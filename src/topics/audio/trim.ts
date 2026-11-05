import { link, lstat, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { nullIfMissing, UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { Audio } from "./audio.js";
import { Ffmpeg } from "./ffmpeg.js";

type Silence = { end: number; start: number };
type TrimOptions = { padding: number; silence: number; threshold: number };
type TrimRange = { end: number; start: number };
type Fingerprint = { dev: number; ino: number; mtimeMs: number; size: number };
type TrimPair = {
    original: string;
    originalDuration: number;
    originalState: Fingerprint;
    trimmed: string;
    trimmedDuration: number;
    trimmedState: Fingerprint;
};

function trimmedPath(file: string): string {
    return Audio.outputPath(file, { suffix: "-trimmed" });
}

// Default silencedetect considers a region silent only when all channels are quiet.
function parseSilence(report: string, duration: number): Silence[] {
    const intervals: Silence[] = [];
    let start: null | number = null;
    for (const match of report.matchAll(
        /silence_(start|end):\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi
    )) {
        const value = Math.max(0, Math.min(duration, Number(match[2])));
        if (match[1] === "start") {
            start = value;
        } else if (start != null) {
            intervals.push({ end: value, start });
            start = null;
        }
    }
    if (start != null) {
        intervals.push({ end: duration, start });
    }
    return intervals;
}

function trimRange(
    intervals: Silence[],
    duration: number,
    padding: number
): null | TrimRange {
    const first = intervals[0];
    const last = intervals.at(-1);
    // ffmpeg rounds printed times; never treat an interior pause as an edge.
    const start =
        first != null && first.start <= 0.000001
            ? Math.max(0, first.end - padding)
            : 0;
    const end =
        last != null && last.end >= duration - 0.000001
            ? Math.min(duration, last.start + padding)
            : duration;
    if (
        end <= start ||
        (start === 0 && end === duration) ||
        intervals.some(
            (interval) => interval.start === 0 && interval.end >= duration
        )
    ) {
        return null;
    }
    return { end, start };
}

async function fingerprint(file: string): Promise<Fingerprint> {
    const info = await lstat(file);
    if (!info.isFile()) {
        throw new UserError(`Not a regular file: ${file}`);
    }
    return {
        dev: info.dev,
        ino: info.ino,
        mtimeMs: info.mtimeMs,
        size: info.size,
    };
}

function sameFile(a: Fingerprint, b: Fingerprint): boolean {
    return (
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs
    );
}

async function readPair(original: string): Promise<TrimPair> {
    const trimmed = trimmedPath(original);
    return {
        original,
        originalDuration: await Ffmpeg.duration(original),
        originalState: await fingerprint(original),
        trimmed,
        trimmedDuration: await Ffmpeg.duration(trimmed),
        trimmedState: await fingerprint(trimmed),
    };
}

async function trimSample(
    file: string,
    options: TrimOptions
): Promise<null | TrimPair> {
    const originalState = await fingerprint(file);
    const output = trimmedPath(file);
    if ((await lstat(output).catch(nullIfMissing)) != null) {
        throw new UserError(
            `${path.basename(output)} already exists; use --review-only to review it, or move it before trimming again`
        );
    }
    const source = await Ffmpeg.probe(file);
    const duration = await Ffmpeg.duration(file);
    const report = await Exec.run(
        "ffmpeg",
        [
            "-nostdin",
            "-hide_banner",
            "-nostats",
            "-progress",
            "pipe:2",
            "-i",
            file,
            "-map",
            "0:a:0",
            "-af",
            `silencedetect=noise=${options.threshold}dB:d=${options.silence}`,
            "-f",
            "null",
            "-",
        ],
        { stderr: true }
    );
    // MP3/AAC container durations can include encoder delay. Use the decoded timeline
    // reported by the measuring pass so trailing silence is recognized in those files too.
    const decodedDuration =
        Array.from(
            report.matchAll(/^out_time_us=(\d+)$/gm),
            (match) => Number(match[1]) / 1_000_000
        )
            .filter((value) => value > 0)
            .at(-1) ?? duration;
    const range = trimRange(
        parseSilence(report, decodedDuration),
        decodedDuration,
        options.padding
    );
    if (range == null) {
        return null;
    }
    const staging = await mkdtemp(
        path.join(path.dirname(file), ".swiss-trim-")
    );
    const temporary = path.join(staging, path.basename(output));
    try {
        await Ffmpeg.run([
            "-i",
            file,
            "-map",
            "0:a:0",
            "-af",
            `atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS`,
            ...Audio.encoderArgs(output, source),
            temporary,
        ]);
        const trimmedDuration = await Ffmpeg.duration(temporary);
        if (
            trimmedDuration <= 0 ||
            !sameFile(originalState, await fingerprint(file))
        ) {
            throw new UserError(
                "The original changed during trimming or the trimmed audio is empty; nothing written"
            );
        }
        // Publish exclusively: an existing file is never overwritten, including one created
        // while ffmpeg was running. The temporary file has the same extension for encoding.
        await link(temporary, output);
        return {
            original: file,
            originalDuration: duration,
            originalState,
            trimmed: output,
            trimmedDuration,
            trimmedState: await fingerprint(output),
        };
    } finally {
        await rm(staging, { recursive: true });
    }
}

async function validatePair(pair: TrimPair): Promise<void> {
    if (
        !sameFile(pair.originalState, await fingerprint(pair.original)) ||
        !sameFile(pair.trimmedState, await fingerprint(pair.trimmed))
    ) {
        throw new UserError(
            "The original or trimmed file changed since review; review it again before replacing"
        );
    }
}

async function replaceOriginal(pair: TrimPair): Promise<void> {
    await validatePair(pair);
    // Rename replaces the original in one operation. If it fails, both files retain
    // their names; there is no gap between deleting the original and moving the trim.
    await rename(pair.trimmed, pair.original);
}

export type { Silence, TrimOptions, TrimPair, TrimRange };
export {
    parseSilence,
    readPair,
    replaceOriginal,
    trimmedPath,
    trimRange,
    trimSample,
    validatePair,
};
