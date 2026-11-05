import { isEmpty } from "lodash-es";
import path from "node:path";
import type { Assignment } from "../../shared/env-files.js";
import type { Style } from "../../shared/text.js";
import type { LoadedEnvFile, SetResult } from "../../topics/env/files.js";
import { SwissCommand } from "../../shared/command.js";
import { EnvFile } from "../../shared/env-files.js";
import { Text } from "../../shared/text.js";
import { EnvFiles } from "../../topics/env/files.js";
import { ENV_DIR_FLAG, ENV_FILE_FLAG } from "../../topics/env/flags.js";

const STATUS_STYLES: Record<SetResult["status"], Style> = {
    added: "green",
    unchanged: "dim",
    updated: "yellow",
};

export default class EnvSet extends SwissCommand {
    static override description = `Set variables in one or more env files.

Each variable is changed where it already is, keeping its comments and the rest of the file as they are, or added at the end of the file. Values are quoted when they need to be.

Give just KEY, without =VALUE, to type the value without it showing on screen or ending up in your shell history.

Without --file you pick the files from the ones under the git repo's root (or --dir), with the current directory's .env picked to start with. --file can name a file that doesn't exist yet to create it, and is required when there's no terminal to pick in.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> PORT=4000 -f apps/api/.env",
            description: "Set a variable in one file",
        },
        {
            command: "<%= config.bin %> <%= command.id %> STRIPE_SECRET_KEY",
            description: "Type a secret and pick which apps get it",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> LOG_LEVEL=debug -f apps/api/.env -f apps/web/.env",
            description: "Set a variable in several files",
        },
    ];

    static override flags = {
        dir: ENV_DIR_FLAG,
        file: ENV_FILE_FLAG,
    };

    // Takes any number of variables.
    static override strict = false;

    static override usage =
        "<%= command.id %> KEY[=VALUE]... [-f FILE]... [-d DIR]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(EnvSet);
        if (isEmpty(argv)) {
            this.error("Give at least one variable to set, like PORT=3000");
        }

        const assignments = (argv as string[]).map((input) =>
            EnvFile.parseAssignment(input)
        );
        if (assignments.some((assignment) => assignment.value == null)) {
            this.terminal.requireArgument("each variable as KEY=VALUE");
        }
        if (flags.file == null) {
            this.terminal.requireArgument(
                "--file to say which env file to change"
            );
        }

        const root = await EnvFiles.root(flags.dir);
        const values = await this.#values(assignments);
        const files = await EnvFiles.load(
            root,
            flags.file ?? (await this.#pickFiles(root))
        );
        await this.#apply(files, values);
    }

    async #apply(
        files: LoadedEnvFile[],
        values: Map<string, string>
    ): Promise<void> {
        const { results, writes } = EnvFiles.planSet(files, values);
        await EnvFiles.save(writes);
        for (const line of Text.table(
            results.map(({ file, key, status }) => [
                file.display,
                key,
                this.style(STATUS_STYLES[status], status),
            ])
        )) {
            this.log(line);
        }
    }

    async #pickFiles(root: string): Promise<string[]> {
        const found = await EnvFiles.find(root);
        if (isEmpty(found)) {
            this.error(
                `No env files under ${Text.displayPath(root)}; pass --file to create one`
            );
        }
        const here = path.join(process.cwd(), ".env");
        return this.terminal.answer(
            this.terminal.prompts.multiselect<string>({
                initialValues: found
                    .filter((file) => file.path === here)
                    .map((file) => file.path),
                message: "Which env files?",
                options: found.map((file) => ({
                    label: file.display,
                    value: file.path,
                })),
            })
        );
    }

    // The value for each key, asking for the ones given without one.
    async #values(assignments: Assignment[]): Promise<Map<string, string>> {
        const values = new Map<string, string>();
        for (const { key, value } of assignments) {
            if (value != null) {
                values.set(key, value);
                continue;
            }
            const typed = await this.terminal.answer(
                this.terminal.prompts.password({ message: `Value for ${key}` })
            );
            values.set(key, typed ?? "");
        }
        return values;
    }
}
