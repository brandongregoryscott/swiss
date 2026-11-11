import {
    lstat,
    mkdir,
    readdir,
    readlink,
    symlink,
    unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nullIfMissing } from "../../shared/errors.js";

type LinkedSkill = {
    name: string;
    path: string;
    status: "added" | "skipped" | "unchanged" | "updated";
};

class ClaudeSkills {
    static readonly ASSETS = fileURLToPath(
        new URL("../../../assets/skills", import.meta.url)
    );

    static directory(env: NodeJS.ProcessEnv = process.env): string {
        return path.join(
            env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
            "skills"
        );
    }

    static async link(
        skillsDir: string = ClaudeSkills.directory(),
        assetsDir: string = ClaudeSkills.ASSETS
    ): Promise<LinkedSkill[]> {
        const entries = await readdir(assetsDir, { withFileTypes: true });
        const names = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        await mkdir(skillsDir, { recursive: true });
        const linked: LinkedSkill[] = [];
        for (const name of names) {
            const source = path.join(assetsDir, name);
            const destination = path.join(skillsDir, name);
            linked.push({
                name,
                path: destination,
                status: await ClaudeSkills.#linkOne(source, destination),
            });
        }
        return linked;
    }

    static async #linkOne(
        source: string,
        destination: string
    ): Promise<LinkedSkill["status"]> {
        const existing = await lstat(destination).catch(nullIfMissing);
        if (existing == null) {
            await symlink(source, destination, "dir");
            return "added";
        }
        if (!existing.isSymbolicLink()) {
            return "skipped";
        }
        const target = path.resolve(
            path.dirname(destination),
            await readlink(destination)
        );
        if (target === source) {
            return "unchanged";
        }
        await unlink(destination);
        await symlink(source, destination, "dir");
        return "updated";
    }
}

export { ClaudeSkills };
export type { LinkedSkill };
