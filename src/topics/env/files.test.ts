import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvFiles } from "./files.js";

describe("EnvFiles", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), "swiss-env-"));
    });

    afterEach(async () => {
        await rm(root, { force: true, recursive: true });
    });

    describe("templateTargets", () => {
        it.each([
            [".env.example", [".env", ".env.local"]],
            [".env.sample", [".env", ".env.local"]],
            [".env.template", [".env", ".env.local"]],
            [".env.production.example", [".env.production"]],
            [".env.local.example", [".env.local"]],
        ])("maps %s to the files it describes", (name, targets) => {
            expect(EnvFiles.templateTargets(name)).toEqual(targets);
        });

        it.each([".env", ".env.local", ".env.production", "app.example"])(
            "isn't a template: %s",
            (name) => {
                expect(EnvFiles.templateTargets(name)).toBeNull();
            }
        );
    });

    describe("check", () => {
        it("finds what's missing across the files and what the template lacks", () => {
            const template = new Map([
                ["API_URL", ""],
                ["PORT", "3000"],
                ["SECRET", ""],
            ]);

            expect(
                EnvFiles.check(template, [
                    new Map([
                        ["PORT", "4000"],
                        ["OLD", "x"],
                    ]),
                    new Map([["SECRET", ""]]),
                ])
            ).toEqual({ extra: ["OLD"], missing: ["API_URL"] });
        });
    });

    describe("find", () => {
        it("finds env files across a monorepo, root first", async () => {
            for (const file of [
                ".env",
                "apps/web/.env.local",
                "apps/web/.env",
                "apps/api/.env",
                "apps/api/.envrc",
                "apps/api/node_modules/pkg/.env",
                "packages/db/dist/.env",
                "README.md",
            ]) {
                await mkdir(path.dirname(path.join(root, file)), {
                    recursive: true,
                });
                await writeFile(path.join(root, file), "");
            }

            const found = await EnvFiles.find(root);

            expect(found.map((file) => file.display)).toEqual([
                ".env",
                path.join("apps", "api", ".env"),
                path.join("apps", "web", ".env"),
                path.join("apps", "web", ".env.local"),
            ]);
        });
    });

    describe("planSet", () => {
        it("adds, updates and leaves alone values, writing only files that change", async () => {
            await write(".env", "A=1\nB=2\n");
            await write(".env.local", "A=new\n");
            const files = await EnvFiles.load(root, [
                path.join(root, ".env"),
                path.join(root, ".env.local"),
            ]);

            const plan = EnvFiles.planSet(
                files,
                new Map([
                    ["A", "new"],
                    ["C", "3"],
                ])
            );

            expect(
                plan.results.map(
                    ({ file, key, status }) =>
                        `${file.display} ${key} ${status}`
                )
            ).toEqual([
                ".env A updated",
                ".env C added",
                ".env.local A unchanged",
                ".env.local C added",
            ]);
            expect(plan.writes.map(({ file }) => file.display)).toEqual([
                ".env",
                ".env.local",
            ]);

            await EnvFiles.save(plan.writes);

            expect(await read(".env")).toBe("A=new\nB=2\nC=3\n");
        });
    });

    describe("planUnset", () => {
        it("finds which files set the keys, and leaves the rest out", async () => {
            await write(".env", "A=1\nB=2\n");
            await write(".env.local", "C=3\n");
            const files = await EnvFiles.load(root, [
                path.join(root, ".env"),
                path.join(root, ".env.local"),
            ]);

            const plan = EnvFiles.planUnset(files, ["A", "B", "Z"]);

            expect(
                plan.items.map(({ file, key }) => `${file.display} ${key}`)
            ).toEqual([".env A", ".env B"]);
            expect(plan.missing).toEqual(["Z"]);

            await plan.remove();

            expect(await read(".env")).toBe("");
            expect(await read(".env.local")).toBe("C=3\n");
        });
    });

    describe("checkTemplates", () => {
        it("compares each template with the files it describes that exist", async () => {
            await write(".env.example", "A=\nB=\n");
            await write(".env", "A=1\n");
            await write(".env.local", "EXTRA=1\n");
            await write("apps/api/.env.production.example", "C=\n");

            const reports = await EnvFiles.checkTemplates(
                root,
                await EnvFiles.find(root)
            );

            expect(
                reports.map((report) => ({
                    extra: report.extra,
                    files: report.files.map((file) => file.display),
                    missing: report.missing,
                    names: report.names,
                    template: report.template.display,
                }))
            ).toEqual([
                {
                    extra: ["EXTRA"],
                    files: [".env", ".env.local"],
                    missing: ["B"],
                    names: [".env", ".env.local"],
                    template: ".env.example",
                },
                {
                    extra: [],
                    files: [],
                    missing: ["C"],
                    names: [".env.production"],
                    template: path.join(
                        "apps",
                        "api",
                        ".env.production.example"
                    ),
                },
            ]);
        });
    });

    async function write(file: string, contents: string): Promise<void> {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), contents);
    }

    async function read(file: string): Promise<string> {
        return readFile(path.join(root, file), "utf8");
    }
});
