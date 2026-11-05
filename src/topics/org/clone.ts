import { lstat } from "node:fs/promises";
import path from "node:path";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { OrgRepo } from "../../shared/git/github.js";
import { nullIfMissing } from "../../shared/errors.js";
import { Git } from "../../shared/git/git.js";

// A repo's clone under the root directory, and whether it's one the org commands can work in.
type OrgCloneState =
    | {
          defaultBranch: string;
          repoDir: string;
          status: "ready";
      }
    | { reason: string; status: "skipped" }
    | { repoDir: string; status: "missing" };

class OrgClone {
    // The repo's clone, checked to be a clone of the repo with its default branch on origin, and
    // fetched, with deleted remote branches pruned, so origin/* is current.
    static async open(
        repo: OrgRepo,
        config: OrgConfig
    ): Promise<OrgCloneState> {
        const repoDir = path.join(config.rootDir, repo.name);
        const stats = await lstat(repoDir).catch(nullIfMissing);
        if (stats == null) {
            return { repoDir, status: "missing" };
        }
        if (!stats.isDirectory()) {
            return skipped(`${repoDir} exists and is not a directory`);
        }
        const notClone = await Git.checkClone(repoDir, config.name, repo.name);
        if (notClone != null) {
            return skipped(notClone);
        }
        if (repo.defaultBranch == null) {
            return skipped("remote has no default branch");
        }

        // --prune drops origin/* refs for deleted remote branches, which is how gone upstreams
        // show up.
        await Git.run(repoDir, "fetch", "--quiet", "--prune", "origin");
        if (
            !(await Git.refExists(
                repoDir,
                `refs/remotes/origin/${repo.defaultBranch}`
            ))
        ) {
            return skipped(
                `origin/${repo.defaultBranch} not found after fetch`
            );
        }
        return { defaultBranch: repo.defaultBranch, repoDir, status: "ready" };
    }
}

function skipped(reason: string): OrgCloneState {
    return { reason, status: "skipped" };
}

export type { OrgCloneState };
export { OrgClone };
