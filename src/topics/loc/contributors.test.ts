import { execFileSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { AuthoredCommit } from "./contributors.js";
import { Contributors } from "./contributors.js";

let root: string;

beforeAll(() => {
    const gitConfigDir = mkdtempSync(path.join(tmpdir(), "swiss-gitconfig-"));
    const gitConfig = path.join(gitConfigDir, "gitconfig");
    writeFileSync(gitConfig, "");
    vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfig);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterAll(() => {
    vi.unstubAllEnvs();
});

beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-loc-")));
    git("init", "-q", "-b", "main");
});

afterEach(() => {
    rmSync(root, { force: true, recursive: true });
});

describe("Contributors", () => {
    it("reads authors through .mailmap", async () => {
        write("a.ts", "1\n");
        commit("2024-01-01T12:00:00", "ada", "ADA@old.example.com");
        write(
            ".mailmap",
            "Ada Lovelace <ada@example.com>\nAda Lovelace <ada@example.com> <ada@old.example.com>\n"
        );
        write("a.ts", "1\n2\n");
        commit("2024-01-02T12:00:00", "Ada", "ada@example.com");

        const commits = await Contributors.commits(root);

        expect(commits.map(({ email, name }) => `${name} <${email}>`)).toEqual([
            "Ada Lovelace <ada@example.com>",
            "Ada Lovelace <ada@example.com>",
        ]);
    });

    describe("merge", () => {
        const commits = [
            authored("1", "Ada", "ada@work.example.com", 10, 2),
            authored("2", "Ada L", "ada@home.example.com", 5, 0),
            authored("3", "Ada", "ada@work.example.com", 1, 1),
            authored("4", "Grace", "123+grace@users.noreply.github.com", 7, 0),
            authored("5", "Grace Hopper", "grace@example.com", 1, 0),
        ];

        it("merges emails linked to the same GitHub login", () => {
            const logins = new Map([
                ["ada@home.example.com", "ada"],
                ["ada@work.example.com", "Ada"],
                ["grace@example.com", "grace"],
            ]);

            expect(Contributors.merge(commits, logins)).toEqual([
                {
                    added: 16,
                    commits: 3,
                    emails: ["ada@home.example.com", "ada@work.example.com"],
                    login: "Ada",
                    name: "Ada",
                    removed: 3,
                },
                {
                    added: 8,
                    commits: 2,
                    emails: [
                        "123+grace@users.noreply.github.com",
                        "grace@example.com",
                    ],
                    login: "grace",
                    name: "Grace",
                    removed: 0,
                },
            ]);
        });

        it("only merges by email and noreply login without GitHub", () => {
            expect(
                Contributors.merge(commits).map(({ emails, login }) => [
                    login,
                    emails,
                ])
            ).toEqual([
                [null, ["ada@work.example.com"]],
                ["grace", ["123+grace@users.noreply.github.com"]],
                [null, ["ada@home.example.com"]],
                [null, ["grace@example.com"]],
            ]);
        });
    });

    describe("logins", () => {
        it("looks up each email's most recent commit, and leaves out the ones without an account", async () => {
            const asked: string[][] = [];
            const logins = await Contributors.logins(
                github,
                [
                    authored("new", "Ada", "ada@example.com", 0, 0),
                    authored("old", "Ada", "ada@example.com", 0, 0),
                    authored("g", "Grace", "grace@example.com", 0, 0),
                ],
                async (repo, shas) => {
                    expect(repo).toBe(github);
                    asked.push(shas);
                    return new Map([["new", "ada"]]);
                }
            );

            expect(asked).toEqual([["new", "g"]]);
            expect([...logins]).toEqual([["ada@example.com", "ada"]]);
        });
    });

    describe("lookupRepo", () => {
        it("looks authors up when origin's host has github in it, unless --no-github", () => {
            expect(Contributors.lookupRepo(github, undefined)).toEqual(github);
            expect(Contributors.lookupRepo(github, false)).toBeNull();
        });

        it("only looks up on other hosts with --github", () => {
            const gitlab = { ...github, host: "gitlab.com" };

            expect(Contributors.lookupRepo(gitlab, undefined)).toBeNull();
            expect(Contributors.lookupRepo(gitlab, true)).toEqual(gitlab);
        });

        it("takes an SSH alias like github-work to mean github.com", () => {
            expect(
                Contributors.lookupRepo(
                    { ...github, host: "github-work" },
                    undefined
                )
            ).toEqual(github);
        });

        it("needs an origin for --github, and otherwise skips looking up without one", () => {
            expect(Contributors.lookupRepo(null, undefined)).toBeNull();
            expect(() => Contributors.lookupRepo(null, true)).toThrow(
                "--github needs an origin remote"
            );
        });
    });
});

const github = { host: "github.com", name: "widget", owner: "acme" };

function authored(
    sha: string,
    name: string,
    email: string,
    added: number,
    removed: number
): AuthoredCommit {
    return { added, email, name, removed, sha };
}

function write(file: string, contents: string): void {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
}

function commit(date: string, name: string, email: string): void {
    git("add", "-A");
    execFileSync("git", ["commit", "-q", "-m", date], {
        cwd: root,
        env: {
            ...process.env,
            GIT_AUTHOR_DATE: date,
            GIT_AUTHOR_EMAIL: email,
            GIT_AUTHOR_NAME: name,
            GIT_COMMITTER_DATE: date,
            GIT_COMMITTER_EMAIL: email,
            GIT_COMMITTER_NAME: name,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
}

function git(...args: string[]): string {
    return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: {
            ...process.env,
            GIT_AUTHOR_DATE: "2024-03-01T12:00:00",
            GIT_AUTHOR_EMAIL: "ada@example.com",
            GIT_AUTHOR_NAME: "Ada",
            GIT_COMMITTER_DATE: "2024-03-01T12:00:00",
            GIT_COMMITTER_EMAIL: "ada@example.com",
            GIT_COMMITTER_NAME: "Ada",
        },
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}
