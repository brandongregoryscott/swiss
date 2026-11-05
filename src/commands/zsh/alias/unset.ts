import { uniq } from "lodash-es";
import type { Located } from "../../../topics/zsh/startup.js";
import type { ZshAlias, ZshFunction } from "../../../topics/zsh/syntax.js";
import {
    REMOVE_FLAGS,
    REMOVE_HELP,
    SwissCommand,
} from "../../../shared/command.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

export default class ZshAliasUnset extends SwissCommand {
    static override aliases = ["zsh:alias:rm"];

    static override cancelled = "Nothing removed";

    static override description = `Remove aliases and functions from your zsh startup files.

Every definition of each one is removed, along with the lines it's on. A name removes both the alias and the function with that name, and name() only the function. Ones inside functions or conditionals, or on a line with other commands, are left for you to remove by hand. Comments above a function are kept.

${REMOVE_HELP}

${ZshStartup.FILES_HELP}`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick aliases and functions to remove from a list",
        },
        "<%= config.bin %> <%= command.id %> gs ll gwtcd",
    ];

    static override flags = REMOVE_FLAGS;

    // Takes any number of aliases.
    static override strict = false;

    static override usage = "zsh alias unset [NAME...] [-y]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(ZshAliasUnset);
        const startup = await ZshStartup.load();
        await this.removeItems<Located<ZshAlias | ZshFunction>>({
            choices: async () =>
                [
                    // The definition that counts for each name, which is the last one.
                    ...new Map(
                        startup
                            .aliases()
                            .map((alias) => [
                                ZshStartup.label(alias.statement),
                                alias,
                            ])
                    ).values(),
                ].map((alias) => ({
                    hint: `${alias.statement.value}, ${ZshStartup.location(alias)}`,
                    label: ZshStartup.label(alias.statement),
                    value: ZshStartup.label(alias.statement),
                })),
            columns: ["NAME", "FILE", "COMMAND"],
            // The reasons it gives already say where it is.
            describe: (alias) => ZshStartup.label(alias.statement),
            hint: (removed) => ZshStartup.forgetHint(removed),
            names: uniq(argv as string[]),
            notFound: (missing) =>
                `${missing.join(", ")} ${missing.length === 1 ? "isn't an alias or function" : "aren't aliases or functions"} in your zsh startup files`,
            noun: ["alias or function", "aliases and functions"],
            plan: async (names) => startup.planAliasRemoval(names),
            row: (alias) => [
                ZshStartup.label(alias.statement),
                ZshStartup.location(alias),
                alias.statement.value.replaceAll(/\s+/g, " "),
            ],
            yes: flags.yes,
        });
    }
}
