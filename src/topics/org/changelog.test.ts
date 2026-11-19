import { describe, expect, it, vi } from "vitest";
import { Changelog } from "./changelog.js";

const REPO = { host: "github.com", name: "cats", owner: "acme" };

const COMPARE_URL = "https://github.com/acme/cats/compare/aaa...bbb";

describe("Changelog", () => {
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
