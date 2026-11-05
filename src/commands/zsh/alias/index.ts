import { compact } from "lodash-es";
import type { Located } from "../../../topics/zsh/startup.js";
import type { ZshAlias, ZshFunction } from "../../../topics/zsh/syntax.js";
import {
    LIST_FLAGS,
    listHelp,
    searchArg,
    SwissCommand,
} from "../../../shared/command.js";
import { Editor } from "../../../shared/editor.js";
import { matchesSearch } from "../../../shared/listing.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

type Alias = Located<ZshAlias | ZshFunction>;

export default class ZshAliasCommand extends SwissCommand {
    static override args = {
        search: searchArg("aliases and functions", "name or command"),
    };

    static override description = `List the aliases and functions in your zsh startup files, with the file and line each is on.

${listHelp("open its definition in VS Code")}

Functions are listed with () after their name, and their body as the command. When one is defined more than once, the last one wins, and the others are marked overridden. Ones inside functions or conditionals are listed too, marked as such, since they might not always be defined.

${ZshStartup.FILES_HELP}

To add or change one, use \`<%= config.bin %> zsh alias set\`, and to remove one, \`<%= config.bin %> zsh alias unset\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> git",
            description: "Find the aliases for git commands",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --table",
            description: "Print them all as a table",
        },
    ];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ZshAliasCommand);
        const aliases = (await ZshStartup.load()).aliases();

        // The last definition of each name is the one that's used.
        const last = new Map(
            aliases.map((alias) => [ZshStartup.label(alias.statement), alias])
        );
        const overridden = (alias: Alias): boolean =>
            last.get(ZshStartup.label(alias.statement)) !== alias;

        await this.listItems<Alias>({
            action: "open its definition in VS Code",
            choice: (alias) => ({
                hint: `${compact([
                    ZshStartup.location(alias),
                    alias.statement.nested && "conditional",
                    overridden(alias) && "overridden",
                ]).join(", ")} · ${oneLine(alias.statement.value)}`,
                label: ZshStartup.label(alias.statement),
            }),
            columns: ["NAME", "FILE", "COMMAND"],
            dim: overridden,
            empty:
                args.search == null
                    ? "No aliases or functions in your zsh startup files"
                    : `No aliases or functions match ${JSON.stringify(args.search)}`,
            items: aliases.filter((alias) =>
                matchesSearch(args.search, [
                    ZshStartup.label(alias.statement),
                    alias.statement.value,
                ])
            ),
            noun: ["definition", "definitions"],
            async open(alias) {
                await Editor.open(alias.file.path, alias.statement.line);
                return `Opened ${ZshStartup.location(alias)}`;
            },
            row: (alias) => [
                ZshStartup.label(alias.statement),
                ZshStartup.location(alias) +
                    (alias.statement.nested ? " (conditional)" : ""),
                alias.statement.value,
            ],
            table: flags.table,
            title: "Aliases and functions in your zsh startup files",
            verb: "Opened",
        });
    }
}

function oneLine(text: string): string {
    return text.replaceAll(/\s+/g, " ");
}
