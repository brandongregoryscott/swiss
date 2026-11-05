import { execFileSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { Git } from "./git.js";

let workDir: string;
let repoDir: string;

beforeAll(() => {
    const gitConfigDir = mkdtempSync(path.join(tmpdir(), "swiss-gitconfig-"));
    const gitConfig = path.join(gitConfigDir, "gitconfig");
    writeFileSync(gitConfig, "");
    vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfig);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("GIT_AUTHOR_NAME", "Test");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
    vi.stubEnv("GIT_COMMITTER_NAME", "Test");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
});

afterAll(() => {
    vi.unstubAllEnvs();
});

beforeEach(() => {
    // Resolved, since git reports the real path, like /private/var on macOS.
    workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-git-")));
    repoDir = path.join(workDir, "repo");
    mkdirSync(path.join(repoDir, "src"), { recursive: true });
    git(repoDir, "init", "--quiet", "--initial-branch=main");
    writeFileSync(path.join(repoDir, "README.md"), "hi\n");
    git(repoDir, "add", ".");
    git(repoDir, "commit", "--quiet", "-m", "first");
});

afterEach(() => {
    rmSync(workDir, { force: true, recursive: true });
});

describe("Git", () => {
    describe("repoRoot", () => {
        it("finds the top of the repo from anywhere in it, or null outside one", async () => {
            const outside = path.join(workDir, "outside");
            mkdirSync(outside);

            expect(await Git.repoRoot(path.join(repoDir, "src"))).toBe(repoDir);
            expect(await Git.repoRoot(outside)).toBeNull();
        });

        it("says when git isn't installed, rather than that it's not a repo", async () => {
            const original = process.env.PATH;
            vi.stubEnv("PATH", "");
            try {
                await expect(Git.repoRoot(repoDir)).rejects.toThrow(
                    "git is not installed"
                );
            } finally {
                vi.stubEnv("PATH", original);
            }
        });
    });

    describe("mergeBase", () => {
        it("is null for branches with no history in common", async () => {
            git(repoDir, "checkout", "--quiet", "--orphan", "other");
            git(repoDir, "commit", "--quiet", "-m", "unrelated");
            const main = git(repoDir, "rev-parse", "main");

            expect(await Git.mergeBase(repoDir, "main", "main")).toBe(main);
            expect(await Git.mergeBase(repoDir, "main", "other")).toBeNull();
            await expect(
                Git.mergeBase(repoDir, "main", "missing")
            ).rejects.toThrow();
        });
    });

    describe("changedFiles", () => {
        it("counts uncommitted and untracked files, but not ignored ones", async () => {
            writeFileSync(path.join(repoDir, ".gitignore"), "*.log\n");
            writeFileSync(path.join(repoDir, "README.md"), "changed\n");
            writeFileSync(path.join(repoDir, "debug.log"), "ignored\n");

            expect(await Git.changedFiles(repoDir)).toBe(2);
            expect(await Git.changedFiles(repoDir, { untracked: false })).toBe(
                1
            );
        });
    });

    describe("originRepo", () => {
        it("reads the origin remote, or null when there isn't one", async () => {
            expect(await Git.originRepo(repoDir)).toBeNull();

            git(
                repoDir,
                "remote",
                "add",
                "origin",
                "git@github.com:acme/widget.git"
            );

            expect(await Git.originRepo(repoDir)).toEqual({
                host: "github.com",
                name: "widget",
                owner: "acme",
            });
        });
    });
});

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("Git.parseRemoteUrl", () => {
    it.each([
        ["git@github.com:octo/repo.git", "github.com"],
        ["https://github.com/octo/repo", "github.com"],
        ["https://github.com/octo/repo.git/", "github.com"],
        [
            "ssh://git@github.example.com:2222/octo/repo.git",
            "github.example.com",
        ],
        ["github-work:octo/repo.git", "github-work"],
    ])("parses %s", (url, host) => {
        expect(Git.parseRemoteUrl(url)).toEqual({
            host,
            name: "repo",
            owner: "octo",
        });
    });

    it("rejects URLs without an owner and name", () => {
        expect(Git.parseRemoteUrl("/srv/git/repo.git")).toBeNull();
    });
});
