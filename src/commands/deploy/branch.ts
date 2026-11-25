import { Args, Flags } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { DeployConfigSection } from "../../shared/config/deploy-config.js";
import { DeployError, Deploys } from "../../topics/deploy/deploys.js";

export default class DeployBranch extends SwissCommand {
    static override args = {
        branch: Args.string({
            description: "The branch to deploy",
            required: true,
        }),
    };

    static override description = `Deploy a branch to a repo's deploy checkout.

The main clone's local branch is deployed, or origin's when there's no local one. --pull fetches origin first and deploys its branch even when there's a local one. Fetching never moves the main clone's own branches.

${DeployConfigSection.HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> feature/login",
        {
            command:
                "<%= config.bin %> <%= command.id %> feature/login --repo api --pull",
            description: "Deploy origin's latest feature/login to api",
        },
    ];

    static override flags = {
        pull: Flags.boolean({
            description: "Fetch origin and deploy its branch",
        }),
        repo: Flags.string({
            char: "r",
            description:
                "The repo to deploy it to, which can be left out when there's only one",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(DeployBranch);
        const config = await DeployConfigSection.load(this.config.configDir);
        const names = config.repos.map((repo) => repo.name).join(", ");

        if (flags.repo == null && config.repos.length > 1) {
            throw new DeployError(
                `Pass --repo with the repo to deploy to: ${names}`
            );
        }
        const repo =
            flags.repo == null
                ? config.repos[0]!
                : config.repos.find((each) => each.name === flags.repo);
        if (repo == null) {
            throw new DeployError(
                `${flags.repo} isn't a repo to deploy; pick one of ${names}`
            );
        }
        await Deploys.requireCopies([repo]);

        const source = await Deploys.branchSource(
            repo,
            args.branch,
            flags.pull
        );
        const deploy = await Deploys.deployBranch(
            this.config.dataDir,
            repo,
            source
        );
        this.log(
            `${repo.name} → ${deploy.commit.slice(0, 8)}, ${Deploys.source(deploy.source)}`
        );
    }
}
