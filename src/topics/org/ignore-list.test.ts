import { describe, expect, it } from "vitest";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { OrgRepo } from "../../shared/git/github.js";
import { IgnoreList } from "./ignore-list.js";

const config: OrgConfig = {
    cloneProtocol: "ssh",
    ignore: [],
    name: "acme",
    rootDir: "/repos",
    scmHost: "github.com",
    skipArchived: true,
    skipForks: true,
};

describe("IgnoreList", () => {
    describe("isPattern", () => {
        it("treats entries with glob characters as patterns", () => {
            expect(IgnoreList.isPattern("ARCHIVED_*")).toBe(true);
            expect(IgnoreList.isPattern("demo-?")).toBe(true);
            expect(IgnoreList.isPattern("{api,web}")).toBe(true);
            expect(IgnoreList.isPattern("tf_modules")).toBe(false);
        });
    });

    describe("matches", () => {
        it("matches case-insensitive globs against the whole name", () => {
            expect(IgnoreList.matches("ARCHIVED_b-cli", ["archived*"])).toBe(
                true
            );
            expect(IgnoreList.matches("Sandbox", ["sandbox"])).toBe(true);
            expect(IgnoreList.matches("team-sandbox", ["sandbox"])).toBe(false);
            expect(IgnoreList.matches("anything", [])).toBe(false);
        });
    });

    describe("choices", () => {
        it("offers syncable repos not hidden by a pattern, selecting those ignored by name", () => {
            const repos = [
                fakeRepo("alpha"),
                fakeRepo("ARCHIVED_old"),
                fakeRepo("Legacy"),
                fakeRepo("zeta"),
            ];

            const result = IgnoreList.choices(repos, {
                ...config,
                ignore: ["ARCHIVED_*", "legacy", "gone"],
            });

            expect(result.candidates.map((repo) => repo.name)).toEqual([
                "alpha",
                "Legacy",
                "zeta",
            ]);
            expect(result.hiddenByPattern.map((repo) => repo.name)).toEqual([
                "ARCHIVED_old",
            ]);
            expect(result.selected).toEqual(["Legacy"]);
        });
    });

    describe("update", () => {
        it("adds newly selected repos after the existing entries, sorted", () => {
            const result = IgnoreList.update(
                ["ARCHIVED_*"],
                ["alpha", "beta", "zeta"],
                ["zeta", "alpha"]
            );

            expect(result).toEqual(["ARCHIVED_*", "alpha", "zeta"]);
        });

        it("removes unselected repos and keeps patterns, unknown names and order", () => {
            const result = IgnoreList.update(
                ["legacy", "ARCHIVED_*", "gone", "beta"],
                ["alpha", "beta", "Legacy"],
                ["Legacy"]
            );

            expect(result).toEqual(["legacy", "ARCHIVED_*", "gone"]);
        });
    });
});

function fakeRepo(name: string, overrides: Partial<OrgRepo> = {}): OrgRepo {
    return {
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        name,
        sshUrl: `git@github.com:acme/${name}.git`,
        url: `https://github.com/acme/${name}`,
        ...overrides,
    };
}
