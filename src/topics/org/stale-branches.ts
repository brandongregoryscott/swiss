import { compact, isEmpty } from "lodash-es";
import { Git } from "../../shared/git/git.js";

// merged: reachable from the default branch. landed: its changes reached the default branch as
// different commits (squash or rebase merge). gone: its upstream was deleted but it isn't merged.
// unstarted: reachable from the default branch, but never committed to or pushed as its own branch.
type StaleReason = "gone" | "landed" | "merged" | "unstarted";

// A local branch, as git lists it.
type LocalBranch = {
    commit: string;
    name: string;
    // Like [gone] when the upstream was deleted.
    track: string;
    upstream: string;
};

// A stale branch, and why it's stale.
type FoundStale = {
    branch: LocalBranch;
    reason: StaleReason;
};

const THROWAWAY_IDENTITY = {
    GIT_AUTHOR_EMAIL: "swiss@localhost",
    GIT_AUTHOR_NAME: "swiss",
    GIT_COMMITTER_EMAIL: "swiss@localhost",
    GIT_COMMITTER_NAME: "swiss",
};

class StaleBranches {
    // Every local branch except the default one that's stale against origin/<defaultBranch>, and
    // why, in the order git lists them. Fetch with --prune first, so gone upstreams show up.
    static async find(
        repoDir: string,
        defaultBranch: string
    ): Promise<FoundStale[]> {
        const target = `refs/remotes/origin/${defaultBranch}`;
        const [branches, merged] = await Promise.all([
            listBranches(repoDir),
            Git.run(
                repoDir,
                "for-each-ref",
                "--format=%(refname:short)",
                `--merged=${target}`,
                "refs/heads"
            ),
        ]);
        const mergedNames = new Set(compact(merged.split("\n")));

        const found: FoundStale[] = [];
        for (const branch of branches) {
            if (branch.name === defaultBranch) {
                continue;
            }
            const reason = await classify(repoDir, branch, target, mergedNames);
            if (reason != null) {
                found.push({ branch, reason });
            }
        }
        return found;
    }
}

async function listBranches(repoDir: string): Promise<LocalBranch[]> {
    const output = await Git.run(
        repoDir,
        "for-each-ref",
        "--format=%(refname:short)%00%(upstream)%00%(upstream:track)%00%(objectname)",
        "refs/heads"
    );
    return compact(output.split("\n")).map((line) => {
        const [name = "", upstream = "", track = "", commit = ""] =
            line.split("\0");
        return { commit, name, track, upstream };
    });
}

async function classify(
    repoDir: string,
    branch: LocalBranch,
    target: string,
    mergedNames: Set<string>
): Promise<null | StaleReason> {
    if (mergedNames.has(branch.name)) {
        // A branch that was created but never committed to is also "merged", since it points at
        // a commit already on the default branch. Tracking the default branch doesn't count as
        // being pushed, since that's how branches created from origin/<default> are set up.
        if (
            (branch.upstream === "" || branch.upstream === target) &&
            (await neverCommittedTo(repoDir, branch.name))
        ) {
            return "unstarted";
        }
        return "merged";
    }
    if (await hasLanded(repoDir, `refs/heads/${branch.name}`, target)) {
        return "landed";
    }
    return branch.track === "[gone]" ? "gone" : null;
}

// True when every change on ref is already on target as different commits: a rebase merge (each
// commit matches one on target) or a squash merge (all of them together match one).
async function hasLanded(
    repoDir: string,
    ref: string,
    target: string
): Promise<boolean> {
    if (await allCherryPicked(repoDir, target, ref)) {
        return true;
    }
    const base = await Git.mergeBase(repoDir, target, ref);
    if (base == null) {
        // No history in common, so it can't have landed.
        return false;
    }
    const tree = await Git.run(repoDir, "rev-parse", `${ref}^{tree}`);
    // A throwaway commit holding the branch's whole diff, written as a loose object that nothing
    // references, so git gc cleans it up. It's given its own author and committer, since git
    // won't write a commit without them and nobody sees this one.
    const squashed = await Git.runWith(
        repoDir,
        { env: THROWAWAY_IDENTITY },
        "commit-tree",
        tree,
        "-p",
        base,
        "-m",
        "squash"
    );
    return allCherryPicked(repoDir, target, squashed);
}

async function allCherryPicked(
    repoDir: string,
    target: string,
    ref: string
): Promise<boolean> {
    const lines = compact(
        (await Git.run(repoDir, "cherry", target, ref)).split("\n")
    );
    return !isEmpty(lines) && lines.every((line) => line.startsWith("-"));
}

// The branch's reflog has nothing but the entry from when it was created, apart from renames,
// which don't change what it points at. A branch with no reflog at all, like one created with
// logging off, can't be told apart, so it counts too: that keeps it unless --unstarted is passed.
async function neverCommittedTo(
    repoDir: string,
    name: string
): Promise<boolean> {
    const subjects = compact(
        (
            await Git.run(
                repoDir,
                "reflog",
                "show",
                "--format=%gs",
                `refs/heads/${name}`
            )
        ).split("\n")
    );
    return (
        subjects.filter((subject) => !subject.startsWith("Branch: renamed"))
            .length <= 1
    );
}

export type { FoundStale, LocalBranch, StaleReason };
export { StaleBranches };
