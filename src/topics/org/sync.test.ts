import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
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
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { OrgRepo } from "../../shared/git/github.js";
import type { SyncResult } from "./sync.js";
import { RepoSync } from "./sync.js";

const ORG = "acme";

let workDir: string;
let remotesDir: string;
let rootDir: string;
let config: OrgConfig;

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
    workDir = mkdtempSync(path.join(tmpdir(), "swiss-sync-"));
    remotesDir = path.join(workDir, "remotes");
    rootDir = path.join(workDir, "home");
    mkdirSync(rootDir);
    config = {
        cloneProtocol: "ssh",
        ignore: [],
        name: ORG,
        rootDir,
        scmHost: "github.com",
        skipArchived: true,
        skipForks: true,
    };
});

afterEach(() => {
    rmSync(workDir, { force: true, recursive: true });
});

describe("RepoSync", () => {
    describe("sync", () => {
        it("clones a missing repo directly into rootDir with no org folder", async () => {
            const repo = createRemote("widget");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({ status: "cloned" });
            expect(existsSync(path.join(rootDir, "widget", "README.md"))).toBe(
                true
            );
            expect(existsSync(path.join(rootDir, ORG))).toBe(false);
        });

        it("clones with the https url when cloneProtocol is https", async () => {
            const repo = {
                ...createRemote("widget"),
                sshUrl: path.join(workDir, "missing.git"),
            };

            const result = await RepoSync.sync(repo, {
                ...config,
                cloneProtocol: "https",
            });

            expect(result).toEqual({ status: "cloned" });
        });

        it("reports an error when the clone fails", async () => {
            const repo = {
                ...createRemote("widget"),
                sshUrl: path.join(workDir, "missing.git"),
            };

            const result = await RepoSync.sync(repo, config);

            expect(result.status).toBe("error");
            expect(existsSync(path.join(rootDir, "widget"))).toBe(false);
        });

        it("reports up-to-date when nothing changed upstream", async () => {
            const repo = createRemote("widget");
            cloneLocal(repo);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({ status: "up-to-date" });
        });

        it("fast-forwards a clean repo that is behind upstream", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            pushUpstream(repo, 2);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                branch: "main",
                commits: 2,
                status: "updated",
            });
            expect(git(localDir, "rev-parse", "HEAD")).toBe(
                git(repo.sshUrl, "rev-parse", "main")
            );
        });

        it("keeps untracked files when fast-forwarding", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            writeFileSync(path.join(localDir, "notes.txt"), "keep me");
            pushUpstream(repo, 1);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                branch: "main",
                commits: 1,
                status: "updated",
            });
            expect(readFileSync(path.join(localDir, "notes.txt"), "utf8")).toBe(
                "keep me"
            );
        });

        it("fast-forwards past uncommitted changes to files upstream did not touch", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            commitUpstream(repo, "staged.txt");
            commitUpstream(repo, "unstaged.txt");
            git(localDir, "pull", "--quiet", "--ff-only");
            writeFileSync(path.join(localDir, "staged.txt"), "staged edit");
            git(localDir, "add", "staged.txt");
            writeFileSync(path.join(localDir, "unstaged.txt"), "unstaged edit");
            pushUpstream(repo, 1);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                branch: "main",
                commits: 1,
                status: "updated",
            });
            expect(git(localDir, "rev-parse", "HEAD")).toBe(
                git(repo.sshUrl, "rev-parse", "main")
            );
            expect(git(localDir, "diff", "--cached", "--name-only")).toBe(
                "staged.txt"
            );
            expect(
                readFileSync(path.join(localDir, "unstaged.txt"), "utf8")
            ).toBe("unstaged edit");
        });

        it("skips when upstream changed a file that has uncommitted changes", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            const headBefore = git(localDir, "rev-parse", "HEAD");
            writeFileSync(path.join(localDir, "README.md"), "local edit");
            commitUpstream(repo, "README.md");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "uncommitted changes to README.md would be overwritten",
                status: "skipped",
            });
            expect(readFileSync(path.join(localDir, "README.md"), "utf8")).toBe(
                "local edit"
            );
            expect(git(localDir, "rev-parse", "HEAD")).toBe(headBefore);
        });

        it("skips when upstream adds a file that exists untracked locally", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            writeFileSync(path.join(localDir, "notes.txt"), "keep me");
            commitUpstream(repo, "notes.txt");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "untracked notes.txt would be overwritten",
                status: "skipped",
            });
            expect(readFileSync(path.join(localDir, "notes.txt"), "utf8")).toBe(
                "keep me"
            );
        });

        it("skips when upstream adds a file that is ignored locally", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            writeFileSync(
                path.join(localDir, ".git", "info", "exclude"),
                ".env\n"
            );
            writeFileSync(path.join(localDir, ".env"), "SECRET=local");
            commitUpstream(repo, ".env");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "untracked .env would be overwritten",
                status: "skipped",
            });
            expect(readFileSync(path.join(localDir, ".env"), "utf8")).toBe(
                "SECRET=local"
            );
        });

        it("lists at most three blocking files", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            const files = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
            for (const file of files) {
                writeFileSync(path.join(localDir, file), "local");
            }
            commitUpstream(repo, ...files);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "untracked a.txt, b.txt, c.txt and 2 more would be overwritten",
                status: "skipped",
            });
        });

        it("skips a default branch that has diverged from upstream", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            commit(localDir, "local.txt");
            pushUpstream(repo, 1);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "main diverged from origin/main (1 ahead, 1 behind)",
                status: "skipped",
            });
        });

        it("skips a default branch with unpushed commits", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            commit(localDir, "local.txt");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "main is ahead of origin/main by 1 commit",
                status: "skipped",
            });
        });

        it("fast-forwards the default branch while another branch is checked out, without touching the working tree", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            git(localDir, "checkout", "--quiet", "-b", "feature/x");
            commit(localDir, "feature.txt");
            const featureHead = git(localDir, "rev-parse", "HEAD");
            writeFileSync(path.join(localDir, "README.md"), "local edit");
            writeFileSync(path.join(localDir, "notes.txt"), "keep me");
            commitUpstream(repo, "README.md");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                branch: "main",
                commits: 1,
                status: "updated",
            });
            expect(git(localDir, "rev-parse", "main")).toBe(
                git(repo.sshUrl, "rev-parse", "main")
            );
            expect(git(localDir, "branch", "--show-current")).toBe("feature/x");
            expect(git(localDir, "rev-parse", "HEAD")).toBe(featureHead);
            expect(readFileSync(path.join(localDir, "README.md"), "utf8")).toBe(
                "local edit"
            );
            expect(readFileSync(path.join(localDir, "notes.txt"), "utf8")).toBe(
                "keep me"
            );
        });

        it("fast-forwards the default branch from a detached HEAD", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            git(localDir, "checkout", "--quiet", "--detach");
            pushUpstream(repo, 1);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                branch: "main",
                commits: 1,
                status: "updated",
            });
            expect(git(localDir, "rev-parse", "main")).toBe(
                git(repo.sshUrl, "rev-parse", "main")
            );
        });

        it("leaves a diverged default branch alone while another branch is checked out", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            commit(localDir, "local.txt");
            const mainBefore = git(localDir, "rev-parse", "main");
            git(localDir, "checkout", "--quiet", "-b", "feature/x");
            pushUpstream(repo, 1);

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "main diverged from origin/main (1 ahead, 1 behind)",
                status: "skipped",
            });
            expect(git(localDir, "rev-parse", "main")).toBe(mainBefore);
        });

        it("fast-forwards the default branch where it is checked out in another worktree", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            git(localDir, "checkout", "--quiet", "-b", "feature/x");
            const worktreeDir = path.join(workDir, "widget-main");
            git(localDir, "worktree", "add", "--quiet", worktreeDir, "main");
            commitUpstream(repo, "new.txt");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                branch: "main",
                commits: 1,
                status: "updated",
            });
            expect(existsSync(path.join(worktreeDir, "new.txt"))).toBe(true);
            expect(existsSync(path.join(localDir, "new.txt"))).toBe(false);
        });

        it("names the other worktree when its uncommitted changes block the update", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            git(localDir, "checkout", "--quiet", "-b", "feature/x");
            const worktreeDir = path.join(workDir, "widget-main");
            git(localDir, "worktree", "add", "--quiet", worktreeDir, "main");
            writeFileSync(path.join(worktreeDir, "README.md"), "local edit");
            commitUpstream(repo, "README.md");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: `uncommitted changes to README.md would be overwritten in ${realpathSync(worktreeDir)}`,
                status: "skipped",
            });
            expect(
                readFileSync(path.join(worktreeDir, "README.md"), "utf8")
            ).toBe("local edit");
        });

        it("skips a repo with no local default branch", async () => {
            const repo = createRemote("widget");
            const localDir = cloneLocal(repo);
            git(localDir, "checkout", "--quiet", "-b", "feature/x");
            git(localDir, "branch", "--quiet", "-D", "main");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "no local main branch",
                status: "skipped",
            });
        });

        it("skips a repo whose remote has no default branch", async () => {
            const repo = createRemote("widget");
            cloneLocal(repo);

            const result = await RepoSync.sync(
                { ...repo, defaultBranch: null },
                config
            );

            expect(result).toEqual({
                reason: "remote has no default branch",
                status: "skipped",
            });
        });

        it("skips a directory whose origin is a different repo", async () => {
            const repo = createRemote("widget");
            const other = createRemote("gadget");
            git(rootDir, "clone", "--quiet", other.sshUrl, "widget");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: `origin is ${other.sshUrl}, not acme/widget`,
                status: "skipped",
            });
        });

        it("skips a directory that is not a git repository", async () => {
            const repo = createRemote("widget");
            mkdirSync(path.join(rootDir, "widget"));
            writeFileSync(
                path.join(rootDir, "widget", "file.txt"),
                "untouched"
            );

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: "not a git repository",
                status: "skipped",
            });
            expect(
                readFileSync(path.join(rootDir, "widget", "file.txt"), "utf8")
            ).toBe("untouched");
        });

        it("skips a path that exists but is not a directory", async () => {
            const repo = createRemote("widget");
            writeFileSync(path.join(rootDir, "widget"), "");

            const result = await RepoSync.sync(repo, config);

            expect(result).toEqual({
                reason: `${path.join(rootDir, "widget")} exists and is not a directory`,
                status: "skipped",
            });
        });

        describe("with dryRun", () => {
            it("reports a missing repo as cloned without cloning it", async () => {
                const repo = createRemote("widget");

                const result = await RepoSync.sync(repo, config, {
                    dryRun: true,
                });

                expect(result).toEqual({ status: "cloned" });
                expect(existsSync(path.join(rootDir, "widget"))).toBe(false);
            });

            it("reports how far behind the checked-out default branch is without moving it", async () => {
                const repo = createRemote("widget");
                const localDir = cloneLocal(repo);
                const head = git(localDir, "rev-parse", "HEAD");
                pushUpstream(repo, 2);

                const result = await RepoSync.sync(repo, config, {
                    dryRun: true,
                });

                expect(result).toEqual({
                    branch: "main",
                    commits: 2,
                    status: "updated",
                });
                expect(git(localDir, "rev-parse", "HEAD")).toBe(head);
            });

            it("reports how far behind a default branch that is not checked out is without moving it", async () => {
                const repo = createRemote("widget");
                const localDir = cloneLocal(repo);
                const main = git(localDir, "rev-parse", "main");
                git(localDir, "checkout", "--quiet", "-b", "feature/x");
                pushUpstream(repo, 1);

                const result = await RepoSync.sync(repo, config, {
                    dryRun: true,
                });

                expect(result).toEqual({
                    branch: "main",
                    commits: 1,
                    status: "updated",
                });
                expect(git(localDir, "rev-parse", "main")).toBe(main);
            });

            it("still reports a repo that would be skipped", async () => {
                const repo = createRemote("widget");
                const localDir = cloneLocal(repo);
                writeFileSync(path.join(localDir, "README.md"), "local edit");
                commitUpstream(repo, "README.md");

                const result = await RepoSync.sync(repo, config, {
                    dryRun: true,
                });

                expect(result).toEqual({
                    reason: "uncommitted changes to README.md would be overwritten",
                    status: "skipped",
                });
            });
        });
    });

    describe("formatResult", () => {
        it("describes each status", () => {
            const testCases: Array<{ expected: string; result: SyncResult }> = [
                { expected: "cloned", result: { status: "cloned" } },
                { expected: "up-to-date", result: { status: "up-to-date" } },
                {
                    expected: "updated main (+1 commit)",
                    result: { branch: "main", commits: 1, status: "updated" },
                },
                {
                    expected: "updated master (+3 commits)",
                    result: { branch: "master", commits: 3, status: "updated" },
                },
                {
                    expected: "skipped: dirty working tree",
                    result: { reason: "dirty working tree", status: "skipped" },
                },
                {
                    expected: "error: fatal: nope",
                    result: { reason: "fatal: nope", status: "error" },
                },
            ];

            for (const { expected, result } of testCases) {
                expect(RepoSync.formatResult(result), expected).toBe(expected);
            }
        });

        it("describes changes that would happen in a dry run", () => {
            expect(
                RepoSync.formatResult({ status: "cloned" }, { dryRun: true })
            ).toBe("would clone");
            expect(
                RepoSync.formatResult(
                    { branch: "main", commits: 2, status: "updated" },
                    { dryRun: true }
                )
            ).toBe("would update main (+2 commits)");
            expect(
                RepoSync.formatResult(
                    { status: "up-to-date" },
                    { dryRun: true }
                )
            ).toBe("up-to-date");
        });
    });

    describe("formatStatus", () => {
        it("returns the status outside a dry run", () => {
            expect(RepoSync.formatStatus("cloned")).toBe("cloned");
        });

        it("describes changes that would happen in a dry run", () => {
            expect(RepoSync.formatStatus("cloned", { dryRun: true })).toBe(
                "would clone"
            );
            expect(RepoSync.formatStatus("updated", { dryRun: true })).toBe(
                "would update"
            );
            expect(RepoSync.formatStatus("skipped", { dryRun: true })).toBe(
                "skipped"
            );
        });
    });
});

