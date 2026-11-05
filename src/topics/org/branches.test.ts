import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
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
import type { BranchPlan, RepoCleanup, StaleBranch } from "./branches.js";
import { BranchCleanup } from "./branches.js";

const ORG = "acme";

let workDir: string;
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
    workDir = mkdtempSync(path.join(tmpdir(), "swiss-branches-"));
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

describe("BranchCleanup", () => {
    describe("plan", () => {
        it("finds a branch merged with a merge commit and leaves the default branch", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");
            mergeUpstream(repo, "feature", "merge");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "feature",
                    reason: "merged",
                    switchTo: null,
                    worktree: null,
                },
            ]);
            expect(plan.kept).toEqual([]);
        });

        it("counts a renamed branch that was never committed to as unstarted", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            git(repoDir, "branch", "scratch");
            git(repoDir, "branch", "--move", "scratch", "renamed");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([]);
            expect(
                plan.kept.map((branch) => [branch.name, branch.reason])
            ).toEqual([["renamed", "unstarted"]]);
        });

        it("keeps a branch with no reflog, since it can't tell whether it was committed to", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            git(
                repoDir,
                "-c",
                "core.logAllRefUpdates=false",
                "branch",
                "nolog"
            );

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([]);
            expect(
                plan.kept.map((branch) => [branch.name, branch.reason])
            ).toEqual([["nolog", "unstarted"]]);
        });

        it("still counts a renamed branch with commits of its own as merged", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");
            mergeUpstream(repo, "feature", "merge");
            git(repoDir, "branch", "--move", "feature", "renamed");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(
                plan.stale.map((branch) => [branch.name, branch.reason])
            ).toEqual([["renamed", "merged"]]);
        });

        it("finds a squash-merged branch after its upstream is deleted", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature", 3);
            mergeUpstream(repo, "feature", "squash");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "feature",
                    reason: "landed",
                    switchTo: null,
                    worktree: null,
                },
            ]);
        });

        it("finds a rebase-merged branch", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature", 2);
            commitUpstream(repo, "other.txt");
            mergeUpstream(repo, "feature", "rebase");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "feature",
                    reason: "landed",
                    switchTo: null,
                    worktree: null,
                },
            ]);
        });

        it("ignores a branch with unmerged commits", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan).toMatchObject({ kept: [], stale: [] });
        });

        it("finds a squash-merged branch when git has no identity to commit with", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature", 3);
            mergeUpstream(repo, "feature", "squash");
            // Checking a squash merge writes a throwaway commit, which git refuses to do without
            // a name and email.
            for (const name of [
                "GIT_AUTHOR_NAME",
                "GIT_AUTHOR_EMAIL",
                "GIT_COMMITTER_NAME",
                "GIT_COMMITTER_EMAIL",
            ]) {
                vi.stubEnv(name, "");
            }

            try {
                const plan = planned(await BranchCleanup.plan(repo, config));

                expect(plan.stale.map((branch) => branch.reason)).toEqual([
                    "landed",
                ]);
            } finally {
                vi.stubEnv("GIT_AUTHOR_NAME", "Test");
                vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
                vi.stubEnv("GIT_COMMITTER_NAME", "Test");
                vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
            }
        });

        it("ignores a squash-merged branch that got more commits afterwards", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");
            mergeUpstream(repo, "feature", "squash");
            git(repoDir, "checkout", "--quiet", "feature");
            commit(repoDir, "later.txt");
            git(repoDir, "checkout", "--quiet", "main");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan).toMatchObject({ stale: [] });
        });

        it("keeps a gone, unmerged branch unless asked to delete it", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "abandoned");
            git(repoDir, "push", "--quiet", "origin", "--delete", "abandoned");

            const plan = planned(await BranchCleanup.plan(repo, config));
            expect(plan.stale).toEqual([]);
            expect(plan.kept).toEqual([
                {
                    name: "abandoned",
                    reason: "gone",
                    why: "it's only deleted with --gone",
                },
            ]);

            const withGone = planned(
                await BranchCleanup.plan(repo, config, { gone: true })
            );
            expect(withGone.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "abandoned",
                    reason: "gone",
                    switchTo: null,
                    worktree: null,
                },
            ]);
        });

        it("keeps branches that were never committed to", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            git(repoDir, "branch", "new-idea");
            git(
                repoDir,
                "worktree",
                "add",
                "--quiet",
                "-b",
                "other-idea",
                path.join(workDir, "wt")
            );
            git(
                repoDir,
                "worktree",
                "add",
                "--quiet",
                "--track",
                "-b",
                "scaffolded",
                path.join(workDir, "wt-scaffolded"),
                "origin/main"
            );

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([]);
            expect(plan.kept).toEqual([
                {
                    name: "new-idea",
                    reason: "unstarted",
                    why: "it's only deleted with --unstarted",
                },
                {
                    name: "other-idea",
                    reason: "unstarted",
                    why: "it's only deleted with --unstarted",
                },
                {
                    name: "scaffolded",
                    reason: "unstarted",
                    why: "it's only deleted with --unstarted",
                },
            ]);
        });

        it("deletes a branch that was never committed to, with its worktree, when asked", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const worktreeDir = path.join(workDir, "wt-scaffolded");
            git(
                repoDir,
                "worktree",
                "add",
                "--quiet",
                "--track",
                "-b",
                "scaffolded",
                worktreeDir,
                "origin/main"
            );

            const plan = planned(
                await BranchCleanup.plan(repo, config, { unstarted: true })
            );

            expect(plan.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "scaffolded",
                    reason: "unstarted",
                    switchTo: null,
                    worktree: {
                        path: realWorktree(repoDir, worktreeDir),
                        prunable: false,
                    },
                },
            ]);
            expect(plan.kept).toEqual([]);
        });

        it("treats a branch committed to while tracking the default branch as merged", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const worktreeDir = path.join(workDir, "wt-tracking");
            git(
                repoDir,
                "worktree",
                "add",
                "--quiet",
                "--track",
                "-b",
                "tracking",
                worktreeDir,
                "origin/main"
            );
            commit(worktreeDir, "work.txt");
            git(worktreeDir, "push", "--quiet", "origin", "HEAD:tracking");
            mergeUpstream(repo, "tracking", "merge");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toMatchObject([
                { name: "tracking", reason: "merged" },
            ]);
        });

        it("includes the clean linked worktree a merged branch is checked out in", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const worktreeDir = path.join(workDir, "wt-feature");
            addWorktree(repoDir, worktreeDir, "feature");
            // Ignored files don't count as changes.
            writeFileSync(
                path.join(worktreeDir, ".gitignore"),
                "node_modules\n"
            );
            git(worktreeDir, "add", ".gitignore");
            git(worktreeDir, "commit", "--quiet", "-m", "ignore");
            git(worktreeDir, "push", "--quiet");
            mergeUpstream(repo, "feature", "squash");
            mkdirSync(path.join(worktreeDir, "node_modules"));
            writeFileSync(path.join(worktreeDir, "node_modules", "dep.js"), "");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "feature",
                    reason: "landed",
                    switchTo: null,
                    worktree: {
                        path: realWorktree(repoDir, worktreeDir),
                        prunable: false,
                    },
                },
            ]);
        });

        it("keeps a merged branch whose worktree has uncommitted or untracked files", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const dirtyDir = path.join(workDir, "wt-dirty");
            const untrackedDir = path.join(workDir, "wt-untracked");
            addWorktree(repoDir, dirtyDir, "dirty");
            addWorktree(repoDir, untrackedDir, "untracked");
            mergeUpstream(repo, "dirty", "merge");
            mergeUpstream(repo, "untracked", "merge");
            writeFileSync(path.join(dirtyDir, "README.md"), "edited");
            writeFileSync(path.join(untrackedDir, "notes.txt"), "draft");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([]);
            expect(plan.kept.map((branch) => branch.why)).toEqual([
                `worktree ${realWorktree(repoDir, dirtyDir)} has uncommitted or untracked files`,
                `worktree ${realWorktree(repoDir, untrackedDir)} has uncommitted or untracked files`,
            ]);
        });

        it("switches the main worktree off a merged branch when it's clean", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");
            mergeUpstream(repo, "feature", "squash");
            git(repoDir, "checkout", "--quiet", "feature");
            // Ignored files don't count as changes.
            writeFileSync(
                path.join(repoDir, ".git", "info", "exclude"),
                "dist\n"
            );
            mkdirSync(path.join(repoDir, "dist"));

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "feature",
                    reason: "landed",
                    switchTo: "main",
                    worktree: null,
                },
            ]);
            expect(plan.kept).toEqual([]);
        });

        it("keeps a merged branch checked out in a main worktree with uncommitted or untracked files", async () => {
            const repo = createRemote("widget");
            const dirtyDir = cloneLocal(repo);
            pushBranch(dirtyDir, "feature");
            mergeUpstream(repo, "feature", "merge");
            git(dirtyDir, "checkout", "--quiet", "feature");
            writeFileSync(path.join(dirtyDir, "README.md"), "edited");
            const other = createRemote("gadget");
            const untrackedDir = cloneLocal(other);
            pushBranch(untrackedDir, "feature");
            mergeUpstream(other, "feature", "merge");
            git(untrackedDir, "checkout", "--quiet", "feature");
            writeFileSync(path.join(untrackedDir, "notes.txt"), "draft");

            const dirty = planned(await BranchCleanup.plan(repo, config));
            const untracked = planned(await BranchCleanup.plan(other, config));

            expect(dirty.stale).toEqual([]);
            expect(dirty.kept).toEqual([
                {
                    name: "feature",
                    reason: "merged",
                    why: `it's checked out in ${realWorktree(dirtyDir, dirtyDir)}, which has uncommitted or untracked files`,
                },
            ]);
            expect(untracked.stale).toEqual([]);
            expect(untracked.kept.map((branch) => branch.why)).toEqual([
                `it's checked out in ${realWorktree(untrackedDir, untrackedDir)}, which has uncommitted or untracked files`,
            ]);
        });

        it("keeps a merged branch in the main worktree when the default branch is checked out elsewhere", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");
            mergeUpstream(repo, "feature", "merge");
            git(repoDir, "checkout", "--quiet", "feature");
            const mainDir = path.join(workDir, "wt-main");
            git(repoDir, "worktree", "add", "--quiet", mainDir, "main");

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([]);
            expect(plan.kept.map((branch) => branch.why)).toEqual([
                `it's checked out in ${realWorktree(repoDir, repoDir)} and main is checked out in ${realWorktree(repoDir, mainDir)}`,
            ]);
        });

        it("never switches the main worktree off a branch that's only gone upstream", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "abandoned");
            git(repoDir, "push", "--quiet", "origin", "--delete", "abandoned");
            git(repoDir, "checkout", "--quiet", "abandoned");

            const plan = planned(
                await BranchCleanup.plan(repo, config, { gone: true })
            );

            expect(plan.stale).toEqual([]);
            expect(plan.kept).toEqual([
                {
                    name: "abandoned",
                    reason: "gone",
                    why: `it's checked out in ${realWorktree(repoDir, repoDir)}`,
                },
            ]);
        });

        it("keeps a merged branch whose worktree is locked", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const worktreeDir = path.join(workDir, "wt-locked");
            addWorktree(repoDir, worktreeDir, "feature");
            mergeUpstream(repo, "feature", "merge");
            git(repoDir, "worktree", "lock", worktreeDir);

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.kept.map((branch) => branch.why)).toEqual([
                `worktree ${realWorktree(repoDir, worktreeDir)} is locked`,
            ]);
        });

        it("marks the worktree as prunable when its directory is gone", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const worktreeDir = path.join(workDir, "wt-gone");
            addWorktree(repoDir, worktreeDir, "feature");
            mergeUpstream(repo, "feature", "merge");
            const worktreePath = realWorktree(repoDir, worktreeDir);
            rmSync(worktreeDir, { force: true, recursive: true });

            const plan = planned(await BranchCleanup.plan(repo, config));

            expect(plan.stale).toEqual([
                {
                    commit: expect.any(String),
                    name: "feature",
                    reason: "merged",
                    switchTo: null,
                    worktree: { path: worktreePath, prunable: true },
                },
            ]);
        });

        it("reports repos that aren't cloned or aren't git repos", async () => {
            const missing = createRemote("missing");
            const notGit = createRemote("not-git");
            mkdirSync(path.join(rootDir, "not-git"));

            expect(await BranchCleanup.plan(missing, config)).toEqual({
                status: "missing",
            });
            expect(await BranchCleanup.plan(notGit, config)).toEqual({
                reason: "not a git repository",
                status: "skipped",
            });
        });
    });

    describe("apply", () => {
        it("leaves a branch that got new commits after planning, and deletes the rest", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const liveDir = path.join(workDir, "wt-live");
            pushBranch(repoDir, "moved");
            addWorktree(repoDir, liveDir, "live");
            pushBranch(repoDir, "done");
            mergeUpstream(repo, "moved", "squash");
            mergeUpstream(repo, "live", "squash");
            mergeUpstream(repo, "done", "squash");
            const plan = planned(await BranchCleanup.plan(repo, config));
            // While the confirm prompt is open, work lands on two of the planned branches.
            git(repoDir, "checkout", "--quiet", "moved");
            commit(repoDir, "after-planning.txt");
            git(repoDir, "checkout", "--quiet", "main");
            commit(liveDir, "in-worktree.txt");

            const outcomes = await BranchCleanup.apply(repoDir, plan.stale);

            expect(
                outcomes.map((outcome) => [
                    outcome.branch.name,
                    outcome.status,
                    "reason" in outcome ? outcome.reason : "",
                ])
            ).toEqual([
                ["done", "deleted", ""],
                [
                    "live",
                    "error",
                    "it has new commits since it was checked; run again to check it again",
                ],
                [
                    "moved",
                    "error",
                    "it has new commits since it was checked; run again to check it again",
                ],
            ]);
            expect(
                git(repoDir, "branch", "--format=%(refname:short)").split("\n")
            ).toEqual(["live", "main", "moved"]);
            // The worktree with new work in it isn't removed either.
            expect(existsSync(liveDir)).toBe(true);
        });

        it("removes worktrees, prunes missing ones and deletes the branches", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const liveDir = path.join(workDir, "wt-live");
            const goneDir = path.join(workDir, "wt-gone");
            pushBranch(repoDir, "plain");
            addWorktree(repoDir, liveDir, "live");
            addWorktree(repoDir, goneDir, "gone");
            mergeUpstream(repo, "plain", "squash");
            mergeUpstream(repo, "live", "squash");
            mergeUpstream(repo, "gone", "merge");
            rmSync(goneDir, { force: true, recursive: true });
            const plan = planned(await BranchCleanup.plan(repo, config));

            const outcomes = await BranchCleanup.apply(repoDir, plan.stale);

            expect(outcomes.map((outcome) => outcome.status)).toEqual([
                "deleted",
                "deleted",
                "deleted",
            ]);
            expect(existsSync(liveDir)).toBe(false);
            expect(git(repoDir, "branch", "--format=%(refname:short)")).toBe(
                "main"
            );
            expect(
                git(repoDir, "worktree", "list", "--porcelain")
            ).not.toContain("wt-");
        });

        it("switches the main worktree to the default branch before deleting", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");
            mergeUpstream(repo, "feature", "squash");
            git(repoDir, "checkout", "--quiet", "feature");
            const plan = planned(await BranchCleanup.plan(repo, config));

            const outcomes = await BranchCleanup.apply(repoDir, plan.stale);

            expect(outcomes).toMatchObject([{ status: "deleted" }]);
            expect(git(repoDir, "branch", "--show-current")).toBe("main");
            expect(git(repoDir, "branch", "--format=%(refname:short)")).toBe(
                "main"
            );
        });

        it("doesn't switch the main worktree when it picked up changes after planning", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            pushBranch(repoDir, "feature");
            mergeUpstream(repo, "feature", "merge");
            git(repoDir, "checkout", "--quiet", "feature");
            const plan = planned(await BranchCleanup.plan(repo, config));
            writeFileSync(path.join(repoDir, "README.md"), "edited");

            const outcomes = await BranchCleanup.apply(repoDir, plan.stale);

            expect(outcomes).toMatchObject([
                {
                    reason: `${repoDir} has uncommitted or untracked files`,
                    status: "error",
                },
            ]);
            expect(git(repoDir, "branch", "--show-current")).toBe("feature");
        });

        it("reports an error and keeps the branch when its worktree changed after planning", async () => {
            const repo = createRemote("widget");
            const repoDir = cloneLocal(repo);
            const worktreeDir = path.join(workDir, "wt-feature");
            addWorktree(repoDir, worktreeDir, "feature");
            pushBranch(repoDir, "other");
            mergeUpstream(repo, "feature", "merge");
            mergeUpstream(repo, "other", "merge");
            const plan = planned(await BranchCleanup.plan(repo, config));
            writeFileSync(path.join(worktreeDir, "late.txt"), "late");

            const outcomes = await BranchCleanup.apply(repoDir, plan.stale);

            expect(outcomes).toMatchObject([
                { branch: { name: "feature" }, status: "error" },
                { branch: { name: "other" }, status: "deleted" },
            ]);
            expect(existsSync(path.join(worktreeDir, "late.txt"))).toBe(true);
            expect(git(repoDir, "branch", "--list", "feature")).not.toBe("");
        });
    });

    describe("picking", () => {
        const merged = staleBranch("merged-one", "merged");
        const gone = staleBranch("gone-one", "gone");
        const unstarted = staleBranch("new-one", "unstarted");
        const noFlags = { gone: false, pick: false, unstarted: false };

        it("lists every deletable branch with --pick, but only starts merged ones picked", () => {
            expect(
                BranchCleanup.planOptions({ ...noFlags, pick: true })
            ).toEqual({ gone: true, unstarted: true });
            expect(BranchCleanup.planOptions(noFlags)).toEqual({
                gone: false,
                unstarted: false,
            });
            expect(
                [merged, gone, unstarted].map((branch) =>
                    BranchCleanup.startsPicked(branch, {
                        ...noFlags,
                        pick: true,
                    })
                )
            ).toEqual([true, false, false]);
            expect(
                BranchCleanup.startsPicked(gone, {
                    ...noFlags,
                    gone: true,
                    pick: true,
                })
            ).toBe(true);
        });

        it("keeps only the picked branches, dropping repos with none left", () => {
            const cleanups = [
                cleanup("widget", [merged, gone]),
                cleanup("gadget", [unstarted]),
            ];

            const kept = BranchCleanup.keepPicked(cleanups, [gone]);

            expect(kept).toEqual([cleanup("widget", [gone])]);
        });

        it("summarizes what deleting them does", () => {
            const inWorktree = {
                ...staleBranch("feature", "merged"),
                worktree: { path: "/repos/widget-feature", prunable: false },
            };
            const checkedOut = {
                ...staleBranch("fix", "landed"),
                switchTo: "main",
            };

            expect(
                BranchCleanup.summarize([
                    cleanup("widget", [merged, inWorktree]),
                    cleanup("gadget", [checkedOut]),
                ])
            ).toBe(
                "3 branches in 2 repos, removing 1 worktree and switching 1 repo to the default branch"
            );
            expect(BranchCleanup.summarize([cleanup("widget", [merged])])).toBe(
                "1 branch in 1 repo"
            );
        });
    });

    describe("formatBranch", () => {
        it("describes the reason and any worktree it removes", () => {
            expect(
                BranchCleanup.formatBranch({
                    commit: expect.any(String),
                    name: "a",
                    reason: "landed",
                    switchTo: null,
                    worktree: null,
                })
            ).toBe("squash or rebase merged");
            expect(
                BranchCleanup.formatBranch({
                    commit: expect.any(String),
                    name: "a",
                    reason: "merged",
                    switchTo: null,
                    worktree: { path: "/tmp/wt", prunable: false },
                })
            ).toBe("merged, removes worktree /tmp/wt");
            expect(
                BranchCleanup.formatBranch({
                    commit: expect.any(String),
                    name: "a",
                    reason: "merged",
                    switchTo: "main",
                    worktree: null,
                })
            ).toBe("merged, switches to main first");
            expect(
                BranchCleanup.formatBranch({
                    commit: expect.any(String),
                    name: "a",
                    reason: "gone",
                    switchTo: null,
                    worktree: { path: "/tmp/wt", prunable: true },
                })
            ).toBe(
                "upstream gone, not merged, prunes missing worktree /tmp/wt"
            );
            expect(
                BranchCleanup.formatBranch({
                    commit: expect.any(String),
                    name: "a",
                    reason: "unstarted",
                    switchTo: null,
                    worktree: { path: "/tmp/wt", prunable: false },
                })
            ).toBe("no commits of its own, removes worktree /tmp/wt");
        });
    });
});

