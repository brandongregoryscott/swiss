import { Flags } from "@oclif/core";
import { isEmpty, isObject } from "lodash-es";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Failure } from "../../shared/errors.js";
import type { StreamInfo } from "./ffmpeg.js";
import { SwissCommand } from "../../shared/command.js";
import { Concurrency } from "../../shared/concurrency.js";
import { settle, UserError } from "../../shared/errors.js";
import { Text } from "../../shared/text.js";
import { Ffmpeg } from "./ffmpeg.js";

// How many files to look at with ffprobe at once.
const PROBE_LIMIT = 8;

// What an audio command will do with one file.
type Job = {
    // ffmpeg's arguments after its global ones.
    args: string[];
    // Why the output is what it is, like which side was copied, shown after it.
    note?: string;
    outputs: string[];
};

// A file an audio command leaves alone, and why.
type Skip = { reason: string; status: "skipped" };

const AUDIO_FLAGS = {
    yes: Flags.boolean({
        char: "y",
        description:
            "Overwrite files that are already there without asking, which is required when there's no terminal to ask in",
    }),
};

const AUDIO_HELP = `New files are written next to the ones they're made from, which are never changed. If one is already there, you're asked before it's overwritten; --yes overwrites without asking.`;

// The base of the audio commands, which each turn every file they're given into new files with
// ffmpeg. A command says what to do with one file, and this probes each one, shows what's
// skipped and why, asks before overwriting anything, and runs ffmpeg for the rest. Each command
// sets strict = false itself to take any number of files, since oclif only reads a command's own
// statics.
abstract class AudioCommand extends SwissCommand {
    static override cancelled = "Nothing written";

    // What to do with file, which probe describes.
    protected abstract plan(
        file: string,
        probe: StreamInfo
    ): Promise<Job | Skip>;

    // Runs plan on every file in argv.
    protected async process(argv: unknown[], yes: boolean): Promise<void> {
        const files = (argv as string[]).map((file) => path.resolve(file));
        if (isEmpty(files)) {
            this.error("Give at least one audio file, like song.wav");
        }

        const planned = await Promise.all(
            Concurrency.map(files, PROBE_LIMIT, (file) =>
                settle(async () => {
                    if (!existsSync(file)) {
                        throw new UserError("it doesn't exist");
                    }
                    return this.plan(file, await Ffmpeg.probe(file));
                })
            )
        );

        const jobs: Array<{ input: string } & Job> = [];
        for (const [index, outcome] of planned.entries()) {
            const input = files[index]!;
            if (isSkip(outcome)) {
                this.log(
                    this.style(
                        "dim",
                        `Skipped ${show(input)}: ${outcome.reason}`
                    )
                );
            } else if (isFailure(outcome)) {
                this.failed = true;
                this.log(
                    `${this.style("red", "Couldn't read")} ${show(input)}: ${outcome.reason}`
                );
            } else {
                jobs.push({ ...outcome, input });
            }
        }
        if (isEmpty(jobs)) {
            return;
        }

        const existing = jobs
            .flatMap((job) => job.outputs)
            .filter((output) => existsSync(output));
        if (!isEmpty(existing)) {
            const consent = this.terminal.consent(yes, "overwrite files");
            this.log("Already there:");
            for (const output of existing) {
                this.log(`  ${show(output)}`);
            }
            await consent.confirm(
                `Overwrite ${Text.pluralize(existing.length, "file")}?`
            );
        }

        // One at a time, since ffmpeg already uses every core.
        for (const job of jobs) {
            const outcome = await settle(() => Ffmpeg.run(job.args));
            if (isFailure(outcome)) {
                this.failed = true;
                this.log(
                    `${this.style("red", "Couldn't convert")} ${show(job.input)}: ${outcome.reason}`
                );
                continue;
            }
            const note =
                job.note == null ? "" : this.style("dim", ` (${job.note})`);
            this.log(
                `${show(job.input)} → ${this.style("green", job.outputs.map(show).join(", "))}${note}`
            );
        }
    }
}

function isFailure(outcome: unknown): outcome is Failure {
    return status(outcome) === "error";
}

function isSkip(outcome: unknown): outcome is Skip {
    return status(outcome) === "skipped";
}

// The status a Failure or Skip has, and undefined for anything else, like a Job or nothing.
function status(outcome: unknown): unknown {
    return isObject(outcome) && "status" in outcome
        ? outcome.status
        : undefined;
}

// file relative to the current directory when it's in it, and with ~ for the home directory
// otherwise.
function show(file: string): string {
    const relative = path.relative(process.cwd(), file);
    return relative.startsWith("..") || path.isAbsolute(relative)
        ? Text.displayPath(file)
        : relative;
}

export type { Job, Skip };
export { AUDIO_FLAGS, AUDIO_HELP, AudioCommand };
