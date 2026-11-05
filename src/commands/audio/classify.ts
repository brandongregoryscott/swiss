import { Args, Flags } from "@oclif/core";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Sample } from "../../topics/audio/classify.js";
import { SwissCommand } from "../../shared/command.js";
import { Concurrency } from "../../shared/concurrency.js";
import { settle } from "../../shared/errors.js";
import { Cancelled } from "../../shared/terminal.js";
import { Text } from "../../shared/text.js";
import { ClassifyPrompt } from "../../topics/audio/classify-prompt.js";
import {
    applyRenames,
    categoriesFrom,
    CATEGORIES,
    Classification,
    renamePlan,
    sampleFiles,
} from "../../topics/audio/classify.js";
import { Ffmpeg } from "../../topics/audio/ffmpeg.js";

export default class AudioClassify extends SwissCommand {
    static override args = {
        directory: Args.directory({
            description: "Directory of samples to classify (not recursive)",
            exists: true,
            required: true,
        }),
    };

    static override cancelled = "Nothing renamed";

    static override description = `Listen to samples and assign categories before renaming them together.

Up/down selects a sample, left/right cycles its category, and Space plays or stops it. A toggles autoplay: the selected sample plays immediately and each time you move up/down. --autoplay starts with it enabled. Each sample shows its duration. Unclassified samples keep their names. Enter reviews the renames; you can return to editing before applying them. Escape cancels without changing files.

Names become "one-shot 1.wav", "one-shot 2.wav", etc., keeping their extensions and avoiding existing names. Only regular audio files directly in the directory are included. Requires ffprobe for durations, and afplay on macOS or ffplay elsewhere for playback. Audio is never re-encoded.`;

    static override examples = [
        '<%= config.bin %> <%= command.id %> "/Users/Brandon/Music/Samples/Misc/Tascam Dumps/2026-11-02"',
        '<%= config.bin %> <%= command.id %> ./samples --categories "one-shot,texture,noise,phrase,fx,loop"',
    ];

    static override flags = {
        autoplay: Flags.boolean({
            description:
                "Play samples automatically when navigating; A toggles this during classification",
        }),
        categories: Flags.string({
            default: CATEGORIES.join(","),
            description: "Comma-separated categories, in cycling order",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AudioClassify);
        this.terminal.requireInteractive();
        const categories = categoriesFrom(flags.categories);
        const directory = path.resolve(args.directory);
        const files = await sampleFiles(directory);
        const spinner = this.terminal.spinner();
        spinner.start("Reading sample durations");
        let outcomes;
        try {
            outcomes = await Promise.all(
                Concurrency.map(files, 8, (file) =>
                    settle(() => Ffmpeg.duration(file))
                )
            );
        } finally {
            spinner.stop("Sample durations read");
        }
        const samples: Sample[] = [];
        for (const [index, outcome] of outcomes.entries()) {
            const file = files[index]!;
            if (typeof outcome !== "number") {
                this.warn(`Skipped ${path.basename(file)}: ${outcome.reason}`);
                this.failed = true;
            } else {
                samples.push({ category: null, duration: outcome, file });
            }
        }
        if (samples.length === 0) {
            this.log("No readable audio samples in this directory");
            return;
        }
        const session = new Classification(samples, categories);
        session.autoplay = flags.autoplay;
        for (;;) {
            if ((await ClassifyPrompt.edit(session, process.stderr)) == null) {
                throw new Cancelled();
            }
            const plan = renamePlan(samples, await readdir(directory));
            if (plan.length === 0) {
                this.log("No renames selected");
            } else {
                this.table(
                    [
                        ["Current name", "New name"],
                        ...plan.map((item) => [
                            path.basename(item.from),
                            path.basename(item.to),
                        ]),
                    ],
                    { fit: false }
                );
            }
            const action = await this.terminal.answer(
                this.terminal.prompts.select({
                    initialValue: "edit",
                    message: `${Text.pluralize(plan.length, "rename")} ready`,
                    options: [
                        { label: "Return to classification", value: "edit" },
                        ...(plan.length === 0
                            ? []
                            : [{ label: "Apply renames", value: "apply" }]),
                        { label: "Cancel without renaming", value: "cancel" },
                    ],
                })
            );
            if (action === "cancel") {
                throw new Cancelled();
            }
            if (action === "apply") {
                await applyRenames(plan);
                this.log(`Renamed ${Text.pluralize(plan.length, "sample")}`);
                return;
            }
        }
    }
}
