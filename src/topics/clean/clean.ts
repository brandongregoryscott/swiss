import { chunk, compact, flatten, groupBy, sortBy } from "lodash-es";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Concurrency } from "../../shared/concurrency.js";
import { settle } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { Git } from "../../shared/git/git.js";

// Directories of installed dependencies and build output, which can be recreated.
const CLEAN_NAMES = [
    ".next",
    ".nuxt",
    ".parcel-cache",
    ".svelte-kit",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
];

// Directories found in a git repo are only cleaned when they're ignored.
type CleanTarget = {
    path: string;
    // In bytes, as counted by du, so hard links are only counted once.
    size: number;
};

type RemoveOutcome =
    | { path: string; reason: string; status: "error" }
    | { path: string; status: "removed" };

// A directory with a matching name, and the root of the git repo it's in, if any.
type Candidate = { path: string; repo: null | string };

// Paths passed to each git check-ignore, to stay under the argument length limit.
const CHECK_IGNORE_BATCH = 200;
const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"];

class Cleanup {
    // How many directories are measured or deleted at once.
    static readonly CONCURRENCY = 8;

    // Directories under root to clean, sorted by path. Matching directories aren't searched
    // inside, and neither are .git directories or symlinks.
    static async find(
        root: string,
        names: string[] = CLEAN_NAMES
    ): Promise<string[]> {
        const candidates: Candidate[] = [];
        await walk(root, await Git.repoRoot(root), new Set(names), candidates);

        const kept = await Promise.all(
            Object.entries(
                groupBy(candidates, (candidate) => candidate.repo ?? "")
            ).map(([repo, group]) => {
                const paths = group.map((candidate) => candidate.path);
                return repo === "" ? paths : ignoredPaths(repo, paths);
            })
        );
        return sortBy(flatten(kept));
    }

    // Sizes like 1.2 GB, with one decimal place below 10 of a unit.
    static formatSize(bytes: number): string {
        let size = bytes;
        let unit = 0;
        while (size >= 1000 && unit < SIZE_UNITS.length - 1) {
            size /= 1000;
            unit++;
        }
        const rounded =
            unit === 0 || size >= 10 ? Math.round(size) : size.toFixed(1);
        return `${rounded} ${SIZE_UNITS[unit]}`;
    }

    static async measure(paths: string[]): Promise<CleanTarget[]> {
        return Promise.all(
            Concurrency.map(paths, Cleanup.CONCURRENCY, async (dir) => ({
                path: dir,
                size: await diskUsage(dir),
            }))
        );
    }

    // Deletes dir, recording a failure, like a permission error, instead of throwing it.
    static async remove(dir: string): Promise<RemoveOutcome> {
        const outcome = await settle(async () => {
            await rm(dir, { force: true, recursive: true });
            return { path: dir, status: "removed" as const };
        });
        return "path" in outcome ? outcome : { ...outcome, path: dir };
    }
}

async function walk(
    dir: string,
    repo: null | string,
    names: Set<string>,
    candidates: Candidate[]
): Promise<void> {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        // Unreadable directories, like ones owned by another user, are skipped.
        return;
    }
    // A .git file rather than directory means a worktree or submodule, which is its own repo too.
    const currentRepo = entries.some((entry) => entry.name === ".git")
        ? dir
        : repo;
    await Promise.all(
        entries.map(async (entry) => {
            if (!entry.isDirectory() || entry.name === ".git") {
                return;
            }
            const child = path.join(dir, entry.name);
            if (names.has(entry.name)) {
                candidates.push({ path: child, repo: currentRepo });
                return;
            }
            await walk(child, currentRepo, names, candidates);
        })
    );
}

// The paths git ignores in repo. Directories with tracked files in them aren't ignored, so
// committed build output is left alone.
async function ignoredPaths(repo: string, paths: string[]): Promise<string[]> {
    const ignored = new Set<string>();
    for (const batch of chunk(paths, CHECK_IGNORE_BATCH)) {
        // check-ignore exits 1 when none of the paths are ignored.
        const output = await Git.runWith(
            repo,
            { okExitCodes: [1] },
            "check-ignore",
            "--",
            ...batch
        );
        for (const line of compact(output.split("\n"))) {
            ignored.add(line);
        }
    }
    return paths.filter((dir) => ignored.has(dir));
}

async function diskUsage(dir: string): Promise<number> {
    // du exits 1 when it can't read some of the files, but still counts the rest.
    const output = await Exec.run("du", ["-sk", dir], { okExitCodes: [1] });
    const kilobytes = Number.parseInt(output, 10);
    return Number.isNaN(kilobytes) ? 0 : kilobytes * 1024;
}

export type { CleanTarget, RemoveOutcome };
export { CLEAN_NAMES, Cleanup };
