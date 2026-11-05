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
import { Loc } from "./loc.js";

let root: string;

beforeAll(() => {
    const gitConfigDir = mkdtempSync(path.join(tmpdir(), "swiss-gitconfig-"));
    const gitConfig = path.join(gitConfigDir, "gitconfig");
    writeFileSync(gitConfig, "");
    vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfig);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterAll(() => {
    vi.unstubAllEnvs();
});

beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-loc-")));
    git("init", "-q", "-b", "main");
});

afterEach(() => {
    rmSync(root, { force: true, recursive: true });
});

describe("Loc", () => {
    describe("countLines", () => {
        it("counts a last line without a newline", () => {
            expect(Loc.countLines(Buffer.from(""))).toBe(0);
            expect(Loc.countLines(Buffer.from("a"))).toBe(1);
            expect(Loc.countLines(Buffer.from("a\n"))).toBe(1);
            expect(Loc.countLines(Buffer.from("a\n\nb"))).toBe(3);
        });
    });

    describe("language", () => {
        it("goes by extension, then by name", () => {
            expect(Loc.language("src/index.TS")).toBe("TypeScript");
            expect(Loc.language("app/Dockerfile")).toBe("Dockerfile");
            expect(Loc.language("LICENSE")).toBe("Other");
        });
    });

    describe("count", () => {
        it("counts tracked text files, leaving out lockfiles and generated files", async () => {
            write("src/index.ts", "one\ntwo\n");
            write("src/gen.ts", "generated\n");
            write("package-lock.json", "{\n}\n");
            write("web/yarn.lock", "lock\n");
            write("logo.png", "\0binary");
            write(".gitattributes", "src/gen.ts linguist-generated\n");
            git("add", ".");
            write("untracked.ts", "not counted\n");

            expect(await count()).toEqual([
                [".gitattributes", 1],
                ["src/index.ts", 2],
            ]);
            expect(await count({ all: true })).toEqual([
                [".gitattributes", 1],
                ["package-lock.json", 2],
                ["src/gen.ts", 1],
                ["src/index.ts", 2],
                ["web/yarn.lock", 1],
            ]);
        });

        it("leaves out --exclude globs and counts uncommitted changes", async () => {
            write("src/index.ts", "one\n");
            write("src/index.test.ts", "test\n");
            write("docs/guide.md", "guide\n");
            git("add", ".");
            write("src/index.ts", "one\ntwo\nthree\n");

            expect(
                await count({ exclude: ["**/*.test.ts", "docs/**"] })
            ).toEqual([["src/index.ts", 3]]);
        });

        it("only counts files under a subdirectory", async () => {
            write("a/one.ts", "1\n");
            write("b/two.ts", "2\n");
            git("add", ".");

            const files = await Loc.count(path.join(root, "b"));
            expect(files.map((file) => file.path)).toEqual(["two.ts"]);
        });
    });

    describe("group", () => {
        it("groups by language or top-level directory, largest first", () => {
            const files = [
                { language: "TypeScript", lines: 5, path: "src/a.ts" },
                { language: "TypeScript", lines: 3, path: "lib/b.ts" },
                { language: "Markdown", lines: 10, path: "README.md" },
            ];

            expect(Loc.group(files, "language")).toEqual([
                { files: 1, lines: 10, name: "Markdown" },
                { files: 2, lines: 8, name: "TypeScript" },
            ]);
            expect(Loc.group(files, "directory")).toEqual([
                { files: 1, lines: 10, name: "." },
                { files: 1, lines: 5, name: "src/" },
                { files: 1, lines: 3, name: "lib/" },
            ]);
        });
    });
});

async function count(
    options?: Parameters<typeof Loc.count>[1]
): Promise<Array<[string, number]>> {
    const files = await Loc.count(root, options);
    return files
        .map((file): [string, number] => [file.path, file.lines])
        .sort(([a], [b]) => a.localeCompare(b));
}

function write(file: string, contents: string): void {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
}

function git(...args: string[]): string {
    return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: {
            ...process.env,
            GIT_AUTHOR_DATE: "2024-03-01T12:00:00",
            GIT_AUTHOR_EMAIL: "ada@example.com",
            GIT_AUTHOR_NAME: "Ada",
            GIT_COMMITTER_DATE: "2024-03-01T12:00:00",
            GIT_COMMITTER_EMAIL: "ada@example.com",
            GIT_COMMITTER_NAME: "Ada",
        },
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}
