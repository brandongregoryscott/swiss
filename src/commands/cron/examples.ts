import { Args } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { Cron } from "../../topics/cron/cron.js";

export default class CronExamples extends SwissCommand {
    static override args = {
        search: Args.string({
            description:
                "Only show examples whose description or pattern has all of these words, like 'weekday' or 'every month'",
        }),
    };

    static override description = `List common cron patterns to start from.

Each pattern is shown with what it does. To see when one runs next, or to check a pattern you've changed, use \`<%= config.bin %> cron\`.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "List every example",
        },
        {
            command: "<%= config.bin %> <%= command.id %> weekday",
            description: "Find patterns that run on weekdays",
        },
    ];

    // The search can span several words.
    static override strict = false;

    async run(): Promise<void> {
        const { argv } = await this.parse(CronExamples);
        const search = (argv as string[]).join(" ");
        const examples = Cron.searchExamples(search);
        if (isEmpty(examples)) {
            this.error(
                `No examples match ${search}; run \`${this.config.bin} cron examples\` to list them all`
            );
        }
        for (const line of Text.table(
            examples.map(({ description, pattern }) => [pattern, description])
        )) {
            this.log(line);
        }
    }
}
