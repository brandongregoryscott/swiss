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
import type { WorktreeInfo } from "./worktrees.js";
import { Worktrees } from "./worktrees.js";

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
    // Resolved through symlinks, like macOS's /tmp, since git reports the real path.
    workDir = realpathSync(
        mkdtempSync(path.join(tmpdir(), "swiss-worktrees-"))
    );
    repoDir = path.join(workDir, "repo");
    mkdirSync(repoDir);
    git(repoDir, "init", "--quiet", "--initial-branch=main");
    writeFileSync(path.join(repoDir, "README.md"), "hello\n");
    git(repoDir, "add", ".");
    git(repoDir, "commit", "--quiet", "-m", "Initial commit");
});

afterEach(() => {
    rmSync(workDir, { force: true, recursive: true });
});

describe("Worktrees.list", () => {
    it("lists the main worktree first, then linked ones with their changes", async () => {
        const featureDir = addWorktree("feature");
        writeFileSync(path.join(featureDir, "new.txt"), "new\n");

        const worktrees = await Worktrees.list(repoDir);

        expect(
            worktrees.map((worktree) => ({
                branch: Worktrees.branchName(worktree),
                changes: worktree.changes,
                isMain: worktree.isMain,
                path: worktree.path,
            }))
        ).toEqual([
            { branch: "main", changes: 0, isMain: true, path: repoDir },
            { branch: "feature", changes: 1, isMain: false, path: featureDir },
        ]);
    });

    it("marks worktrees whose directory is gone as missing", async () => {
        const featureDir = addWorktree("feature");
        rmSync(featureDir, { force: true, recursive: true });

        const worktrees = await Worktrees.list(repoDir);

        expect(Worktrees.status(worktrees[1]!)).toBe("missing");
    });

    it("fails outside a git repo", async () => {
        await expect(Worktrees.list(workDir)).rejects.toThrow(
            "isn't in a git repo"
        );
    });
});

describe("Worktrees.find", () => {
    it("finds a linked worktree by branch, path or directory name", async () => {
        const featureDir = addWorktree("feature", "feature-dir");
        const worktrees = await Worktrees.list(repoDir);

        expect((await Worktrees.find(worktrees, "feature"))?.path).toBe(
            featureDir
        );
        expect(
            (await Worktrees.find(worktrees, "../feature-dir", repoDir))?.path
        ).toBe(featureDir);
        expect((await Worktrees.find(worktrees, "feature-dir"))?.path).toBe(
            featureDir
        );
    });

    it("never finds the main worktree", async () => {
        const worktrees = await Worktrees.list(repoDir);

        expect(await Worktrees.find(worktrees, "main")).toBeUndefined();
        expect(await Worktrees.find(worktrees, repoDir)).toBeUndefined();
    });
});

describe("Worktrees.containing", () => {
    it("finds the worktree a nested directory is in", async () => {
        const featureDir = addWorktree("feature");
        mkdirSync(path.join(featureDir, "src"));
        const worktrees = await Worktrees.list(repoDir);

        expect(
            (
                await Worktrees.containing(
                    worktrees,
                    path.join(featureDir, "src")
                )
            )?.path
        ).toBe(featureDir);
        expect(await Worktrees.containing(worktrees, workDir)).toBeNull();
    });
});

