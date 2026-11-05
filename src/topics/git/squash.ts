import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { nullIfMissing, UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";

type SquashOptions = {
    cwd?: string;
    from?: string;
    log?: (message: string) => void;
    message: string;
};

const OPERATIONS = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
    "BISECT_LOG",
];

class GitSquash {
    static async run(options: SquashOptions): Promise<string> {
        if (options.message.trim() === "") {
            throw new UserError("Give a nonempty commit message.");
        }
        const cwd = options.cwd ?? process.cwd();
        const git = (args: string[], okExitCodes?: number[]) =>
            Exec.run("git", args, { cwd, okExitCodes });
        if ((await git(["rev-parse", "--is-inside-work-tree"])) !== "true") {
            throw new UserError("Run git squash inside a Git working tree.");
        }
        const branch = await git(
            ["symbolic-ref", "--quiet", "--short", "HEAD"],
            [1]
        );
        if (branch === "") {
            throw new UserError(
                "Check out a branch before squashing; HEAD is detached."
            );
        }
        for (const operation of OPERATIONS) {
            const file = await git(["rev-parse", "--git-path", operation]);
            if (
                (await stat(path.resolve(cwd, file)).catch(nullIfMissing)) !=
                null
            ) {
                throw new UserError(
                    "Finish or abort the current Git operation before squashing."
                );
            }
        }
        if (
            (await git([
                "status",
                "--porcelain",
                "--untracked-files=normal",
                "--ignore-submodules=none",
            ])) !== ""
        ) {
            throw new UserError(
                "Commit or stash staged, unstaged and untracked changes before squashing."
            );
        }
        let base = options.from;
        if (base == null) {
            base = await git(
                [
                    "symbolic-ref",
                    "--quiet",
                    "--short",
                    "refs/remotes/origin/HEAD",
                ],
                [1]
            );
            if (base === "") {
                for (const name of ["main", "master"]) {
                    if (
                        (await git(
                            [
                                "rev-parse",
                                "--verify",
                                "--quiet",
                                `refs/heads/${name}`,
                            ],
                            [1]
                        )) !== ""
                    ) {
                        base = name;
                        break;
                    }
                }
            }
        }
        if (base == null || base === "") {
            throw new UserError(
                "Cannot determine the default branch; use --from BRANCH."
            );
        }
        const baseCommit = await git([
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${base}^{commit}`,
        ]);
        const headCommit = await git(["rev-parse", "--verify", "HEAD"]);
        if (
            ["main", "master", base.replace(/^origin\//, "")].includes(branch)
        ) {
            throw new UserError(
                `Switch to a feature branch before squashing: ${branch}`
            );
        }
        if (baseCommit === headCommit) {
            throw new UserError(`No commits to squash since ${base}.`);
        }
        if (
            (await git(["merge-base", baseCommit, headCommit], [1])) !==
            baseCommit
        ) {
            throw new UserError(
                `${base} is not an ancestor of HEAD; choose the correct base with --from.`
            );
        }
        if (
            (await git([
                "diff",
                "--name-only",
                baseCommit,
                headCommit,
                "--",
            ])) === ""
        ) {
            throw new UserError(`No net changes to commit since ${base}.`);
        }

        const backup = `refs/swiss/gcsquash/${randomUUID()}`;
        await git(["update-ref", backup, headCommit, ""]);
        options.log?.(`Recovery reference: ${backup}`);
        await git(["reset", "--soft", baseCommit]);
        try {
            await Exec.interactive("git", ["commit", "-m", options.message], {
                cwd,
            });
        } catch (error) {
            throw new UserError(
                `${(error as Error).message}\nCommit failed; changes remain staged. To restore the previous history: git reset --soft ${backup}`
            );
        }
        return backup;
    }
}

export { GitSquash };
