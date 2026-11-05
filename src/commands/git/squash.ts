import { Flags } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { GitSquash } from "../../topics/git/squash.js";

export default class GitSquashCommand extends SwissCommand {
    static override description = `Squash a feature branch's commits into one commit.

Defaults to origin/HEAD, then local main or master. --from picks another base, which must be an ancestor of HEAD. Requires a clean working tree, including staged, unstaged and untracked files, and refuses detached HEAD, main/master, the base branch and unfinished Git operations.

Saves the old HEAD under refs/swiss/gcsquash/ before resetting. Git commit runs with your terminal for hooks and signing. If committing fails, changes remain staged and a recovery command is printed. Nothing is pushed.

Run configure to install gcsquash as an alias for this command.`;

    static override examples = [
        '<%= config.bin %> <%= command.id %> "Add account settings"',
        '<%= config.bin %> <%= command.id %> --from master "Add account settings"',
    ];

    static override flags = {
        from: Flags.string({
            char: "f",
            description: "Base branch to squash commits since",
        }),
    };

    static override strict = false;

    static override usage = "git squash MESSAGE... [--from BRANCH]";

    async run(): Promise<void> {
        const { flags, raw } = await this.parse(GitSquashCommand);
        const message = raw
            .filter((token) => token.type === "arg")
            .map((token) => token.input)
            .join(" ");
        await GitSquash.run({
            from: flags.from,
            log: (line) => this.log(line),
            message,
        });
    }
}
