import { Args } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { Jq } from "../../topics/jq/jq.js";

export default class JqCommand extends SwissCommand {
    // oclif reads positional args in the order they're declared.
    /* eslint-disable perfectionist/sort-objects */
    static override args = {
        filter: Args.string({
            description: "The jq filter to run",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };
    /* eslint-enable perfectionist/sort-objects */

    static override description = `Run a jq filter over JSON, with jq built in so it doesn't need to be installed.

The input is read from FILE, from stdin when it's piped in, or otherwise from the clipboard. It can hold several JSON values, like newline-delimited JSON, and the filter runs on each of them unless --slurp collects them into one array.

To find the path to a field, use \`<%= config.bin %> jq paths\`. For common queries, like picking fields, filtering, counting, sorting or making a CSV, the other jq commands write the filter for you and show it.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> . data.json",
            description: "Pretty-print a file",
        },
        {
            command:
                "curl -s https://api.github.com/repos/jqlang/jq | <%= config.bin %> <%= command.id %> .stargazers_count",
            description: "Pull one field out of an API response",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> -r '.items[] | select(.active) | .name' data.json",
            description: "List the names of the active items, without quotes",
        },
    ];

    static override flags = JQ_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqCommand);

        const input = await Jq.readInput(args.file);
        const output = await Jq.run(input, args.filter, flags);
        if (output !== "") {
            this.log(output);
        }
    }
}
