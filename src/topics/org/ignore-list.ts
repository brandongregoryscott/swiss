import { differenceBy, partition, toLower } from "lodash-es";
import path from "node:path";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { OrgRepo } from "../../shared/git/github.js";

type IgnoreChoices = {
    // Repos to offer for ignoring: every syncable one, apart from those a pattern already ignores.
    candidates: OrgRepo[];
    // Repos left out of candidates because a pattern entry already ignores them.
    hiddenByPattern: OrgRepo[];
    selected: string[];
};

const GLOB_CHARACTERS = /[*?[\]{}]/;

class IgnoreList {
    // syncable is OrgRepos.list's syncable repos, in the order to offer them.
    static choices(syncable: OrgRepo[], config: OrgConfig): IgnoreChoices {
        const patterns = config.ignore.filter((entry) =>
            IgnoreList.isPattern(entry)
        );
        const names = new Set(
            config.ignore
                .filter((entry) => !IgnoreList.isPattern(entry))
                .map((entry) => entry.toLowerCase())
        );
        const [hiddenByPattern, candidates] = partition(syncable, (repo) =>
            IgnoreList.matches(repo.name, patterns)
        );

        return {
            candidates,
            hiddenByPattern,
            selected: candidates
                .filter((repo) => names.has(repo.name.toLowerCase()))
                .map((repo) => repo.name),
        };
    }

    static isPattern(entry: string): boolean {
        return GLOB_CHARACTERS.test(entry);
    }

    static matches(name: string, entries: string[]): boolean {
        const lowerName = name.toLowerCase();
        return entries.some((entry) =>
            path.matchesGlob(lowerName, entry.toLowerCase())
        );
    }

    // Makes the exact-name entries for the offered candidates match the selection. Patterns, and entries that
    // don't name a candidate, are kept as they are, and existing entries keep their order.
    static update(
        ignore: string[],
        candidates: string[],
        selected: string[]
    ): string[] {
        const offered = new Set(candidates.map((name) => name.toLowerCase()));
        const chosen = new Set(selected.map((name) => name.toLowerCase()));
        const kept = ignore.filter(
            (entry) =>
                IgnoreList.isPattern(entry) ||
                !offered.has(entry.toLowerCase()) ||
                chosen.has(entry.toLowerCase())
        );
        const added = differenceBy(selected, kept, toLower).sort((a, b) =>
            a.localeCompare(b)
        );
        return [...kept, ...added];
    }
}

export type { IgnoreChoices };
export { IgnoreList };
