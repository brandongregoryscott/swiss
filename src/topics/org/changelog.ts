import { uniq } from "lodash-es";
import type { CommitSummary, GitHubRepo } from "../../shared/git/github.js";
import { CommandError } from "../../shared/exec.js";
import { GitHub } from "../../shared/git/github.js";
import { PromiseCache } from "../../shared/promise-cache.js";
import { NpmRegistry } from "./npm-registry.js";

type ChangelogSource = (
    pkg: string,
    from: string,
    to: string
) => Promise<null | string>;

const MAX_LISTED_COMMITS = 50;

const PULL_REQUEST_SUFFIX = /\s*\(#(\d+)\)\s*$/;

class Changelog {
    static async between(
        pkg: string,
        from: string,
        to: string
    ): Promise<null | string> {
        try {
            return await build(pkg, from, to);
        } catch (error) {
            if (error instanceof CommandError) {
                return null;
            }
            throw error;
        }
    }

    static cached(
        source: ChangelogSource = Changelog.between
    ): ChangelogSource {
        const changelogs = new PromiseCache<null | string>();
        return (pkg, from, to) =>
            changelogs.get(`${pkg}@${from}...${to}`, () =>
                source(pkg, from, to)
            );
    }

    static format(
        repo: GitHubRepo,
        commits: CommitSummary[],
        compareUrl: string
    ): string {
        if (commits.length === 0) {
            return `_No commits between these versions._ ([compare](${compareUrl}))`;
        }
        const repoUrl = GitHub.webUrl(repo);
        const newestFirst = commits.toReversed();
        const lines = newestFirst.slice(0, MAX_LISTED_COMMITS).map((commit) => {
            const pullRequest = PULL_REQUEST_SUFFIX.exec(commit.subject)?.[1];
            if (pullRequest != null) {
                const subject = commit.subject.replace(PULL_REQUEST_SUFFIX, "");
                return `- ${subject} ([#${pullRequest}](${repoUrl}/pull/${pullRequest}))`;
            }
            return `- ${commit.subject} ([\`${commit.sha.slice(0, 7)}\`](${repoUrl}/commit/${commit.sha}))`;
        });
        const remaining = newestFirst.length - MAX_LISTED_COMMITS;
        if (remaining > 0) {
            lines.push(`- …and ${remaining} more`);
        }
        return `${lines.join("\n")}\n\n[Full comparison](${compareUrl})`;
    }
}

async function build(
    pkg: string,
    from: string,
    to: string
): Promise<null | string> {
    const [base, head] = await Promise.all([
        NpmRegistry.release(pkg, from),
        NpmRegistry.release(pkg, to),
    ]);
    const { repo } = head;
    if (repo == null) {
        return null;
    }
    const [baseSha, headSha] = await Promise.all([
        base.gitHead ?? taggedCommit(repo, pkg, from),
        head.gitHead ?? taggedCommit(repo, pkg, to),
    ]);
    if (baseSha == null || headSha == null) {
        return null;
    }

    const comparison = await GitHub.compareCommits({
        base: baseSha,
        head: headSha,
        repo,
    });
    let { commits } = comparison;
    if (head.directory != null && comparison.earliestDate != null) {
        const touching = await GitHub.commitsTouching({
            directory: head.directory,
            head: headSha,
            repo,
            since: comparison.earliestDate,
        });
        commits = commits.filter((commit) => touching.has(commit.sha));
    }
    const compareUrl = `${GitHub.webUrl(repo)}/compare/${baseSha}...${headSha}`;
    return Changelog.format(repo, commits, compareUrl);
}

async function taggedCommit(
    repo: GitHubRepo,
    pkg: string,
    version: string
): Promise<null | string> {
    const unscoped = pkg.replace(/^@[^/]+\//, "");
    const tags = uniq([
        `${pkg}@${version}`,
        `${unscoped}@${version}`,
        `v${version}`,
        version,
    ]);
    for (const tag of tags) {
        try {
            return await GitHub.tagCommit(repo, tag);
        } catch (error) {
            if (!(error instanceof CommandError)) {
                throw error;
            }
        }
    }
    return null;
}

export type { ChangelogSource };
export { Changelog };
