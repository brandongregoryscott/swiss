import path from "node:path";
import type { Loudness, StreamInfo } from "./ffmpeg.js";
import { Ffmpeg } from "./ffmpeg.js";

type Side = "left" | "right";

const SIDES: readonly Side[] = ["left", "right"];

// How far below the louder channel the quieter one has to be for a stereo file to count as
// one-sided: recorded in stereo with one side empty. A wide mix keeps its channels within a few
// dB of each other, and a dead side with only noise on it is 40 dB or more down.
const ONE_SIDED_DB = 20;

// Where a stereo file's two sides come from, by kind:
// - stereo: already stereo, with sound on both sides, so there's nothing to do
// - mono: a mono file, copied onto both sides
// - one-sided: a stereo file with one side empty, whose live side is copied onto both
// - picked: a stereo file whose side to copy was picked with --channel
type StereoSource =
    | { imbalance: number; kind: "one-sided"; live: Side }
    | { imbalance: number; kind: "stereo" }
    | { kind: "mono" }
    | { kind: "picked"; live: Side };

// How a file is normalized: to a loudness in LUFS, or with its loudest true peak at the ceiling.
// Either way the gain never takes the true peak above ceiling, in dBTP.
type NormalizeTarget = {
    ceiling: number;
    mode: "loudness" | "peak";
    // LUFS, for loudness mode.
    target: number;
};

// The gain that normalizes a file, in dB, and the loudness it reaches instead when the ceiling
// held it back from the target, or null when it didn't.
type Normalization =
    | { gain: number; reached: null | number; status: "gain" }
    | { reason: string; status: "skipped" };

// Gains smaller than this, in dB, aren't worth re-encoding a file for.
const NEGLIGIBLE_GAIN_DB = 0.1;

// A file that's mono or stereo, which are the only kinds these commands handle.
type Channels = 1 | 2;

// What the audio commands run, worked out here so it can be tested without ffmpeg.
class Audio {
    static readonly ONE_SIDED_DB = ONE_SIDED_DB;

    static readonly SIDES = SIDES;

    // Converts input to output's format, keeping its channels.
    static convertArgs(
        input: string,
        source: StreamInfo,
        output: string,
        bitrate?: string
    ): string[] {
        return [
            "-i",
            input,
            // Only the audio, since cover art can't go in every format.
            "-map",
            "0:a:0",
            ...Audio.encoderArgs(output, source, bitrate),
            output,
        ];
    }

    // The arguments that pick the encoder for output, chosen from its extension, keeping the
    // source's quality: WAV and AIFF at the source's bit depth (24-bit when it's that or more,
    // 16 otherwise, and float WAV stays float), and MP3 at bitrate, or LAME's best VBR setting
    // without one. Other formats get ffmpeg's encoder for them.
    static encoderArgs(
        output: string,
        source: StreamInfo,
        bitrate?: string
    ): string[] {
        const depth = source.bits >= 24 ? 24 : 16;
        switch (path.extname(output).toLowerCase()) {
            case ".aif":
            case ".aiff": {
                return ["-c:a", `pcm_s${depth}be`];
            }

            case ".mp3": {
                return [
                    "-c:a",
                    "libmp3lame",
                    ...(bitrate == null ? ["-q:a", "0"] : ["-b:a", bitrate]),
                ];
            }

            case ".wav": {
                return [
                    "-c:a",
                    /^pcm_f(32|64)le$/.test(source.codec)
                        ? source.codec
                        : `pcm_s${depth}le`,
                ];
            }

            default: {
                return [];
            }
        }
    }

    // dB to one decimal place, with a + on gains, like +3.2 or -14.0.
    static formatDb(value: number, signed = false): string {
        const text = value.toFixed(1);
        return signed && value >= 0 ? `+${text}` : text;
    }

    // Changes input's volume by gain dB, keeping its format and channels.
    static gainArgs(
        input: string,
        source: StreamInfo,
        gain: number,
        output: string
    ): string[] {
        return [
            "-i",
            input,
            "-map",
            "0:a:0",
            "-af",
            `volume=${gain.toFixed(2)}dB`,
            ...Audio.encoderArgs(output, source),
            output,
        ];
    }

