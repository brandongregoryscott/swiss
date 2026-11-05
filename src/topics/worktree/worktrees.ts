import { compact, orderBy } from "lodash-es";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Worktree } from "../../shared/git/git.js";
import type { RemovalPlan, Unremoved } from "../../shared/removal.js";
import { UserError, settle } from "../../shared/errors.js";
import { Files } from "../../shared/files.js";
import { Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";

class WorktreeError extends UserError {}

// A worktree with what's needed to show it in a list.
type WorktreeInfo = {
    // Files with uncommitted changes or untracked, or null when its directory is gone or git
    // couldn't read its status.
    changes: null | number;
} & Worktree;

type WorktreeRemovalPlan = {
    // Whether the branch is checked out in the main worktree after removing it.
    checkout: boolean;
} & RemovalPlan<WorktreeInfo>;

type RemoveOptions = {
    // Check out the worktree's branch in the main worktree once it's removed.
    checkout: boolean;
    // Remove it even with uncommitted changes or untracked files, which are lost.
    force: boolean;
};

class Worktrees {
    // The header of a table of worktrees.
    static readonly COLUMNS = ["", "BRANCH", "HEAD", "STATUS", "PATH"];

    // Short branch name, like main for refs/heads/main, or "(detached)".
    static branchName(worktree: Worktree): string {
        return worktree.branch == null
            ? "(detached)"
            : worktree.branch.replace(/^refs\/heads\//, "");
    }

    // The worktree dir is in, or null when it's in none of them.
    static async containing(
        worktrees: Worktree[],
        dir: string
    ): Promise<null | Worktree> {
        const real = await realpath(dir).catch(() => dir);
        // Longest path first, so a worktree nested in another's directory wins.
        const byDepth = orderBy(
            worktrees,
            (worktree) => worktree.path.length,
            "desc"
        );
        return (
            byDepth.find(
                (worktree) =>
                    real === worktree.path ||
                    real.startsWith(`${worktree.path}${path.sep}`)
            ) ?? null
        );
    }

    // The linked worktree matching query, which can be its branch, its path or its directory name.
    static async find<T extends Worktree>(
        worktrees: T[],
        query: string,
        cwd = process.cwd()
    ): Promise<T | undefined> {
        const linked = worktrees.filter((worktree) => !worktree.isMain);
        // Resolved through symlinks, like macOS's /tmp, since git reports the real path.
        const resolved = await realpath(path.resolve(cwd, query)).catch(() =>
            path.resolve(cwd, query)
        );
        return (
            linked.find(
                (worktree) =>
                    worktree.branch != null &&
                    Worktrees.branchName(worktree) === query
            ) ??
            linked.find((worktree) => worktree.path === resolved) ??
            linked.find((worktree) => path.basename(worktree.path) === query)
        );
    }

    // The worktrees of the repo dir is in, main first, with how many files have changed in each.
    static async list(dir: string): Promise<WorktreeInfo[]> {
        await Files.requireDirectory(dir);
        if ((await Git.repoRoot(dir)) == null) {
            throw new WorktreeError(
                `${Text.displayPath(dir)} isn't in a git repo`
            );
        }
        const worktrees = await Git.listWorktrees(dir);
        return Promise.all(
            worktrees.map(async (worktree) => {
                if (worktree.prunable) {
                    return { ...worktree, changes: null };
                }
                return {
                    ...worktree,
                    // Null when git couldn't read its status.
                    changes: await Git.changedFiles(worktree.path).catch(
                        () => null
                    ),
                };
            })
        );
    }

    // A short description of a worktree's state, like "2 changed files, locked".
    // Removing the linked worktrees queries find, as find does. One with uncommitted changes,
    // untracked files or a lock is left unless force is set. The branch is only checked out in
    // the main worktree when there's one to remove, since only one can be checked out there.
    static async planRemoval(
        worktrees: WorktreeInfo[],
        queries: string[],
        options: RemoveOptions
    ): Promise<WorktreeRemovalPlan> {
        const main = worktrees.find((worktree) => worktree.isMain)!;
        const found = new Map<string, WorktreeInfo>();
        const missing: string[] = [];
        for (const query of queries) {
            const worktree = await Worktrees.find(worktrees, query);
            if (worktree == null) {
                missing.push(query);
            } else {
                found.set(worktree.path, worktree);
            }
        }
        const blocked: Array<Unremoved<WorktreeInfo>> = [];
        const items: WorktreeInfo[] = [];
        for (const worktree of found.values()) {
            const reason = options.force ? null : needsForce(worktree);
            if (reason == null) {
                items.push(worktree);
            } else {
                blocked.push({ item: worktree, reason });
            }
        }
        const checkout =
            options.checkout && items.length === 1 && items[0]!.branch != null;
        return {
            blocked,
            checkout,
            items,
            missing,
            remove: async () => {
                const failures: Array<Unremoved<WorktreeInfo>> = [];
                for (const worktree of items) {
                    const outcome = await settle(async () => {
                        await Worktrees.remove(main, worktree, {
                            checkout,
                            force: options.force,
                        });
                        return "removed" as const;
                    });
                    if (outcome !== "removed") {
                        failures.push({
                            item: worktree,
                            reason: outcome.reason,
                        });
                    }
                }
                return failures;
            },
        };
    }

    // Removes a linked worktree, then checks its branch out in the main worktree when asked to.
    // Everything that could stop the checkout is checked before anything is removed.
    static async remove(
        main: Worktree,
        worktree: WorktreeInfo,
        options: RemoveOptions
    ): Promise<void> {
        if (worktree.isMain) {
            throw new WorktreeError("The main worktree can't be removed");
        }
        if (worktree.locked && !options.force) {
            throw new WorktreeError(
                `${Text.displayPath(worktree.path)} is locked; unlock it with \`git worktree unlock\` or pass --force`
            );
        }
        if ((worktree.changes ?? 0) > 0 && !options.force) {
            throw new WorktreeError(
                `${Text.displayPath(worktree.path)} has ${Text.pluralize(worktree.changes!, "changed file")}; commit or stash the changes, or pass --force to lose them`
            );
        }
        const checkout = options.checkout && worktree.branch != null;
        if (checkout) {
            const mainChanges = await Git.changedFiles(main.path, {
                untracked: false,
            });
            if (mainChanges > 0) {
                throw new WorktreeError(
                    `The main worktree at ${Text.displayPath(main.path)} has uncommitted changes; commit or stash them first, or pass --no-checkout`
                );
            }
        }

        // Locked worktrees need --force twice.
        const forceArgs = options.force
            ? worktree.locked
                ? ["--force", "--force"]
                : ["--force"]
            : [];
        await Git.run(
            main.path,
            "worktree",
            "remove",
            ...forceArgs,
            worktree.path
        );
        if (checkout) {
            await Git.run(
                main.path,
                "checkout",
                "--quiet",
                Worktrees.branchName(worktree)
            );
        }
    }

    // A worktree's row in a table of them, under COLUMNS, marked with * when it's current, the
    // one the command was run in.
    static row(worktree: WorktreeInfo, current: null | Worktree): string[] {
        return [
            worktree.path === current?.path ? "*" : "",
            Worktrees.branchName(worktree),
            worktree.head?.slice(0, 7) ?? "",
            Worktrees.status(worktree),
            Text.displayPath(worktree.path),
        ];
    }

    static status(worktree: WorktreeInfo): string {
        if (worktree.prunable) {
            return "missing";
        }
        return compact([
            worktree.changes == null
                ? "unknown"
                : worktree.changes === 0
                  ? "clean"
                  : Text.pluralize(worktree.changes, "changed file"),
            worktree.locked && "locked",
        ]).join(", ");
    }
}

// Why removing worktree would lose something, which only --force allows, or null.
function needsForce(worktree: WorktreeInfo): null | string {
    if (worktree.locked) {
        return "it's locked; pass --force to remove it anyway";
    }
    if ((worktree.changes ?? 0) > 0) {
        return `it has ${Text.pluralize(worktree.changes!, "changed file")}; pass --force to lose them`;
    }
    return null;
}

export type { RemoveOptions, WorktreeInfo, WorktreeRemovalPlan };
export { WorktreeError, Worktrees };
