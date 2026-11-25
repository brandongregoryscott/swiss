import { formatDistanceStrict } from "date-fns";
import { isBoolean, isEmpty, isPlainObject, isString } from "lodash-es";
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DeployRepo } from "../../shared/config/deploy-config.js";
import { nullIfMissing, UserError } from "../../shared/errors.js";
import { Files } from "../../shared/files.js";
import { Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";

type WorktreeSource = {
    branch: null | string;
    kind: "worktree";
    path: string;
    uncommitted: boolean;
};

type BranchSource = {
    branch: string;
    kind: "branch";
    ref: string;
};

type DeploySource = BranchSource | WorktreeSource;

type Deploy = {
    commit: string;
    deployedAt: string;
    source: DeploySource;
};

type DeployState = Record<string, Deploy>;

type DeployTarget = {
    repo: DeployRepo;
    worktree: string;
};

type DeployStatus = {
    commit: null | string;
    deploy: Deploy | null;
    repo: DeployRepo;
    state: string;
};

type WorktreeSnapshot = {
    commit: string;
    uncommitted: boolean;
};

class DeployError extends UserError {}

const LOCK_REASON = "swiss deploy checkout";

class Deploys {
    static readonly COLUMNS = [
        "REPO",
        "STATUS",
        "COMMIT",
        "DEPLOYED",
        "SOURCE",
    ];

    static readonly DISPLAY_PATH =
        "~/.local/share/swiss/deploys.json (or $XDG_DATA_HOME/swiss/deploys.json)";

    static readonly FILE_NAME = "deploys.json";

    static async branchSource(
        repo: DeployRepo,
        branch: string,
        pull: boolean
    ): Promise<BranchSource> {
        const local = `refs/heads/${branch}`;
        const remote = `refs/remotes/origin/${branch}`;
        if (!pull && (await Git.refExists(repo.path, local))) {
            return { branch, kind: "branch", ref: local };
        }
        await fetchOrigin(repo, pull);
        for (const ref of [remote, local]) {
            if (await Git.refExists(repo.path, ref)) {
                return { branch, kind: "branch", ref };
            }
        }
        throw new DeployError(
            `${repo.name} has no branch ${branch}, locally or on origin`
        );
    }

    static async defaultBranch(repo: DeployRepo): Promise<string> {
        const originHead = await Git.runWith(
            repo.path,
            { okExitCodes: [1] },
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD"
        );
        if (originHead !== "") {
            return originHead.replace(/^origin\//, "");
        }
        for (const branch of ["main", "master"]) {
            if (await Git.refExists(repo.path, `refs/heads/${branch}`)) {
                return branch;
            }
        }
        throw new DeployError(
            `${repo.name} has no main or master branch, and origin doesn't name a default`
        );
    }

    static async deployBranch(
        dataDir: string,
        repo: DeployRepo,
        source: BranchSource
    ): Promise<Deploy> {
        const commit = await checkout(repo, source.ref);
        return record(dataDir, repo, { commit, source });
    }

    static async deployWorktree(
        dataDir: string,
        target: DeployTarget
    ): Promise<Deploy> {
        const branch = await Git.runWith(
            target.worktree,
            { okExitCodes: [1] },
            "symbolic-ref",
            "--quiet",
            "--short",
            "HEAD"
        );
        const snapshot = await snapshotOf(target.worktree);
        const commit = await checkout(target.repo, snapshot.commit);
        return record(dataDir, target.repo, {
            commit,
            source: {
                branch: branch === "" ? null : branch,
                kind: "worktree",
                path: target.worktree,
                uncommitted: snapshot.uncommitted,
            },
        });
    }

    static async load(dataDir: string): Promise<DeployState> {
        const statePath = Deploys.path(dataDir);
        const contents = await readFile(statePath, "utf8").catch(nullIfMissing);
        if (contents == null) {
            return {};
        }

        let state: unknown;
        try {
            state = JSON.parse(contents);
        } catch (error) {
            throw new DeployError(
                `${statePath} is not valid JSON: ${(error as Error).message}`
            );
        }
        if (
            !isPlainObject(state) ||
            !Object.values(state as object).every(isDeploy)
        ) {
            throw new DeployError(
                `${statePath} must map repo names to deploys, each with a commit, deployedAt and source`
            );
        }
        return state as DeployState;
    }

    static path(dataDir: string): string {
        return path.join(dataDir, Deploys.FILE_NAME);
    }

    static async planUse(
        repos: DeployRepo[],
        dirs: string[],
        cwd = process.cwd()
    ): Promise<DeployTarget[]> {
        const commonDirs = await Promise.all(
            repos.map((repo) => commonDirOf(repo.path).catch(() => null))
        );
        const targets: DeployTarget[] = [];
        for (const dir of dirs) {
            const resolved = path.resolve(cwd, dir);
            await Files.requireDirectory(resolved);
            const root = await Git.repoRoot(resolved);
            if (root == null) {
                throw new DeployError(
                    `${Text.displayPath(resolved)} isn't in a git repo`
                );
            }
            const repo = repos[commonDirs.indexOf(await commonDirOf(root))];
            if (repo == null) {
                throw new DeployError(
                    `${Text.displayPath(root)} isn't a worktree of a repo to deploy (${repos.map((each) => each.name).join(", ")})`
                );
            }
            if ((await realpath(repo.checkout).catch(() => null)) === root) {
                throw new DeployError(
                    `${Text.displayPath(root)} is ${repo.name}'s deploy checkout, which can't be deployed to itself`
                );
            }
            const previous = targets.find((target) => target.repo === repo);
            if (previous == null) {
                targets.push({ repo, worktree: root });
            } else if (previous.worktree !== root) {
                throw new DeployError(
                    `${repo.name} was given twice, as ${Text.displayPath(previous.worktree)} and ${Text.displayPath(root)}, but its checkout can only hold one`
                );
            }
        }
        return targets;
    }

    static async requireCopies(repos: DeployRepo[]): Promise<void> {
        const missing = [];
        for (const repo of repos) {
            for (const file of repo.copy) {
                const source = path.join(repo.path, file);
                if (!(await Files.exists(source))) {
                    missing.push(Text.displayPath(source));
                }
            }
        }
        if (!isEmpty(missing)) {
            throw new DeployError(
                `Files to copy into the deploy checkouts are missing: ${missing.join(", ")}`
            );
        }
    }

    static row(status: DeployStatus, now = new Date()): string[] {
        const { deploy } = status;
        return [
            status.repo.name,
            status.state,
            status.commit?.slice(0, 8) ?? "",
            deploy == null
                ? ""
                : formatDistanceStrict(new Date(deploy.deployedAt), now, {
                      addSuffix: true,
                  }),
            deploy == null ? "" : Deploys.source(deploy.source),
        ];
    }

    static source(source: DeploySource): string {
        if (source.kind === "branch") {
            return source.ref.replace(/^refs\/(heads|remotes)\//, "");
        }
        const branch = source.branch ?? "(detached)";
        const changes = source.uncommitted ? " with uncommitted changes" : "";
        return `${branch}${changes} at ${Text.displayPath(source.path)}`;
    }

    static async status(
        repo: DeployRepo,
        deploy: Deploy | undefined
    ): Promise<DeployStatus> {
        if (!(await Files.isDirectory(repo.checkout))) {
            return { commit: null, deploy: null, repo, state: "not created" };
        }
        const commit = await Git.run(repo.checkout, "rev-parse", "HEAD");
        if (deploy == null) {
            return {
                commit,
                deploy: null,
                repo,
                state: "not deployed by swiss",
            };
        }
        if (deploy.commit !== commit) {
            return {
                commit,
                deploy: null,
                repo,
                state: "changed outside swiss",
            };
        }
        return { commit, deploy, repo, state: await freshness(repo, deploy) };
    }
}

async function checkout(repo: DeployRepo, ref: string): Promise<string> {
    if (await Files.exists(repo.checkout)) {
        await requireCheckoutOf(repo);
        await Git.run(
            repo.checkout,
            "checkout",
            "--quiet",
            "--force",
            "--detach",
            ref
        );
    } else {
        await Git.run(
            repo.path,
            "worktree",
            "add",
            "--quiet",
            "--detach",
            "--lock",
            "--reason",
            LOCK_REASON,
            repo.checkout,
            ref
        );
    }
    for (const file of repo.copy) {
        const target = path.join(repo.checkout, file);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(repo.path, file), target);
    }
    return Git.run(repo.checkout, "rev-parse", "HEAD");
}

async function commonDirOf(dir: string): Promise<string> {
    return realpath(
        await Git.run(
            dir,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir"
        )
    );
}

async function fetchOrigin(repo: DeployRepo, pull: boolean): Promise<void> {
    const origin = await Git.runWith(
        repo.path,
        { okExitCodes: [2] },
        "remote",
        "get-url",
        "origin"
    );
    if (origin === "") {
        return;
    }
    try {
        await Git.run(repo.path, "fetch", "--quiet", "origin");
    } catch (error) {
        if (pull) {
            throw error;
        }
    }
}

async function freshness(repo: DeployRepo, deploy: Deploy): Promise<string> {
    const { source } = deploy;
    if (source.kind === "branch") {
        const current = await Git.runWith(
            repo.path,
            { okExitCodes: [1] },
            "rev-parse",
            "--verify",
            "--quiet",
            source.ref
        );
        if (current === "") {
            return "branch deleted";
        }
        return current === deploy.commit ? "up to date" : "branch moved on";
    }
    if (!(await Files.isDirectory(source.path))) {
        return "worktree removed";
    }
    const tree = await treeOf(source.path).catch(() => null);
    if (tree == null) {
        return "unknown";
    }
    const deployed = await Git.run(
        repo.checkout,
        "rev-parse",
        `${deploy.commit}^{tree}`
    );
    return tree === deployed ? "up to date" : "worktree changed";
}

function isDeploy(value: unknown): value is Deploy {
    const deploy = value as null | Partial<Deploy>;
    if (
        deploy == null ||
        !isString(deploy.commit) ||
        !isString(deploy.deployedAt)
    ) {
        return false;
    }
    const source = deploy.source as null | Record<string, unknown> | undefined;
    if (source?.kind === "branch") {
        return isString(source.branch) && isString(source.ref);
    }
    return (
        source?.kind === "worktree" &&
        isString(source.path) &&
        isBoolean(source.uncommitted) &&
        (source.branch === null || isString(source.branch))
    );
}

async function record(
    dataDir: string,
    repo: DeployRepo,
    deployed: Omit<Deploy, "deployedAt">
): Promise<Deploy> {
    const deploy = { ...deployed, deployedAt: new Date().toISOString() };
    const state = await Deploys.load(dataDir);
    await mkdir(dataDir, { recursive: true });
    await writeFile(
        Deploys.path(dataDir),
        `${JSON.stringify({ ...state, [repo.name]: deploy }, null, 2)}\n`
    );
    return deploy;
}

async function requireCheckoutOf(repo: DeployRepo): Promise<void> {
    const root = await Git.repoRoot(repo.checkout).catch(() => null);
    const isCheckout =
        root != null &&
        root === (await realpath(repo.checkout)) &&
        (await commonDirOf(root)) === (await commonDirOf(repo.path));
    if (!isCheckout) {
        throw new DeployError(
            `${Text.displayPath(repo.checkout)} already exists and isn't a worktree of ${Text.displayPath(repo.path)}; move it out of the way`
        );
    }
}

async function snapshotOf(worktree: string): Promise<WorktreeSnapshot> {
    const head = await Git.run(worktree, "rev-parse", "HEAD");
    const tree = await treeOf(worktree);
    if (tree === (await Git.run(worktree, "rev-parse", `${head}^{tree}`))) {
        return { commit: head, uncommitted: false };
    }
    const commit = await Git.run(
        worktree,
        "commit-tree",
        "--no-gpg-sign",
        "-p",
        head,
        "-m",
        `swiss deploy of ${worktree}`,
        tree
    );
    return { commit, uncommitted: true };
}

async function treeOf(worktree: string): Promise<string> {
    const index = await Git.run(
        worktree,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index"
    );
    const tempDir = await mkdtemp(path.join(tmpdir(), "swiss-deploy-"));
    const tempIndex = path.join(tempDir, "index");
    try {
        await copyFile(index, tempIndex).catch(nullIfMissing);
        const env = { GIT_INDEX_FILE: tempIndex };
        await Git.runWith(worktree, { env }, "add", "--all");
        return await Git.runWith(worktree, { env }, "write-tree");
    } finally {
        await rm(tempDir, { force: true, recursive: true });
    }
}

export type {
    BranchSource,
    Deploy,
    DeploySource,
    DeployState,
    DeployStatus,
    DeployTarget,
};
export { DeployError, Deploys };