function createRemote(name: string): OrgRepo {
    const remoteDir = path.join(remotesDir, ORG, `${name}.git`);
    mkdirSync(remoteDir, { recursive: true });
    git(remoteDir, "init", "--quiet", "--bare", "--initial-branch=main");
    const seedDir = path.join(workDir, `seed-${name}`);
    git(workDir, "clone", "--quiet", remoteDir, seedDir);
    commit(seedDir, "README.md");
    git(seedDir, "push", "--quiet", "origin", "HEAD:main");
    return fakeRepo(name, { sshUrl: remoteDir, url: remoteDir });
}

function cloneLocal(repo: OrgRepo): string {
    git(rootDir, "clone", "--quiet", repo.sshUrl, repo.name);
    return path.join(rootDir, repo.name);
}

function pushUpstream(repo: OrgRepo, count: number): void {
    for (let i = 0; i < count; i++) {
        commitUpstream(repo, `upstream-${randomUUID()}.txt`);
    }
}

function commitUpstream(repo: OrgRepo, ...files: string[]): void {
    const seedDir = path.join(workDir, `seed-${repo.name}`);
    git(seedDir, "pull", "--quiet", "--ff-only");
    commit(seedDir, ...files);
    git(seedDir, "push", "--quiet", "origin", "HEAD:main");
}

function commit(repoDir: string, ...files: string[]): void {
    for (const file of files) {
        writeFileSync(path.join(repoDir, file), randomUUID());
    }
    git(repoDir, "add", "--force", ...files);
    git(repoDir, "commit", "--quiet", "-m", `change ${files.join(", ")}`);
}

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function fakeRepo(name: string, overrides: Partial<OrgRepo> = {}): OrgRepo {
    return {
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        name,
        sshUrl: `git@github.com:${ORG}/${name}.git`,
        url: `https://github.com/${ORG}/${name}`,
        ...overrides,
    };
}
