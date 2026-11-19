import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Exec } from "../../shared/exec.js";
import { LockfileError, Lockfiles } from "./lockfiles.js";

let repoDir: string;
let nvmDir: string;

beforeEach(() => {
    const workDir = mkdtempSync(path.join(tmpdir(), "swiss-lockfiles-"));
    repoDir = path.join(workDir, "repo");
    nvmDir = path.join(workDir, "nvm");
    mkdirSync(path.join(repoDir, "apps", "web"), { recursive: true });
    mkdirSync(nvmDir);
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

    describe("nodeVersion", () => {
        it("reads the nearest version file", async () => {
            const testCases = [
                { file: ".nvmrc", text: "v24.1.0\n", version: "v24.1.0" },
                { file: ".node-version", text: "22\n", version: "22" },
                {
                    file: ".tool-versions",
                    text: "python 3.12.0\nnodejs 24.22.1\n",
                    version: "24.22.1",
                },
            ];

            for (const { file, text, version } of testCases) {
                write(`apps/web/${file}`, text);

                const result = await Lockfiles.nodeVersion(
                    repoDir,
                    path.join(repoDir, "apps", "web")
                );

                expect(result, file).toEqual({
                    file: `apps/web/${file}`,
                    version,
                });
                rmSync(path.join(repoDir, "apps", "web", file));
            }
        });

        it("skips a .tool-versions without node", async () => {
            write("apps/web/.tool-versions", "python 3.12.0\n");
            write(".nvmrc", "24\n");

            const result = await Lockfiles.nodeVersion(
                repoDir,
                path.join(repoDir, "apps", "web")
            );

            expect(result).toEqual({ file: ".nvmrc", version: "24" });
        });
    });

    describe("update", () => {
        it("runs the package manager directly without a version file", async () => {
            const run = vi.spyOn(Exec, "run").mockResolvedValue("");

            await new Lockfiles(nvmDir).update(
                { dir: repoDir, manager: "pnpm", name: "pnpm-lock.yaml" },
                repoDir
            );

            expect(run.mock.calls).toEqual([
                [
                    "pnpm",
                    ["install", "--lockfile-only", "--ignore-scripts"],
                    { cwd: repoDir },
                ],
            ]);
        });

        it("installs and uses the repo's Node version through nvm once", async () => {
            write(".nvmrc", "24\n");
            writeFileSync(path.join(nvmDir, "nvm.sh"), "");
            const run = vi.spyOn(Exec, "run").mockResolvedValue("");
            const lockfiles = new Lockfiles(nvmDir);
            const lockfile = {
                dir: repoDir,
                manager: "npm" as const,
                name: "package-lock.json",
            };

            await lockfiles.update(lockfile, repoDir);
            await lockfiles.update(lockfile, repoDir);

            const installs = run.mock.calls.filter(
                ([, args]) => args[1]?.includes("nvm install") === true
            );
            const execs = run.mock.calls.filter(
                ([, args]) => args[1]?.includes("nvm use") === true
            );
            expect(installs).toHaveLength(1);
            expect(installs[0]?.[1].slice(2)).toEqual(["bash", "24"]);
            expect(execs).toHaveLength(2);
            expect(execs[0]?.[1].slice(2)).toEqual([
                "bash",
                "24",
                "npm",
                "install",
                "--package-lock-only",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ]);
            expect(execs[0]?.[2]).toEqual({
                cwd: repoDir,
                env: { NVM_DIR: nvmDir },
            });
        });

        it("refuses when the repo pins Node but nvm is missing", async () => {
            write(".nvmrc", "24\n");
            const run = vi.spyOn(Exec, "run").mockResolvedValue("");

            const result = new Lockfiles(nvmDir).update(
                { dir: repoDir, manager: "npm", name: "package-lock.json" },
                repoDir
            );

            await expect(result).rejects.toThrow(
                `.nvmrc asks for Node 24, but nvm isn't installed at ${nvmDir}`
            );
            expect(run).not.toHaveBeenCalled();
        });
    });
});

function write(file: string, text = "{}"): void {
    writeFileSync(path.join(repoDir, file), text);
}
