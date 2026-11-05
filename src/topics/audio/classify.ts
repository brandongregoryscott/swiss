import type { Key } from "node:readline";
import {
    link,
    lstat,
    mkdtemp,
    readdir,
    rm,
    unlink,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { nullIfMissing, UserError } from "../../shared/errors.js";

const CATEGORIES = ["one-shot", "texture", "noise", "phrase", "fx"];
const AUDIO_EXTENSIONS = new Set([
    ".aac",
    ".aif",
    ".aiff",
    ".alac",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
    ".wave",
    ".wma",
]);

type Sample = { category: null | string; duration: number; file: string };
type Rename = { from: string; to: string };
type ClassifyAction = "autoplay" | "cancel" | "move" | "play" | "review";

function categoriesFrom(text: string): string[] {
    const categories = text.split(",").map((category) => category.trim());
    if (
        categories.some(
            (category) => !/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(category)
        )
    ) {
        throw new UserError(
            "Categories must be comma-separated names using letters, numbers, spaces, underscores or hyphens"
        );
    }
    if (
        new Set(categories.map((category) => category.toLowerCase())).size !==
        categories.length
    ) {
        throw new UserError("Give each category only once");
    }
    return categories;
}

// Only regular audio files directly in the directory; never follow symlinks or descend into it.
async function sampleFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
        .filter(
            (entry) =>
                entry.isFile() &&
                AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        )
        .map((entry) => path.join(directory, entry.name))
        .sort((a, b) => {
            const order = a.localeCompare(b, "en", { numeric: true });
            return order === 0 ? a.localeCompare(b) : order;
        });
}

class Classification {
    readonly categories: string[];
    readonly samples: Sample[];
    autoplay = false;
    index = 0;

    constructor(samples: Sample[], categories: string[]) {
        this.samples = samples;
        this.categories = categories;
    }

    get current(): Sample {
        return this.samples[this.index]!;
    }

    press(key: Key): ClassifyAction | null {
        if (key.name === "escape" || (key.ctrl === true && key.name === "c")) {
            return "cancel";
        }
        if (key.ctrl === true || key.meta === true) {
            return null;
        }
        switch (key.name) {
            case "a": {
                this.autoplay = !this.autoplay;
                return "autoplay";
            }
            case "backspace": {
                this.current.category = null;
                return null;
            }
            case "down":
            case "up": {
                const next = Math.max(
                    0,
                    Math.min(
                        this.samples.length - 1,
                        this.index + (key.name === "down" ? 1 : -1)
                    )
                );
                if (next === this.index) {
                    return null;
                }
                this.index = next;
                return "move";
            }
            case "left":
            case "right": {
                const choices = [null, ...this.categories];
                const current = choices.indexOf(this.current.category);
                this.current.category =
                    choices[
                        (current +
                            (key.name === "right" ? 1 : -1) +
                            choices.length) %
                            choices.length
                    ]!;
                return null;
            }
            case "return": {
                return "review";
            }
            case "space": {
                return "play";
            }
        }
        return null;
    }
}

// Keep unclassified files and unrelated directory entries reserved, including on filesystems
// that ignore case. All assigned files can exchange names, so reassigning a category is safe.
function renamePlan(samples: Sample[], entries: string[]): Rename[] {
    const assigned = new Set(
        samples
            .filter((sample) => sample.category != null)
            .map((sample) => path.basename(sample.file))
    );
    const reserved = new Set(
        entries
            .filter((entry) => !assigned.has(entry))
            .map((entry) => entry.toLowerCase())
    );
    const numbers = new Map<string, number>();
    return samples.flatMap((sample) => {
        if (sample.category == null) {
            return [];
        }
        const { dir, ext } = path.parse(sample.file);
        let number = numbers.get(sample.category) ?? 1;
        let name: string;
        do {
            name = `${sample.category} ${number++}${ext}`;
        } while (reserved.has(name.toLowerCase()));
        reserved.add(name.toLowerCase());
        numbers.set(sample.category, number);
        const to = path.join(dir, name);
        return sample.file === to ? [] : [{ from: sample.file, to }];
    });
}

// Hard links give every rename an exclusive destination (rename itself would overwrite).
// Keep recovery copies until the entire batch succeeds, including when exchanging names.
async function applyRenames(plan: Rename[]): Promise<void> {
    if (plan.length === 0) {
        return;
    }
    const sources = new Set(plan.map((item) => item.from));
    const targets = new Set(plan.map((item) => item.to.toLowerCase()));
    const directory = path.dirname(plan[0]!.from);
    if (
        sources.size !== plan.length ||
        targets.size !== plan.length ||
        plan.some(
            (item) =>
                path.dirname(item.from) !== directory ||
                path.dirname(item.to) !== directory
        )
    ) {
        throw new UserError(
            "Rename plan must contain unique files in one directory"
        );
    }
    for (const item of plan) {
        if (!(await lstat(item.from)).isFile()) {
            throw new UserError(`No longer a regular file: ${item.from}`);
        }
        if (
            !sources.has(item.to) &&
            (await lstat(item.to).catch(nullIfMissing)) != null
        ) {
            throw new UserError(
                `Already there: ${item.to}. Return to classification to rebuild the plan.`
            );
        }
    }
    const staging = await mkdtemp(path.join(directory, ".swiss-classify-"));
    const backups = plan.map((_, index) => path.join(staging, String(index)));
    const removed: number[] = [];
    const created: string[] = [];
    try {
        await writeFile(
            path.join(staging, "plan.json"),
            JSON.stringify(plan, null, 2)
        );
        for (const [index, item] of plan.entries()) {
            await link(item.from, backups[index]!);
        }
        for (const [index, item] of plan.entries()) {
            await unlink(item.from);
            removed.push(index);
        }
        for (const [index, item] of plan.entries()) {
            await link(backups[index]!, item.to);
            created.push(item.to);
        }
    } catch (error) {
        try {
            for (const file of created) {
                await unlink(file);
            }
            for (const index of removed) {
                await link(backups[index]!, plan[index]!.from);
            }
        } catch {
            throw new UserError(
                `Renaming failed and some names could not be restored. Recovery copies are in ${staging}: ${String(error)}`
            );
        }
        await rm(staging, { recursive: true });
        throw new UserError(`Nothing renamed: ${String(error)}`);
    }
    await rm(staging, { recursive: true });
}

export type { ClassifyAction, Rename, Sample };
export {
    applyRenames,
    CATEGORIES,
    categoriesFrom,
    Classification,
    renamePlan,
    sampleFiles,
};
