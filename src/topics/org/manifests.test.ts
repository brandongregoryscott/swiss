import { describe, expect, it } from "vitest";
import type { ManifestBump } from "./manifests.js";
import { ManifestError, Manifests } from "./manifests.js";

const TARGET = { pkg: "@acme/cats", version: "1.4.0" };

describe("Manifests", () => {
    describe("check", () => {
        it("plans a bump that keeps the range prefix", () => {
            const testCases = [
                { current: "1.2.0", next: "1.4.0" },
                { current: "^1.2.0", next: "^1.4.0" },
                { current: "~1.2.0", next: "~1.4.0" },
            ];

            for (const { current, next } of testCases) {
                const result = Manifests.check(
                    "package.json",
                    manifest({ dependencies: { "@acme/cats": current } }),
                    TARGET
                );

                expect(result, current).toEqual([
                    {
                        current,
                        currentVersion: "1.2.0",
                        next,
                        path: "package.json",
                        section: "dependencies",
                        status: "bump",
                    },
                ]);
            }
        });

        it("checks every dependency section that lists the package", () => {
            const result = Manifests.check(
                "apps/web/package.json",
                manifest({
                    dependencies: { "@acme/cats": "^1.0.0" },
                    devDependencies: { "@acme/cats": "1.4.0" },
                    peerDependencies: { "@acme/cats": "^1.0.0" },
                }),
                TARGET
            );

            expect(result).toEqual([
                expect.objectContaining({
                    section: "dependencies",
                    status: "bump",
                }),
                {
                    current: "1.4.0",
                    path: "apps/web/package.json",
                    status: "up-to-date",
                },
            ]);
        });

        it("skips specs it can't bump safely", () => {
            const testCases = [
                {
                    reason: "workspace:* isn't a version, or a ^ or ~ range",
                    spec: "workspace:*",
                },
                {
                    reason: ">=1.0.0 isn't a version, or a ^ or ~ range",
                    spec: ">=1.0.0",
                },
                {
                    reason: "latest isn't a version, or a ^ or ~ range",
                    spec: "latest",
                },
                { reason: "^2.0.0 is newer than 1.4.0", spec: "^2.0.0" },
            ];

            for (const { reason, spec } of testCases) {
                const result = Manifests.check(
                    "package.json",
                    manifest({ dependencies: { "@acme/cats": spec } }),
                    TARGET
                );

                expect(result, spec).toEqual([
                    { path: "package.json", reason, status: "skipped" },
                ]);
            }
        });

        it("skips a manifest that isn't valid JSON", () => {
            const result = Manifests.check("package.json", "{", TARGET);

            expect(result).toEqual([
                {
                    path: "package.json",
                    reason: "isn't valid JSON",
                    status: "skipped",
                },
            ]);
        });

        it("ignores a manifest that only mentions the package by name", () => {
            const result = Manifests.check(
                "package.json",
                manifest({ name: "@acme/cats" }),
                TARGET
            );

            expect(result).toEqual([]);
        });
    });

    describe("oldestVersion", () => {
        it("picks the lowest current version by semver", () => {
            const result = Manifests.oldestVersion([
                bump({ currentVersion: "0.10.0" }),
                bump({ currentVersion: "0.9.1" }),
            ]);

            expect(result).toBe("0.9.1");
        });
    });

    describe("rewrite", () => {
        it("changes only the bumped spec and keeps the formatting", () => {
            const text = [
                "{",
                '  "name": "web",',
                '  "dependencies": {',
                '    "@acme/cats":   "^1.2.0",',
                '    "@acme/dogs": "^1.2.0"',
                "  },",
                '  "devDependencies": {',
                '    "@acme/cats": "^1.2.0"',
                "  }",
                "}",
                "",
            ].join("\n");

            const result = Manifests.rewrite(text, "@acme/cats", [
                bump({ current: "^1.2.0", next: "^1.4.0" }),
            ]);

            expect(result).toBe(
                text.replace(
                    '"@acme/cats":   "^1.2.0"',
                    '"@acme/cats":   "^1.4.0"'
                )
            );
        });

        it("rewrites every bumped section", () => {
            const text = manifest({
                dependencies: { "@acme/cats": "1.2.0" },
                devDependencies: { "@acme/cats": "~1.3.0" },
            });

            const result = JSON.parse(
                Manifests.rewrite(text, "@acme/cats", [
                    bump({ current: "1.2.0", next: "1.4.0" }),
                    bump({
                        current: "~1.3.0",
                        next: "~1.4.0",
                        section: "devDependencies",
                    }),
                ])
            ) as unknown;

            expect(result).toEqual({
                dependencies: { "@acme/cats": "1.4.0" },
                devDependencies: { "@acme/cats": "~1.4.0" },
            });
        });

        it("refuses when the spec isn't where the bump expects it", () => {
            const text = manifest({ dependencies: { "@acme/cats": "1.3.0" } });

            expect(() =>
                Manifests.rewrite(text, "@acme/cats", [bump()])
            ).toThrow(ManifestError);
        });
    });
});

function manifest(fields: Record<string, unknown>): string {
    return `${JSON.stringify(fields, null, 2)}\n`;
}

function bump(overrides: Partial<ManifestBump> = {}): ManifestBump {
    return {
        current: "^1.2.0",
        currentVersion: "1.2.0",
        next: "^1.4.0",
        path: "package.json",
        section: "dependencies",
        status: "bump",
        ...overrides,
    };
}
