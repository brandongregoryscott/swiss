import { SwissCommand } from "../../shared/command.js";
import { DeployConfigSection } from "../../shared/config/deploy-config.js";
import { Text } from "../../shared/text.js";
import { Deploys } from "../../topics/deploy/deploys.js";

export default class DeployStatus extends SwissCommand {
    static override description = `Show what each deploy checkout is running, and whether its source has changed since.

STATUS is "up to date" when the checkout still matches what it was deployed from: a worktree's files, uncommitted ones included, or a branch's commit as of the last fetch. "worktree changed" or "branch moved on" means deploying it again would change what's running. "changed outside swiss" means the checkout was moved by something else, so where its commit came from isn't known.

What's been deployed is kept in ${Deploys.DISPLAY_PATH}.

${DeployConfigSection.HELP}`;

    static override examples = ["<%= config.bin %> <%= command.id %>"];

    async run(): Promise<void> {
        await this.parse(DeployStatus);
        const config = await DeployConfigSection.load(this.config.configDir);
        const state = await Deploys.load(this.config.dataDir);

        const statuses = await Promise.all(
            config.repos.map((repo) => Deploys.status(repo, state[repo.name]))
        );

        this.table([
            Deploys.COLUMNS,
            ...statuses.map((status) => Deploys.row(status)),
        ]);
        this.log(
            this.style(
                "dim",
                `\nCheckouts are in ${Text.displayPath(config.dir)}`
            )
        );
    }
}
