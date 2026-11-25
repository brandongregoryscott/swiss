import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigSection } from "./config.js";
import { DeployConfigSection } from "./deploy-config.js";

describe("DeployConfigSection", () => {
    describe("parse", () => {
        it("puts each repo's checkout under dir, by name", () => {
            const result = DeployConfigSection.parse(
                deploySection({
                    dir: "/srv/deploy",
                    repos: { api: { copy: [".env"], path: "/code/api" } },
                })
            );

            expect(result).toEqual({
                dir: "/srv/deploy",
                repos: [
                    {
                        checkout: "/srv/deploy/api",
                        copy: [".env"],
                        name: "api",
                        path: "/code/api",
                    },
                ],
            });
        });

        it("defaults dir to ~/deploy and expands ~ in paths", () => {
            const result = DeployConfigSection.parse(
                deploySection({ repos: { api: { path: "~/code/api" } } })
            );

            expect(result.repos).toEqual([
                {
                    checkout: path.join(homedir(), "deploy", "api"),
                    copy: [],
                    name: "api",
                    path: path.join(homedir(), "code", "api"),
                },
            ]);
        });

        it("accepts the config init template", () => {
            const result = DeployConfigSection.parse(
                deploySection(DeployConfigSection.TEMPLATE)
            );

            expect(result.repos).toEqual([]);
        });

        it("requires each repo's path", () => {
            expect(() =>
                DeployConfigSection.parse(deploySection({ repos: { api: {} } }))
            ).toThrow(/deploy\.repos\.api\.path must be the absolute path/);
        });

        it("rejects copy files outside the repo", () => {
            expect(() =>
                DeployConfigSection.parse(
                    deploySection({
                        repos: {
                            api: { copy: ["../secrets"], path: "/code/api" },
                        },
                    })
                )
            ).toThrow(
                /deploy\.repos\.api\.copy must be a list of paths inside/
            );
        });

        it("rejects a repo name that can't be a directory name", () => {
            expect(() =>
                DeployConfigSection.parse(
                    deploySection({ repos: { "a/b": { path: "/code/api" } } })
                )
            ).toThrow(/deploy\.repos\.a\/b must be named/);
        });

        it("rejects unknown repo settings", () => {
            expect(() =>
                DeployConfigSection.parse(
                    deploySection({
                        repos: { api: { path: "/code/api", port: 3000 } },
                    })
                )
            ).toThrow(/deploy\.repos\.api has unknown keys: port/);
        });
    });

    describe("load", () => {
        let configDir: string;

        beforeEach(() => {
            configDir = mkdtempSync(path.join(tmpdir(), "swiss-config-"));
        });

        afterEach(() => {
            rmSync(configDir, { force: true, recursive: true });
        });

        it("asks for repos when there are none", async () => {
            writeFileSync(
                path.join(configDir, "config.json"),
                JSON.stringify({ deploy: DeployConfigSection.TEMPLATE })
            );

            await expect(DeployConfigSection.load(configDir)).rejects.toThrow(
                /Add the repos to deploy/
            );
        });
    });
});

function deploySection(values: Record<string, unknown>): ConfigSection {
    return new ConfigSection("config.json", "deploy", values);
}
