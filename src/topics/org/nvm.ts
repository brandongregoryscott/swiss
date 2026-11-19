import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { nullIfMissing, UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { Files } from "../../shared/files.js";
import { PromiseCache } from "../../shared/promise-cache.js";

class NvmError extends UserError {}

type NodeVersion = {
    file: string;
    version: string;
};

type NvmRunOptions = {
    cwd: string;
    rootDir: string;
};

type NvmRunner = Pick<Nvm, "run">;

const NODE_VERSION_FILES = [".nvmrc", ".node-version", ".tool-versions"];

const TOOL_VERSIONS_NODE = /^(?:nodejs|node)\s+(\S+)/m;

const NVM_INSTALL = `. "$NVM_DIR/nvm.sh" --no-use && nvm install "$1" >/dev/null`;

const NVM_EXEC = `. "$NVM_DIR/nvm.sh" --no-use && nvm use "$1" >/dev/null && shift && exec "$@"`;

class Nvm {
    readonly #installs = new PromiseCache<void>();
    readonly #nvmDir: string;

    constructor(nvmDir = process.env.NVM_DIR ?? path.join(homedir(), ".nvm")) {
        this.#nvmDir = nvmDir;
    }

    static async nodeVersion(
        rootDir: string,
        fromDir: string
    ): Promise<NodeVersion | null> {
        for (const dir of Files.ancestors(rootDir, fromDir)) {
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

    async run(
        command: string,
        args: string[],
        options: NvmRunOptions
    ): Promise<void> {
        const { cwd, rootDir } = options;
        const node = await Nvm.nodeVersion(rootDir, cwd);
        if (node == null) {
            await Exec.run(command, args, { cwd });
            return;
        }

        if (!(await Files.exists(path.join(this.#nvmDir, "nvm.sh")))) {
            throw new NvmError(
                `${node.file} asks for Node ${node.version}, but nvm isn't installed at ${this.#nvmDir}`
            );
        }
        await this.#installs.get(node.version, () =>
            this.#install(node.version)
        );
        await Exec.run(
            "bash",
            ["-c", NVM_EXEC, "bash", node.version, command, ...args],
            { cwd, env: { NVM_DIR: this.#nvmDir } }
        );
    }

    async #install(version: string): Promise<void> {
        await Exec.run("bash", ["-c", NVM_INSTALL, "bash", version], {
            env: { NVM_DIR: this.#nvmDir },
        });
    }
}

function parseNodeVersion(name: string, text: string): null | string {
    if (name === ".tool-versions") {
        return TOOL_VERSIONS_NODE.exec(text)?.[1] ?? null;
    }
    const version = text.trim().split(/\s+/)[0];
    return version == null || version === "" ? null : version;
}

export type { NodeVersion, NvmRunner, NvmRunOptions };
export { Nvm, NvmError };