function planned(plan: BranchPlan): Extract<BranchPlan, { status: "planned" }> {
    if (plan.status !== "planned") {
        throw new Error(`expected a plan, got ${JSON.stringify(plan)}`);
    }
    return plan;
}

function createRemote(name: string): OrgRepo {
    const remoteDir = path.join(workDir, "remotes", ORG, `${name}.git`);
    mkdirSync(remoteDir, { recursive: true });
    git(remoteDir, "init", "--quiet", "--bare", "--initial-branch=main");
    const seedDir = seedPath(name);
    git(workDir, "clone", "--quiet", remoteDir, seedDir);
    commit(seedDir, "README.md");
    git(seedDir, "push", "--quiet", "origin", "HEAD:main");
    return {
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        name,
        sshUrl: remoteDir,
        url: remoteDir,
    };
}

function cloneLocal(repo: OrgRepo): string {
    git(rootDir, "clone", "--quiet", repo.sshUrl, repo.name);
    return path.join(rootDir, repo.name);
}

// Creates a branch with its own commits and pushes it with an upstream, leaving main checked out.
function pushBranch(repoDir: string, branch: string, commits = 1): void {
    git(repoDir, "checkout", "--quiet", "-b", branch);
    for (let i = 0; i < commits; i++) {
        commit(repoDir, `${branch}-${i}.txt`);
    }
    git(repoDir, "push", "--quiet", "--set-upstream", "origin", branch);
    git(repoDir, "checkout", "--quiet", "main");
}

