import { isEmpty, sortBy } from "lodash-es";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { EnvDocument } from "../../shared/env-files.js";
import type { RemovalPlan } from "../../shared/removal.js";
import { EnvFile } from "../../shared/env-files.js";
import { Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";

type EnvFileInfo = {
    // Shown to the user: relative to the root when under it.
    display: string;
    path: string;
};

type LoadedEnvFile = { doc: EnvDocument } & EnvFileInfo;

// How the files an env template describes differ from it.
type TemplateCheck = {
    // Set but not in the template, so the template may be out of date.
    extra: string[];
    // In the template but not set in any of the files.
    missing: string[];
};

// A file with new contents to write.
type EnvWrite = {
    doc: EnvDocument;
    file: LoadedEnvFile;
};

// What setting a variable does to a file.
type SetResult = {
    file: LoadedEnvFile;
    key: string;
    status: "added" | "unchanged" | "updated";
};

type SetPlan = {
    results: SetResult[];
    // Only the files that change.
    writes: EnvWrite[];
};

// A variable set in a file.
type EnvKey = {
    file: LoadedEnvFile;
    key: string;
};

// A template and how the files it describes differ from it.
type TemplateReport = {
    // The files it describes that exist.
    files: LoadedEnvFile[];
    // The names of the files it describes, like .env and .env.local.
    names: string[];
    template: LoadedEnvFile;
} & TemplateCheck;

// Directories that never hold an app's env files, and can be huge.
const SKIPPED_DIRECTORIES = new Set([
    ".cache",
    ".git",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".terraform",
    ".turbo",
    ".venv",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "vendor",
    "venv",
]);
// Deep enough for apps/api/config/.env, shallow enough to stay quick outside a repo.
const MAX_DEPTH = 5;
// Suffixes of files committed to show which variables to set, like .env.example.
const TEMPLATE_SUFFIXES = [".example", ".sample", ".template"];

class EnvFiles {
    // Compares a template's variables with those set across the files it describes.
    static check(
        template: Map<string, string>,
        files: Array<Map<string, string>>
    ): TemplateCheck {
        const set = new Set(files.flatMap((entries) => [...entries.keys()]));
        return {
            extra: [...set].filter((key) => !template.has(key)),
            missing: [...template.keys()].filter((key) => !set.has(key)),
        };
    }

    // Each template under root, compared with the files it describes that exist.
    static async checkTemplates(
        root: string,
        found: EnvFileInfo[]
    ): Promise<TemplateReport[]> {
        const existing = new Set(found.map((file) => file.path));
        const reports: TemplateReport[] = [];
        for (const info of found) {
            const names = EnvFiles.templateTargets(path.basename(info.path));
            if (names == null) {
                continue;
            }
            const dir = path.dirname(info.path);
            const targets = names
                .map((name) => path.join(dir, name))
                .filter((target) => existing.has(target));
            const [template, ...files] = await EnvFiles.load(root, [
                info.path,
                ...targets,
            ]);
            reports.push({
                files,
                names,
                template: template!,
                ...EnvFiles.check(
                    EnvFile.entries(template!.doc),
                    files.map((file) => EnvFile.entries(file.doc))
                ),
            });
        }
        return reports;
    }

    // How a file is shown: relative to root when it's under it.
    static display(root: string, file: string): string {
        const relative = path.relative(root, file);
        return relative.startsWith("..") || path.isAbsolute(relative)
            ? Text.displayPath(file)
            : relative;
    }

    // Env files under root, like .env and .env.local, skipping dependency and build directories.
    // Sorted by directory, shallowest first, so a monorepo's root files come before its apps'.
    static async find(root: string): Promise<EnvFileInfo[]> {
        const found: string[] = [];
        await walk(root, 0, found);
        return sortBy(
            found,
            (file) => path.relative(root, file).split(path.sep).length,
            (file) => path.dirname(file),
            (file) => path.basename(file)
        ).map((file) => ({
            display: EnvFiles.display(root, file),
            path: file,
        }));
    }

    static isEnvFile(name: string): boolean {
        return name === ".env" || name.startsWith(".env.");
    }

    // Reads files, given relative to the current directory. Missing files read as empty.
    static async load(root: string, files: string[]): Promise<LoadedEnvFile[]> {
        return Promise.all(
            files.map(async (file) => {
                const resolved = path.resolve(file);
                return {
                    display: EnvFiles.display(root, resolved),
                    doc: await EnvFile.read(resolved),
                    path: resolved,
                };
            })
        );
    }

    // What setting values in files would do, file by file, leaving out values that are already set.
    static planSet(
        files: LoadedEnvFile[],
        values: Map<string, string>
    ): SetPlan {
        const results: SetResult[] = [];
        const writes: EnvWrite[] = [];
        for (const file of files) {
            const before = EnvFile.entries(file.doc);
            let doc = file.doc;
            for (const [key, value] of values) {
                const previous = before.get(key);
                if (previous === value) {
                    results.push({ file, key, status: "unchanged" });
                    continue;
                }
                doc = EnvFile.set(doc, key, value);
                results.push({
                    file,
                    key,
                    status: previous == null ? "added" : "updated",
                });
            }
            if (doc !== file.doc) {
                writes.push({ doc, file });
            }
        }
        return { results, writes };
    }

    // Removing keys from every file that sets them.
    static planUnset(
        files: LoadedEnvFile[],
        keys: string[]
    ): RemovalPlan<EnvKey> {
        const found: EnvKey[] = [];
        const writes: EnvWrite[] = [];
        for (const file of files) {
            const entries = EnvFile.entries(file.doc);
            const present = keys.filter((key) => entries.has(key));
            if (isEmpty(present)) {
                continue;
            }
            found.push(...present.map((key) => ({ file, key })));
            writes.push({
                doc: present.reduce(
                    (doc, key) => EnvFile.unset(doc, key),
                    file.doc
                ),
                file,
            });
        }
        return {
            blocked: [],
            items: found,
            missing: keys.filter(
                (key) => !found.some((variable) => variable.key === key)
            ),
            remove: async () => {
                await EnvFiles.save(writes);
                return [];
            },
        };
    }

    // The directory given with --dir, otherwise the git repo containing cwd, otherwise cwd.
    static async root(dir: string | undefined): Promise<string> {
        if (dir != null) {
            return path.resolve(dir);
        }
        const cwd = process.cwd();
        return (await Git.repoRoot(cwd)) ?? cwd;
    }

    static async save(writes: EnvWrite[]): Promise<void> {
        for (const { doc, file } of writes) {
            await EnvFile.write(file.path, doc);
        }
    }

    // The names of the files an env template describes, or null when name isn't a template.
    // .env.example describes .env and .env.local, since both are loaded in development, and
    // .env.production.example describes .env.production.
    static templateTargets(name: string): null | string[] {
        const suffix = TEMPLATE_SUFFIXES.find((candidate) =>
            name.endsWith(candidate)
        );
        if (suffix == null || !EnvFiles.isEnvFile(name)) {
            return null;
        }
        const base = name.slice(0, -suffix.length);
        if (!EnvFiles.isEnvFile(base)) {
            return null;
        }
        return base === ".env" ? [".env", ".env.local"] : [base];
    }
}

async function walk(
    dir: string,
    depth: number,
    found: string[]
): Promise<void> {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        // Unreadable directories are skipped rather than failing the search.
        return;
    }
    const subdirectories: string[] = [];
    for (const entry of entries) {
        if (entry.isFile() && EnvFiles.isEnvFile(entry.name)) {
            found.push(path.join(dir, entry.name));
        } else if (
            entry.isDirectory() &&
            depth < MAX_DEPTH &&
            !SKIPPED_DIRECTORIES.has(entry.name)
        ) {
            subdirectories.push(path.join(dir, entry.name));
        }
    }
    await Promise.all(
        subdirectories.map((subdirectory) =>
            walk(subdirectory, depth + 1, found)
        )
    );
}

export type {
    EnvFileInfo,
    EnvKey,
    EnvWrite,
    LoadedEnvFile,
    SetPlan,
    SetResult,
    TemplateCheck,
    TemplateReport,
};
export { EnvFiles };
