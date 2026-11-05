import { UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { Text } from "../../shared/text.js";

// What ffprobe says about a file's first audio stream.
type StreamInfo = {
    // Bits per sample, when the format has a fixed depth (PCM, FLAC); 0 for lossy formats.
    bits: number;
    channels: number;
    // ffprobe's codec_name, like pcm_s24le or mp3.
    codec: string;
};

// A file's loudness, as loudnorm measures it, or null for either when it can't be measured:
// integrated loudness needs at least 400ms of sound, and a silent file has no peak.
type Loudness = {
    // Integrated loudness over the whole file, in LUFS.
    lufs: null | number;
    // Highest true peak, between samples as well as on them, in dBTP.
    truePeak: null | number;
};

// loudnorm prints its measurement as a JSON object on stderr.
const MEASUREMENT = /\{[^{}]*"input_i"[^{}]*\}/;

// loudnorm's level for a file it heard nothing in, which isn't a real loudness.
const UNMEASURED_LUFS = -70;

// Stands in for astats' "-inf" on a channel of digital silence, so a level is always a number.
const SILENT_DB = -120;

// Splits astats' report into one block per channel.
const CHANNEL_HEADING = /Channel:\s*\d+/;

// Runs ffmpeg and ffprobe. Everything that decides what to run is in Audio, so it can be tested
// without them.
class Ffmpeg {
    // Each channel's RMS level over the whole file, in dBFS, via the astats filter.
    static async channelLevels(file: string): Promise<number[]> {
        // astats reports on stderr, alongside ffmpeg's own logging, so it runs at info level.
        const report = await Exec.run(
            "ffmpeg",
            [
                "-nostdin",
                "-hide_banner",
                "-nostats",
                "-i",
                file,
                "-af",
                "astats=measure_overall=none:measure_perchannel=RMS_level",
                "-f",
                "null",
                "-",
            ],
            { stderr: true }
        );
        return Ffmpeg.parseLevels(report);
    }

    static async duration(file: string): Promise<number> {
        const output = await Exec.run("ffprobe", [
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=duration:format=duration",
            "-of",
            "json",
            file,
        ]);
        const result = JSON.parse(output) as {
            format?: { duration?: string };
            streams?: Array<{ duration?: string }>;
        };
        const duration = [
            result.streams?.[0]?.duration,
            result.format?.duration,
        ]
            .filter((value) => value != null && value.trim() !== "")
            .map(Number)
            .find((value) => Number.isFinite(value) && value >= 0);
        if (result.streams?.[0] == null || duration == null) {
            throw new UserError(
                `${Text.displayPath(file)} has no measurable audio duration`
            );
        }
        return duration;
    }

    // The file's integrated loudness and true peak, via loudnorm's measuring pass, whose output
    // is thrown away.
    static async loudness(file: string): Promise<Loudness> {
        const report = await Exec.run(
            "ffmpeg",
            [
                "-nostdin",
                "-hide_banner",
                "-nostats",
                "-i",
                file,
                "-map",
                "0:a:0",
                "-af",
                "loudnorm=print_format=json",
                "-f",
                "null",
                "-",
            ],
            { stderr: true }
        );
        return Ffmpeg.parseLoudness(report);
    }

    // The RMS levels out of astats' report, one per channel.
    static parseLevels(report: string): number[] {
        const [, ...blocks] = report.split(CHANNEL_HEADING);
        return blocks.map((block) => {
            const value = /RMS level dB:\s*(\S+)/.exec(block)?.[1];
            const level = Number(value);
            return value == null || !Number.isFinite(level) ? SILENT_DB : level;
        });
    }

    // The loudness out of loudnorm's report.
    static parseLoudness(report: string): Loudness {
        const json = MEASUREMENT.exec(report)?.[0];
        if (json == null) {
            throw new UserError("ffmpeg didn't report its loudness");
        }
        const { input_i: lufs, input_tp: truePeak } = JSON.parse(json) as {
            input_i: string;
            input_tp: string;
        };
        const measured = (value: string): null | number => {
            const level = Number(value);
            return Number.isFinite(level) ? level : null;
        };
        const integrated = measured(lufs);
        return {
            lufs:
                integrated == null || integrated <= UNMEASURED_LUFS
                    ? null
                    : integrated,
            truePeak: measured(truePeak),
        };
    }

    static parseProbe(output: string, file: string): StreamInfo {
        const { streams } = JSON.parse(output) as {
            streams?: Array<Record<string, number | string | undefined>>;
        };
        const stream = streams?.[0];
        if (stream == null) {
            throw new UserError(`${Text.displayPath(file)} has no audio in it`);
        }
        // PCM has bits_per_sample; FLAC and ALAC have bits_per_raw_sample, as a string.
        const bits = [stream.bits_per_sample, stream.bits_per_raw_sample]
            .map(Number)
            .find((value) => Number.isFinite(value) && value > 0);
        return {
            bits: bits ?? 0,
            channels: Number(stream.channels),
            codec: String(stream.codec_name),
        };
    }

    static async probe(file: string): Promise<StreamInfo> {
        const output = await Exec.run("ffprobe", [
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,channels,bits_per_sample,bits_per_raw_sample",
            "-of",
            "json",
            file,
        ]);
        return Ffmpeg.parseProbe(output, file);
    }

    // Runs ffmpeg with args between the input and the outputs, which it overwrites.
    static async run(args: string[]): Promise<void> {
        await Exec.run("ffmpeg", [
            "-nostdin",
            "-hide_banner",
            "-v",
            "error",
            "-y",
            ...args,
        ]);
    }
}

export type { Loudness, StreamInfo };
export { Ffmpeg, SILENT_DB };
