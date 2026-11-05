import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { LoadedEnvFile } from "../../topics/env/files.js";
import {
    LIST_FLAGS,
    listHelp,
    searchArg,
    SwissCommand,
} from "../../shared/command.js";
import { Editor } from "../../shared/editor.js";
import { EnvFile } from "../../shared/env-files.js";
import { matchesSearch } from "../../shared/listing.js";
import { Text } from "../../shared/text.js";
import { EnvFiles } from "../../topics/env/files.js";
import { ENV_DIR_FLAG } from "../../topics/env/flags.js";

// A variable an env file sets, with the line that sets it.
type EnvVariable = {
    file: LoadedEnvFile;
    key: string;
    line: number;
    value: string;
};

export default class EnvCommand extends SwissCommand {
    static override args = {
        search: searchArg("variables", "name"),
    };

    static override description = `List the variables in every env file in a project, like a monorepo's apps/api/.env and apps/web/.env.

${listHelp("open the line that sets it in VS Code")}

Files named .env or .env.* (like .env.local and .env.example) are found under the git repo's root, or under --dir, skipping node_modules, build output and other dependency directories. Values are hidden unless you pass --reveal.

Files that set none of them are listed underneath.

To change them, use \`<%= config.bin %> env set\`, \`<%= config.bin %> env unset\` or \`<%= config.bin %> env edit\`. To find variables an app's .env.example lists that aren't set yet, use \`<%= config.bin %> env check\`.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "List the variables in every env file",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> DATABASE_URL --reveal --table",
            description: "Compare one variable across the apps",
        },
        {
            command: "<%= config.bin %> <%= command.id %> 'NEXT_PUBLIC_*' -r",
            description: "Show the variables matching a pattern",
        },
    ];

    static override flags = {
        ...LIST_FLAGS,
        dir: ENV_DIR_FLAG,
        reveal: Flags.boolean({
            char: "r",
            description: "Show values instead of hiding them",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(EnvCommand);
        const root = await EnvFiles.root(flags.dir);
        const files = await EnvFiles.load(
            root,
            (await EnvFiles.find(root)).map((file) => file.path)
        );
        if (isEmpty(files)) {
            this.log(`No env files under ${Text.displayPath(root)}`);
            return;
        }

        const variables = files.flatMap((file) =>
            [...EnvFile.entries(file.doc)]
                .filter(([key]) => matchesSearch(args.search, [key]))
                .map(([key, value]) => ({
                    file,
                    key,
                    line: EnvFile.lineOf(file.doc, key)!,
                    value,
                }))
        );
        const location = (variable: EnvVariable): string =>
            `${variable.file.display}:${variable.line}`;
        const value = (variable: EnvVariable): string =>
            EnvFile.formatValue(variable.value, flags.reveal);

        // Comparing a variable across the apps, the ones that don't set it matter too.
        const unset = files.filter(
            (file) => !variables.some((variable) => variable.file === file)
        );
        await this.listItems<EnvVariable>({
            action: "open the line that sets it in VS Code",
            choice: (variable) => ({
                hint: `${location(variable)} · ${value(variable)}`,
                label: variable.key,
            }),
            columns: ["NAME", "FILE", "VALUE"],
            empty:
                args.search == null
                    ? `No variables in the env files under ${Text.displayPath(root)}`
                    : `No variables match ${JSON.stringify(args.search)}`,
            footer: isEmpty(unset)
                ? null
                : this.style(
                      "dim",
                      `${args.search == null ? "No variables in" : "Not set in"} ${unset.map((file) => file.display).join(", ")}`
                  ),
            items: variables,
            noun: ["variable", "variables"],
            async open(variable) {
                await Editor.open(variable.file.path, variable.line);
                return `Opened ${location(variable)}`;
            },
            row: (variable) => [
                variable.key,
                location(variable),
                value(variable),
            ],
            table: flags.table,
            title: `Variables in the env files under ${Text.displayPath(root)}`,
            verb: "Opened",
        });
    }
}
