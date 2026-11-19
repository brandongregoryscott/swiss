import { execFileSync } from "node:child_process";
import {
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
import type { BumpOptions, ScannedPlan } from "./bump.js";
import { CommandError } from "../../shared/exec.js";
import { GitHub } from "../../shared/git/github.js";
import { PackageBump } from "./bump.js";
import { LockfileError } from "./lockfiles.js";
import { fakeManifest } from "./manifest.fixtures.js";

const ORG = "acme";

const TARGET = { pkg: "@acme/cats", version: "1.4.0" };

const BRANCH = "bump/acme-cats-1.4.0";

const TEMPLATE = "## Checklist\n\n- [ ] Technical docs updated\n- [ ] Tested\n";

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
    workDir = mkdtempSync(path.join(tmpdir(), "swiss-bump-test-"));
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
    vi.restoreAllMocks();
    rmSync(workDir, { force: true, recursive: true });
});

describe("PackageBump", () => {
    describe("plan", () => {
        it("finds every manifest on origin that depends on the package", async () => {
            const repo = createRemote("monorepo", {
                "apps/api/package.json": fakeManifest({
                    dependencies: { "@acme/cats": "^1.2.0" },
                }),
                "apps/web/package.json": fakeManifest({
                    dependencies: { "@acme/cats": "1.4.0" },
                }),
                "package.json": fakeManifest({
                    dependencies: { "@acme/dogs": "^1.0.0" },
                }),
            });
            cloneLocal(repo);

            const result = await PackageBump.plan(repo, TARGET, config);

            expect(result).toEqual({
                branch: BRANCH,
                checks: [
                    {
                        current: "^1.2.0",
                        currentVersion: "1.2.0",
                        next: "^1.4.0",
                        path: "apps/api/package.json",
                        section: "dependencies",
                        status: "bump",
                    },
                    {
                        current: "1.4.0",
                        path: "apps/web/package.json",
                        status: "up-to-date",
                    },
                ],
                defaultBranch: "main",
                repoDir: path.join(rootDir, "monorepo"),
                status: "scanned",
            });
        });

        it("reports a repo that isn't cloned", async () => {
            const repo = createRemote("widget", {
                "package.json": fakeManifest({
                    dependencies: { "@acme/cats": "^1.2.0" },
                }),
            });

            const result = await PackageBump.plan(repo, TARGET, config);

            expect(result).toEqual({ status: "missing" });
        });

        it("skips a repo whose bump branch is already on origin", async () => {
            const repo = createRemote("widget", {
                "package.json": fakeManifest({
                    dependencies: { "@acme/cats": "^1.2.0" },
                }),
            });
            git(seedDir(repo), "push", "--quiet", "origin", `HEAD:${BRANCH}`);
            cloneLocal(repo);

            const result = await PackageBump.plan(repo, TARGET, config);

            expect(result).toEqual({
                reason: `${BRANCH} is already on origin`,
                status: "skipped",
            });
        });
    });

    describe("apply", () => {
        it("pushes the bump from origin's default branch and opens a pull request", async () => {
            const repo = createRemote("widget", {
                ".github/pull_request_template.md": TEMPLATE,
                "package.json": fakeManifest({
                    dependencies: { "@acme/cats": "^1.2.0" },
                }),
            });
            const localDir = cloneLocal(repo);
            writeFileSync(path.join(localDir, "package.json"), "local edit");
            const plan = await scannedPlan(repo);
            const bodies: string[] = [];
            const createPullRequest = vi
                .spyOn(GitHub, "createPullRequest")
                .mockImplementation((options) => {
                    bodies.push(readFileSync(options.bodyFile, "utf8"));
                    return Promise.resolve(
                        "https://github.com/acme/widget/pull/1"
                    );
                });
            const options = bumpOptions();

            const result = await PackageBump.apply(repo, plan, options);

            expect(result).toEqual({
                status: "opened",
                url: "https://github.com/acme/widget/pull/1",
            });
            expect(
                JSON.parse(git(repo.sshUrl, "show", `${BRANCH}:package.json`))
            ).toEqual({ dependencies: { "@acme/cats": "^1.4.0" } });
            expect(git(repo.sshUrl, "log", "-1", "--format=%s", BRANCH)).toBe(
                "chore(deps): bump @acme/cats to 1.4.0"
            );
            expect(options.lockfiles.update).toHaveBeenCalledWith(
                {
                    dir: expect.stringMatching(/widget$/) as unknown,
                    manager: "npm",
                    name: "package-lock.json",
                },
                expect.any(String)
            );
            expect(options.changelog).toHaveBeenCalledWith(
                "@acme/cats",
                "1.2.0",
                "1.4.0"
            );
            expect(createPullRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    base: "main",
                    draft: true,
                    head: BRANCH,
                    repo: { host: "github.com", name: "widget", owner: ORG },
                    title: "chore(deps): bump @acme/cats to 1.4.0",
                })
            );
            expect(bodies).toEqual([
                [
                    "Bumps `@acme/cats` from `^1.2.0` to `^1.4.0`.",
                    "",
                    "No ticket required - general housekeeping",
                    "",
                    "## Changelog",
                    "",
                    "- feat: add whiskers",
                    "",
                    "## Checklist",
                    "",
                    "- [x] Technical docs updated",
                    "- [ ] Tested",
                    "",
                ].join("\n"),
            ]);
            expect(
                readFileSync(path.join(localDir, "package.json"), "utf8")
            ).toBe("local edit");
            expect(worktrees(localDir)).toEqual([realpathSync(localDir)]);
        });

        it("reports a failed lockfile update and cleans up", async () => {
            const repo = createRemote("widget", {
                "package.json": fakeManifest({
                    dependencies: { "@acme/cats": "^1.2.0" },
                }),
            });
            const localDir = cloneLocal(repo);
            const plan = await scannedPlan(repo);
            const createPullRequest = vi.spyOn(GitHub, "createPullRequest");
            const options = bumpOptions();
            vi.mocked(options.lockfiles.update).mockRejectedValue(
                new LockfileError("npm install failed")
            );

            const result = await PackageBump.apply(repo, plan, options);

            expect(result).toEqual({
                reason: "npm install failed",
                status: "error",
            });
            expect(createPullRequest).not.toHaveBeenCalled();
            expect(git(repo.sshUrl, "branch", "--list", BRANCH)).toBe("");
            expect(worktrees(localDir)).toEqual([realpathSync(localDir)]);
        });

        it("deletes the pushed branch when the pull request can't be opened", async () => {
            const repo = createRemote("widget", {
                "package.json": fakeManifest({
                    dependencies: { "@acme/cats": "^1.2.0" },
                }),
            });
            const localDir = cloneLocal(repo);
            const plan = await scannedPlan(repo);
            vi.spyOn(GitHub, "createPullRequest").mockRejectedValue(
                new CommandError("gh pr create failed")
            );

            const result = await PackageBump.apply(repo, plan, bumpOptions());

            expect(result).toEqual({
                reason: "gh pr create failed",
                status: "error",
            });
            expect(git(repo.sshUrl, "branch", "--list", BRANCH)).toBe("");
            expect(worktrees(localDir)).toEqual([realpathSync(localDir)]);
        });
    });

    describe("branch", () => {
        it("names the branch after the package and version", () => {
            const testCases = [
                { pkg: "@acme/cats", result: "bump/acme-cats-1.4.0" },
                { pkg: "lodash", result: "bump/lodash-1.4.0" },
            ];

            for (const { pkg, result } of testCases) {
                expect(PackageBump.branch({ pkg, version: "1.4.0" }), pkg).toBe(
                    result
                );
            }
        });
    });
});

