import { uniq } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";
import { DeployConfigSection } from "../../shared/config/deploy-config.js";
import { Deploys } from "../../topics/deploy/deploys.js";

export default class DeployUse extends SwissCommand {
    static override description = `Deploy worktrees to their repos' deploy checkouts, uncommitted changes and untracked files included.

A deploy checkout is a fixed worktree of a repo that a long-running dev environment, like Tilt or docker compose watch, is pointed at once. Deploying moves it onto other code, which the environment picks up like any other edit, so its config never changes when you switch what's running.

Each worktree's files are snapshotted into a commit no branch points to, so its own index and git status stay as they are. A worktree with nothing uncommitted deploys its HEAD. Every path is checked before anything moves, and each checkout is created the first time it's deployed to. Its files git ignores, like node_modules, are kept between deploys, and the repo's copy files are copied in from its main clone every time.

Run \`<%= config.bin %> deploy status\` to see what each checkout is running.

${DeployConfigSection.HELP}`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Deploy the worktree you're in",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> ~/code/api/.worktrees/feature ~/code/web",
            description: "Deploy worktrees of two repos at once",
        },
    ];

    static override strict = false;

    static override usage = "deploy use [WORKTREE...]";

    async run(): Promise<void> {
        const { argv } = await this.parse(DeployUse);
        const dirs = uniq(argv as string[]);
        const config = await DeployConfigSection.load(this.config.configDir);

        const targets = await Deploys.planUse(
            config.repos,
            dirs.length === 0 ? ["."] : dirs
        );
        await Deploys.requireCopies(targets.map((target) => target.repo));

        for (const target of targets) {
            const deploy = await Deploys.deployWorktree(
                this.config.dataDir,
                target
            );
            this.log(
                `${target.repo.name} → ${deploy.commit.slice(0, 8)}, ${Deploys.source(deploy.source)}`
            );
        }
    }
}
