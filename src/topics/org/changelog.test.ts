import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../../shared/exec.js";
import { GitHub } from "../../shared/git/github.js";
import { Changelog } from "./changelog.js";
import { NpmRegistry } from "./npm-registry.js";

const REPO = { host: "github.com", name: "cats", owner: "acme" };

const COMPARE_URL = "https://github.com/acme/cats/compare/aaa...bbb";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Changelog", () => {
    describe("between", () => {
        it("keeps only commits touching the package's directory since the earliest compared commit", async () => {
            vi.spyOn(NpmRegistry, "release").mockImplementation(
                (_pkg, version) =>
                    Promise.resolve({
                        directory: "packages/cats",
                        gitHead: version === "1.0.0" ? "aaa" : "bbb",
                        repo: REPO,
                    })
            );
            vi.spyOn(GitHub, "compareCommits").mockResolvedValue({
                commits: [
                    { sha: "c1", subject: "feat: add whiskers" },
                    { sha: "c2", subject: "chore: touch dogs" },
                ],
                earliestDate: "2024-01-01T00:00:00Z",
            });
            const commitsTouching = vi
                .spyOn(GitHub, "commitsTouching")
                .mockResolvedValue(new Set(["c1"]));

            const result = await Changelog.between(
                "@acme/cats",
                "1.0.0",
                "1.4.0"
            );

            expect(commitsTouching).toHaveBeenCalledWith({
                directory: "packages/cats",
                head: "bbb",
                repo: REPO,
                since: "2024-01-01T00:00:00Z",
            });
            expect(result).toBe(
                [
                    "- feat: add whiskers ([`c1`](https://github.com/acme/cats/commit/c1))",
                    "",
                    `[Full comparison](${COMPARE_URL})`,
                ].join("\n")
            );
        });
        it("falls back to the release's git tag when npm has no git head", async () => {
            vi.spyOn(NpmRegistry, "release").mockImplementation(
                (_pkg, version) =>
                    Promise.resolve({
                        directory: null,
                        gitHead: version === "1.0.0" ? null : "bbb",
                        repo: REPO,
                    })
            );
            const tagCommit = vi
                .spyOn(GitHub, "tagCommit")
                .mockImplementation((_repo, tag) =>
                    tag === "cats@1.0.0"
                        ? Promise.resolve("aaa")
                        : Promise.reject(new CommandError("No commit found"))
                );
            const compareCommits = vi
                .spyOn(GitHub, "compareCommits")
                .mockResolvedValue({ commits: [], earliestDate: null });

            await Changelog.between("@acme/cats", "1.0.0", "1.4.0");

            expect(tagCommit.mock.calls.map(([, tag]) => tag)).toEqual([
                "@acme/cats@1.0.0",
                "cats@1.0.0",
            ]);
            expect(compareCommits).toHaveBeenCalledWith({
                base: "aaa",
                head: "bbb",
                repo: REPO,
            });
        });

        it("gives up when neither npm nor a git tag knows the release's commit", async () => {
            vi.spyOn(NpmRegistry, "release").mockResolvedValue({
                directory: null,
                gitHead: null,
                repo: REPO,
            });
            vi.spyOn(GitHub, "tagCommit").mockRejectedValue(
                new CommandError("No commit found")
            );
            const compareCommits = vi.spyOn(GitHub, "compareCommits");

            const result = await Changelog.between(
                "@acme/cats",
                "1.0.0",
                "1.4.0"
            );

            expect(result).toBeNull();
            expect(compareCommits).not.toHaveBeenCalled();
        });
    });

    describe("format", () => {
        it("lists commits newest first, linking pull requests or commits", () => {
            const result = Changelog.format(
                REPO,
                [
                    { sha: "1111111abcdef", subject: "fix: purr louder" },
                    {
                        sha: "2222222abcdef",
                        subject: "feat: add whiskers (#12)",
                    },
                ],
                COMPARE_URL
            );

            expect(result).toBe(
                [
                    "- feat: add whiskers ([#12](https://github.com/acme/cats/pull/12))",
                    "- fix: purr louder ([`1111111`](https://github.com/acme/cats/commit/1111111abcdef))",
                    "",
                    `[Full comparison](${COMPARE_URL})`,
                ].join("\n")
            );
        });

        it("caps the list and counts the rest", () => {
            const commits = Array.from({ length: 52 }, (_, i) => ({
                sha: `sha${i}`,
                subject: `commit ${i}`,
            }));

            const result = Changelog.format(REPO, commits, COMPARE_URL);

            const lines = result.split("\n");
            expect(lines[0]).toBe(
                "- commit 51 ([`sha51`](https://github.com/acme/cats/commit/sha51))"
            );
            expect(lines[50]).toBe("- …and 2 more");
        });

        it("says so when there are no commits", () => {
            const result = Changelog.format(REPO, [], COMPARE_URL);

            expect(result).toBe(
                `_No commits between these versions._ ([compare](${COMPARE_URL}))`
            );
        });
    });

    describe("cached", () => {
        it("looks up each range once", async () => {
            const source = vi.fn(() => Promise.resolve("changes"));
            const changelog = Changelog.cached(source);

            await changelog("@acme/cats", "1.0.0", "1.4.0");
            await changelog("@acme/cats", "1.0.0", "1.4.0");
            await changelog("@acme/cats", "1.2.0", "1.4.0");

            expect(source).toHaveBeenCalledTimes(2);
        });
    });
});
