import { isEmpty } from "lodash-es";
import type { ZshFile } from "../../../topics/zsh/startup.js";
import { SwissCommand } from "../../../shared/command.js";
import { zshFileFlag } from "../../../topics/zsh/flags.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

export default class ZshEnvSet extends SwissCommand {
    static override description = `Export environment variables from your zsh startup files, or change ones they already export.

A variable that's already exported is changed where it is, keeping the rest of the file as it is. A new one goes in the file that exports the most variables already, after the last of them, unless --file says otherwise.

Values are written in double quotes, so $VARIABLES and $(commands) in them expand when the shell starts, like export BUN_INSTALL="$HOME/.bun". Quote the value so your shell doesn't expand them first. A KEY without =VALUE asks for the value without showing it, for secrets you don't want in your shell history.

The file is checked with zsh -n afterwards, and put back as it was if zsh finds a syntax error. To change PATH, use \`<%= config.bin %> zsh path add\` instead.

${ZshStartup.FILES_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> EDITOR=nvim",
        {
            command: "<%= config.bin %> <%= command.id %> 'GOPATH=$HOME/go'",
            description: "Use another variable in the value",
        },
        {
            command: "<%= config.bin %> <%= command.id %> OPENAI_API_KEY",
            description: "Type a secret's value without it being shown",
        },
    ];

    static override flags = {
        file: zshFileFlag("variables"),
    };

    // Takes any number of variables.
    static override strict = false;

    static override usage = "zsh env set KEY[=VALUE]... [-f FILE]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(ZshEnvSet);
        if (isEmpty(argv)) {
            this.error("Give at least one variable to set, like EDITOR=nvim");
        }

        const assignments: Array<[string, string]> = [];
        for (const input of argv as string[]) {
            const equals = input.indexOf("=");
            if (equals !== -1) {
                assignments.push([
                    input.slice(0, equals),
                    input.slice(equals + 1),
                ]);
                continue;
            }
            this.terminal.requireArgument("each variable as KEY=VALUE");
            const typed = await this.terminal.answer(
                this.terminal.prompts.password({
                    message: `Value for ${input}`,
                })
            );
            assignments.push([input, typed ?? ""]);
        }

        const startup = await ZshStartup.load();
        const changed: ZshFile[] = [];
        for (const [name, value] of assignments) {
            const change = startup.setExport(name, value, flags.file);
            if (change.status === "unchanged") {
                this.log(`${name} ${this.style("dim", "unchanged")}`);
                continue;
            }
            changed.push(...(await startup.save()));
            this.log(
                `${change.status === "added" ? this.style("green", "Added") : this.style("yellow", "Changed")} ${name} at ${ZshStartup.location(change)}`
            );
        }
        if (!isEmpty(changed)) {
            this.log(this.style("dim", ZshStartup.reloadHint(changed)));
        }
    }
}
