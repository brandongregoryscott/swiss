import { afterEach, describe, expect, it, vi } from "vitest";
import { Exec } from "../../shared/exec.js";
import { NpmRegistry, NpmRegistryError } from "./npm-registry.js";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("NpmRegistry", () => {
    describe("resolveVersion", () => {
        it("returns the version a dist-tag points at", async () => {
            vi.spyOn(Exec, "run").mockResolvedValue('"1.4.0"\n');

            const result = await NpmRegistry.resolveVersion("@acme/cats");

            expect(result).toBe("1.4.0");
        });

        it("takes the highest version a range matches", async () => {
            vi.spyOn(Exec, "run").mockResolvedValue('["1.3.0", "1.3.2"]\n');

            const result = await NpmRegistry.resolveVersion(
                "@acme/cats",
                "1.3"
            );

            expect(result).toBe("1.3.2");
        });

        it("reports npm's error summary", async () => {
            vi.spyOn(Exec, "run").mockResolvedValue(
                JSON.stringify({
                    error: {
                        code: "E404",
                        summary: "No match found for version 9.0.0",
                    },
                })
            );

            const result = NpmRegistry.resolveVersion("@acme/cats", "9.0.0");

            await expect(result).rejects.toThrow(
                new NpmRegistryError(
                    "Couldn't look up @acme/cats@9.0.0: No match found for version 9.0.0"
                )
            );
        });

        it("refuses when nothing matches", async () => {
            vi.spyOn(Exec, "run").mockResolvedValue("");

            const result = NpmRegistry.resolveVersion("@acme/cats", "^9");

            await expect(result).rejects.toThrow(
                "No published version of @acme/cats matches ^9"
            );
        });
    });

    describe("release", () => {
        it("reads the git head and the monorepo directory", async () => {
            vi.spyOn(Exec, "run").mockResolvedValue(
                JSON.stringify({
                    gitHead: "abc123",
                    repository: {
                        directory: "packages/cats",
                        type: "git",
                        url: "git+https://github.com/acme/monorepo.git",
                    },
                })
            );

            const result = await NpmRegistry.release("@acme/cats", "1.4.0");

            expect(result).toEqual({
                directory: "packages/cats",
                gitHead: "abc123",
                repo: { host: "github.com", name: "monorepo", owner: "acme" },
            });
        });

        it("understands repository shorthands", async () => {
            const testCases = ["acme/cats", "github:acme/cats"];

            for (const repository of testCases) {
                vi.spyOn(Exec, "run").mockResolvedValue(
                    JSON.stringify({ repository })
                );

                const result = await NpmRegistry.release("@acme/cats", "1.4.0");

                expect(result, repository).toEqual({
                    directory: null,
                    gitHead: null,
                    repo: { host: "github.com", name: "cats", owner: "acme" },
                });
            }
        });
    });
});
