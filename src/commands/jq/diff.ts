import { Args } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { JsonChange } from "../../topics/jq/json-diff.js";
import { SwissCommand } from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { JQ_FILE_ARG } from "../../topics/jq/flags.js";
import { Jq, JqError } from "../../topics/jq/jq.js";
import { JsonDiff } from "../../topics/jq/json-diff.js";
import { JsonPaths, JsonPathsError } from "../../topics/jq/json-paths.js";

export default class JqDiff extends SwissCommand {
    static override args = {
        left: Args.string({
            description: "The JSON file to compare from",
            required: true,
        }),
        right: JQ_FILE_ARG,
    };

    static override description = `Show what's different between two JSON values, as jq paths.

Each difference is one line: + for a path only in RIGHT, - for a path only in LEFT, and ~ for a value that changed. Key order doesn't matter, and arrays are compared element by element by index, so an element inserted near the start shows up as changes to every element after it.

RIGHT is read the same way as \`<%= config.bin %> jq\` reads its input, so a copied API response can be compared against a file. Input holding several JSON values, like newline-delimited JSON, is compared as an array of them.

Exits with 1 when there are differences, like \`diff\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> before.json after.json",
        {
            command:
                "curl -s https://api.example.com/config | <%= config.bin %> <%= command.id %> config.json",
            description: "Compare an API response against a file",
        },
    ];

    async run(): Promise<void> {
        const { args } = await this.parse(JqDiff);

        let changes: JsonChange[];
        const left = await readValue(args.left);
        const right = await readValue(args.right);
        changes = JsonDiff.compare(left, right);

        if (isEmpty(changes)) {
            this.log(this.style("dim", "No differences"));
            return;
        }
        for (const change of changes) {
            this.log(this.#format(change));
        }
        this.log(
            this.style(
                "dim",
                `\n${Text.pluralize(changes.length, "difference")}`
            )
        );
        this.exit(1);
    }

    #format(change: JsonChange): string {
        switch (change.kind) {
            case "added": {
                return this.style(
                    "green",
                    `+ ${change.path}: ${JSON.stringify(change.value)}`
                );
            }
            case "changed": {
                return this.style(
                    "yellow",
                    `~ ${change.path}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`
                );
            }
            case "removed": {
                return this.style(
                    "red",
                    `- ${change.path}: ${JSON.stringify(change.value)}`
                );
            }
        }
    }
}

// The JSON value in file, or from stdin or the clipboard when there's no file. Several values,
// like newline-delimited JSON, are read as an array of them.
async function readValue(file: string | undefined): Promise<unknown> {
    let values: unknown[];
    try {
        values = JsonPaths.parse(await Jq.readInput(file));
    } catch (error) {
        if (error instanceof JsonPathsError) {
            throw new JqError(
                file == null
                    ? error.message
                    : `${file} isn't JSON or newline-delimited JSON`
            );
        }
        throw error;
    }
    return values.length === 1 ? values[0] : values;
}
