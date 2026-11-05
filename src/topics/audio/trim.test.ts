import type * as Fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ffmpeg } from "./ffmpeg.js";
import {
    replaceOriginal,
    parseSilence,
    readPair,
    trimRange,
    trimSample,
} from "./trim.js";

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof Fs>();
    return { ...actual, rename: vi.fn(actual.rename) };
});

const hasFfmpeg = (() => {
    try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
})();

describe("edge silence", () => {
    it("parses leading, internal and trailing intervals, including an open final interval", () => {
        const report =
            "silence_start: 0\nsilence_end: 0.3 | silence_duration: 0.3\nsilence_start: 0.5\nsilence_end: 0.9 | silence_duration: 0.4\nsilence_start: 1.1";
        const intervals = parseSilence(report, 1.6);
        expect(intervals).toEqual([
            { end: 0.3, start: 0 },
            { end: 0.9, start: 0.5 },
            { end: 1.6, start: 1.1 },
        ]);
        expect(trimRange(intervals, 1.6, 0.01)).toEqual({
            end: 1.11,
            start: 0.29,
        });
    });

    it("keeps inner pauses and skips fully silent samples", () => {
        expect(trimRange([{ end: 0.5, start: 0.3 }], 1, 0.01)).toBeNull();
        expect(trimRange([{ end: 1, start: 0 }], 1, 0.01)).toBeNull();
        expect(trimRange([], 1, 0.01)).toBeNull();
        expect(trimRange([{ end: 0.1, start: 0 }], 1, 0.2)).toBeNull();
        expect(trimRange([{ end: 1, start: 0.7 }], 1, 0)).toEqual({
            end: 0.7,
            start: 0,
        });
    });
});

describe.skipIf(!hasFfmpeg)("trimming samples with ffmpeg", () => {
    let directory: string;
    let file: string;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), "swiss-trim-test-"));
        file = path.join(directory, "sample.wav");
        const inputs = [
            "anullsrc=r=48000:cl=mono:d=0.3",
            "sine=frequency=440:sample_rate=48000:duration=0.2",
            "anullsrc=r=48000:cl=mono:d=0.4",
            "sine=frequency=440:sample_rate=48000:duration=0.2",
            "anullsrc=r=48000:cl=mono:d=0.5",
        ];
        await Ffmpeg.run([
            ...inputs.flatMap((input) => ["-f", "lavfi", "-i", input]),
            "-filter_complex",
            "[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1,pan=stereo|c0=0*c0|c1=c0[out]",
            "-map",
            "[out]",
            "-c:a",
            "pcm_s24le",
            file,
        ]);
    });

    afterEach(async () => {
        await rm(directory, { force: true, recursive: true });
    });

    const options = { padding: 0.01, silence: 0.05, threshold: -60 };

    it("trims both ends, preserves an interior pause and a live stereo channel, and keeps original bytes", async () => {
        const before = await readFile(file);
        const pair = await trimSample(file, options);
        expect(pair).not.toBeNull();
        expect(pair!.trimmedDuration).toBeCloseTo(0.82, 2);
        expect(await Ffmpeg.probe(pair!.trimmed)).toEqual({
            bits: 24,
            channels: 2,
            codec: "pcm_s24le",
        });
        expect(await readFile(file)).toEqual(before);
        expect((await readdir(directory)).sort()).toEqual([
            "sample-trimmed.wav",
            "sample.wav",
        ]);
        const reopened = await readPair(file);
        expect(reopened.trimmedDuration).toBeCloseTo(0.82, 2);
        const trimmedBytes = await readFile(reopened.trimmed);
        await replaceOriginal(reopened);
        expect(await readdir(directory)).toEqual(["sample.wav"]);
        expect(await readFile(file)).toEqual(trimmedBytes);
        expect(await Ffmpeg.duration(file)).toBeCloseTo(0.82, 2);
    });

    it("never overwrites an existing output", async () => {
        const output = path.join(directory, "sample-trimmed.wav");
        await writeFile(output, "keep me");
        await expect(trimSample(file, options)).rejects.toThrow(
            "already exists"
        );
        expect(await readFile(output, "utf8")).toBe("keep me");
    });

    it("trims trailing silence from MP3 despite container duration including encoder delay", async () => {
        const mp3 = path.join(directory, "sample.mp3");
        await Ffmpeg.run(["-i", file, "-c:a", "libmp3lame", "-q:a", "0", mp3]);
        const pair = await trimSample(mp3, options);
        expect(pair).not.toBeNull();
        expect(pair!.trimmedDuration).toBeGreaterThan(0.8);
        expect(pair!.trimmedDuration).toBeLessThan(0.95);
    });

    it("keeps originals when a reviewed output changes or disappears", async () => {
        const pair = (await trimSample(file, options))!;
        await writeFile(pair.trimmed, "changed");
        await expect(replaceOriginal(pair)).rejects.toThrow(
            "changed since review"
        );
        expect((await readFile(file)).length).toBeGreaterThan(0);
        await unlink(pair.trimmed);
        await expect(replaceOriginal(pair)).rejects.toThrow();
        expect((await readFile(file)).length).toBeGreaterThan(0);
    });

    it("keeps an original that changes after review", async () => {
        const pair = (await trimSample(file, options))!;
        await writeFile(file, "replacement");
        await expect(replaceOriginal(pair)).rejects.toThrow(
            "changed since review"
        );
        expect(await readFile(file, "utf8")).toBe("replacement");
    });

    it("keeps both files if replacement fails", async () => {
        const pair = (await trimSample(file, options))!;
        const original = await readFile(pair.original);
        const trimmed = await readFile(pair.trimmed);
        vi.mocked(rename).mockRejectedValueOnce(
            new Error("simulated rename failure")
        );
        await expect(replaceOriginal(pair)).rejects.toThrow(
            "simulated rename failure"
        );
        expect(await readFile(pair.original)).toEqual(original);
        expect(await readFile(pair.trimmed)).toEqual(trimmed);
    });

    it("does not produce a file for silence or audio with no quiet edges", async () => {
        for (const input of [
            "anullsrc=r=48000:cl=mono:d=0.2",
            "sine=frequency=440:duration=0.2",
        ]) {
            await Ffmpeg.run(["-f", "lavfi", "-i", input, file]);
            expect(await trimSample(file, options)).toBeNull();
        }
        expect(await readdir(directory)).toEqual(["sample.wav"]);
    });
});