describe("Worktrees.remove", () => {
    it("removes the worktree and checks its branch out in the main worktree", async () => {
        const featureDir = addWorktree("feature");
        const [main, feature] = await Worktrees.list(repoDir);

        await Worktrees.remove(main!, feature!, {
            checkout: true,
            force: false,
        });

        expect(await Worktrees.list(repoDir)).toHaveLength(1);
        expect(git(repoDir, "branch", "--show-current")).toBe("feature");
        expect(() => realpathSync(featureDir)).toThrow();
    });

    it("leaves the main worktree's branch alone without checkout", async () => {
        addWorktree("feature");
        const [main, feature] = await Worktrees.list(repoDir);

        await Worktrees.remove(main!, feature!, {
            checkout: false,
            force: false,
        });

        expect(git(repoDir, "branch", "--show-current")).toBe("main");
        expect(git(repoDir, "branch", "--list", "feature")).toContain(
            "feature"
        );
    });

    it("refuses a worktree with changes unless forced", async () => {
        const featureDir = addWorktree("feature");
        writeFileSync(path.join(featureDir, "new.txt"), "new\n");
        const [main, feature] = await Worktrees.list(repoDir);

        await expect(
            Worktrees.remove(main!, feature!, { checkout: true, force: false })
        ).rejects.toThrow("has 1 changed file");

        await Worktrees.remove(main!, feature!, {
            checkout: true,
            force: true,
        });
        expect(git(repoDir, "branch", "--show-current")).toBe("feature");
    });

    it("removes nothing when the main worktree has uncommitted changes", async () => {
        addWorktree("feature");
        writeFileSync(path.join(repoDir, "README.md"), "changed\n");
        const [main, feature] = await Worktrees.list(repoDir);

        await expect(
            Worktrees.remove(main!, feature!, { checkout: true, force: false })
        ).rejects.toThrow("has uncommitted changes");
        expect(await Worktrees.list(repoDir)).toHaveLength(2);
    });

    it("removes a locked worktree when forced", async () => {
        addWorktree("feature");
        git(repoDir, "worktree", "lock", path.join(workDir, "feature"));
        const [main, feature] = await Worktrees.list(repoDir);

        await expect(
            Worktrees.remove(main!, feature!, { checkout: true, force: false })
        ).rejects.toThrow("is locked");

        await Worktrees.remove(main!, feature!, {
            checkout: true,
            force: true,
        });
        expect(await Worktrees.list(repoDir)).toHaveLength(1);
    });

    it("removes a missing worktree", async () => {
        const featureDir = addWorktree("feature");
        rmSync(featureDir, { force: true, recursive: true });
        const [main, feature] = await Worktrees.list(repoDir);

        await Worktrees.remove(main!, feature!, {
            checkout: true,
            force: false,
        });

        expect(git(repoDir, "branch", "--show-current")).toBe("feature");
    });
});

describe("Worktrees.planRemoval", () => {
    it("leaves worktrees with changes or a lock unless forced, and notes names that match nothing", async () => {
        addWorktree("clean");
        const dirtyDir = addWorktree("dirty");
        addWorktree("locked");
        writeFileSync(path.join(dirtyDir, "new.txt"), "work");
        git(repoDir, "worktree", "lock", path.join(workDir, "locked"));
        const worktrees = await Worktrees.list(repoDir);

        const plan = await Worktrees.planRemoval(
            worktrees,
            ["clean", "dirty", "locked", "nope"],
            { checkout: true, force: false }
        );

        expect(
            plan.items.map((worktree) => Worktrees.branchName(worktree))
        ).toEqual(["clean"]);
        expect(
            plan.blocked.map(({ item, reason }) => [
                Worktrees.branchName(item),
                reason,
            ])
        ).toEqual([
            ["dirty", "it has 1 changed file; pass --force to lose them"],
            ["locked", "it's locked; pass --force to remove it anyway"],
        ]);
        expect(plan.missing).toEqual(["nope"]);

        const forced = await Worktrees.planRemoval(
            worktrees,
            ["clean", "dirty", "locked"],
            { checkout: true, force: true }
        );
        expect(forced.blocked).toEqual([]);
        expect(forced.items).toHaveLength(3);
    });

    it("only checks a branch out when there's one worktree to remove", async () => {
        addWorktree("one");
        addWorktree("two");
        const worktrees = await Worktrees.list(repoDir);
        const options = { checkout: true, force: false };

        const single = await Worktrees.planRemoval(worktrees, ["one"], options);
        const both = await Worktrees.planRemoval(
            worktrees,
            ["one", "two"],
            options
        );

        expect(single.checkout).toBe(true);
        expect(both.checkout).toBe(false);

        expect(await both.remove()).toEqual([]);
        expect(await Worktrees.list(repoDir)).toHaveLength(1);
        expect(git(repoDir, "branch", "--show-current")).toBe("main");
    });
});

describe("Worktrees.status", () => {
    function info(overrides: Partial<WorktreeInfo>): WorktreeInfo {
        return {
            branch: "refs/heads/feature",
            changes: 0,
            head: "abc1234",
            isMain: false,
            locked: false,
            path: "/code/feature",
            prunable: false,
            ...overrides,
        };
    }

    it("describes changes and locks", () => {
        expect(Worktrees.status(info({}))).toBe("clean");
        expect(Worktrees.status(info({ changes: 2, locked: true }))).toBe(
            "2 changed files, locked"
        );
        expect(Worktrees.status(info({ changes: null }))).toBe("unknown");
    });
});

function addWorktree(branch: string, dirName = branch): string {
    const dir = path.join(workDir, dirName);
    git(repoDir, "worktree", "add", "--quiet", "-b", branch, dir);
    return dir;
}

function git(dir: string, ...args: string[]): string {
    return execFileSync("git", ["-C", dir, ...args], {
        encoding: "utf8",
    }).trim();
}