function addWorktree(
    repoDir: string,
    worktreeDir: string,
    branch: string
): void {
    git(
        repoDir,
        "worktree",
        "add",
        "--quiet",
        "-b",
        branch,
        worktreeDir,
        "main"
    );
    commit(worktreeDir, `${branch}.txt`);
    git(worktreeDir, "push", "--quiet", "--set-upstream", "origin", branch);
}

// Merges the remote branch into main the way GitHub would, deleting it for squash and rebase merges.
function mergeUpstream(
    repo: OrgRepo,
    branch: string,
    style: "merge" | "rebase" | "squash"
): void {
    const seedDir = seedPath(repo.name);
    git(seedDir, "fetch", "--quiet", "origin");
    git(seedDir, "merge", "--quiet", "--ff-only", "origin/main");
    switch (style) {
        case "merge": {
            git(
                seedDir,
                "merge",
                "--quiet",
                "--no-ff",
                "-m",
                `merge ${branch}`,
                `origin/${branch}`
            );
            break;
        }

        case "rebase": {
            git(
                seedDir,
                "checkout",
                "--quiet",
                "-b",
                `rebase-${branch}`,
                `origin/${branch}`
            );
            git(seedDir, "rebase", "--quiet", "main");
            git(seedDir, "checkout", "--quiet", "main");
            git(seedDir, "merge", "--quiet", "--ff-only", `rebase-${branch}`);
            break;
        }

        case "squash": {
            git(seedDir, "merge", "--quiet", "--squash", `origin/${branch}`);
            git(seedDir, "commit", "--quiet", "-m", `squash ${branch}`);
            break;
        }
    }
    git(seedDir, "push", "--quiet", "origin", "HEAD:main");
    if (style !== "merge") {
        git(seedDir, "push", "--quiet", "origin", "--delete", branch);
    }
}

function commitUpstream(repo: OrgRepo, ...files: string[]): void {
    const seedDir = seedPath(repo.name);
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

// The path git reports for a worktree, which resolves symlinks like macOS's /var -> /private/var.
function realWorktree(repoDir: string, worktreeDir: string): string {
    const name = path.basename(worktreeDir);
    const line = git(repoDir, "worktree", "list", "--porcelain")
        .split("\n")
        .find(
            (entry) =>
                entry.startsWith("worktree ") && entry.endsWith(`/${name}`)
        );
    return line!.slice("worktree ".length);
}

function seedPath(name: string): string {
    return path.join(workDir, `seed-${name}`);
}

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function staleBranch(name: string, reason: StaleBranch["reason"]): StaleBranch {
    return {
        commit: "0".repeat(40),
        name,
        reason,
        switchTo: null,
        worktree: null,
    };
}

function cleanup(name: string, stale: StaleBranch[]): RepoCleanup {
    return { repo: fakeRepo(name), repoDir: `/repos/${name}`, stale };
}

function fakeRepo(name: string): OrgRepo {
    return {
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        name,
        sshUrl: `git@github.com:${ORG}/${name}.git`,
        url: `https://github.com/${ORG}/${name}`,
    };
}
