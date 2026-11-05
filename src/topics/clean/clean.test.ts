import { execFileSync } from "node:child_process";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    symlinkSync,
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
import { Cleanup } from "./clean.js";

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
    // Resolved, since macOS's temp directory is behind a symlink and git reports real paths.
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-clean-")));
});

afterEach(() => {
    rmSync(root, { force: true, recursive: true });
});

describe("Cleanup", () => {
    describe("find", () => {
        it("finds matching directories at any depth outside a git repo", async () => {
            touch("node_modules/react/index.js");
            touch("packages/app/dist/main.js");
            touch("packages/app/src/index.ts");
            touch("packages/lib/out/lib.js");

            expect(await find()).toEqual([
                "node_modules",
                "packages/app/dist",
                "packages/lib/out",
            ]);
        });

        it("doesn't search inside matching directories", async () => {
            touch("node_modules/pkg/node_modules/dep/index.js");
            touch("node_modules/pkg/dist/index.js");

            expect(await find()).toEqual(["node_modules"]);
        });

        it("only finds directories git ignores in a repo", async () => {
            git(root, "init", "--quiet");
            writeFileSync(
                path.join(root, ".gitignore"),
                "node_modules/\nout\n"
            );
            touch("node_modules/react/index.js");
            touch("out/app.js");
            // Committed, like a GitHub Action's build.
            touch("dist/index.js");
            git(root, "add", "dist/index.js");
            // Neither ignored nor committed.
            touch("build/script.sh");

            expect(await find()).toEqual(["node_modules", "out"]);
        });

        it("checks each directory against the repo it's in", async () => {
            touch("loose/dist/index.js");
            mkdirSync(path.join(root, "repo"));
            git(path.join(root, "repo"), "init", "--quiet");
            touch("repo/dist/index.js");
            touch("repo/coverage/lcov.info");
            writeFileSync(path.join(root, "repo", ".gitignore"), "coverage\n");

            expect(await find()).toEqual(["loose/dist", "repo/coverage"]);
        });

        it("finds directories when cleaning a subdirectory of a repo", async () => {
            git(root, "init", "--quiet");
            writeFileSync(path.join(root, ".gitignore"), "dist\n");
            touch("app/dist/index.js");
            touch("app/build/index.js");

            expect(
                await Cleanup.find(path.join(root, "app")).then((paths) =>
                    paths.map((dir) => path.relative(root, dir))
                )
            ).toEqual(["app/dist"]);
        });

        it("skips .git and symlinked directories", async () => {
            touch("real/dist/index.js");
            touch(".git-like/.git/dist/x");
            mkdirSync(path.join(root, "elsewhere", "dist"), {
                recursive: true,
            });
            symlinkSync(
                path.join(root, "elsewhere"),
                path.join(root, "linked")
            );

            expect(await find()).toEqual(["elsewhere/dist", "real/dist"]);
        });

        it("finds nothing in an empty directory", async () => {
            expect(await find()).toEqual([]);
        });
    });

    describe("measure", () => {
        it("adds up the size of each directory", async () => {
            mkdirSync(path.join(root, "dist"));
            writeFileSync(path.join(root, "dist", "big"), Buffer.alloc(64_000));

            const [target] = await Cleanup.measure([path.join(root, "dist")]);
            expect(target!.path).toBe(path.join(root, "dist"));
            expect(target!.size).toBeGreaterThanOrEqual(64_000);
        });
    });

    describe("remove", () => {
        it("deletes each directory", async () => {
            touch("dist/index.js");
            touch("out/index.js");

            const outcomes = await Promise.all([
                Cleanup.remove(path.join(root, "dist")),
                Cleanup.remove(path.join(root, "out")),
            ]);
            expect(outcomes.map((outcome) => outcome.status)).toEqual([
                "removed",
                "removed",
            ]);
            expect(await find()).toEqual([]);
        });

        it.skipIf(process.getuid?.() === 0)(
            "reports a directory it can't delete, and carries on",
            async () => {
                touch("locked/dist/index.js");
                touch("out/index.js");
                const locked = path.join(root, "locked");
                chmodSync(locked, 0o555);
                try {
                    const outcomes = await Promise.all([
                        Cleanup.remove(path.join(locked, "dist")),
                        Cleanup.remove(path.join(root, "out")),
                    ]);

                    expect(outcomes[0]).toMatchObject({ status: "error" });
                    expect(outcomes[0]).toHaveProperty(
                        "reason",
                        expect.stringMatching(/EACCES|EPERM/)
                    );
                    expect(outcomes[1]!.status).toBe("removed");
                } finally {
                    chmodSync(locked, 0o755);
                }
            }
        );

        it("lets bugs through instead of reporting them as a directory's error", async () => {
            await expect(
                Cleanup.remove(undefined as unknown as string)
            ).rejects.toThrow(TypeError);
        });
    });

    describe("formatSize", () => {
        it("uses the largest unit that fits", () => {
            expect(Cleanup.formatSize(0)).toBe("0 B");
            expect(Cleanup.formatSize(999)).toBe("999 B");
            expect(Cleanup.formatSize(1500)).toBe("1.5 KB");
            expect(Cleanup.formatSize(48_200_000)).toBe("48 MB");
            expect(Cleanup.formatSize(2_340_000_000)).toBe("2.3 GB");
        });
    });
});

async function find(): Promise<string[]> {
    const paths = await Cleanup.find(root);
    return paths.map((dir) => path.relative(root, dir));
}

function touch(file: string): void {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "");
}

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}
