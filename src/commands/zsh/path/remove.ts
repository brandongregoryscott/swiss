import { groupBy, uniq } from "lodash-es";
import type { PathAddition } from "../../../topics/zsh/startup.js";
import {
    REMOVE_FLAGS,
    REMOVE_HELP,
    SwissCommand,
} from "../../../shared/command.js";
import { Text } from "../../../shared/text.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

export default class ZshPathRemove extends SwissCommand {
    static override aliases = ["zsh:path:rm"];

    static override cancelled = "Nothing removed";

    static override description = `Stop your zsh startup files adding directories to PATH.

Each line that adds one of the directories is changed to leave it out, or removed when it adds nothing else; the rest of the line is kept as it's written. Lines inside functions or conditionals, or that share their line with other commands, are left for you to change by hand.

${REMOVE_HELP}

Directories match however they're written, so ~/.bun/bin removes export PATH="$BUN_INSTALL/bin:$PATH" when BUN_INSTALL is ~/.bun.

${ZshStartup.FILES_HELP}`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick directories to remove from a list",
        },
        "<%= config.bin %> <%= command.id %> ~/.old-tool/bin",
        {
            command: `<%= config.bin %> <%= command.id %> "$(dirname "$(which node)")"`,
            description: "Remove the directory a command is in",
        },
    ];

    static override flags = REMOVE_FLAGS;

    // Takes any number of directories.
    static override strict = false;

    static override usage = "zsh path remove [DIR...] [-y]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(ZshPathRemove);
        const startup = await ZshStartup.load();
        await this.removeItems<PathAddition>({
            choices: async () =>
                Object.values(
                    groupBy(
                        startup
                            .pathAdditions()
                            .filter((addition) => addition.expanded != null),
                        (addition) => addition.expanded!
                    )
                ).map((additions) => ({
                    hint: uniq(
                        additions.map((addition) =>
                            ZshStartup.location(addition)
                        )
                    ).join(", "),
                    label: Text.displayPath(additions[0]!.expanded!),
                    value: additions[0]!.expanded!,
                })),
            columns: ["DIRECTORY", "FILE"],
            // The reasons it gives already say where it is.
            describe: (addition) => Text.displayPath(addition.expanded!),
            hint: (removed) => ZshStartup.forgetHint(removed),
            names: uniq(argv as string[]),
            notFound: (missing) =>
                `Your startup files don't add ${missing.join(", ")}; ${missing.length === 1 ? "it" : "they"} may come from /etc/paths or a tool that changes PATH when it runs`,
            noun: ["directory", "directories"],
            plan: async (dirs) => startup.planPathRemoval(dirs),
            row: (addition) => [
                Text.displayPath(addition.expanded!),
                ZshStartup.location(addition),
            ],
            yes: flags.yes,
        });
    }
}
