import { Flags } from "@oclif/core";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenUuid extends GenCommand {
    static override description = `Generate UUIDs.

They're v4 (random) by default. v7 UUIDs start with the current time, so they sort in the order they were made, which makes them better database keys.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --v7 -n 5",
            description: "Generate 5 time-ordered UUIDs",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        upper: Flags.boolean({
            char: "u",
            description: "Use uppercase hex digits",
        }),
        v7: Flags.boolean({
            description: "Generate v7 UUIDs, which start with the current time",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenUuid);
        await this.generate(() => {
            const uuid = Generators.uuid(flags.v7 ? 7 : 4);
            return flags.upper ? uuid.toUpperCase() : uuid;
        }, flags);
    }
}
