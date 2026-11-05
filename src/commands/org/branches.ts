import { Flags } from "@oclif/core";
import { fromPairs, isEmpty } from "lodash-es";
import type { OrgRepo } from "../../shared/git/github.js";
import type { Consent } from "../../shared/terminal.js";
import type {
    BranchFlags,
    BranchPlan,
    RepoCleanup,
    StaleBranch,
} from "../../topics/org/branches.js";
import { SwissCommand } from "../../shared/command.js";
import { Concurrency } from "../../shared/concurrency.js";
import { OrgConfigSection } from "../../shared/config/org-config.js";
import { BranchCleanup } from "../../topics/org/branches.js";
import { OrgRepos } from "../../topics/org/repos.js";

export default class OrgBranches extends SwissCommand {
    static override cancelled = "Nothing deleted";

    static override description = `Delete local branches that have been merged into the default branch, removing the worktrees they're checked out in.

Every cloned repo in the org is fetched with --prune, which only updates origin/* refs. What it finds is listed, and nothing is deleted until you confirm.

  - Merged means the default branch on origin contains the branch, or contains its changes as different commits, so squash and rebase merges count. A branch that got more commits after being squash-merged doesn't.
  - A branch whose upstream was deleted but that doesn't look merged is listed as kept, and only deleted with --gone.
  - A branch checked out in a linked worktree is deleted along with the worktree, as long as the worktree is unlocked and has no uncommitted or untracked files. Ignored files in it, like node_modules, are deleted with it. Worktrees whose directory is already gone are pruned.
  - A merged branch checked out in the repo's main worktree is deleted after switching to the default branch, as long as there are no uncommitted or untracked files and the default branch isn't checked out in another worktree. Otherwise it's listed as kept, as is a branch that's only gone upstream.
  - Branches that were never committed to and were never pushed as their own branch (no upstream, or the default branch as upstream) are listed as kept, since they're usually ones you just created or scaffolded a worktree for. They're only deleted with --unstarted.

With --pick, every branch that can be deleted, including ones only gone upstream or never committed to, is listed by repo to pick from instead of confirming them all. Merged branches start picked, as do gone and unstarted ones when --gone or --unstarted is passed.

Only local branches are deleted; nothing is pushed. --yes is required when there's no terminal to confirm in.

Uses the same "${OrgConfigSection.NAME}" settings as \`org sync\`; see \`<%= config.bin %> org sync --help\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --dry-run",
            description:
                "List what would be deleted, without deleting anything",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --gone --yes",
            description:
                "Also delete unmerged branches whose upstream is gone, without asking",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --pick",
            description: "Pick which branches to delete from a list",
        },
    ];

    static override flags = {
        concurrency: Flags.integer({
            char: "c",
            default: 8,
            description: "Number of repos to fetch and check at once",
            min: 1,
        }),
        "dry-run": Flags.boolean({
            description:
                "List what would be deleted without deleting anything (repos are still fetched)",
        }),
        gone: Flags.boolean({
            description:
                "Also delete branches whose upstream was deleted, even if they don't look merged",
        }),
        pick: Flags.boolean({
            char: "p",
            description:
                "Pick the branches to delete from a list, including ones only deleted with --gone or --unstarted",
            exclusive: ["dry-run", "yes"],
        }),
        unstarted: Flags.boolean({
            description:
                "Also delete branches that were never committed to, along with their worktrees",
        }),
        yes: Flags.boolean({
            char: "y",
            description: "Delete without asking first",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(OrgBranches);
        const config = await OrgConfigSection.load(this.config.configDir);
        if (flags.pick) {
            this.terminal.requireInteractive(undefined, "--pick");
        }
        const consent = this.terminal.consent(
            flags.yes || flags["dry-run"],
            "delete",
            "or --dry-run to only list"
        );

        const list = await OrgRepos.list(config);
        if (list.truncated) {
            this.warn(OrgRepos.limitWarning(config));
        }
        const repos = list.selected;
        let cleanups: RepoCleanup[] = [];
        await Concurrency.inOrder(
            repos,
            flags.concurrency,
            (repo) =>
                BranchCleanup.plan(
                    repo,
                    config,
                    BranchCleanup.planOptions(flags)
                ),
            (plan, repo) => {
                this.failed ||= plan.status === "error";
                this.#logPlan(repo, plan, { listStale: !flags.pick });
                if (plan.status === "planned" && !isEmpty(plan.stale)) {
                    cleanups.push({
                        repo,
                        repoDir: plan.repoDir,
                        stale: plan.stale,
                    });
                }
            }
        );

        if (isEmpty(cleanups)) {
            this.log("\nNo branches to delete");
            return;
        }

        if (flags.pick) {
            this.log("");
            cleanups = await this.#pick(cleanups, flags);
            if (isEmpty(cleanups)) {
                this.log("Nothing deleted");
                return;
            }
        } else if (!(await this.#confirm(cleanups, flags, consent))) {
            return;
        }

        const nameWidth = Math.max(
            ...cleanups.map((cleanup) => cleanup.repo.name.length)
        );
        await Concurrency.inOrder(
            cleanups,
            flags.concurrency,
            (cleanup) => BranchCleanup.apply(cleanup.repoDir, cleanup.stale),
            (outcomes, cleanup) => {
                for (const outcome of outcomes) {
                    const prefix = `${cleanup.repo.name.padEnd(nameWidth)}  ${outcome.branch.name}`;
                    if (outcome.status === "error") {
                        this.failed = true;
                        this.log(
                            `${prefix}  ${this.style("red", `error: ${outcome.reason}`)}`
                        );
                    } else {
                        this.log(
                            `${prefix}  ${this.style("green", BranchCleanup.formatDeleted(outcome.branch))}`
                        );
                    }
                }
            }
        );
    }

    async #confirm(
        cleanups: RepoCleanup[],
        flags: { "dry-run": boolean },
        consent: Consent
    ): Promise<boolean> {
        const summary = BranchCleanup.summarize(cleanups);
        if (flags["dry-run"]) {
            this.log(`\nWould delete ${summary}`);
            return false;
        }

        await consent.confirm(`Delete ${summary}?`);
        return true;
    }

    // Repos with nothing stale, and ones that aren't cloned, print nothing.
    #logPlan(
        repo: OrgRepo,
        plan: BranchPlan,
        options: { listStale: boolean }
    ): void {
        switch (plan.status) {
            case "error": {
                this.log(
                    `${repo.name}  ${this.style("red", `error: ${plan.reason}`)}`
                );
                return;
            }

            case "missing": {
                return;
            }

            case "planned": {
                const stale = options.listStale ? plan.stale : [];
                if (isEmpty(stale) && isEmpty(plan.kept)) {
                    return;
                }
                const lines = [
                    ...stale.map((branch) => ({
                        name: branch.name,
                        text: BranchCleanup.formatBranch(branch),
                    })),
                    ...plan.kept.map((branch) => ({
                        name: branch.name,
                        text: this.style(
                            "yellow",
                            `kept: ${BranchCleanup.formatKept(branch)}`
                        ),
                    })),
                ];
                const nameWidth = Math.max(
                    ...lines.map((line) => line.name.length)
                );
                this.log(this.style("bold", repo.name));
                for (const line of lines) {
                    this.log(`  ${line.name.padEnd(nameWidth)}  ${line.text}`);
                }
                return;
            }

            case "skipped": {
                this.log(
                    `${repo.name}  ${this.style("yellow", `skipped: ${plan.reason}`)}`
                );
                return;
            }
        }
    }

    async #pick(
        cleanups: RepoCleanup[],
        flags: BranchFlags
    ): Promise<RepoCleanup[]> {
        const nameWidth = Math.max(
            ...cleanups.flatMap((cleanup) =>
                cleanup.stale.map((branch) => branch.name.length)
            )
        );
        const picked = await this.terminal.answer(
            this.terminal.prompts.groupMultiselect<StaleBranch>({
                initialValues: cleanups.flatMap((cleanup) =>
                    cleanup.stale.filter((branch) =>
                        BranchCleanup.startsPicked(branch, flags)
                    )
                ),
                message: "Branches to delete",
                options: fromPairs(
                    cleanups.map((cleanup) => [
                        cleanup.repo.name,
                        cleanup.stale.map((branch) => ({
                            label: `${branch.name.padEnd(nameWidth)}  ${BranchCleanup.formatBranch(branch)}`,
                            value: branch,
                        })),
                    ])
                ),
                required: false,
            })
        );
        return BranchCleanup.keepPicked(cleanups, picked);
    }
}
