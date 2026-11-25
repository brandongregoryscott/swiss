import { Flags } from "@oclif/core";
import { difference, isEmpty, uniq } from "lodash-es";
import type { BranchSource } from "../../topics/deploy/deploys.js";
import { SwissCommand } from "../../shared/command.js";
import { DeployConfigSection } from "../../shared/config/deploy-config.js";
import { DeployError, Deploys } from "../../topics/deploy/deploys.js";

export default class DeployReset extends SwissCommand {
    static override description = `Deploy repos' default branches to their deploy checkouts, creating any that don't exist yet.

The default branch is the one origin names, or else main or master. Like \`<%= config.bin %> deploy branch\`, the main clone's local branch is deployed unless --pull is passed. Without repo names, every repo is reset. Every name is checked before anything moves.

${DeployConfigSection.HELP}`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description:
                "Create the deploy checkouts, or put them all back on their default branch",
        },
        {
            command: "<%= config.bin %> <%= command.id %> api --pull",
            description: "Deploy origin's latest default branch to api",
        },
    ];

    static override flags = {
        pull: Flags.boolean({
            description: "Fetch origin and deploy its default branch",
        }),
    };

    static override strict = false;

    static override usage = "deploy reset [REPO...] [--pull]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(DeployReset);
        const names = uniq(argv as string[]);
        const config = await DeployConfigSection.load(this.config.configDir);

        const unknown = difference(
            names,
            config.repos.map((repo) => repo.name)
        );
        if (!isEmpty(unknown)) {
            throw new DeployError(
                `${unknown.join(", ")} ${unknown.length === 1 ? "isn't a repo" : "aren't repos"} to deploy; pick from ${config.repos.map((repo) => repo.name).join(", ")}`
            );
        }
        const repos = isEmpty(names)
            ? config.repos
            : config.repos.filter((repo) => names.includes(repo.name));
        await Deploys.requireCopies(repos);

        const sources: BranchSource[] = [];
        for (const repo of repos) {
            const branch = await Deploys.defaultBranch(repo);
            sources.push(await Deploys.branchSource(repo, branch, flags.pull));
        }
        for (const [index, repo] of repos.entries()) {
            const deploy = await Deploys.deployBranch(
                this.config.dataDir,
                repo,
                sources[index]!
            );
            this.log(await Deploys.summary(repo, deploy));
        }
    }
}
