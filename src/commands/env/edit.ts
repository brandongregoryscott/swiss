import { Args, Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import path from "node:path";
import type { VariableStore } from "../../shared/variable-editor.js";
import { SwissCommand } from "../../shared/command.js";
import { EnvFile } from "../../shared/env-files.js";
import { Text } from "../../shared/text.js";
import { VariableEditor } from "../../shared/variable-editor.js";
import { EnvFiles } from "../../topics/env/files.js";
import { ENV_DIR_FLAG } from "../../topics/env/flags.js";

export default class EnvEdit extends SwissCommand {
    static override args = {
        file: Args.string({
            description:
                "Env file to edit, which is created when you save if it doesn't exist [default: pick from the env files under the git repo's root]",
        }),
    };

    static override cancelled = "Nothing saved";

    static override description = `Interactively add, change, rename and remove the variables in an env file.

Pick a variable to change its value, rename it or remove it, or add a new one. Comments, blank lines and the order of the file are kept. Values are hidden in the list unless you pass --reveal.

Nothing is written until you choose "Save and exit". Needs an interactive terminal.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick one of the project's env files to edit",
        },
        "<%= config.bin %> <%= command.id %> apps/api/.env",
    ];

    static override flags = {
        dir: ENV_DIR_FLAG,
        reveal: Flags.boolean({
            char: "r",
            description: "Show values in the list instead of hiding them",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(EnvEdit);
        this.terminal.requireInteractive(
            "use `env set` and `env unset` instead"
        );

        const root = await EnvFiles.root(flags.dir);
        const [file] = await EnvFiles.load(root, [
            args.file ?? (await this.#pickFile(root)),
        ]);
        let doc = file!.doc;
        const store: VariableStore = {
            changed: () =>
                EnvFile.serialize(doc) !== EnvFile.serialize(file!.doc),
            checkName: (name) =>
                EnvFile.isValidKey(name)
                    ? undefined
                    : "Use letters, digits and underscores, starting with a letter or underscore",
            placeholder: "API_KEY",
            remove: (name) => {
                doc = EnvFile.unset(doc, name);
            },
            rename: (from, to) => {
                doc = EnvFile.rename(doc, from, to);
            },
            save: async () => {
                await EnvFile.write(file!.path, doc);
                return `Saved ${file!.display}`;
            },
            set: (name, value) => {
                doc = EnvFile.set(doc, name, value);
            },
            title: `Editing ${file!.display}`,
            variables: () =>
                [...EnvFile.entries(doc)].map(([name, value]) => ({
                    name,
                    value,
                })),
        };
        await VariableEditor.edit(this.terminal, store, {
            reveal: flags.reveal,
        });
    }

    async #pickFile(root: string): Promise<string> {
        const found = await EnvFiles.find(root);
        if (isEmpty(found)) {
            this.error(
                `No env files under ${Text.displayPath(root)}; give the path of one to create`
            );
        }
        const here = path.join(process.cwd(), ".env");
        return this.terminal.answer(
            this.terminal.prompts.select<string>({
                initialValue: found.some((file) => file.path === here)
                    ? here
                    : undefined,
                maxItems: 15,
                message: "Which env file?",
                options: found.map((file) => ({
                    label: file.display,
                    value: file.path,
                })),
            })
        );
    }
}
