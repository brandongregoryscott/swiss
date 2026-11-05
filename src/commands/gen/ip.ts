import { Flags } from "@oclif/core";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenIp extends GenCommand {
    static override description = `Generate IP addresses.

They're random IPv4 addresses by default. --network picks from a well-known range, like private for 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16, and --cidr from a block of your own.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command:
                "<%= config.bin %> <%= command.id %> --network private -n 3",
            description: "Generate 3 private addresses",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --cidr 10.20.0.0/16",
            description: "Generate an address in a VPC's block",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --v6",
            description: "Generate an IPv6 address",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        cidr: Flags.string({
            description: "IPv4 block to pick from, like 10.0.0.0/16",
            exclusive: ["network"],
        }),
        network: Flags.option({
            description: "Well-known IPv4 range to pick from",
            options: Generators.IP_NETWORKS,
        })(),
        v6: Flags.boolean({
            description: "Generate IPv6 addresses",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenIp);
        await this.generate(() => Generators.ip(flags), flags);
    }
}
