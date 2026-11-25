import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { nullIfMissing, UserError } from "./errors.js";
import { Text } from "./text.js";

class FileError extends UserError {}

class Files {
    static ancestors(rootDir: string, fromDir: string): string[] {
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

    static async exists(file: string): Promise<boolean> {
        return (await stat(file).catch(nullIfMissing)) != null;
    }

    static expandHome(dir: string): string {
        if (dir === "~") {
            return homedir();
        }
        if (dir.startsWith("~/")) {
            return path.join(homedir(), dir.slice(2));
        }
        return dir;
    }

    // Whether dir is an existing directory. Not being able to read it counts as not, for warnings
    // and notes; use requireDirectory when it has to be one.
    static async isDirectory(dir: string): Promise<boolean> {
        const stats = await stat(dir).catch(() => null);
        return stats?.isDirectory() === true;
    }

    // Throws unless dir is an existing directory, saying why.
    static async requireDirectory(dir: string): Promise<void> {
        const stats = await stat(dir).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return null;
            }
            throw new FileError(
                `Can't read ${Text.displayPath(dir)}: ${(error as Error).message}`
            );
        });
        if (stats?.isDirectory() !== true) {
            throw new FileError(`${Text.displayPath(dir)} isn't a directory`);
        }
    }
}

export { FileError, Files };
