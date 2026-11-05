import { Flags } from "@oclif/core";
import { countBy, isEmpty, max } from "lodash-es";
import type { Style } from "../../shared/text.js";
import type { SyncStatus } from "../../topics/org/sync.js";
import { SwissCommand } from "../../shared/command.js";
import { Concurrency } from "../../shared/concurrency.js";
import { OrgConfigSection } from "../../shared/config/org-config.js";
import { Text } from "../../shared/text.js";
import { OrgRepos } from "../../topics/org/repos.js";
import { RepoSync } from "../../topics/org/sync.js";

const STATUS_ORDER: SyncStatus[] = [
    "cloned",
    "updated",
    "up-to-date",
    "skipped",
    "error",
];

const STATUS_STYLES: Record<SyncStatus, Style> = {
    cloned: "green",
    error: "red",
    skipped: "yellow",
    "up-to-date": "dim",
    updated: "green",
};

export default class OrgSync extends SwissCommand {
    static override description = `Clone any missing repos from a GitHub org and fast-forward the default branch of the ones already cloned.

Repos that aren't at <rootDir>/<repo> yet are cloned. For the rest, the local default branch is fast-forwarded to origin whatever branch you have checked out:

  - Not checked out (you're on another branch or a detached HEAD): only the branch ref moves, and your working tree is untouched.
  - Checked out, here or in another worktree: it fast-forwards in place, carrying along uncommitted changes to files upstream didn't touch.
  - Skipped with a reason: the default branch has diverged from or is ahead of origin, or the fast-forward would overwrite uncommitted changes or an untracked or ignored file.

It never runs git clean, reset or stash, never checks out a different branch, and never deletes local repos.

With --dry-run, nothing is cloned and no branch moves. Repos are still fetched, which only updates origin/* refs, so the commit counts and skip reasons match what a real run would do.

Repos are listed with the gh CLI, so run \`gh auth login\` for the host first.

${OrgConfigSection.HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --dry-run",
            description: "Show what would be cloned, updated or skipped",
        },
        "<%= config.bin %> <%= command.id %> --concurrency 16",
    ];

    static override flags = {
        concurrency: Flags.integer({
            char: "c",
            default: 8,
            description: "Number of repos to clone or update at once",
            min: 1,
        }),
        "dry-run": Flags.boolean({
            description:
                "Show what would be cloned or updated without changing anything (repos are still fetched)",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(OrgSync);
        const config = await OrgConfigSection.load(this.config.configDir);

        const list = await OrgRepos.list(config);
        if (list.truncated) {
            this.warn(OrgRepos.limitWarning(config));
        }

        const repos = list.selected;
        if (isEmpty(repos)) {
            this.log(`No repos to sync in ${config.name}`);
            return;
        }

        const nameWidth = max(repos.map((repo) => repo.name.length)) ?? 0;
        const options = { dryRun: flags["dry-run"] };
        const results = await Concurrency.inOrder(
            repos,
            flags.concurrency,
            (repo) => RepoSync.sync(repo, config, options),
            (result, repo) => {
                this.failed ||= result.status === "error";
                this.log(
                    `${repo.name.padEnd(nameWidth)}  ${this.style(STATUS_STYLES[result.status], RepoSync.formatResult(result, options))}`
                );
            }
        );

        const counts = countBy(results, (result) => result.status);
        const totals = STATUS_ORDER.filter((status) => status in counts)
            .map(
                (status) =>
                    `${counts[status]} ${RepoSync.formatStatus(status, options)}`
            )
            .join(", ");
        this.log(
            `\n${Text.pluralize(repos.length, "repo")} in ${config.rootDir}: ${totals}`
        );
    }
}
