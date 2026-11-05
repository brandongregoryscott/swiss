import { chunk, isArray } from "lodash-es";
import { CommandError, Exec } from "../exec.js";

type OrgRepo = {
    defaultBranch: null | string;
    isArchived: boolean;
    isFork: boolean;
    name: string;
    sshUrl: string;
    url: string;
};

type OwnedRepo = {
    description: string;
    isArchived: boolean;
    isFork: boolean;
    isPrivate: boolean;
    name: string;
    nameWithOwner: string;
    pushedAt: string;
};

// A repo on GitHub, or a GitHub Enterprise host.
type GitHubRepo = {
    host: string;
    name: string;
    owner: string;
};

type GhRepo = {
    defaultBranchRef: { name: string } | null;
    isArchived: boolean;
    isFork: boolean;
    name: string;
    sshUrl: string;
    url: string;
};

// Commits looked up per GraphQL request, well under GitHub's node limit.
const COMMIT_LOOKUP_BATCH = 100;

type GhCommitLookup = {
    data: {
        repository: null | Record<
            string,
            { author?: { user: { login: string } | null } | null } | null
        >;
    };
};

class GitHub {
    static readonly REPO_LIST_LIMIT = 1000;

    // Archives a repo given as OWNER/NAME, making it read-only.
    static async archiveRepo(nameWithOwner: string): Promise<void> {
        await Exec.run("gh", ["repo", "archive", nameWithOwner, "--yes"]);
    }

    // The GitHub login each commit's author is linked to, for the commits GitHub has and whose
    // author email belongs to an account. Commits that were never pushed are left out.
    static async commitAuthorLogins(
        repo: GitHubRepo,
        shas: string[]
    ): Promise<Map<string, string>> {
        const logins = new Map<string, string>();
        for (const batch of chunk(shas, COMMIT_LOOKUP_BATCH)) {
            const fields = batch
                .map(
                    (sha, index) =>
                        `c${index}: object(oid: "${sha}") { ... on Commit { author { user { login } } } }`
                )
                .join("\n");
            const output = await Exec.run(
                "gh",
                [
                    "api",
                    "graphql",
                    "-f",
                    `query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
                    "-f",
                    `owner=${repo.owner}`,
                    "-f",
                    `name=${repo.name}`,
                ],
                { env: { GH_HOST: repo.host } }
            );
            const response = JSON.parse(output) as GhCommitLookup;
            for (const [index, sha] of batch.entries()) {
                const login =
                    response.data.repository?.[`c${index}`]?.author?.user
                        ?.login;
                if (login != null) {
                    logins.set(sha, login);
                }
            }
        }
        return logins;
    }

    static async listOrgRepos(
        org: string,
        scmHost: string
    ): Promise<OrgRepo[]> {
        const output = await Exec.run(
            "gh",
            [
                "repo",
                "list",
                org,
                "--limit",
                String(GitHub.REPO_LIST_LIMIT),
                "--json",
                "name,sshUrl,url,isArchived,isFork,defaultBranchRef",
            ],
            { env: { GH_HOST: scmHost } }
        );
        return GitHub.parseOrgRepos(output);
    }

    // The repos an account or org owns, or the signed-in account's when no owner is given.
    static async listOwnedRepos(owner?: string): Promise<OwnedRepo[]> {
        const output = await Exec.run("gh", [
            "repo",
            "list",
            ...(owner == null ? [] : [owner]),
            "--limit",
            String(GitHub.REPO_LIST_LIMIT),
            "--json",
            "name,nameWithOwner,description,isArchived,isFork,isPrivate,pushedAt",
        ]);
        return JSON.parse(output) as OwnedRepo[];
    }

    // The repos in gh repo list's JSON, with the fields listOrgRepos asks for.
    static parseOrgRepos(output: string): OrgRepo[] {
        const parsed: unknown = JSON.parse(output);
        if (!isArray(parsed)) {
            throw new CommandError(
                "gh repo list didn't return a list of repos; is gh up to date?"
            );
        }
        return (parsed as GhRepo[]).map(({ defaultBranchRef, ...repo }) => ({
            ...repo,
            defaultBranch: defaultBranchRef?.name ?? null,
        }));
    }

    // Renames a repo given as OWNER/NAME. GitHub redirects the old name to the new one.
    static async renameRepo(
        nameWithOwner: string,
        newName: string
    ): Promise<void> {
        await Exec.run("gh", [
            "repo",
            "rename",
            newName,
            "--repo",
            nameWithOwner,
            "--yes",
        ]);
    }
}

export type { GitHubRepo, OrgRepo, OwnedRepo };
export { GitHub };
