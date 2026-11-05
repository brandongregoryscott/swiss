import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { JsonPath } from "../../topics/jq/json-paths.js";
import { SwissCommand } from "../../shared/command.js";
import { JQ_FILE_ARG } from "../../topics/jq/flags.js";
import { Jq } from "../../topics/jq/jq.js";
import { JsonPaths } from "../../topics/jq/json-paths.js";

export default class JqPaths extends SwissCommand {
    static override args = {
        file: JQ_FILE_ARG,
    };

    static override cancelled = "Nothing copied";

    static override description = `List every path in JSON as a jq path, with its type and an example value.

Array elements are merged under [], so .orders[].customer.email covers the email of every order. Paste a path into a filter as it is, or use the path of an array as the ARRAY of the recipe commands, like \`<%= config.bin %> jq pluck\`.

--match only shows the paths whose path or example contains some text. --pick searches the paths as you type instead, then prints the one you pick and copies it.

The input is read the same way as \`<%= config.bin %> jq\` reads it.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> orders.json",
        {
            command: "<%= config.bin %> <%= command.id %> orders.json -m email",
            description: "Find where the email addresses are",
        },
        {
            command: "<%= config.bin %> <%= command.id %> orders.json --pick",
            description: "Search for a path and copy it",
        },
    ];

    static override flags = {
        match: Flags.string({
            char: "m",
            description:
                "Only show paths whose path or example contains this text (ignoring case)",
        }),
        pick: Flags.boolean({
            char: "p",
            description:
                "Search the paths interactively, and copy the one you pick",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqPaths);
        if (flags.pick) {
            this.terminal.requireInteractive(
                "pass the JSON as a file instead of piping it in",
                "--pick"
            );
        }

        let paths = JsonPaths.list(await Jq.readInput(args.file));

        if (flags.match != null) {
            const match = flags.match.toLowerCase();
            paths = paths.filter((path) =>
                `${path.path}\n${path.example ?? ""}`
                    .toLowerCase()
                    .includes(match)
            );
            if (isEmpty(paths)) {
                this.error(
                    `No paths or examples contain ${JSON.stringify(flags.match)}`
                );
            }
        }

        if (flags.pick) {
            await this.#pick(paths);
            return;
        }

        this.table([
            ["PATH", "TYPE", "EXAMPLE"],
            ...paths.map((path) => [
                path.path,
                path.types.join(" | "),
                path.example ?? "",
            ]),
        ]);
    }

    async #pick(paths: JsonPath[]): Promise<void> {
        const picked = await this.terminal.answer(
            this.terminal.prompts.autocomplete({
                maxItems: 15,
                message: "Search for a path",
                options: paths.map((path) => ({
                    hint: compactHint(path),
                    label: path.path,
                    value: path.path,
                })),
            })
        );

        this.log(picked);
        await this.copy(picked);
    }
}

function compactHint(path: JsonPath): string {
    const types = path.types.join(" | ");
    return path.example == null ? types : `${types}, e.g. ${path.example}`;
}