async function scannedPlan(repo: OrgRepo): Promise<ScannedPlan> {
    const plan = await PackageBump.plan(repo, TARGET, config);
    if (plan.status !== "scanned") {
        throw new Error(`expected a scanned plan, got ${plan.status}`);
    }
    return plan;
}

function bumpOptions(): BumpOptions {
    return {
        changelog: vi.fn(() => Promise.resolve("- feat: add whiskers")),
        config,
        draft: true,
        lockfiles: {
            update: vi.fn(async (lockfile) => {
                writeFileSync(
                    path.join(lockfile.dir, lockfile.name),
                    "updated"
                );
            }),
        },
        notes: ["No ticket required - general housekeeping"],
        target: TARGET,
    };
}

function createRemote(name: string, files: Record<string, string>): OrgRepo {
    const remoteDir = path.join(remotesDir, ORG, `${name}.git`);
    mkdirSync(remoteDir, { recursive: true });
    git(remoteDir, "init", "--quiet", "--bare", "--initial-branch=main");
    const seed = path.join(workDir, `seed-${name}`);
    git(workDir, "clone", "--quiet", remoteDir, seed);
    for (const [file, text] of Object.entries({
        ...files,
        "package-lock.json": "{}",
    })) {
        mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
        writeFileSync(path.join(seed, file), text);
    }
    git(seed, "add", ".");
    git(seed, "commit", "--quiet", "-m", "initial");
    git(seed, "push", "--quiet", "origin", "HEAD:main");
    return fakeRepo(name, { sshUrl: remoteDir, url: remoteDir });
}

function worktrees(repoDir: string): string[] {
    return git(repoDir, "worktree", "list", "--porcelain")
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => realpathSync(line.slice("worktree ".length)));
}

function seedDir(repo: OrgRepo): string {
    return path.join(workDir, `seed-${repo.name}`);
}

function cloneLocal(repo: OrgRepo): string {
    git(rootDir, "clone", "--quiet", repo.sshUrl, repo.name);
    return path.join(rootDir, repo.name);
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
