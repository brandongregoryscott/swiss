import { describe, expect, it } from "vitest";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { OrgRepo } from "../../shared/git/github.js";
import { CommandError } from "../../shared/exec.js";
import { GitHub } from "../../shared/git/github.js";
import { OrgRepos, OrgReposError } from "./repos.js";

const config: OrgConfig = {
    cloneProtocol: "ssh",
    ignore: [],
    name: "acme",
    rootDir: "/repos",
    scmHost: "github.com",
    skipArchived: true,
    skipForks: true,
};

describe("OrgRepos", () => {
    describe("list", () => {
        it("drops archived repos, forks and ignored names, sorted by name", async () => {
            const list = await OrgRepos.list(
                { ...config, ignore: ["sandbox*"] },
                source([
                    fakeRepo("zeta"),
                    fakeRepo("old", { isArchived: true }),
                    fakeRepo("upstream-copy", { isFork: true }),
                    fakeRepo("Sandbox-Playground"),
                    fakeRepo("alpha"),
                ])
            );

            expect(names(list.selected)).toEqual(["alpha", "zeta"]);
            // Ignored repos are still syncable, so they can be offered for un-ignoring.
            expect(names(list.syncable)).toEqual([
                "alpha",
                "Sandbox-Playground",
                "zeta",
            ]);
            expect(list.truncated).toBe(false);
        });

        it("matches ignore entries as case-insensitive globs against the whole name", async () => {
            const list = await OrgRepos.list(
                { ...config, ignore: ["sandbox", "demo-?", "{api,web}"] },
                source([
                    fakeRepo("sandbox"),
                    fakeRepo("team-sandbox"),
                    fakeRepo("Demo-1"),
                    fakeRepo("demo-12"),
                    fakeRepo("api"),
                    fakeRepo("web"),
                    fakeRepo("rapid"),
                ])
            );

            expect(names(list.selected)).toEqual([
                "demo-12",
                "rapid",
                "team-sandbox",
            ]);
        });

        it("keeps archived repos and forks when the skip options are off", async () => {
            const list = await OrgRepos.list(
                { ...config, skipArchived: false, skipForks: false },
                source([
                    fakeRepo("old", { isArchived: true }),
                    fakeRepo("upstream-copy", { isFork: true }),
                ])
            );

            expect(names(list.selected)).toEqual(["old", "upstream-copy"]);
        });

        it("says when gh's limit may have cut the list short", async () => {
            const repos = Array.from(
                { length: GitHub.REPO_LIST_LIMIT },
                (_, index) => fakeRepo(`repo-${index}`)
            );

            const list = await OrgRepos.list(config, source(repos));

            expect(list.truncated).toBe(true);
            expect(OrgRepos.limitWarning(config)).toBe(
                "acme has at least 1000 repos; only the first 1000 were listed"
            );
        });

        it("explains a failed listing, but lets bugs through", async () => {
            await expect(
                OrgRepos.list(config, () =>
                    Promise.reject(new CommandError("gh is not installed"))
                )
            ).rejects.toThrow(
                new OrgReposError(
                    "Could not list repos in acme: gh is not installed"
                )
            );
            await expect(
                OrgRepos.list(config, () =>
                    Promise.reject(new TypeError("x is undefined"))
                )
            ).rejects.toThrow(TypeError);
        });
    });
});

describe("OrgRepos.cached", () => {
    it("asks once for each org and host, but again after a failure", async () => {
        let calls = 0;
        const cached = OrgRepos.cached((org) => {
            calls++;
            return org === "broken"
                ? Promise.reject(new CommandError("gh failed"))
                : Promise.resolve([fakeRepo(`${org}-repo`)]);
        });

        expect(cached.has("acme", "github.com")).toBe(false);
        expect(names(await cached.list("acme", "github.com"))).toEqual([
            "acme-repo",
        ]);
        await cached.list("ACME", "github.com");
        expect(cached.has("acme", "github.com")).toBe(true);
        expect(calls).toBe(1);

        await cached.list("acme", "ghe.example.com");
        await cached.list("other", "github.com");
        expect(calls).toBe(3);

        await expect(cached.list("broken", "github.com")).rejects.toThrow();
        await expect(cached.list("broken", "github.com")).rejects.toThrow();
        expect(calls).toBe(5);
        expect(cached.has("broken", "github.com")).toBe(false);
    });
});

function source(repos: OrgRepo[]): () => Promise<OrgRepo[]> {
    return () => Promise.resolve(repos);
}

function names(repos: OrgRepo[]): string[] {
    return repos.map((repo) => repo.name);
}

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
