import { Flags } from "@oclif/core";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenMac extends GenCommand {
    static override description = `Generate MAC addresses.

--local makes locally administered unicast addresses, like the ones VMs and containers get, which can't clash with a real network card's.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --local -f dash -u",
            description:
                "Generate a locally administered address like 02-1A-2B-3C-4D-5E",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        format: Flags.option({
            char: "f",
            default: "colon" as const,
            description:
                "How the digits are separated: colon 00:1a:2b:3c:4d:5e, dash 00-1a-2b-3c-4d-5e, dot (Cisco) 001a.2b3c.4d5e, or none",
            options: Generators.MAC_FORMATS,
        })(),
        local: Flags.boolean({
            char: "l",
            description: "Generate locally administered unicast addresses",
        }),
        upper: Flags.boolean({
            char: "u",
            description: "Use uppercase hex digits",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenMac);
        await this.generate(() => Generators.mac(flags), flags);
    }
}
