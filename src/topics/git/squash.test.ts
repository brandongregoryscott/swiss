import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitSquash } from "./squash.js";

describe("GitSquash", () => {
    let directory: string;
    let original: string;
    let base: string;

    function git(...args: string[]): string {
        const result = spawnSync("git", args, {
            cwd: directory,
            encoding: "utf8",
        });
        if (result.status !== 0) {
            throw new Error(result.stderr);
        }
        return result.stdout.trim();
    }

    async function squash(message = "", from?: string) {
        try {
            await GitSquash.run({ cwd: directory, from, message });
            return { status: 0, stderr: "" };
        } catch (error) {
            return { status: 1, stderr: (error as Error).message };
        }
    }

    beforeEach(() => {
        directory = mkdtempSync(path.join(tmpdir(), "swiss-squash-"));
        git("init", "-b", "main");
        git("config", "user.name", "Swiss Test");
        git("config", "user.email", "swiss@example.com");
        git("config", "commit.gpgsign", "false");
        git(
            "config",
            "core.hooksPath",
            path.join(directory, ".git", "test-hooks")
        );
        writeFileSync(path.join(directory, "sample"), "base\n");
        git("add", "sample");
        git("commit", "-m", "base");
        base = git("rev-parse", "HEAD");
        git("switch", "-c", "feature");
        for (const text of ["first", "second"]) {
            writeFileSync(path.join(directory, "sample"), `${text}\n`);
            git("commit", "-am", text);
        }
        original = git("rev-parse", "HEAD");
    });

    afterEach(() => rmSync(directory, { force: true, recursive: true }));

    it("squashes onto the base, preserves the tree and saves the original HEAD", async () => {
        const tree = git("rev-parse", "HEAD^{tree}");
        const result = await squash("combined message");
        expect(result.status, result.stderr).toBe(0);
        expect(git("rev-parse", "HEAD^")).toBe(base);
        expect(git("rev-parse", "HEAD^{tree}")).toBe(tree);
        expect(git("log", "-1", "--format=%s")).toBe("combined message");
        expect(
            git(
                "for-each-ref",
                "--format=%(objectname)",
                "refs/swiss/gcsquash/"
            )
        ).toBe(original);
        expect(git("status", "--porcelain")).toBe("");
    });

    it.each(["staged", "unstaged", "untracked"])(
        "rejects %s changes without moving HEAD",
        async (kind) => {
            writeFileSync(
                path.join(directory, kind === "untracked" ? "extra" : "sample"),
                "dirty\n"
            );
            if (kind === "staged") {
                git("add", "sample");
            }
            const status = git("status", "--porcelain");
            expect((await squash("message")).status).toBe(1);
            expect(git("rev-parse", "HEAD")).toBe(original);
            expect(git("status", "--porcelain")).toBe(status);
        }
    );

    it.each(["", "   "])("rejects an empty message %j", async (message) => {
        expect((await squash(message)).status).toBe(1);
        expect(git("rev-parse", "HEAD")).toBe(original);
    });

    it("rejects an invalid base", async () => {
        expect((await squash("message", "missing")).status).toBe(1);
        expect(git("rev-parse", "HEAD")).toBe(original);
    });

    it("accepts an explicit base", async () => {
        git("branch", "develop", base);
        git("branch", "-D", "main");
        expect((await squash("message", "develop")).status).toBe(0);
        expect(git("rev-parse", "HEAD^")).toBe(base);
    });

    it("falls back to master when main is absent", async () => {
        git("branch", "-m", "main", "master");
        expect((await squash("message")).status).toBe(0);
        expect(git("rev-parse", "HEAD^")).toBe(base);
    });

    it("passes commit messages literally without shell expansion", async () => {
        const message =
            'keep "quotes" and $(touch injected) and `touch injected`';
        expect((await squash(message)).status).toBe(0);
        expect(git("log", "-1", "--format=%s")).toBe(message);
        expect(git("status", "--porcelain")).toBe("");
    });

    it("uses the remote default branch when it is configured", async () => {
        git("update-ref", "refs/remotes/origin/trunk", base);
        git(
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/trunk"
        );
        git("branch", "-D", "main");
        expect((await squash("message")).status).toBe(0);
        expect(git("rev-parse", "HEAD^")).toBe(base);
    });

    it("rejects a branch with no net changes", async () => {
        writeFileSync(path.join(directory, "sample"), "base\n");
        git("commit", "-am", "undo changes");
        const head = git("rev-parse", "HEAD");
        expect((await squash("message")).status).toBe(1);
        expect(git("rev-parse", "HEAD")).toBe(head);
    });

    it("rejects detached HEAD and the default branch", async () => {
        git("switch", "--detach");
        expect((await squash("message")).status).toBe(1);
        git("switch", "main");
        expect((await squash("message")).status).toBe(1);
        expect(git("rev-parse", "HEAD")).toBe(base);
    });

    it("rejects a diverged base", async () => {
        git("switch", "main");
        writeFileSync(path.join(directory, "other"), "diverged\n");
        git("add", "other");
        git("commit", "-m", "diverged");
        git("switch", "feature");
        expect((await squash("message")).status).toBe(1);
        expect(git("rev-parse", "HEAD")).toBe(original);
    });

    it("rejects an operation in progress", async () => {
        writeFileSync(path.join(directory, ".git", "MERGE_HEAD"), `${base}\n`);
        expect((await squash("message")).status).toBe(1);
        expect(git("rev-parse", "HEAD")).toBe(original);
    });

    it("keeps a recoverable original HEAD if a commit hook fails", async () => {
        mkdirSync(path.join(directory, ".git", "test-hooks"));
        writeFileSync(
            path.join(directory, ".git", "test-hooks", "pre-commit"),
            "#!/bin/sh\nexit 1\n",
            { mode: 0o755 }
        );
        const tree = git("rev-parse", "HEAD^{tree}");
        const result = await squash("message");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
            "git reset --soft refs/swiss/gcsquash/"
        );
        expect(git("rev-parse", "HEAD")).toBe(base);
        expect(git("write-tree")).toBe(tree);
        const recovery = git(
            "for-each-ref",
            "--format=%(refname)",
            "refs/swiss/gcsquash/"
        );
        git("reset", "--soft", recovery);
        expect(git("rev-parse", "HEAD")).toBe(original);
        expect(git("status", "--porcelain")).toBe("");
    });
});
