import { groupBy, uniq } from "lodash-es";
import type { EnvKey } from "../../topics/env/files.js";
import {
    REMOVE_FLAGS,
    REMOVE_HELP,
    SwissCommand,
} from "../../shared/command.js";
import { EnvFile } from "../../shared/env-files.js";
import { EnvFiles } from "../../topics/env/files.js";
import { ENV_DIR_FLAG, ENV_FILE_FLAG } from "../../topics/env/flags.js";

export default class EnvUnset extends SwissCommand {
    static override aliases = ["env:rm"];

    static override cancelled = "Nothing removed";

    static override description = `Remove variables from env files.

Without --file, they're removed from every env file under the git repo's root (or --dir) that sets them.

${REMOVE_HELP}`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick variables to remove from a list",
        },
        {
            command: "<%= config.bin %> <%= command.id %> OLD_API_URL",
            description: "Remove a variable from every app",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> DEBUG -f apps/web/.env --yes",
            description: "Remove a variable from one file without asking",
        },
    ];

    static override flags = {
        dir: ENV_DIR_FLAG,
        file: ENV_FILE_FLAG,
        ...REMOVE_FLAGS,
    };

    // Takes any number of variables.
    static override strict = false;

    static override usage = "env unset [KEY...] [-f FILE]... [-y]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(EnvUnset);
        const keys = uniq(argv as string[]);
        const invalid = keys.find((key) => !EnvFile.isValidKey(key));
        if (invalid != null) {
            this.error(
                `${JSON.stringify(invalid)} isn't a valid variable name`
            );
        }

        const root = await EnvFiles.root(flags.dir);
        const files = await EnvFiles.load(
            root,
            flags.file ?? (await EnvFiles.find(root)).map((file) => file.path)
        );
        await this.removeItems<EnvKey>({
            choices: async () =>
                Object.entries(
                    groupBy(
                        files.flatMap((file) =>
                            [...EnvFile.entries(file.doc).keys()].map(
                                (key) => ({ file, key })
                            )
                        ),
                        ({ key }) => key
                    )
                ).map(([key, set]) => ({
                    hint: set.map(({ file }) => file.display).join(", "),
                    label: key,
                    value: key,
                })),
            columns: ["NAME", "FILE"],
            describe: ({ file, key }) => `${key} in ${file.display}`,
            names: keys,
            notFound: (missing) =>
                `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} set in any env file`,
            noun: ["variable", "variables"],
            plan: async (picked) => EnvFiles.planUnset(files, picked),
            row: ({ file, key }) => [key, file.display],
            yes: flags.yes,
        });
    }
}
