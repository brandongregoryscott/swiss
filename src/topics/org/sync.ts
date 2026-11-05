import { isEmpty } from "lodash-es";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { OrgRepo } from "../../shared/git/github.js";
import { settle } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { GIT_ENV, Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";
import { OrgClone } from "./clone.js";

type SyncResult =
    | { branch: string; commits: number; status: "updated" }
    | { reason: string; status: "error" }
    | { reason: string; status: "skipped" }
    | { status: "cloned" }
    | { status: "up-to-date" };

type SyncStatus = SyncResult["status"];

type SyncOptions = {
    // Still fetches, so counts and skip reasons are accurate, but stops before cloning or moving a branch.
    dryRun?: boolean;
};

const MAX_LISTED_PATHS = 3;

const DRY_RUN_LABELS: Partial<Record<SyncStatus, string>> = {
    cloned: "would clone",
    updated: "would update",
};

class RepoSync {
    static formatResult(result: SyncResult, options: SyncOptions = {}): string {
        switch (result.status) {
            case "error":
            case "skipped": {
                return `${result.status}: ${result.reason}`;
            }

            case "updated": {
                return `${RepoSync.formatStatus(result.status, options)} ${result.branch} (+${Text.pluralize(result.commits, "commit")})`;
            }

            default: {
                return RepoSync.formatStatus(result.status, options);
            }
        }
    }

    static formatStatus(status: SyncStatus, options: SyncOptions = {}): string {
        return options.dryRun === true
            ? (DRY_RUN_LABELS[status] ?? status)
            : status;
    }

    static async sync(
        repo: OrgRepo,
        config: OrgConfig,
        options: SyncOptions = {}
    ): Promise<SyncResult> {
        return settle(async () => {
            const clone = await OrgClone.open(repo, config);
            switch (clone.status) {
                case "missing": {
                    return cloneRepo(repo, clone.repoDir, config, options);
                }
                case "ready": {
                    return updateRepo(
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
}

async function cloneRepo(
    repo: OrgRepo,
    repoDir: string,
    config: OrgConfig,
    options: SyncOptions
): Promise<SyncResult> {
    if (options.dryRun === true) {
        return { status: "cloned" };
    }
    const url = config.cloneProtocol === "ssh" ? repo.sshUrl : repo.url;
    await Exec.run("git", ["clone", "--quiet", url, repoDir], {
        cwd: config.rootDir,
        env: GIT_ENV,
    });
    return { status: "cloned" };
}

// Fast-forwards the local default branch of a clone OrgClone.open checked and fetched.
async function updateRepo(
    repoDir: string,
    branch: string,
    options: SyncOptions
): Promise<SyncResult> {
    const localRef = `refs/heads/${branch}`;
    const remoteRef = `refs/remotes/origin/${branch}`;
    if (!(await Git.refExists(repoDir, localRef))) {
        return skipped(`no local ${branch} branch`);
    }

    const counts = await Git.run(
        repoDir,
        "rev-list",
        "--left-right",
        "--count",
        `${localRef}...${remoteRef}`
    );
    const [ahead = 0, behind = 0] = counts.split(/\s+/).map(Number);
    if (ahead > 0 && behind > 0) {
        return skipped(
            `${branch} diverged from origin/${branch} (${ahead} ahead, ${behind} behind)`
        );
    }
    if (ahead > 0) {
        return skipped(
            `${branch} is ahead of origin/${branch} by ${Text.pluralize(ahead, "commit")}`
        );
    }
    if (behind === 0) {
        return { status: "up-to-date" };
    }

    const worktreeDir = await findWorktreeWithBranch(repoDir, localRef);
    if (worktreeDir == null) {
        if (options.dryRun === true) {
            return { branch, commits: behind, status: "updated" };
        }
        await Git.run(
            repoDir,
            "fetch",
            "--quiet",
            ".",
            `${remoteRef}:${localRef}`
        );
        return { branch, commits: behind, status: "updated" };
    }

    const blocked = await findOverwrittenPaths(worktreeDir, remoteRef);
    if (blocked != null) {
        const location =
            (await realpath(worktreeDir)) === (await realpath(repoDir))
                ? ""
                : ` in ${worktreeDir}`;
        return skipped(`${blocked}${location}`);
    }

    if (options.dryRun === true) {
        return { branch, commits: behind, status: "updated" };
    }
    await Git.run(worktreeDir, "merge", "--ff-only", "--quiet", remoteRef);
    return { branch, commits: behind, status: "updated" };
}

async function findWorktreeWithBranch(
    repoDir: string,
    localRef: string
): Promise<null | string> {
    const worktrees = await Git.listWorktrees(repoDir);
    return (
        worktrees.find((worktree) => worktree.branch === localRef)?.path ?? null
    );
}

async function findOverwrittenPaths(
    worktreeDir: string,
    remoteRef: string
): Promise<null | string> {
    const [upstreamChanged, upstreamAdded, locallyChanged] = await Promise.all([
        Git.paths(
            worktreeDir,
            "diff",
            "-z",
            "--name-only",
            "--no-renames",
            "HEAD",
            remoteRef
        ),
        Git.paths(
            worktreeDir,
            "diff",
            "-z",
            "--name-only",
            "--no-renames",
            "--diff-filter=A",
            "HEAD",
            remoteRef
        ),
        Git.paths(
            worktreeDir,
            "diff",
            "-z",
            "--name-only",
            "--no-renames",
            "HEAD"
        ),
    ]);

    const locallyChangedSet = new Set(locallyChanged);
    const conflicting = upstreamChanged.filter((file) =>
        locallyChangedSet.has(file)
    );
    const addedUpstreamOnly = upstreamAdded.filter(
        (file) => !locallyChangedSet.has(file)
    );
    const untrackedExists = await Promise.all(
        addedUpstreamOnly.map((file) =>
            lstat(path.join(worktreeDir, file)).then(
                () => true,
                () => false
            )
        )
    );
    const untracked = addedUpstreamOnly.filter(
        (_, index) => untrackedExists[index] === true
    );

    const reasons = [];
    if (!isEmpty(conflicting)) {
        reasons.push(`uncommitted changes to ${formatPaths(conflicting)}`);
    }
    if (!isEmpty(untracked)) {
        reasons.push(`untracked ${formatPaths(untracked)}`);
    }
    return !isEmpty(reasons)
        ? `${reasons.join(" and ")} would be overwritten`
        : null;
}

function formatPaths(paths: string[]): string {
    const listed = paths.slice(0, MAX_LISTED_PATHS).join(", ");
    const remaining = paths.length - MAX_LISTED_PATHS;
    return remaining > 0 ? `${listed} and ${remaining} more` : listed;
}

function skipped(reason: string): SyncResult {
    return { reason, status: "skipped" };
}

export type { SyncOptions, SyncResult, SyncStatus };
export { RepoSync };
