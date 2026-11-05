import { Flags } from "@oclif/core";
import { compact } from "lodash-es";
import type { Located } from "../../../topics/zsh/startup.js";
import type { ZshVariable } from "../../../topics/zsh/syntax.js";
import {
    LIST_FLAGS,
    listHelp,
    searchArg,
    SwissCommand,
} from "../../../shared/command.js";
import { Editor } from "../../../shared/editor.js";
import { EnvFile } from "../../../shared/env-files.js";
import { matchesSearch } from "../../../shared/listing.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

export default class ZshEnv extends SwissCommand {
    static override args = {
        search: searchArg("variables", "name"),
    };

    static override description = `List the environment variables your zsh startup files export, with the file and line each is on.

${listHelp("open where it's exported in VS Code")}

Values are shown as they're written, like $HOME/.bun, and hidden unless you pass --reveal. When a variable is exported more than once, the last one wins, and the others are marked overridden. PATH is left out; see \`<%= config.bin %> zsh path\`.

${ZshStartup.FILES_HELP}

To change them, use \`<%= config.bin %> zsh env set\`, \`<%= config.bin %> zsh env unset\` or \`<%= config.bin %> zsh env edit\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> 'NVM_*' --reveal",
            description: "Show the values of the variables matching a pattern",
        },
    ];

    static override flags = {
        ...LIST_FLAGS,
        reveal: Flags.boolean({
            char: "r",
            description: "Show values instead of hiding them",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ZshEnv);
        const variables = (await ZshStartup.load()).exports();

        const last = new Map(
            variables.map((variable) => [variable.statement.name, variable])
        );
        const overridden = (variable: Located<ZshVariable>): boolean =>
            last.get(variable.statement.name) !== variable;
        const value = (variable: Located<ZshVariable>): string =>
            EnvFile.formatValue(variable.statement.value, flags.reveal);

        await this.listItems<Located<ZshVariable>>({
            action: "open where it's exported in VS Code",
            choice: (variable) => ({
                hint: `${compact([
                    ZshStartup.location(variable),
                    variable.statement.nested && "conditional",
                    overridden(variable) && "overridden",
                ]).join(", ")} · ${value(variable)}`,
                label: variable.statement.name,
            }),
            columns: ["NAME", "FILE", "VALUE"],
            dim: overridden,
            empty:
                args.search == null
                    ? "No variables exported by your zsh startup files"
                    : `No variables match ${JSON.stringify(args.search)}`,
            items: variables.filter((variable) =>
                matchesSearch(args.search, [variable.statement.name])
            ),
            noun: ["export", "exports"],
            async open(variable) {
                await Editor.open(variable.file.path, variable.statement.line);
                return `Opened ${ZshStartup.location(variable)}`;
            },
            row: (variable) => [
                variable.statement.name,
                ZshStartup.location(variable) +
                    (variable.statement.nested ? " (conditional)" : ""),
                value(variable),
            ],
            table: flags.table,
            title: "Variables your zsh startup files export",
            verb: "Opened",
        });
    }
}
