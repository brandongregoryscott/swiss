import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { nullIfMissing, UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";

class LockfileError extends UserError {}

type PackageManager = "bun" | "npm" | "pnpm";

type Lockfile = {
    dir: string;
    manager: PackageManager;
    name: string;
};

type LockfileUpdater = Pick<Lockfiles, "update">;

type NodeVersion = {
    file: string;
    version: string;
};

const LOCKFILES: Array<[string, null | PackageManager]> = [
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["yarn.lock", null],
];

const LOCKFILE_ONLY_ARGS: Record<PackageManager, string[]> = {
    bun: ["install", "--lockfile-only", "--ignore-scripts"],
    npm: [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
    ],
    pnpm: ["install", "--lockfile-only", "--ignore-scripts"],
};

const NODE_VERSION_FILES = [".nvmrc", ".node-version", ".tool-versions"];

const TOOL_VERSIONS_NODE = /^(?:nodejs|node)\s+(\S+)/m;

const NVM_INSTALL = `. "$NVM_DIR/nvm.sh" --no-use && nvm install "$1" >/dev/null`;

const NVM_EXEC = `. "$NVM_DIR/nvm.sh" --no-use && nvm use "$1" >/dev/null && shift && exec "$@"`;

class Lockfiles {
    readonly #installs = new Map<string, Promise<void>>();
    readonly #nvmDir: string;

    constructor(nvmDir = process.env.NVM_DIR ?? path.join(homedir(), ".nvm")) {
        this.#nvmDir = nvmDir;
    }

    static async find(
        rootDir: string,
        fromDir: string
    ): Promise<Lockfile | null> {
        for (const dir of ancestors(rootDir, fromDir)) {
            for (const [name, manager] of LOCKFILES) {
                if (!(await exists(path.join(dir, name)))) {
                    continue;
                }
                if (manager == null) {
                    throw new LockfileError(
                        `can't update ${path.relative(rootDir, path.join(dir, name))}; only npm, pnpm and bun lockfiles are supported`
                    );
                }
                return { dir, manager, name };
            }
        }
        return null;
    }

    static async nodeVersion(
        rootDir: string,
        fromDir: string
    ): Promise<NodeVersion | null> {
        for (const dir of ancestors(rootDir, fromDir)) {
            for (const name of NODE_VERSION_FILES) {
                const file = path.join(dir, name);
                const text = await readFile(file, "utf8").catch(nullIfMissing);
                const version =
                    text == null ? null : parseNodeVersion(name, text);
                if (version != null) {
                    return { file: path.relative(rootDir, file), version };
                }
            }
        }
        return null;
    }

    async update(lockfile: Lockfile, rootDir: string): Promise<void> {
        const args = LOCKFILE_ONLY_ARGS[lockfile.manager];
        const node = await Lockfiles.nodeVersion(rootDir, lockfile.dir);
        if (node == null) {
            await Exec.run(lockfile.manager, args, { cwd: lockfile.dir });
            return;
        }

        if (!(await exists(path.join(this.#nvmDir, "nvm.sh")))) {
            throw new LockfileError(
                `${node.file} asks for Node ${node.version}, but nvm isn't installed at ${this.#nvmDir}`
            );
        }
        await this.#install(node.version);
        await Exec.run(
            "bash",
            ["-c", NVM_EXEC, "bash", node.version, lockfile.manager, ...args],
            { cwd: lockfile.dir, env: { NVM_DIR: this.#nvmDir } }
        );
    }

    #install(version: string): Promise<void> {
        let install = this.#installs.get(version);
        if (install == null) {
            install = Exec.run("bash", ["-c", NVM_INSTALL, "bash", version], {
                env: { NVM_DIR: this.#nvmDir },
            }).then(() => {});
            this.#installs.set(version, install);
        }
        return install;
    }
}

function ancestors(rootDir: string, fromDir: string): string[] {
    const dirs = [];
    let dir = fromDir;
    for (;;) {
        dirs.push(dir);
        const parent = path.dirname(dir);
        if (path.relative(rootDir, dir) === "" || parent === dir) {
            return dirs;
        }
        dir = parent;
    }
}

async function exists(file: string): Promise<boolean> {
    return access(file).then(
        () => true,
        () => false
    );
}

function parseNodeVersion(name: string, text: string): null | string {
    if (name === ".tool-versions") {
        return TOOL_VERSIONS_NODE.exec(text)?.[1] ?? null;
    }
    const version = text.trim().split(/\s+/)[0];
    return version == null || version === "" ? null : version;
}

export type { Lockfile, LockfileUpdater, NodeVersion, PackageManager };
export { LockfileError, Lockfiles };
