import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LockfileError, Lockfiles } from "./lockfiles.js";

let repoDir: string;

beforeEach(() => {
    const workDir = mkdtempSync(path.join(tmpdir(), "swiss-lockfiles-"));
    repoDir = path.join(workDir, "repo");
    mkdirSync(path.join(repoDir, "apps", "web"), { recursive: true });
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(path.dirname(repoDir), { force: true, recursive: true });
});

describe("Lockfiles", () => {
    describe("find", () => {
        it("finds the nearest lockfile, walking up to the repo root", async () => {
            write("package-lock.json");

            const result = await Lockfiles.find(
                repoDir,
                path.join(repoDir, "apps", "web")
            );

            expect(result).toEqual({
                dir: repoDir,
                manager: "npm",
                name: "package-lock.json",
            });
        });

        it("prefers a lockfile next to the manifest", async () => {
            write("package-lock.json");
            write("apps/web/pnpm-lock.yaml");

            const result = await Lockfiles.find(
                repoDir,
                path.join(repoDir, "apps", "web")
            );

            expect(result).toEqual({
                dir: path.join(repoDir, "apps", "web"),
                manager: "pnpm",
                name: "pnpm-lock.yaml",
            });
        });

        it("doesn't look above the repo root", async () => {
            writeFileSync(
                path.join(path.dirname(repoDir), "package-lock.json"),
                "{}"
            );

            const result = await Lockfiles.find(repoDir, repoDir);

            expect(result).toBeNull();
        });

        it("refuses yarn lockfiles", async () => {
            write("yarn.lock");

            const result = Lockfiles.find(repoDir, repoDir);

            await expect(result).rejects.toThrow(
                new LockfileError(
                    "can't update yarn.lock; only npm, pnpm and bun lockfiles are supported"
                )
            );
        });
    });

    describe("update", () => {
        it("runs the lockfile-only install in the lockfile's directory", async () => {
            const nvm = { run: vi.fn(() => Promise.resolve()) };

            await new Lockfiles(nvm).update(
                { dir: repoDir, manager: "pnpm", name: "pnpm-lock.yaml" },
                path.dirname(repoDir)
            );

            expect(nvm.run).toHaveBeenCalledWith(
                "pnpm",
                ["install", "--lockfile-only", "--ignore-scripts"],
                { cwd: repoDir, rootDir: path.dirname(repoDir) }
            );
        });
    });
});

function write(file: string, text = "{}"): void {
    writeFileSync(path.join(repoDir, file), text);
}
