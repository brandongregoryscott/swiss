import type { CommitSummary, GitHubRepo } from "../../shared/git/github.js";
import { CommandError } from "../../shared/exec.js";
import { GitHub } from "../../shared/git/github.js";
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
        const changelogs = new Map<string, Promise<null | string>>();
        return (pkg, from, to) => {
            const key = `${pkg}@${from}...${to}`;
            let changelog = changelogs.get(key);
            if (changelog == null) {
                changelog = source(pkg, from, to);
                changelogs.set(key, changelog);
            }
            return changelog;
        };
    }

    static format(
        repo: GitHubRepo,
        commits: CommitSummary[],
        compareUrl: string
    ): string {
        if (commits.length === 0) {
            return `_No commits between these versions._ ([compare](${compareUrl}))`;
        }
        const repoUrl = `https://${repo.host}/${repo.owner}/${repo.name}`;
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
    if (repo == null || base.gitHead == null || head.gitHead == null) {
        return null;
    }

    const comparison = await GitHub.compareCommits(
        repo,
        base.gitHead,
        head.gitHead
    );
    let { commits } = comparison;
    if (head.directory != null) {
        const touching = await GitHub.commitsTouching(
            repo,
            head.gitHead,
            head.directory,
            comparison.baseDate
        );
        commits = commits.filter((commit) => touching.has(commit.sha));
    }
    const compareUrl = `https://${repo.host}/${repo.owner}/${repo.name}/compare/${base.gitHead}...${head.gitHead}`;
    return Changelog.format(repo, commits, compareUrl);
}

export type { ChangelogSource };
export { Changelog };
