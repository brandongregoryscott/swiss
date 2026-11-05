import { formatDistanceStrict } from "date-fns";
import { compact, sortBy } from "lodash-es";
import type { OwnedRepo } from "../../shared/git/github.js";
import { GitHub } from "../../shared/git/github.js";
import { Text } from "../../shared/text.js";

// What renames and archives repos given as OWNER/NAME: gh, or a fake in tests.
type RepoHost = {
    archive(nameWithOwner: string): Promise<void>;
    rename(nameWithOwner: string, newName: string): Promise<void>;
};

const GH: RepoHost = {
    archive: (nameWithOwner) => GitHub.archiveRepo(nameWithOwner),
    rename: (nameWithOwner, newName) =>
        GitHub.renameRepo(nameWithOwner, newName),
};

class RepoRename {
    static readonly ARCHIVED_PREFIX = "ARCHIVED_";

    // GitHub's limit on the length of a repo name.
    static readonly MAX_NAME_LENGTH = 100;

    static defaultName(name: string): string {
        return RepoRename.isRenamed(name)
            ? name
            : `${RepoRename.ARCHIVED_PREFIX}${name}`;
    }

    // Private, archived, fork and when it was last pushed to, like "private, pushed 2 years ago".
    static hint(repo: OwnedRepo, now = new Date()): string {
        return compact([
            repo.isPrivate && "private",
            repo.isArchived && "archived",
            repo.isFork && "fork",
            `pushed ${formatDistanceStrict(new Date(repo.pushedAt), now, { addSuffix: true })}`,
        ]).join(", ");
    }

    // Whether a repo name already has the archived prefix.
    static isRenamed(name: string): boolean {
        return name.startsWith(RepoRename.ARCHIVED_PREFIX);
    }

    // Whether a repo is named as archived but isn't archived on GitHub yet.
    static needsArchiving(repo: OwnedRepo): boolean {
        return RepoRename.isRenamed(repo.name) && !repo.isArchived;
    }

    // The least recently pushed first, since those are usually the ones to archive.
    static sort(repos: OwnedRepo[]): OwnedRepo[] {
        return sortBy(repos, (repo) => repo.pushedAt);
    }

    // Why a new name can't be used, or undefined when it can. GitHub only allows letters,
    // digits, hyphens, underscores and periods.
    static validate(
        newName: string,
        current: string,
        taken: Set<string>
    ): string | undefined {
        if (newName === "") {
            return "Enter a name";
        }
        if (newName === current) {
            return "That's the current name";
        }
        if (newName.length > RepoRename.MAX_NAME_LENGTH) {
            return `Names can be at most ${RepoRename.MAX_NAME_LENGTH} characters`;
        }
        if (!/^[\w.-]+$/.test(newName)) {
            return "Use only letters, digits, hyphens, underscores and periods";
        }
        if (newName === "." || newName === "..") {
            return "That name is reserved";
        }
        // GitHub repo names are case-insensitive, so ARCHIVED_Foo and archived_foo clash.
        if (taken.has(newName.toLowerCase())) {
            return "Another repo already has that name";
        }
        return undefined;
    }
}

// One run of \`repo rename\`: an owner's repos, kept up to date as they're renamed and archived, so
// the list to pick from and the names that are taken stay right.
class RepoRenameSession {
    readonly #host: RepoHost;
    readonly owner: string;
    readonly repos: OwnedRepo[];
    #archived = 0;
    #renamed = 0;

    // repos all belong to one owner, and there's at least one.
    constructor(repos: OwnedRepo[], host: RepoHost = GH) {
        this.repos = RepoRename.sort(repos);
        this.owner = repos[0]!.nameWithOwner.split("/")[0]!;
        this.#host = host;
    }

    // Archives a repo, making it read-only. Throws a CommandError when gh can't.
    async archive(repo: OwnedRepo): Promise<void> {
        await this.#host.archive(repo.nameWithOwner);
        repo.isArchived = true;
        this.#archived++;
    }

    // The repos to pick from: the ones not named as archived yet, or all of them.
    listed(all: boolean): OwnedRepo[] {
        return all
            ? this.repos
            : this.repos.filter((repo) => !RepoRename.isRenamed(repo.name));
    }

    // Renames a repo, which then needs archiving when its new name has the archived prefix.
    // Throws a CommandError when gh can't.
    async rename(repo: OwnedRepo, newName: string): Promise<void> {
        await this.#host.rename(repo.nameWithOwner, newName);
        repo.name = newName;
        repo.nameWithOwner = `${this.owner}/${newName}`;
        this.#renamed++;
    }

    // What was done, like "Renamed 2 repos and archived 1 repo".
    summary(): string {
        return compact([
            `Renamed ${Text.pluralize(this.#renamed, "repo")}`,
            this.#archived > 0 &&
                `archived ${Text.pluralize(this.#archived, "repo")}`,
        ]).join(" and ");
    }

    // The repos named as archived but not archived on GitHub, like ones renamed before renaming
    // archived them.
    unarchived(): OwnedRepo[] {
        return this.repos.filter((repo) => RepoRename.needsArchiving(repo));
    }

    // Why repo can't be renamed to newName, or undefined when it can.
    validate(repo: OwnedRepo, newName: string): string | undefined {
        const taken = new Set(
            this.repos
                .filter((other) => other !== repo)
                .map((other) => other.name.toLowerCase())
        );
        return RepoRename.validate(newName, repo.name, taken);
    }
}

export type { RepoHost };
export { RepoRename, RepoRenameSession };
