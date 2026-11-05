import { SwissCommand } from "../../../shared/command.js";
import { zshFileFlag } from "../../../topics/zsh/flags.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

export default class ZshAliasSet extends SwissCommand {
    static override description = `Add an alias to your zsh startup files, or change one.

Everything after NAME is the command, joined with spaces, so quoting it is optional. An alias that's already defined is changed where it is, keeping the rest of the file as it is. A new one goes in the file that has the most aliases already, after the last of them, unless --file says otherwise.

The command is written in single quotes, so it's kept exactly as you give it, and $VARIABLES in it expand when the alias runs rather than when the file loads. Quote the command when it has characters your shell would expand first, like $, * or |.

The file is checked with zsh -n afterwards, and put back as it was if zsh finds a syntax error.

${ZshStartup.FILES_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> gs git status",
        {
            command:
                "<%= config.bin %> <%= command.id %> ports 'lsof -iTCP -sTCP:LISTEN -n -P | grep node'",
            description: "Quote commands with characters like | in them",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> k kubectl -f ~/.zsh/aliases.zsh",
            description: "Add an alias to a particular file",
        },
    ];

    static override flags = {
        file: zshFileFlag("aliases"),
    };

    // The command can be given without quotes, as several arguments.
    static override strict = false;

    static override usage = "zsh alias set NAME COMMAND... [-f FILE]";

    async run(): Promise<void> {
        const { flags, raw } = await this.parse(ZshAliasSet);
        // oclif's argv moves repeated words next to their first use, so `hi echo hi` would come
        // back as `hi hi echo`; raw keeps them in order.
        const [name, ...words] = raw
            .filter((token) => token.type === "arg")
            .map((token) => token.input);
        if (name == null) {
            this.error("Give a name for the alias, like gs");
        }

        const startup = await ZshStartup.load();
        const change = startup.setAlias(name, words.join(" "), flags.file);
        if (change.status === "unchanged") {
            this.log(
                `${name} is already set to that at ${ZshStartup.location(change)}`
            );
            return;
        }
        const written = await startup.save();
        this.log(
            `${change.status === "added" ? this.style("green", "Added") : this.style("yellow", "Changed")} ${name} at ${ZshStartup.location(change)}`
        );
        this.log(this.style("dim", ZshStartup.reloadHint(written)));
    }
}
