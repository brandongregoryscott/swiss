import { execFileSync } from "node:child_process";
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
import type { DeployRepo } from "../../shared/config/deploy-config.js";
import { Deploys } from "./deploys.js";

let workDir: string;
let dataDir: string;
let repo: DeployRepo;

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
    workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-deploy-")));
    dataDir = path.join(workDir, "data");
    repo = {
        checkout: path.join(workDir, "deploy", "app"),
        copy: [".env"],
        name: "app",
        path: path.join(workDir, "app"),
    };
    mkdirSync(repo.path);
    git(repo.path, "init", "--quiet", "--initial-branch=main");
    writeFileSync(path.join(repo.path, ".gitignore"), ".env\n");
    writeFileSync(path.join(repo.path, "README.md"), "hello\n");
    writeFileSync(path.join(repo.path, ".env"), "SECRET=1\n");
    git(repo.path, "add", ".");
    git(repo.path, "commit", "--quiet", "-m", "Initial commit");
});

afterEach(() => {
    rmSync(workDir, { force: true, recursive: true });
});

describe("Deploys.deployWorktree", () => {
    it("deploys uncommitted and untracked files without changing the worktree's status", async () => {
        const worktree = addWorktree("feature");
        writeFileSync(path.join(worktree, "README.md"), "edited\n");
        writeFileSync(path.join(worktree, "new.txt"), "new\n");
        const statusBefore = git(worktree, "status", "--porcelain");

        const result = await Deploys.deployWorktree(dataDir, {
            repo,
            worktree,
        });

        expect(readFile(repo.checkout, "README.md")).toBe("edited\n");
        expect(readFile(repo.checkout, "new.txt")).toBe("new\n");
        expect(git(worktree, "status", "--porcelain")).toBe(statusBefore);
        expect(result.source).toEqual({
            branch: "feature",
            kind: "worktree",
            path: worktree,
            uncommitted: true,
        });
    });

    it("deploys a clean worktree's HEAD", async () => {
        const worktree = addWorktree("feature");

        const result = await Deploys.deployWorktree(dataDir, {
            repo,
            worktree,
        });

        expect(result.commit).toBe(git(worktree, "rev-parse", "HEAD"));
        expect(result.source).toMatchObject({ uncommitted: false });
    });

    it("copies the repo's copy files from its main clone", async () => {
        const worktree = addWorktree("feature");

        await Deploys.deployWorktree(dataDir, { repo, worktree });

        expect(readFile(repo.checkout, ".env")).toBe("SECRET=1\n");
    });

    it("creates the checkout as a locked worktree, so removing worktrees leaves it alone", async () => {
        const worktree = addWorktree("feature");

        await Deploys.deployWorktree(dataDir, { repo, worktree });

        const result = git(repo.path, "worktree", "list", "--porcelain");
        expect(result).toContain(
            `worktree ${repo.checkout}\nHEAD ${git(repo.checkout, "rev-parse", "HEAD")}\ndetached\nlocked swiss deploy checkout`
        );
    });

    it("records the deploy", async () => {
        const worktree = addWorktree("feature");

        const deploy = await Deploys.deployWorktree(dataDir, {
            repo,
            worktree,
        });

        expect(await Deploys.load(dataDir)).toEqual({ app: deploy });
    });

    it("keeps ignored files in the checkout between deploys", async () => {
        const worktree = addWorktree("feature");
        await Deploys.deployWorktree(dataDir, { repo, worktree });
        mkdirSync(path.join(repo.checkout, "node_modules"));
        writeFileSync(path.join(repo.checkout, "node_modules", "dep.js"), "");
        writeFileSync(
            path.join(repo.path, ".gitignore"),
            ".env\nnode_modules\n"
        );
        writeFileSync(
            path.join(worktree, ".gitignore"),
            ".env\nnode_modules\n"
        );

        await Deploys.deployWorktree(dataDir, { repo, worktree });

        expect(
            existsSync(path.join(repo.checkout, "node_modules", "dep.js"))
        ).toBe(true);
    });

    it("refuses a checkout directory that isn't a worktree of the repo", async () => {
        const worktree = addWorktree("feature");
        mkdirSync(repo.checkout, { recursive: true });
        writeFileSync(path.join(repo.checkout, "mine.txt"), "keep\n");

        await expect(
            Deploys.deployWorktree(dataDir, { repo, worktree })
        ).rejects.toThrow(/already exists and isn't a worktree/);
        expect(readFile(repo.checkout, "mine.txt")).toBe("keep\n");
    });
});

describe("Deploys.deployBranch", () => {
    it("deploys the default branch", async () => {
        const branch = await Deploys.defaultBranch(repo);
        const source = await Deploys.branchSource(repo, branch, false);

        const result = await Deploys.deployBranch(dataDir, repo, source);

        expect(result.commit).toBe(git(repo.path, "rev-parse", "main"));
        expect(Deploys.source(result.source)).toBe("main");
    });

    it("fails for a branch that doesn't exist", async () => {
        await expect(Deploys.branchSource(repo, "nope", false)).rejects.toThrow(
            "app has no branch nope, locally or on origin"
        );
    });
});

describe("Deploys.planUse", () => {
    it("matches a worktree to its repo from a directory inside it", async () => {
        const worktree = addWorktree("feature");
        mkdirSync(path.join(worktree, "src"));

        const result = await Deploys.planUse([repo], ["src"], worktree);

        expect(result).toEqual([{ repo, worktree }]);
    });

    it("rejects a worktree of a repo that isn't configured", async () => {
        const other = path.join(workDir, "other");
        mkdirSync(other);
        git(other, "init", "--quiet");

        await expect(Deploys.planUse([repo], [other])).rejects.toThrow(
            /isn't a worktree of a repo to deploy \(app\)/
        );
    });

    it("rejects two worktrees of the same repo", async () => {
        const first = addWorktree("first");
        const second = addWorktree("second");

        await expect(Deploys.planUse([repo], [first, second])).rejects.toThrow(
            /app was given twice/
        );
    });

    it("rejects the deploy checkout itself", async () => {
        const worktree = addWorktree("feature");
        await Deploys.deployWorktree(dataDir, { repo, worktree });

        await expect(Deploys.planUse([repo], [repo.checkout])).rejects.toThrow(
            /can't be deployed to itself/
        );
    });
});

describe("Deploys.requireCopies", () => {
    it("names the copy files missing from the main clone", async () => {
        rmSync(path.join(repo.path, ".env"));

        await expect(Deploys.requireCopies([repo])).rejects.toThrow(
            `missing: ${path.join(repo.path, ".env")}`
        );
    });
});

describe("Deploys.status", () => {
    it("says a checkout that doesn't exist isn't created", async () => {
        const result = await Deploys.status(repo, undefined);

        expect(result.state).toBe("not created");
    });

    it("says a worktree deploy is up to date while the worktree is unchanged", async () => {
        const worktree = addWorktree("feature");
        writeFileSync(path.join(worktree, "README.md"), "edited\n");
        const deploy = await Deploys.deployWorktree(dataDir, {
            repo,
            worktree,
        });

        const result = await Deploys.status(repo, deploy);

        expect(result.state).toBe("up to date");
    });

    it("says a worktree deploy is out of date once the worktree changes", async () => {
        const worktree = addWorktree("feature");
        const deploy = await Deploys.deployWorktree(dataDir, {
            repo,
            worktree,
        });
        writeFileSync(path.join(worktree, "README.md"), "edited\n");

        const result = await Deploys.status(repo, deploy);

        expect(result.state).toBe("worktree changed");
    });

    it("says a branch deploy is out of date once the branch moves on", async () => {
        const source = await Deploys.branchSource(repo, "main", false);
        const deploy = await Deploys.deployBranch(dataDir, repo, source);
        git(repo.path, "commit", "--quiet", "--allow-empty", "-m", "Next");

        const result = await Deploys.status(repo, deploy);

        expect(result.state).toBe("branch moved on");
    });

    it("says a worktree deploy's worktree was removed", async () => {
        const worktree = addWorktree("feature");
        const deploy = await Deploys.deployWorktree(dataDir, {
            repo,
            worktree,
        });
        git(repo.path, "worktree", "remove", worktree);

        const result = await Deploys.status(repo, deploy);

        expect(result.state).toBe("worktree removed");
    });

    it("says the checkout changed outside swiss when it isn't on the recorded commit", async () => {
        const source = await Deploys.branchSource(repo, "main", false);
        const deploy = await Deploys.deployBranch(dataDir, repo, source);
        git(repo.checkout, "commit", "--quiet", "--allow-empty", "-m", "Other");

        const result = await Deploys.status(repo, deploy);

        expect(result).toMatchObject({
            deploy: null,
            state: "changed outside swiss",
        });
    });
});

function addWorktree(branch: string): string {
    const dir = path.join(workDir, branch);
    git(repo.path, "worktree", "add", "--quiet", "-b", branch, dir);
    return dir;
}

function git(dir: string, ...args: string[]): string {
    return execFileSync("git", ["-C", dir, ...args], {
        encoding: "utf8",
    }).trim();
}

function readFile(dir: string, file: string): string {
    return readFileSync(path.join(dir, file), "utf8");
}
