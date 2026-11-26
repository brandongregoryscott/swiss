import { Args } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { SshExamples } from "../../topics/ssh/examples.js";

export default class SshExamplesCommand extends SwissCommand {
    static override args = {
        search: Args.string({
            description:
                "Only show examples whose command or description has all of these words, like 'forward' or 'known_hosts'",
        }),
    };

    static override description = `List ssh commands worth remembering: port forwarding, jump hosts, agent forwarding, keys, copying files and debugging connections.

To forward ports without remembering the flags, use \`<%= config.bin %> ssh forward\`.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "List every example",
        },
        {
            command: "<%= config.bin %> <%= command.id %> forward",
            description: "Find the port forwarding commands",
        },
    ];

    static override strict = false;

    async run(): Promise<void> {
        const { argv } = await this.parse(SshExamplesCommand);
        const search = (argv as string[]).join(" ");
        const examples = SshExamples.search(search);
        if (isEmpty(examples)) {
            this.error(
                `No examples match ${search}; run \`${this.config.bin} ssh examples\` to list them all`
            );
        }
        for (const line of Text.table(
            examples.map(({ command, description }) => [command, description])
        )) {
            this.log(line);
        }
    }
}
