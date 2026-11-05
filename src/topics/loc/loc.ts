import { groupBy, isEmpty, last, orderBy, sumBy } from "lodash-es";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Concurrency } from "../../shared/concurrency.js";
import { UserError } from "../../shared/errors.js";
import { Files } from "../../shared/files.js";
import { Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";

class LocDirError extends UserError {}

type LocFile = {
    language: string;
    lines: number;
    path: string;
};

type LocGroup = {
    files: number;
    lines: number;
    name: string;
};

type LocGrouping = "directory" | "language";

type LocOptions = {
    // Also count lockfiles and files marked linguist-generated or linguist-vendored.
    all?: boolean;
    // Globs of paths to leave out, relative to the directory being counted.
    exclude?: string[];
};

// Lockfiles are generated, and would otherwise dwarf the code in most repos.
const LOCKFILES = [
    "bun.lock",
    "bun.lockb",
    "Cargo.lock",
    "composer.lock",
    "flake.lock",
    "Gemfile.lock",
    "go.sum",
    "mix.lock",
    "package-lock.json",
    "Package.resolved",
    "Pipfile.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "pubspec.lock",
    "uv.lock",
    "yarn.lock",
];

const LANGUAGES_BY_EXTENSION: Record<string, string> = {
    ".bash": "Shell",
    ".c": "C",
    ".cc": "C++",
    ".cjs": "JavaScript",
    ".clj": "Clojure",
    ".cpp": "C++",
    ".cs": "C#",
    ".css": "CSS",
    ".dart": "Dart",
    ".ex": "Elixir",
    ".exs": "Elixir",
    ".fish": "Shell",
    ".go": "Go",
    ".graphql": "GraphQL",
    ".h": "C",
    ".hcl": "HCL",
    ".hpp": "C++",
    ".hs": "Haskell",
    ".html": "HTML",
    ".java": "Java",
    ".js": "JavaScript",
    ".json": "JSON",
    ".jsx": "JavaScript",
    ".kt": "Kotlin",
    ".less": "CSS",
    ".lua": "Lua",
    ".md": "Markdown",
    ".mdx": "Markdown",
    ".mjs": "JavaScript",
    ".mts": "TypeScript",
    ".php": "PHP",
    ".proto": "Protocol Buffers",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".sass": "CSS",
    ".scala": "Scala",
    ".scss": "CSS",
    ".sh": "Shell",
    ".sql": "SQL",
    ".svelte": "Svelte",
    ".swift": "Swift",
    ".tf": "HCL",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".vue": "Vue",
    ".xml": "XML",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".zig": "Zig",
    ".zsh": "Shell",
};

const LANGUAGES_BY_NAME: Record<string, string> = {
    Dockerfile: "Dockerfile",
    Gemfile: "Ruby",
    Makefile: "Makefile",
    Rakefile: "Ruby",
};

const OTHER_LANGUAGE = "Other";
const CONCURRENCY = 32;
// The same check git uses to decide a file is binary: a NUL in its first 8000 bytes.
const BINARY_CHECK_BYTES = 8000;

class Loc {
    // Lines in each tracked file under dir, including uncommitted changes. Binary files are
    // skipped, and so are tracked files that have been deleted.
    static async count(
        dir: string,
        options: LocOptions = {}
    ): Promise<LocFile[]> {
        const paths = await Git.paths(
            dir,
            "ls-files",
            "-z",
            "--",
            ...Loc.pathspecs(options)
        );
        const files = await Promise.all(
            Concurrency.map(paths, CONCURRENCY, async (file) => {
                const contents = await readFile(path.join(dir, file)).catch(
                    () => null
                );
                if (contents == null || isBinary(contents)) {
                    return null;
                }
                return {
                    language: Loc.language(file),
                    lines: Loc.countLines(contents),
                    path: file,
                };
            })
        );
        return files.filter((file) => file != null);
    }

    // Counts lines the way git diff does, so a last line without a newline still counts.
    static countLines(contents: Buffer): number {
        if (isEmpty(contents)) {
            return 0;
        }
        let lines = 0;
        for (const byte of contents) {
            if (byte === 0x0a) {
                lines++;
            }
        }
        return last(contents) === 0x0a ? lines : lines + 1;
    }

    // Totals by language, or by the top-level directory files are in, largest first. Files
    // directly in the counted directory are grouped under ".".
    static group(files: LocFile[], by: LocGrouping): LocGroup[] {
        const groups = groupBy(files, (file) => {
            if (by === "language") {
                return file.language;
            }
            const [first, ...rest] = file.path.split("/");
            return isEmpty(rest) ? "." : `${first}/`;
        });
        return orderBy(
            Object.entries(groups).map(([name, group]) => ({
                files: group.length,
                lines: sumBy(group, "lines"),
                name,
            })),
            ["lines", "name"],
            ["desc", "asc"]
        );
    }

    static language(file: string): string {
        const name = path.basename(file);
        return (
            LANGUAGES_BY_NAME[name] ??
            LANGUAGES_BY_EXTENSION[path.extname(name).toLowerCase()] ??
            OTHER_LANGUAGE
        );
    }

    // Git pathspecs selecting the files to count, shared by ls-files and log so the current
    // count and the history agree.
    static pathspecs(options: LocOptions = {}): string[] {
        const excluded = (options.exclude ?? []).map(
            (glob) => `:(exclude,glob)${glob}`
        );
        if (options.all === true) {
            return [".", ...excluded];
        }
        return [
            ".",
            ...LOCKFILES.map((name) => `:(exclude,glob)**/${name}`),
            ":(exclude,attr:linguist-generated)",
            ":(exclude,attr:linguist-vendored)",
            ...excluded,
        ];
    }

    // The directory to run git in: dir, or the root of the repo the working directory is in.
    static async resolveDir(dir: string | undefined): Promise<string> {
        const resolved = path.resolve(dir ?? ".");
        await Files.requireDirectory(resolved);
        const root = await Git.repoRoot(resolved);
        if (root == null) {
            throw new LocDirError(
                `${Text.displayPath(resolved)} isn't in a git repo`
            );
        }
        return dir == null ? root : resolved;
    }
}

function isBinary(contents: Buffer): boolean {
    return contents.subarray(0, BINARY_CHECK_BYTES).includes(0);
}

export type { LocFile, LocGroup, LocGrouping, LocOptions };
export { Loc, LocDirError, LOCKFILES };
