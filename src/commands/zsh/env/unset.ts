import { uniq } from "lodash-es";
import type { Located } from "../../../topics/zsh/startup.js";
import type { ZshVariable } from "../../../topics/zsh/syntax.js";
import {
    REMOVE_FLAGS,
    REMOVE_HELP,
    SwissCommand,
} from "../../../shared/command.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

export default class ZshEnvUnset extends SwissCommand {
    static override aliases = ["zsh:env:rm"];

    static override cancelled = "Nothing removed";

    static override description = `Stop exporting environment variables from your zsh startup files.

Every export of each variable is removed, along with the line it's on. Ones inside functions or conditionals, or on a line with other commands, are left for you to remove by hand.

${REMOVE_HELP}

${ZshStartup.FILES_HELP}`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick exports to remove from a list",
        },
        "<%= config.bin %> <%= command.id %> OLD_TOKEN API_URL",
    ];

    static override flags = REMOVE_FLAGS;

    // Takes any number of variables.
    static override strict = false;

    static override usage = "zsh env unset [KEY...] [-y]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(ZshEnvUnset);
        const names = uniq(argv as string[]);
        if (names.includes("PATH")) {
            this.error("Use `zsh path remove` to change PATH");
        }

        const startup = await ZshStartup.load();
        await this.removeItems<Located<ZshVariable>>({
            choices: async () =>
                [
                    // The export that counts for each name, which is the last one.
                    ...new Map(
                        startup
                            .exports()
                            .map((variable) => [
                                variable.statement.name,
                                variable,
                            ])
                    ).values(),
                ].map((variable) => ({
                    hint: ZshStartup.location(variable),
                    label: variable.statement.name,
                    value: variable.statement.name,
                })),
            columns: ["NAME", "FILE"],
            // The reasons it gives already say where it is.
            describe: (variable) => variable.statement.name,
            hint: (removed) => ZshStartup.forgetHint(removed),
            names,
            notFound: (missing) =>
                `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} exported by your zsh startup files`,
            noun: ["export", "exports"],
            plan: async (picked) => startup.planExportRemoval(picked),
            row: (variable) => [
                variable.statement.name,
                ZshStartup.location(variable),
            ],
            yes: flags.yes,
        });
    }
}