    // The gain that brings a file with this loudness to target. It's one gain for the whole
    // file, so its dynamics are kept, rather than loudnorm's own processing, which compresses
    // when it can't reach the target without clipping. Instead the gain stops where the true
    // peak reaches the ceiling, and says so.
    static normalization(
        { lufs, truePeak }: Loudness,
        { ceiling, mode, target }: NormalizeTarget
    ): Normalization {
        if (truePeak == null) {
            return { reason: "it's silent", status: "skipped" };
        }
        const headroom = ceiling - truePeak;
        if (mode === "peak") {
            return Math.abs(headroom) < NEGLIGIBLE_GAIN_DB
                ? {
                      reason: `its peak is already at ${Audio.formatDb(truePeak)} dBTP`,
                      status: "skipped",
                  }
                : { gain: headroom, reached: null, status: "gain" };
        }

        if (lufs == null) {
            return {
                reason: "it's too short or quiet to measure its loudness; try --peak",
                status: "skipped",
            };
        }
        const wanted = target - lufs;
        const gain = Math.min(wanted, headroom);
        if (Math.abs(gain) < NEGLIGIBLE_GAIN_DB) {
            return {
                reason: `it's already at ${Audio.formatDb(lufs)} LUFS`,
                status: "skipped",
            };
        }
        return {
            gain,
            reached: gain < wanted ? lufs + gain : null,
            status: "gain",
        };
    }

    // The file next to input named with suffix, like song-left.wav, in extension's format when
    // it's given, like ".wav".
    static outputPath(
        input: string,
        { extension, suffix = "" }: { extension?: string; suffix?: string }
    ): string {
        const { dir, ext, name } = path.parse(input);
        return path.join(dir, `${name}${suffix}${extension ?? ext}`);
    }

    // Splits a stereo input into a mono file per side, in its own format.
    static splitArgs(
        input: string,
        source: StreamInfo,
        [left, right]: [string, string]
    ): string[] {
        return [
            "-i",
            input,
            "-filter_complex",
            "[0:a:0]asplit=2[a][b];[a]pan=mono|c0=c0[left];[b]pan=mono|c0=c1[right]",
            "-map",
            "[left]",
            ...Audio.encoderArgs(left, source),
            left,
            "-map",
            "[right]",
            ...Audio.encoderArgs(right, source),
            right,
        ];
    }

    // Copies one of input's channels onto both sides of a stereo output. pan states the matrix
    // outright, so each side is the source channel exactly; -ac 2 would go through ffmpeg's
    // upmix, which can lower the level, and can't pick the channel.
    static stereoArgs(
        input: string,
        source: StreamInfo,
        channel: number,
        output: string
    ): string[] {
        return [
            "-i",
            input,
            "-map",
            "0:a:0",
            "-af",
            `pan=stereo|c0=c${channel}|c1=c${channel}`,
            ...Audio.encoderArgs(output, source),
            output,
        ];
    }

    // Where the sides of a stereo version of a file with these channels come from. levels are a
    // stereo file's RMS levels, left then right, and picked is the side --channel chose.
    static stereoSource(
        channels: Channels,
        levels: number[],
        picked?: Side
    ): StereoSource {
        if (channels === 1) {
            return { kind: "mono" };
        }
        if (picked != null) {
            return { kind: "picked", live: picked };
        }
        const [left = 0, right = 0] = levels;
        const imbalance = Math.abs(left - right);
        if (imbalance < ONE_SIDED_DB) {
            return { imbalance, kind: "stereo" };
        }
        return {
            imbalance,
            kind: "one-sided",
            live: left > right ? "left" : "right",
        };
    }

    // Works out where a stereo version of file comes from, measuring its levels only when that
    // can change the answer.
    static async stereoSourceOf(
        file: string,
        source: { channels: Channels } & StreamInfo,
        picked?: Side
    ): Promise<StereoSource> {
        const levels =
            source.channels === 2 && picked == null
                ? await Ffmpeg.channelLevels(file)
                : [];
        return Audio.stereoSource(source.channels, levels, picked);
    }
}

export type { Channels, Normalization, NormalizeTarget, Side, StereoSource };
export { Audio };
