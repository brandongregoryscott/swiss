import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManifestBump } from "./manifests.js";
import { PullRequestBody } from "./pull-request-body.js";

const TARGET = { pkg: "@acme/cats", version: "1.4.0" };

const TEMPLATE = [
    "## Checklist",
    "",
    "- [ ] [Technical docs](https://example.com/docs) updated (or not needed)",
    "- [ ] Tested locally",
    "",
    "### Infratron :robot:",
    "",
    "- [ ] TBC: `/review` risk score",
    "",
].join("\n");

let repoDir: string;

beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), "swiss-pr-body-"));
});

afterEach(() => {
    rmSync(repoDir, { force: true, recursive: true });
});

describe("PullRequestBody", () => {
    describe("build", () => {
        it("summarizes a single root bump", () => {
            const result = PullRequestBody.build({
                bumps: [bump()],
                changelog: null,
                notes: [],
                target: TARGET,
                template: null,
            });

            expect(result).toBe(
                "Bumps `@acme/cats` from `^1.2.0` to `^1.4.0`.\n"
            );
        });

        it("names the manifest for a single nested bump", () => {
            const result = PullRequestBody.build({
                bumps: [bump({ path: "apps/web/package.json" })],
                changelog: null,
                notes: [],
                target: TARGET,
                template: null,
            });

            expect(result).toBe(
                "Bumps `@acme/cats` from `^1.2.0` to `^1.4.0` in `apps/web/package.json`.\n"
            );
        });

        it("lists each manifest when several are bumped", () => {
            const result = PullRequestBody.build({
                bumps: [
                    bump({ path: "apps/api/package.json" }),
                    bump({
                        current: "1.0.0",
                        next: "1.4.0",
                        path: "apps/web/package.json",
                    }),
                ],
                changelog: null,
                notes: [],
                target: TARGET,
                template: null,
            });

            expect(result).toBe(
                [
                    "Bumps `@acme/cats` to `1.4.0`:",
                    "",
                    "- `apps/api/package.json`: `^1.2.0` → `^1.4.0`",
                    "- `apps/web/package.json`: `1.0.0` → `1.4.0`",
                    "",
                ].join("\n")
            );
        });

        it("adds each note as a paragraph after the summary", () => {
            const result = PullRequestBody.build({
                bumps: [bump()],
                changelog: "- Add whiskers (#12)",
                notes: [
                    "No ticket required - general housekeeping\n",
                    " ",
                    "Bumping every consumer",
                ],
                target: TARGET,
                template: null,
            });

            expect(result).toBe(
                [
                    "Bumps `@acme/cats` from `^1.2.0` to `^1.4.0`.",
                    "",
                    "No ticket required - general housekeeping",
                    "",
                    "Bumping every consumer",
                    "",
                    "## Changelog",
                    "",
                    "- Add whiskers (#12)",
                    "",
                ].join("\n")
            );
        });

        it("keeps the template and ticks only the technical docs box", () => {
            const result = PullRequestBody.build({
                bumps: [bump()],
                changelog: "- Add whiskers (#12)",
                notes: [],
                target: TARGET,
                template: TEMPLATE,
            });

            expect(result).toBe(
                [
                    "Bumps `@acme/cats` from `^1.2.0` to `^1.4.0`.",
                    "",
                    "## Changelog",
                    "",
                    "- Add whiskers (#12)",
                    "",
                    "## Checklist",
                    "",
                    "- [x] [Technical docs](https://example.com/docs) updated (or not needed)",
                    "- [ ] Tested locally",
                    "",
                    "### Infratron :robot:",
                    "",
                    "- [ ] TBC: `/review` risk score",
                    "",
                ].join("\n")
            );
        });
    });

    describe("template", () => {
        it("finds the template in .github regardless of case", async () => {
            mkdirSync(path.join(repoDir, ".github"));
            writeFileSync(
                path.join(repoDir, ".github", "PULL_REQUEST_TEMPLATE.md"),
                TEMPLATE
            );

            const result = await PullRequestBody.template(repoDir);

            expect(result).toBe(TEMPLATE);
        });

        it("falls back to the repo root and then docs", async () => {
            mkdirSync(path.join(repoDir, "docs"));
            writeFileSync(
                path.join(repoDir, "docs", "pull_request_template.md"),
                "docs"
            );
            writeFileSync(
                path.join(repoDir, "pull_request_template.md"),
                "root"
            );

            const result = await PullRequestBody.template(repoDir);

            expect(result).toBe("root");
        });

        it("uses the only template in the templates folder", async () => {
            mkdirSync(path.join(repoDir, ".github", "PULL_REQUEST_TEMPLATE"), {
                recursive: true,
            });
            writeFileSync(
                path.join(
                    repoDir,
                    ".github",
                    "PULL_REQUEST_TEMPLATE",
                    "deps.md"
                ),
                "deps"
            );

            const result = await PullRequestBody.template(repoDir);

            expect(result).toBe("deps");
        });

        it("picks none when the templates folder has several", async () => {
            const templatesDir = path.join(
                repoDir,
                ".github",
                "pull_request_template"
            );
            mkdirSync(templatesDir, { recursive: true });
            writeFileSync(path.join(templatesDir, "feature.md"), "feature");
            writeFileSync(path.join(templatesDir, "fix.md"), "fix");

            const result = await PullRequestBody.template(repoDir);

            expect(result).toBeNull();
        });

        it("returns null when the repo has no template", async () => {
            const result = await PullRequestBody.template(repoDir);

            expect(result).toBeNull();
        });
    });
});

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
