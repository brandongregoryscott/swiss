import { Args, Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { OrgRepo } from "../../shared/git/github.js";
import type { BumpPlan, ScannedPlan } from "../../topics/org/bump.js";
import type { Target } from "../../topics/org/manifests.js";
import { SwissCommand } from "../../shared/command.js";
import { Concurrency } from "../../shared/concurrency.js";
import { OrgConfigSection } from "../../shared/config/org-config.js";
import { Text } from "../../shared/text.js";
import { PackageBump } from "../../topics/org/bump.js";
import { Changelog } from "../../topics/org/changelog.js";
import { IgnoreList } from "../../topics/org/ignore-list.js";
import { Lockfiles } from "../../topics/org/lockfiles.js";
import { NpmRegistry } from "../../topics/org/npm-registry.js";
import { OrgRepos } from "../../topics/org/repos.js";

type PlannedRepo = {
    plan: ScannedPlan;
    repo: OrgRepo;
};

export default class OrgBump extends SwissCommand {
    static override args = {
        package: Args.string({
            description: "The npm package to bump, like @acme/ui",
            required: true,
        }),
    };

    static override cancelled = "No pull requests opened";

    static override description = `Open a pull request in every cloned repo in the org that depends on an npm package, bumping it to a new version.

Every package.json on each repo's default branch is checked, so it finds the package at the root of a repo and in nested apps and packages of a monorepo, like apps/web and apps/api. Exact versions and ^ or ~ ranges are bumped, keeping their ^ or ~. Other specs, like workspace:* or a git URL, are listed as skipped, as are versions newer than the one being bumped to.

For each repo, a temporary worktree is made from origin's default branch, so your checkout is never touched. In it:

  - Each package.json is changed in place, keeping its formatting.
  - The nearest lockfile is updated without installing node_modules or running scripts, using the Node version from the nearest .nvmrc, .node-version or .tool-versions through nvm, which installs that version if it's missing. npm, pnpm and bun lockfiles are supported.
  - The change is committed, skipping git hooks, and pushed to a bump/<package>-<version> branch. A repo where that branch is already on origin is skipped.

The pull request is assigned to you, and its description says what was bumped, then has any --note paragraphs, lists the package's commits between the versions when the registry links them to a GitHub repo, and then has the repo's pull request template, with its technical docs checkbox ticked.

Repos are scanned from the org's clones under rootDir; run \`<%= config.bin %> org sync\` first to clone missing ones and fetch the rest. Uses the same "${OrgConfigSection.NAME}" settings as \`org sync\`; see \`<%= config.bin %> org sync --help\`.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> @acme/ui --dry-run",
            description:
                "List the repos and package.json files that would be bumped to the latest version",
        },
        {
            command: "<%= config.bin %> <%= command.id %> @acme/ui --to 2.3.0",
            description: "Bump to a specific version",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> @acme/analytics --repo 'web*' --repo api --no-draft",
            description:
                "Only bump some repos, and open ready-for-review pull requests",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> @acme/ui --note 'No ticket required - general housekeeping, bumping every consumer'",
            description:
                "Add a line to each pull request's description, like a repo's no-ticket override",
        },
    ];

    static override flags = {
        concurrency: Flags.integer({
            char: "c",
            default: 4,
            description: "Number of repos to scan or bump at once",
            min: 1,
        }),
        draft: Flags.boolean({
            allowNo: true,
            default: true,
            description: "Open draft pull requests",
        }),
        "dry-run": Flags.boolean({
            description:
                "List what would be bumped without changing anything (repos are still fetched)",
        }),
        note: Flags.string({
            char: "n",
            description:
                "A paragraph to add to each pull request's description, after the summary; can be given more than once",
            multiple: true,
        }),
        repo: Flags.string({
            char: "r",
            description:
                "Only bump repos whose name matches this glob, ignoring case; can be given more than once",
            multiple: true,
        }),
        to: Flags.string({
            default: "latest",
            description:
                "The version to bump to, or a dist-tag or range to resolve to one",
        }),
        yes: Flags.boolean({
            char: "y",
            description: "Open the pull requests without asking first",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(OrgBump);
        const config = await OrgConfigSection.load(this.config.configDir);
        const consent = this.terminal.consent(
            flags.yes || flags["dry-run"],
            "open pull requests",
            "or --dry-run to only list"
        );

        const target: Target = {
            pkg: args.package,
            version: await NpmRegistry.resolveVersion(args.package, flags.to),
        };
        this.log(
            `Bumping ${target.pkg} to ${this.style("bold", target.version)}\n`
        );

        const list = await OrgRepos.list(config);
        if (list.truncated) {
            this.warn(OrgRepos.limitWarning(config));
        }
        const repos = list.selected.filter(
            (repo) =>
                flags.repo == null || IgnoreList.matches(repo.name, flags.repo)
        );

        const planned: PlannedRepo[] = [];
        let missing = 0;
        await Concurrency.inOrder(
            repos,
            flags.concurrency,
            (repo) => PackageBump.plan(repo, target, config),
            (plan, repo) => {
                this.failed ||= plan.status === "error";
                missing += plan.status === "missing" ? 1 : 0;
                this.#logPlan(repo, plan);
                if (
                    plan.status === "scanned" &&
                    !isEmpty(PackageBump.bumps(plan))
                ) {
                    planned.push({ plan, repo });
                }
            }
        );
        if (missing > 0) {
            this.log(
                this.style(
                    "dim",
                    `${Text.pluralize(missing, "repo")} not cloned, so not checked`
                )
            );
        }

        if (isEmpty(planned)) {
            this.log(`\nNo repos to bump`);
            return;
        }
        const summary = `${Text.pluralize(planned.length, "pull request")} bumping ${target.pkg} to ${target.version}`;
        if (flags["dry-run"]) {
            this.log(`\nWould open ${summary}`);
            return;
        }
        await consent.confirm(`Open ${summary}?`);

        this.log("");
        const options = {
            changelog: Changelog.cached(),
            config,
            draft: flags.draft,
            lockfiles: new Lockfiles(),
            notes: flags.note ?? [],
            target,
        };
        const nameWidth = Math.max(
            ...planned.map(({ repo }) => repo.name.length)
        );
        await Concurrency.inOrder(
            planned,
            flags.concurrency,
            ({ plan, repo }) => PackageBump.apply(repo, plan, options),
            (outcome, { repo }) => {
                const name = repo.name.padEnd(nameWidth);
                if (outcome.status === "error") {
                    this.failed = true;
                    this.log(
                        `${name}  ${this.style("red", `error: ${outcome.reason}`)}`
                    );
                } else {
                    this.log(`${name}  ${this.style("green", outcome.url)}`);
                }
            }
        );
    }

    #logPlan(repo: OrgRepo, plan: BumpPlan): void {
        switch (plan.status) {
            case "error":
            case "skipped": {
                this.log(
                    `${repo.name}  ${this.style(plan.status === "error" ? "red" : "yellow", `${plan.status}: ${plan.reason}`)}`
                );
                return;
            }

            case "missing": {
                return;
            }

            case "scanned": {
                if (isEmpty(plan.checks)) {
                    return;
                }
                const pathWidth = Math.max(
                    ...plan.checks.map((check) => check.path.length)
                );
                this.log(this.style("bold", repo.name));
                for (const check of plan.checks) {
                    const file = check.path.padEnd(pathWidth);
                    switch (check.status) {
                        case "bump": {
                            this.log(
                                `  ${file}  ${check.current} → ${check.next}`
                            );
                            break;
                        }
                        case "skipped": {
                            this.log(
                                `  ${file}  ${this.style("yellow", `skipped: ${check.reason}`)}`
                            );
                            break;
                        }
                        case "up-to-date": {
                            this.log(
                                this.style(
                                    "dim",
                                    `  ${file}  already ${check.current}`
                                )
                            );
                            break;
                        }
                    }
                }
                return;
            }
        }
    }
}
