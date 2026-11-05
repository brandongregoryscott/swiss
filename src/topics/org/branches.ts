import { compact, isEmpty } from "lodash-es";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { Worktree } from "../../shared/git/git.js";
import type { OrgRepo } from "../../shared/git/github.js";
import type { StaleReason } from "./stale-branches.js";
import { settle, UserError } from "../../shared/errors.js";
import { Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";
import { OrgClone } from "./clone.js";
import { StaleBranches } from "./stale-branches.js";

// Why a branch couldn't be deleted, reported for that branch.
class BranchError extends UserError {}

type StaleBranch = {
    // The commit it pointed at when it was planned, so it's only deleted if it still does.
    commit: string;
    name: string;
    reason: StaleReason;
    // The default branch to switch the main worktree to first, when it has this branch checked out.
    switchTo: null | string;
    // The linked worktree that has it checked out, which is removed along with it.
    worktree: null | Pick<Worktree, "path" | "prunable">;
};

// A stale branch that won't be deleted, and why.
type KeptBranch = {
    name: string;
    reason: StaleReason;
    why: string;
};

type BranchPlan =
    | {
          kept: KeptBranch[];
          repoDir: string;
          stale: StaleBranch[];
          status: "planned";
      }
    | { reason: string; status: "error" }
    | { reason: string; status: "skipped" }
    | { status: "missing" };

type BranchOutcome =
    | { branch: StaleBranch; reason: string; status: "error" }
    | { branch: StaleBranch; status: "deleted" };

// A repo with branches to delete.
type RepoCleanup = {
    repo: OrgRepo;
    repoDir: string;
    stale: StaleBranch[];
};

// The org branches flags that decide what's listed and what starts picked.
type BranchFlags = {
    gone: boolean;
    pick: boolean;
    unstarted: boolean;
};

type PlanOptions = {
    // Also delete branches whose upstream is gone even though they don't look merged.
    gone?: boolean;
    unstarted?: boolean;
};

const REASON_LABELS: Record<StaleReason, string> = {
    gone: "upstream gone, not merged",
    landed: "squash or rebase merged",
    merged: "merged",
    unstarted: "no commits of its own",
};

class BranchCleanup {
    // Switches the main worktree off each branch or removes its linked worktree, if it has one,
    // then deletes the branch. Stops at nothing: a branch that fails is reported and the rest
    // still run.
    static async apply(
        repoDir: string,
        stale: StaleBranch[]
    ): Promise<BranchOutcome[]> {
        if (stale.some((branch) => branch.worktree?.prunable === true)) {
            await Git.run(repoDir, "worktree", "prune");
        }

        const outcomes: BranchOutcome[] = [];
        for (const branch of stale) {
            const outcome = await settle(async (): Promise<BranchOutcome> => {
                // Work may have landed on it since it was planned, like while the confirm prompt
                // was open, which deleting it would lose.
                await assertUnmoved(repoDir, branch);
                if (branch.switchTo != null) {
                    // git switch carries uncommitted changes along, so make sure there still aren't any.
                    if (!(await isClean(repoDir))) {
                        throw new BranchError(
                            `${Text.displayPath(repoDir)} has uncommitted or untracked files`
                        );
                    }
                    await Git.run(
                        repoDir,
                        "switch",
                        "--quiet",
                        branch.switchTo
                    );
                }
                if (branch.worktree != null && !branch.worktree.prunable) {
                    // Without --force, git refuses if the worktree picked up changes since the plan.
                    await Git.run(
                        repoDir,
                        "worktree",
                        "remove",
                        branch.worktree.path
                    );
                }
                await Git.run(repoDir, "branch", "--quiet", "-D", branch.name);
                return { branch, status: "deleted" };
            });
            // A failure from settle doesn't say which branch it was.
            outcomes.push(
                "branch" in outcome ? outcome : { ...outcome, branch }
            );
        }
        return outcomes;
    }

    static formatBranch(branch: StaleBranch): string {
        const label = REASON_LABELS[branch.reason];
        if (branch.switchTo != null) {
            return `${label}, switches to ${branch.switchTo} first`;
        }
        if (branch.worktree == null) {
            return label;
        }
        const action = branch.worktree.prunable
            ? "prunes missing worktree"
            : "removes worktree";
        return `${label}, ${action} ${Text.displayPath(branch.worktree.path)}`;
    }

    // What happened to a branch that was deleted.
    static formatDeleted(branch: StaleBranch): string {
        if (branch.switchTo != null) {
            return `switched to ${branch.switchTo} and deleted`;
        }
        const worktree = branch.worktree;
        return worktree == null || worktree.prunable
            ? "deleted"
            : `deleted along with ${Text.displayPath(worktree.path)}`;
    }

    static formatKept(branch: KeptBranch): string {
        return `${REASON_LABELS[branch.reason]}, but ${branch.why}`;
    }

    // cleanups narrowed to the picked branches, leaving out repos with none picked.
    static keepPicked(
        cleanups: RepoCleanup[],
        picked: StaleBranch[]
    ): RepoCleanup[] {
        const chosen = new Set(picked);
        return cleanups
            .map((cleanup) => ({
                ...cleanup,
                stale: cleanup.stale.filter((branch) => chosen.has(branch)),
            }))
            .filter((cleanup) => !isEmpty(cleanup.stale));
    }

    static async plan(
        repo: OrgRepo,
        config: OrgConfig,
        options: PlanOptions = {}
    ): Promise<BranchPlan> {
        return settle(async (): Promise<BranchPlan> => {
            const clone = await OrgClone.open(repo, config);
            switch (clone.status) {
                case "missing": {
                    return { status: "missing" };
                }
                case "ready": {
                    return planRepo(
                        clone.repoDir,
                        clone.defaultBranch,
                        options
                    );
                }
                case "skipped": {
                    return clone;
                }
            }
        });
    }

    // --pick lists every branch that can be deleted, so ones only gone upstream or never committed
    // to can be picked too.
    static planOptions(flags: BranchFlags): PlanOptions {
        return {
            gone: flags.gone || flags.pick,
            unstarted: flags.unstarted || flags.pick,
        };
    }

    // Whether a branch starts picked with --pick: merged ones do, and ones only gone upstream or
    // never committed to when --gone or --unstarted is passed.
    static startsPicked(branch: StaleBranch, flags: BranchFlags): boolean {
        switch (branch.reason) {
            case "gone": {
                return flags.gone;
            }
            case "unstarted": {
                return flags.unstarted;
            }
            default: {
                return true;
            }
        }
    }

    // Like "3 branches in 2 repos, removing 1 worktree", for asking before deleting them.
    static summarize(cleanups: RepoCleanup[]): string {
        const stale = cleanups.flatMap((cleanup) => cleanup.stale);
        const worktrees = stale.filter((branch) => branch.worktree != null);
        const switches = stale.filter((branch) => branch.switchTo != null);
        const sideEffects = compact([
            !isEmpty(worktrees) &&
                `removing ${Text.pluralize(worktrees.length, "worktree")}`,
            !isEmpty(switches) &&
                `switching ${Text.pluralize(switches.length, "repo")} to the default branch`,
        ]);
        return `${Text.pluralize(stale.length, "branch", "branches")} in ${Text.pluralize(cleanups.length, "repo")}${isEmpty(sideEffects) ? "" : `, ${sideEffects.join(" and ")}`}`;
    }
}

// The stale branches of a clone OrgClone.open checked and fetched, and the ones to keep.
async function planRepo(
    repoDir: string,
    defaultBranch: string,
    options: PlanOptions
): Promise<BranchPlan> {
    const [found, worktrees] = await Promise.all([
        StaleBranches.find(repoDir, defaultBranch),
        Git.listWorktrees(repoDir),
    ]);

    const stale: StaleBranch[] = [];
    const kept: KeptBranch[] = [];
    for (const { branch, reason } of found) {
        if (reason === "gone" && options.gone !== true) {
            kept.push({
                name: branch.name,
                reason,
                why: "it's only deleted with --gone",
            });
            continue;
        }
        if (reason === "unstarted" && options.unstarted !== true) {
            kept.push({
                name: branch.name,
                reason,
                why: "it's only deleted with --unstarted",
            });
            continue;
        }

        const worktree = worktrees.find(
            (candidate) => candidate.branch === `refs/heads/${branch.name}`
        );
        if (worktree?.isMain === true) {
            const why = await mainWorktreeBlocker(
                worktree,
                reason,
                defaultBranch,
                worktrees
            );
            if (why != null) {
                kept.push({ name: branch.name, reason, why });
                continue;
            }
            stale.push({
                commit: branch.commit,
                name: branch.name,
                reason,
                switchTo: defaultBranch,
                worktree: null,
            });
            continue;
        }

        const why = worktree == null ? null : await worktreeBlocker(worktree);
        if (why != null) {
            kept.push({ name: branch.name, reason, why });
            continue;
        }
        stale.push({
            commit: branch.commit,
            name: branch.name,
            reason,
            switchTo: null,
            worktree:
                worktree == null
                    ? null
                    : { path: worktree.path, prunable: worktree.prunable },
        });
    }

    return { kept, repoDir, stale, status: "planned" };
}

// Switching the main worktree to the default branch is fine as long as nothing is lost: the branch
// is merged, there's nothing uncommitted, and the default branch isn't checked out elsewhere.
async function mainWorktreeBlocker(
    worktree: Worktree,
    reason: StaleReason,
    defaultBranch: string,
    worktrees: Worktree[]
): Promise<null | string> {
    const where = Text.displayPath(worktree.path);
    if (reason === "gone") {
        return `it's checked out in ${where}`;
    }
    const holder = worktrees.find(
        (candidate) => candidate.branch === `refs/heads/${defaultBranch}`
    );
    if (holder != null) {
        return `it's checked out in ${where} and ${defaultBranch} is checked out in ${Text.displayPath(holder.path)}`;
    }
    const clean = await isClean(worktree.path).catch(() => null);
    if (clean == null) {
        return `couldn't read the status of ${where}`;
    }
    return clean
        ? null
        : `it's checked out in ${where}, which has uncommitted or untracked files`;
}

async function worktreeBlocker(worktree: Worktree): Promise<null | string> {
    const where = Text.displayPath(worktree.path);
    if (worktree.locked) {
        return `worktree ${where} is locked`;
    }
    if (worktree.prunable) {
        return null;
    }
    const clean = await isClean(worktree.path).catch(() => null);
    if (clean == null) {
        return `couldn't read the status of worktree ${where}`;
    }
    return clean
        ? null
        : `worktree ${where} has uncommitted or untracked files`;
}

// Throws unless branch still points at the commit it was planned at.
async function assertUnmoved(
    repoDir: string,
    branch: StaleBranch
): Promise<void> {
    // rev-parse --verify --quiet exits 1 with no output when the branch is gone.
    const commit = await Git.runWith(
        repoDir,
        { okExitCodes: [1] },
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch.name}`
    );
    if (commit === "") {
        throw new BranchError("it no longer exists");
    }
    if (commit !== branch.commit) {
        throw new BranchError(
            "it has new commits since it was checked; run again to check it again"
        );
    }
}

// No uncommitted changes and no untracked files. Ignored files don't count.
async function isClean(worktreeDir: string): Promise<boolean> {
    return (await Git.changedFiles(worktreeDir)) === 0;
}

export type {
    BranchFlags,
    BranchOutcome,
    BranchPlan,
    KeptBranch,
    PlanOptions,
    RepoCleanup,
    StaleBranch,
    StaleReason,
};
export { BranchCleanup };
