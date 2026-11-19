import path from "node:path";
import type { NvmRunner } from "./nvm.js";
import { UserError } from "../../shared/errors.js";
import { Files } from "../../shared/files.js";
import { Nvm } from "./nvm.js";

class LockfileError extends UserError {}

type PackageManager = "bun" | "npm" | "pnpm";

type Lockfile = {
    dir: string;
    manager: PackageManager;
    name: string;
};

type LockfileUpdater = Pick<Lockfiles, "update">;

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

class Lockfiles {
    readonly #nvm: NvmRunner;

    constructor(nvm: NvmRunner = new Nvm()) {
        this.#nvm = nvm;
    }

    static async find(
        rootDir: string,
        fromDir: string
    ): Promise<Lockfile | null> {
        for (const dir of Files.ancestors(rootDir, fromDir)) {
            for (const [name, manager] of LOCKFILES) {
                if (!(await Files.exists(path.join(dir, name)))) {
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

    async update(lockfile: Lockfile, rootDir: string): Promise<void> {
        await this.#nvm.run(
            lockfile.manager,
            LOCKFILE_ONLY_ARGS[lockfile.manager],
            { cwd: lockfile.dir, rootDir }
        );
    }
}

export type { Lockfile, LockfileUpdater, PackageManager };
export { LockfileError, Lockfiles };
