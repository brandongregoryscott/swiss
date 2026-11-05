import { compact, isEmpty } from "lodash-es";
import { realpath } from "node:fs/promises";
import type { GitHubRepo } from "./github.js";
import { CommandError, Exec } from "../exec.js";

type Worktree = {
    // Full ref, like refs/heads/main, or null when HEAD is detached.
    branch: null | string;
    // Commit checked out, or null for a new repo with no commits yet.
    head: null | string;
    isMain: boolean;
    locked: boolean;
    path: string;
    // Its directory is gone, so `git worktree prune` would drop it.
    prunable: boolean;
};

type ChangedFilesOptions = {
    // Count untracked files too. On by default.
    untracked?: boolean;
};

type GitRunOptions = {
    env?: NodeJS.ProcessEnv;
    okExitCodes?: number[];
};

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0" };

class Git {
    // The files with uncommitted changes, counting untracked ones unless untracked is false.
    // Ignored files don't count.
    static async changedFiles(
        repoDir: string,
        options: ChangedFilesOptions = {}
    ): Promise<number> {
        const output = await Git.run(
            repoDir,
            "status",
            "--porcelain",
            ...(options.untracked === false ? ["--untracked-files=no"] : [])
        );
        return compact(output.split("\n")).length;
    }

    // Returns why repoDir isn't a clone of org/name, or null when it is.
    static async checkClone(
        repoDir: string,
        org: string,
        name: string
    ): Promise<null | string> {
        const root = await Git.repoRoot(repoDir);
        if (
            root == null ||
            (await realpath(root)) !== (await realpath(repoDir))
        ) {
            return "not a git repository";
        }

        const originUrl = await originUrlOf(repoDir);
        if (originUrl == null) {
            return "no origin remote";
        }
        if (!pointsAtRepo(originUrl, org, name)) {
            return `origin is ${originUrl}, not ${org}/${name}`;
        }
        return null;
    }

    static async listWorktrees(repoDir: string): Promise<Worktree[]> {
        const output = await Git.run(
            repoDir,
            "worktree",
            "list",
            "--porcelain"
        );
        const worktrees: Worktree[] = [];
        for (const block of output.split("\n\n")) {
            const lines = block.split("\n");
            const worktreeLine = lines.find((line) =>
                line.startsWith("worktree ")
            );
            if (worktreeLine == null) {
                continue;
            }
            const branchLine = lines.find((line) => line.startsWith("branch "));
            const headLine = lines.find((line) => line.startsWith("HEAD "));
            worktrees.push({
                branch: branchLine?.slice("branch ".length) ?? null,
                head: headLine?.slice("HEAD ".length) ?? null,
                isMain: isEmpty(worktrees),
                locked: lines.some((line) => /^locked( |$)/.test(line)),
                path: worktreeLine.slice("worktree ".length),
                prunable: lines.some((line) => /^prunable( |$)/.test(line)),
            });
        }
        return worktrees;
    }

    // The host, owner and name of the origin remote, or null when there's no origin or its URL
    // isn't in the host/owner/name shape GitHub uses.
    // The newest commit a and b both come from, or null when they share no history.
    static async mergeBase(
        repoDir: string,
        a: string,
        b: string
    ): Promise<null | string> {
        // git merge-base exits 1 with no output when there isn't one; other failures still throw.
        const base = await Git.runWith(
            repoDir,
            { okExitCodes: [1] },
            "merge-base",
            a,
            b
        );
        return base === "" ? null : base;
    }

    static async originRepo(repoDir: string): Promise<GitHubRepo | null> {
        const url = await originUrlOf(repoDir);
        return url == null ? null : Git.parseRemoteUrl(url);
    }

    // Parses https://host/owner/name, git@host:owner/name and ssh://git@host/owner/name URLs,
    // with or without .git.
    static parseRemoteUrl(url: string): GitHubRepo | null {
        const match =
            /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[/:]([^/]+)\/([^/]+?)(?:\.git)?\/*$/i.exec(
                url.trim()
            );
        if (match == null) {
            return null;
        }
        const [, host, owner, name] = match;
        return { host: host!, name: name!, owner: owner! };
    }

    // Splits NUL-separated output, as printed by commands run with -z.
    static async paths(repoDir: string, ...args: string[]): Promise<string[]> {
        const output = await Git.run(repoDir, ...args);
        return compact(output.split("\0"));
    }

    static async refExists(repoDir: string, ref: string): Promise<boolean> {
        return Git.run(repoDir, "rev-parse", "--verify", "--quiet", ref).then(
            () => true,
            () => false
        );
    }

    // The top of the repo dir is in, or null when it isn't in one. Other failures, like git not
    // being installed, throw.
    static async repoRoot(dir: string): Promise<null | string> {
        try {
            return await Git.run(dir, "rev-parse", "--show-toplevel");
        } catch (error) {
            if (
                error instanceof CommandError &&
                /not a git repository/i.test(error.message)
            ) {
                return null;
            }
            throw error;
        }
    }

    static run(repoDir: string, ...args: string[]): Promise<string> {
        return Git.runWith(repoDir, {}, ...args);
    }

    // Runs git with extra environment variables, or with exit codes that still count as success,
    // like 1 from git grep when nothing matches.
    static runWith(
        repoDir: string,
        options: GitRunOptions,
        ...args: string[]
    ): Promise<string> {
        return Exec.run("git", ["-C", repoDir, ...args], {
            env: { ...GIT_ENV, ...options.env },
            okExitCodes: options.okExitCodes,
        });
    }
}

// The URL of the origin remote, or null when there isn't one.
async function originUrlOf(repoDir: string): Promise<null | string> {
    // git remote get-url exits 2 with no output when there's no such remote.
    const url = await Git.runWith(
        repoDir,
        { okExitCodes: [2] },
        "remote",
        "get-url",
        "origin"
    );
    return url === "" ? null : url;
}

function pointsAtRepo(remoteUrl: string, org: string, name: string): boolean {
    const segments = remoteUrl
        .replace(/\/+$/, "")
        .replace(/\.git$/, "")
        .split(/[/:]/);
    return (
        segments.slice(-2).join("/").toLowerCase() ===
        `${org}/${name}`.toLowerCase()
    );
}

export type { Worktree };
export { Git, GIT_ENV };
