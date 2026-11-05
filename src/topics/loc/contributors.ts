import {
    countBy,
    groupBy,
    maxBy,
    orderBy,
    sortBy,
    sumBy,
    uniq,
} from "lodash-es";
import type { GitHubRepo } from "../../shared/git/github.js";
import type { LocOptions } from "./loc.js";
import { UserError } from "../../shared/errors.js";
import { GitHub } from "../../shared/git/github.js";
import { Loc } from "./loc.js";
import { Numstat } from "./numstat.js";

type AuthoredCommit = {
    added: number;
    // Lowercased, since email addresses aren't case-sensitive in practice.
    email: string;
    name: string;
    removed: number;
    sha: string;
};

type Contributor = {
    added: number;
    commits: number;
    emails: string[];
    // The GitHub login, when GitHub or a noreply email gave one.
    login: null | string;
    // The name used on the most commits.
    name: string;
    removed: number;
};

// The GitHub login each of shas' authors is linked to: gh, or a fake in tests.
type LoginLookup = (
    repo: GitHubRepo,
    shas: string[]
) => Promise<Map<string, string>>;

class ContributorsError extends UserError {}

const NOREPLY_EMAIL = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i;

class Contributors {
    // Non-merge commits reachable from HEAD, with names and emails mapped through .mailmap.
    static async commits(
        dir: string,
        options: LocOptions = {}
    ): Promise<AuthoredCommit[]> {
        const commits = await Numstat.log(
            dir,
            ["%aN", "%aE"],
            ["--no-merges"],
            Loc.pathspecs(options)
        );
        return commits.map((commit) => ({
            added: commit.added,
            email: (commit.fields[1] ?? "").toLowerCase(),
            name: commit.fields[0] ?? "",
            removed: commit.removed,
            sha: commit.sha,
        }));
    }

    // The GitHub login of each email, from its most recent commit. Commits that were never
    // pushed, and emails that aren't on any account, are left out.
    static async logins(
        repo: GitHubRepo,
        commits: AuthoredCommit[],
        lookup: LoginLookup = GitHub.commitAuthorLogins
    ): Promise<Map<string, string>> {
        const samples = sampleCommits(commits);
        const loginsBySha = await lookup(repo, [...samples.values()]);
        const loginsByEmail = new Map<string, string>();
        for (const [email, sha] of samples) {
            const login = loginsBySha.get(sha);
            if (login != null) {
                loginsByEmail.set(email, login);
            }
        }
        return loginsByEmail;
    }

    // The GitHub repo to look authors up in, given origin's and --github, or null when they
    // aren't looked up. Without --github or --no-github, they are when origin's host has
    // "github" in it. An SSH alias from ~/.ssh/config, like github-work, is taken to mean
    // github.com.
    static lookupRepo(
        origin: GitHubRepo | null,
        github: boolean | undefined
    ): GitHubRepo | null {
        if (github === false) {
            return null;
        }
        if (origin == null) {
            if (github === true) {
                throw new ContributorsError(
                    "--github needs an origin remote like git@github.com:owner/repo.git"
                );
            }
            return null;
        }
        if (github !== true && !origin.host.toLowerCase().includes("github")) {
            return null;
        }
        return origin.host.includes(".")
            ? origin
            : { ...origin, host: "github.com" };
    }

    // Groups commits by person. Emails linked to the same GitHub login are one person, using
    // loginsByEmail and GitHub noreply emails, and other emails are each their own.
    static merge(
        commits: AuthoredCommit[],
        loginsByEmail: Map<string, string> = new Map()
    ): Contributor[] {
        const loginOf = (email: string): null | string =>
            loginsByEmail.get(email) ?? NOREPLY_EMAIL.exec(email)?.[1] ?? null;
        const groups = groupBy(commits, (commit) => {
            const login = loginOf(commit.email);
            return login == null
                ? `email:${commit.email}`
                : `login:${login.toLowerCase()}`;
        });
        const contributors = Object.values(groups).map((group) => {
            const names = countBy(group, "name");
            const logins = countBy(
                group
                    .map((commit) => loginOf(commit.email))
                    .filter((login) => login != null)
            );
            return {
                added: sumBy(group, "added"),
                commits: group.length,
                emails: sortBy(uniq(group.map((commit) => commit.email))),
                login:
                    maxBy(Object.keys(logins), (login) => logins[login]) ??
                    null,
                name: maxBy(Object.keys(names), (name) => names[name])!,
                removed: sumBy(group, "removed"),
            };
        });
        return orderBy(
            contributors,
            ["commits", "added", "name"],
            ["desc", "desc", "asc"]
        );
    }
}

// One commit per email, the most recent, to look its author up on GitHub with.
function sampleCommits(commits: AuthoredCommit[]): Map<string, string> {
    const samples = new Map<string, string>();
    for (const commit of commits) {
        if (!samples.has(commit.email)) {
            samples.set(commit.email, commit.sha);
        }
    }
    return samples;
}

export type { AuthoredCommit, Contributor, LoginLookup };
export { Contributors };
