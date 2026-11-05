import { describe, expect, it } from "vitest";
import type { NormalizeTarget } from "./audio.js";
import type { Loudness, StreamInfo } from "./ffmpeg.js";
import { Audio } from "./audio.js";

const PCM_24: StreamInfo = { bits: 24, channels: 2, codec: "pcm_s24le" };
const MP3: StreamInfo = { bits: 0, channels: 2, codec: "mp3" };

describe("Audio.stereoSource", () => {
    it("copies a mono file onto both sides", () => {
        expect(Audio.stereoSource(1, [])).toEqual({ kind: "mono" });
    });

    it("copies the side with sound on it when the other is far quieter", () => {
        expect(Audio.stereoSource(2, [-70, -21])).toEqual({
            imbalance: 49,
            kind: "one-sided",
            live: "right",
        });
        expect(Audio.stereoSource(2, [-18, -120])).toEqual({
            imbalance: 102,
            kind: "one-sided",
            live: "left",
        });
    });

    it("leaves a stereo file with sound on both sides alone", () => {
        expect(Audio.stereoSource(2, [-20, -26])).toEqual({
            imbalance: 6,
            kind: "stereo",
        });
    });

    it("copies the side that's picked, whatever the levels", () => {
        expect(Audio.stereoSource(2, [], "left")).toEqual({
            kind: "picked",
            live: "left",
        });
    });
});

describe("Audio.outputPath", () => {
    it("names the output next to the input", () => {
        expect(Audio.outputPath("/a/song.wav", { suffix: "-left" })).toBe(
            "/a/song-left.wav"
        );
        expect(Audio.outputPath("/a/song.mp3", { extension: ".wav" })).toBe(
            "/a/song.wav"
        );
    });
});

describe("Audio.encoderArgs", () => {
    it("keeps the source's quality in the output's format", () => {
        const testCases: Array<[string, StreamInfo, string[]]> = [
            ["out.wav", PCM_24, ["-c:a", "pcm_s24le"]],
            ["out.wav", MP3, ["-c:a", "pcm_s16le"]],
            [
                "out.wav",
                { bits: 32, channels: 2, codec: "pcm_f32le" },
                ["-c:a", "pcm_f32le"],
            ],
            ["out.AIFF", PCM_24, ["-c:a", "pcm_s24be"]],
            ["out.mp3", PCM_24, ["-c:a", "libmp3lame", "-q:a", "0"]],
            ["out.flac", PCM_24, []],
        ];

        for (const [output, source, args] of testCases) {
            expect(Audio.encoderArgs(output, source), output).toEqual(args);
        }
    });

    it("encodes MP3 at a constant bitrate when one is given", () => {
        expect(Audio.encoderArgs("out.mp3", PCM_24, "320k")).toEqual([
            "-c:a",
            "libmp3lame",
            "-b:a",
            "320k",
        ]);
    });
});

describe("Audio's ffmpeg arguments", () => {
    it("splits each side into its own mono file", () => {
        expect(
            Audio.splitArgs("in.mp3", MP3, ["in-left.mp3", "in-right.mp3"])
        ).toEqual([
            "-i",
            "in.mp3",
            "-filter_complex",
            "[0:a:0]asplit=2[a][b];[a]pan=mono|c0=c0[left];[b]pan=mono|c0=c1[right]",
            "-map",
            "[left]",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "0",
            "in-left.mp3",
            "-map",
            "[right]",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "0",
            "in-right.mp3",
        ]);
    });

    it("copies the chosen channel onto both sides", () => {
        expect(Audio.stereoArgs("in.wav", PCM_24, 1, "out.wav")).toEqual([
            "-i",
            "in.wav",
            "-map",
            "0:a:0",
            "-af",
            "pan=stereo|c0=c1|c1=c1",
            "-c:a",
            "pcm_s24le",
            "out.wav",
        ]);
    });
});

describe("Audio.normalization", () => {
    const LOUDNESS = { ceiling: -1, mode: "loudness", target: -14 } as const;
    const PEAK = { ...LOUDNESS, mode: "peak" } as const;

    it("brings a file's loudness to the target", () => {
        expect(
            Audio.normalization({ lufs: -20, truePeak: -8 }, LOUDNESS)
        ).toEqual({ gain: 6, reached: null, status: "gain" });
        expect(
            Audio.normalization({ lufs: -9, truePeak: -0.5 }, LOUDNESS)
        ).toEqual({ gain: -5, reached: null, status: "gain" });
    });

    it("stops where the true peak reaches the ceiling, and says how loud it got", () => {
        expect(
            Audio.normalization({ lufs: -30, truePeak: -5 }, LOUDNESS)
        ).toEqual({ gain: 4, reached: -26, status: "gain" });
    });

    it("brings the true peak to the ceiling in peak mode", () => {
        expect(Audio.normalization({ lufs: null, truePeak: -7 }, PEAK)).toEqual(
            { gain: 6, reached: null, status: "gain" }
        );
    });

    it("skips files it can't measure or that are already there", () => {
        const testCases: Array<[Loudness, NormalizeTarget, string]> = [
            [{ lufs: null, truePeak: null }, LOUDNESS, "it's silent"],
            [
                { lufs: null, truePeak: -6 },
                LOUDNESS,
                "it's too short or quiet to measure its loudness; try --peak",
            ],
            [
                { lufs: -14.05, truePeak: -3 },
                LOUDNESS,
                "it's already at -14.1 LUFS",
            ],
            [
                { lufs: null, truePeak: -1.02 },
                PEAK,
                "its peak is already at -1.0 dBTP",
            ],
        ];

        for (const [loudness, target, reason] of testCases) {
            expect(Audio.normalization(loudness, target), reason).toEqual({
                reason,
                status: "skipped",
            });
        }
    });
});

describe("Audio.gainArgs", () => {
    it("changes the volume and keeps the format", () => {
        expect(Audio.gainArgs("in.wav", PCM_24, 4.256, "out.wav")).toEqual([
            "-i",
            "in.wav",
            "-map",
            "0:a:0",
            "-af",
            "volume=4.26dB",
            "-c:a",
            "pcm_s24le",
            "out.wav",
        ]);
    });
});
