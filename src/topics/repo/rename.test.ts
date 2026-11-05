import { describe, expect, it } from "vitest";
import type { OwnedRepo } from "../../shared/git/github.js";
import type { RepoHost } from "./rename.js";
import { CommandError } from "../../shared/exec.js";
import { RepoRename, RepoRenameSession } from "./rename.js";

function repo(overrides: Partial<OwnedRepo> = {}): OwnedRepo {
    return {
        description: "",
        isArchived: false,
        isFork: false,
        isPrivate: false,
        name: "api",
        nameWithOwner: "someone/api",
        pushedAt: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}

describe("RepoRename.defaultName", () => {
    it("adds the archived prefix", () => {
        expect(RepoRename.defaultName("api")).toBe("ARCHIVED_api");
    });

    it("doesn't add the prefix twice", () => {
        expect(RepoRename.defaultName("ARCHIVED_api")).toBe("ARCHIVED_api");
    });
});

describe("RepoRename.hint", () => {
    it("lists the visibility, state and when it was pushed", () => {
        expect(
            RepoRename.hint(
                repo({ isArchived: true, isFork: true, isPrivate: true }),
                new Date("2026-03-01T00:00:00Z")
            )
        ).toBe("private, archived, fork, pushed 2 months ago");
    });

    it("only says when a public repo was pushed", () => {
        expect(RepoRename.hint(repo(), new Date("2028-01-01T00:00:00Z"))).toBe(
            "pushed 2 years ago"
        );
    });
});

describe("RepoRename.isRenamed", () => {
    it("is true for names with the archived prefix", () => {
        expect(RepoRename.isRenamed("ARCHIVED_api")).toBe(true);
    });

    it("is false for other names", () => {
        expect(RepoRename.isRenamed("api")).toBe(false);
        expect(RepoRename.isRenamed("api_ARCHIVED_")).toBe(false);
    });
});

describe("RepoRename.needsArchiving", () => {
    it("is true for an unarchived repo with the archived prefix", () => {
        expect(RepoRename.needsArchiving(repo({ name: "ARCHIVED_api" }))).toBe(
            true
        );
    });

    it("is false once it's archived", () => {
        expect(
            RepoRename.needsArchiving(
                repo({ isArchived: true, name: "ARCHIVED_api" })
            )
        ).toBe(false);
    });

    it("is false without the prefix", () => {
        expect(RepoRename.needsArchiving(repo())).toBe(false);
    });
});

describe("RepoRename.sort", () => {
    it("puts the least recently pushed first", () => {
        const repos = [
            repo({ name: "new", pushedAt: "2026-06-01T00:00:00Z" }),
            repo({ name: "old", pushedAt: "2020-06-01T00:00:00Z" }),
        ];
        expect(RepoRename.sort(repos).map((r) => r.name)).toEqual([
            "old",
            "new",
        ]);
    });
});

describe("RepoRename.validate", () => {
    const taken = new Set(["api", "web"]);

    it("accepts a valid name", () => {
        expect(
            RepoRename.validate("ARCHIVED_api-v1.2", "api", taken)
        ).toBeUndefined();
    });

    it.each([
        ["", "Enter a name"],
        ["api", "That's the current name"],
        [
            "my repo",
            "Use only letters, digits, hyphens, underscores and periods",
        ],
        ["..", "That name is reserved"],
        ["WEB", "Another repo already has that name"],
        ["a".repeat(101), "Names can be at most 100 characters"],
    ])("rejects %j", (name, reason) => {
        expect(RepoRename.validate(name, "api", taken)).toBe(reason);
    });
});

describe("RepoRenameSession", () => {
    // A host that records what it's asked to do, failing for the names in failing.
    function host(failing: string[] = []): { calls: string[] } & RepoHost {
        const calls: string[] = [];
        const run = async (call: string, name: string): Promise<void> => {
            if (failing.includes(name)) {
                throw new CommandError(`gh couldn't ${call} ${name}`);
            }
            calls.push(call);
        };
        return {
            archive: (nameWithOwner) =>
                run(`archive ${nameWithOwner}`, nameWithOwner),
            calls,
            rename: (nameWithOwner, newName) =>
                run(`rename ${nameWithOwner} ${newName}`, nameWithOwner),
        };
    }

    it("keeps a renamed repo's names up to date, and leaves it off the list once it's named as archived", async () => {
        const api = repo();
        const web = repo({ name: "web", nameWithOwner: "someone/web" });
        const gh = host();
        const session = new RepoRenameSession([api, web], gh);

        await session.rename(api, "ARCHIVED_api");
        await session.archive(api);

        expect(gh.calls).toEqual([
            "rename someone/api ARCHIVED_api",
            "archive someone/ARCHIVED_api",
        ]);
        expect(api).toMatchObject({
            isArchived: true,
            name: "ARCHIVED_api",
            nameWithOwner: "someone/ARCHIVED_api",
        });
        expect(session.listed(false)).toEqual([web]);
        expect(session.listed(true)).toHaveLength(2);
        expect(session.summary()).toBe("Renamed 1 repo and archived 1 repo");
    });

    it("leaves a repo as it was when gh can't rename it", async () => {
        const api = repo();
        const session = new RepoRenameSession([api], host(["someone/api"]));

        await expect(session.rename(api, "ARCHIVED_api")).rejects.toThrow(
            "gh couldn't rename"
        );

        expect(api.name).toBe("api");
        expect(session.summary()).toBe("Renamed 0 repos");
    });

    it("checks new names against the other repos' current names, ignoring case", async () => {
        const api = repo();
        const web = repo({ name: "web", nameWithOwner: "someone/web" });
        const session = new RepoRenameSession([api, web], host());

        expect(session.validate(api, "WEB")).toBe(
            "Another repo already has that name"
        );
        // Changing only the case of its own name is fine.
        expect(session.validate(api, "API")).toBeUndefined();

        await session.rename(web, "site");
        expect(session.validate(api, "web")).toBeUndefined();
        expect(session.validate(api, "Site")).toBe(
            "Another repo already has that name"
        );
    });

    it("finds repos named as archived that aren't archived yet", () => {
        const renamed = repo({
            name: "ARCHIVED_old",
            nameWithOwner: "someone/ARCHIVED_old",
        });
        const session = new RepoRenameSession([repo(), renamed], host());

        expect(session.unarchived()).toEqual([renamed]);
        expect(session.owner).toBe("someone");
    });
});
