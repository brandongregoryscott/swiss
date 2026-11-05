import { Flags } from "@oclif/core";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { TrimPair } from "../../topics/audio/trim.js";
import { SwissCommand } from "../../shared/command.js";
import { nullIfMissing, settle, UserError } from "../../shared/errors.js";
import { Cancelled } from "../../shared/terminal.js";
import { Text } from "../../shared/text.js";
import { sampleFiles } from "../../topics/audio/classify.js";
import { TrimPrompt } from "../../topics/audio/trim-prompt.js";
import {
    readPair,
    replaceOriginal,
    trimSample,
    trimmedPath,
    validatePair,
} from "../../topics/audio/trim.js";

export default class AudioTrim extends SwissCommand {
    static override cancelled = "Originals kept; trimmed files remain";

    static override description = `Trim silence from the beginning and end of audio samples, then compare them before replacing originals.

Accepts files or directories (not recursive). Writes sample-trimmed.wav beside sample.wav, keeping the format, channels and bit depth where supported. Lossy formats are re-encoded. Existing outputs are never overwritten. Files already ending in -trimmed are ignored. Interior pauses are preserved; entirely silent files and files without removable edge silence are skipped.

Silence must be below --threshold (default -60 dB) for at least --silence seconds (default 0.05). --padding keeps 0.01 seconds at each trimmed edge by default. A higher threshold trims more aggressively; use --threshold 50 for -50 dB.

In a terminal, review successful trims: left plays the original, right plays the trimmed sample, Space plays/stops, and up/down moves between pairs. D marks an original for replacement; Enter shows the plan and asks for consent, starting on no. Confirming replaces each marked original with its trimmed audio, dropping the -trimmed suffix so the original filename is kept. Escape keeps both versions. Changed or missing files prevent replacement.

--no-review only writes trimmed files; it is also the behavior without a terminal. --review-only reopens comparisons for existing original/trimmed pairs without trimming again.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> kick.wav snare.wav",
        '<%= config.bin %> <%= command.id %> "./samples" --threshold 50 --padding 0.02',
        '<%= config.bin %> <%= command.id %> "./samples" --review-only',
    ];

    static override flags = {
        padding: Flags.string({
            default: "0.01",
            description: "Seconds of silence to retain at each trimmed edge",
        }),
        review: Flags.boolean({
            allowNo: true,
            default: true,
            description:
                "Compare originals and trimmed files interactively after trimming",
        }),
        "review-only": Flags.boolean({
            description:
                "Review existing original/trimmed pairs without creating files",
        }),
        silence: Flags.string({
            default: "0.05",
            description: "Minimum silence duration to detect, in seconds",
        }),
        threshold: Flags.string({
            default: "60",
            description: "Silence threshold in dB (minus sign optional)",
        }),
    };

    static override strict = false;
    static override usage =
        "<%= command.id %> FILE_OR_DIRECTORY... [--threshold DB] [--silence SECONDS] [--padding SECONDS] [--no-review | --review-only]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(AudioTrim);
        if (argv.length === 0) {
            throw new UserError(
                "Give at least one audio file or sample directory"
            );
        }
        if (flags["review-only"]) {
            if (!flags.review) {
                throw new UserError(
                    "Use --review-only or --no-review, not both"
                );
            }
            this.terminal.requireInteractive(undefined, "--review-only");
        }
        const options = {
            padding: seconds(flags.padding, "padding", true),
            silence: seconds(flags.silence, "silence", false),
            threshold: -seconds(
                flags.threshold.replace(/^-/, ""),
                "threshold",
                true
            ),
        };
        const files = new Set<string>();
        for (const argument of argv as string[]) {
            const file = path.resolve(argument);
            const outcome = await settle(async () => {
                const info = await lstat(file);
                if (info.isDirectory()) {
                    return sampleFiles(file);
                }
                if (!info.isFile()) {
                    throw new UserError("it isn't a regular file or directory");
                }
                return [file];
            });
            if (Array.isArray(outcome)) {
                for (const item of outcome) {
                    if (
                        !path
                            .parse(item)
                            .name.toLowerCase()
                            .endsWith("-trimmed")
                    ) {
                        files.add(item);
                    }
                }
            } else {
                this.failed = true;
                this.warn(`${Text.displayPath(file)}: ${outcome.reason}`);
            }
        }
        const pairs: TrimPair[] = [];
        for (const file of files) {
            const spinner = this.terminal.spinner();
            spinner.start(
                `${flags["review-only"] ? "Reading" : "Trimming"} ${path.basename(file)}`
            );
            const outcome = await settle(async () => {
                if (flags["review-only"]) {
                    return (await lstat(trimmedPath(file)).catch(
                        nullIfMissing
                    )) == null
                        ? null
                        : readPair(file);
                }
                return trimSample(file, options);
            });
            spinner.stop(path.basename(file));
            if (outcome == null) {
                this.log(
                    `Skipped ${Text.displayPath(file)}: ${flags["review-only"] ? "no trimmed file" : "no removable edge silence (or entirely silent)"}`
                );
            } else if ("status" in outcome) {
                this.failed = true;
                this.warn(`${Text.displayPath(file)}: ${outcome.reason}`);
            } else {
                pairs.push(outcome);
                this.log(
                    `${Text.displayPath(file)} → ${path.basename(outcome.trimmed)} (${outcome.originalDuration.toFixed(2)}s → ${outcome.trimmedDuration.toFixed(2)}s)`
                );
            }
        }
        if (pairs.length === 0) {
            this.log("No trimmed samples to review; originals kept");
            return;
        }
        if (!flags.review || !this.terminal.interactive) {
            this.log(
                "Originals kept. Run audio trim with the same inputs and --review-only to compare them later."
            );
            return;
        }
        const marked = await TrimPrompt.review(pairs, process.stderr);
        if (marked == null) {
            throw new Cancelled();
        }
        const removable: TrimPair[] = [];
        for (const pair of marked) {
            const outcome = await settle(() => validatePair(pair));
            if (outcome != null) {
                this.failed = true;
                this.warn(
                    `Keeping ${Text.displayPath(pair.original)}: ${outcome.reason}`
                );
            } else {
                removable.push(pair);
            }
        }
        if (removable.length === 0) {
            this.log("No originals replaced; trimmed files remain");
            return;
        }
        this.table(
            [
                ["Replace original", "With trimmed audio"],
                ...removable.map((pair) => [
                    Text.displayPath(pair.original),
                    Text.displayPath(pair.trimmed),
                ]),
            ],
            { fit: false }
        );
        await this.terminal
            .consent(false, "replace originals")
            .confirm(
                `Replace ${Text.pluralize(removable.length, "original")} with trimmed audio? The -trimmed suffix will be removed.`
            );
        for (const pair of removable) {
            const outcome = await settle(() => replaceOriginal(pair));
            if (outcome != null) {
                this.failed = true;
                this.warn(
                    `Couldn't replace ${Text.displayPath(pair.original)}: ${outcome.reason}`
                );
            } else {
                this.log(
                    `Replaced ${Text.displayPath(pair.original)} with trimmed audio; removed the -trimmed suffix`
                );
            }
        }
    }
}

function seconds(input: string, flag: string, zero: boolean): number {
    const value = Number(input);
    if (
        input.trim() === "" ||
        !Number.isFinite(value) ||
        (zero ? value < 0 : value <= 0)
    ) {
        throw new UserError(
            `--${flag} must be a finite ${zero ? "non-negative" : "positive"} number`
        );
    }
    return value;
}
