import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Exec } from "../../shared/exec.js";
import { Ffmpeg, SILENT_DB } from "./ffmpeg.js";

const hasFfmpeg = (() => {
    try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
})();

describe("Ffmpeg.duration", () => {
    afterEach(() => vi.restoreAllMocks());

    it("prefers stream duration and falls back to the container's duration", async () => {
        const run = vi.spyOn(Exec, "run");
        run.mockResolvedValueOnce(
            JSON.stringify({
                format: { duration: "2" },
                streams: [{ duration: "1.25" }],
            })
        );
        expect(await Ffmpeg.duration("sample.wav")).toBe(1.25);
        run.mockResolvedValueOnce(
            JSON.stringify({
                format: { duration: "2.5" },
                streams: [{ duration: "N/A" }],
            })
        );
        expect(await Ffmpeg.duration("sample.mp3")).toBe(2.5);
    });

    it("rejects files without audio or a usable duration", async () => {
        const run = vi.spyOn(Exec, "run");
        for (const result of [
            { format: { duration: "3" }, streams: [] },
            { streams: [{}] },
            { streams: [{ duration: "-1" }] },
            { streams: [{ duration: "" }] },
        ]) {
            run.mockResolvedValueOnce(JSON.stringify(result));
            await expect(Ffmpeg.duration("bad.wav")).rejects.toThrow(
                "no measurable audio duration"
            );
        }
    });
});

describe("Ffmpeg.parseLevels", () => {
    it("reads each channel's RMS level out of astats' report", () => {
        const report = `[Parsed_astats_0 @ 0x7fb74d009680] Channel: 1
[Parsed_astats_0 @ 0x7fb74d009680] RMS level dB: -70.786718
[Parsed_astats_0 @ 0x7fb74d009680] Channel: 2
[Parsed_astats_0 @ 0x7fb74d009680] RMS level dB: -21.074022
[out#0/null @ 0x7fb74d009980] video:0KiB audio:562KiB subtitle:0KiB`;

        expect(Ffmpeg.parseLevels(report)).toEqual([-70.786_718, -21.074_022]);
    });

    it("counts a channel of digital silence as a very low level", () => {
        const report = `[Parsed_astats_0 @ 0x1] Channel: 1
[Parsed_astats_0 @ 0x1] RMS level dB: -inf`;

        expect(Ffmpeg.parseLevels(report)).toEqual([SILENT_DB]);
    });
});

describe("Ffmpeg.parseLoudness", () => {
    const report = (
        lufs: string,
        truePeak: string
    ): string => `[Parsed_loudnorm_0 @ 0x1]
{
\t"input_i" : "${lufs}",
\t"input_tp" : "${truePeak}",
\t"input_lra" : "0.00",
\t"normalization_type" : "dynamic",
\t"target_offset" : "-0.02"
}
[out#0/null @ 0x2] video:0KiB audio:2250KiB`;

    it("reads loudnorm's measurement", () => {
        expect(Ffmpeg.parseLoudness(report("-18.75", "-18.04"))).toEqual({
            lufs: -18.75,
            truePeak: -18.04,
        });
    });

    it("has no loudness for a file too short to measure, and no peak for silence", () => {
        expect(Ffmpeg.parseLoudness(report("-inf", "-18.06"))).toEqual({
            lufs: null,
            truePeak: -18.06,
        });
        expect(Ffmpeg.parseLoudness(report("-70.00", "-inf"))).toEqual({
            lufs: null,
            truePeak: null,
        });
    });
});

describe("Ffmpeg.parseProbe", () => {
    it("reads the bit depth from whichever field the format uses", () => {
        const testCases: Array<[Record<string, unknown>, number]> = [
            [{ bits_per_sample: 24, codec_name: "pcm_s24le" }, 24],
            [
                {
                    bits_per_raw_sample: "24",
                    bits_per_sample: 0,
                    codec_name: "flac",
                },
                24,
            ],
            [{ bits_per_sample: 0, codec_name: "mp3" }, 0],
        ];

        for (const [stream, bits] of testCases) {
            const output = JSON.stringify({
                streams: [{ channels: 2, ...stream }],
            });
            expect(Ffmpeg.parseProbe(output, "song"), output).toEqual({
                bits,
                channels: 2,
                codec: stream.codec_name,
            });
        }
    });

    it("says when a file has no audio", () => {
        expect(() =>
            Ffmpeg.parseProbe(JSON.stringify({ streams: [] }), "/movie.png")
        ).toThrow("/movie.png has no audio in it");
    });
});

describe.skipIf(!hasFfmpeg)("Ffmpeg, running ffmpeg", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "swiss-audio-"));
    });

    afterEach(() => {
        rmSync(dir, { force: true, recursive: true });
    });

    it("measures a stereo file with a quiet side as one-sided", async () => {
        const file = path.join(dir, "take.wav");
        // Faint hiss on the left, where a mic wasn't plugged in, and a tone on the right.
        await Ffmpeg.run([
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=a=0.0005:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=440:d=1",
            "-filter_complex",
            "[0][1]amerge=inputs=2",
            "-c:a",
            "pcm_s24le",
            file,
        ]);

        expect(await Ffmpeg.probe(file)).toEqual({
            bits: 24,
            channels: 2,
            codec: "pcm_s24le",
        });
        expect(await Ffmpeg.duration(file)).toBeCloseTo(1, 2);
        const [left, right] = await Ffmpeg.channelLevels(file);
        expect(right! - left!).toBeGreaterThan(40);
    });
});
