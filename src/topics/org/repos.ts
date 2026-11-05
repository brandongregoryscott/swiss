import type { OrgConfig } from "../../shared/config/org-config.js";
import type { OrgRepo } from "../../shared/git/github.js";
import { UserError } from "../../shared/errors.js";
import { CommandError } from "../../shared/exec.js";
import { GitHub } from "../../shared/git/github.js";
import { IgnoreList } from "./ignore-list.js";

class OrgReposError extends UserError {}

// Where an org's repos come from: gh, or a fixed list in tests.
type RepoSource = (org: string, scmHost: string) => Promise<OrgRepo[]>;

// A source that remembers what it listed, for listing the same org again.
type CachedSource = {
    // Whether the org's repos are already listed, so listing them again is instant.
    has(org: string, scmHost: string): boolean;
    list: RepoSource;
};

type OrgRepoList = {
    // How many repos gh listed, before any were left out.
    listed: number;
    // The ones swiss works on: syncable and not ignored.
    selected: OrgRepo[];
    // Not left out by skipArchived or skipForks, sorted by name. What the ignore list is chosen
    // from.
    syncable: OrgRepo[];
    // gh lists at most GitHub.REPO_LIST_LIMIT repos, so there may be more.
    truncated: boolean;
};

class OrgRepos {
    // A source that asks source once for each org and host, like while editing the org's
    // settings. Failures aren't remembered, so they're tried again.
    static cached(source: RepoSource = GitHub.listOrgRepos): CachedSource {
        const lists = new Map<string, Promise<OrgRepo[]>>();
        const key = (org: string, scmHost: string): string =>
            `${scmHost}/${org}`.toLowerCase();
        return {
            has: (org, scmHost) => lists.has(key(org, scmHost)),
            list: (org, scmHost) => {
                const cacheKey = key(org, scmHost);
                let listing = lists.get(cacheKey);
                if (listing == null) {
                    listing = source(org, scmHost);
                    lists.set(cacheKey, listing);
                    listing.catch(() => lists.delete(cacheKey));
                }
                return listing;
            },
        };
    }

    // What to warn about when the list was cut short.
    static limitWarning(config: OrgConfig): string {
        return `${config.name} has at least ${GitHub.REPO_LIST_LIMIT} repos; only the first ${GitHub.REPO_LIST_LIMIT} were listed`;
    }

    // The org's repos, sorted into the ones swiss can sync and the ones it works on.
    static async list(
        config: OrgConfig,
        source: RepoSource = GitHub.listOrgRepos
    ): Promise<OrgRepoList> {
        const repos = await source(config.name, config.scmHost).catch(
            (error: unknown) => {
                if (error instanceof CommandError) {
                    throw new OrgReposError(
                        `Could not list repos in ${config.name}: ${error.message}`
                    );
                }
                throw error;
            }
        );
        const syncable = repos
            .filter((repo) => !(config.skipArchived && repo.isArchived))
            .filter((repo) => !(config.skipForks && repo.isFork))
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
            listed: repos.length,
            selected: syncable.filter(
                (repo) => !IgnoreList.matches(repo.name, config.ignore)
            ),
            syncable,
            truncated: repos.length >= GitHub.REPO_LIST_LIMIT,
        };
    }
}

export type { CachedSource, OrgRepoList, RepoSource };
export { OrgRepos, OrgReposError };
