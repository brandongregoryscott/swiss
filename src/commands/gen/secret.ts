import { Flags } from "@oclif/core";
import { GEN_FLAGS, GenCommand } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenSecret extends GenCommand {
    static override description = `Generate random secrets, like signing keys and API tokens.

They're random bytes from a cryptographically secure generator, encoded as hex or base64. 32 bytes (256 bits) suits most keys, like JWT and session secrets.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command:
                "<%= config.bin %> <%= command.id %> -b 64 -e base64url -c",
            description: "Generate a 64-byte URL-safe secret, and copy it",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        bytes: Flags.integer({
            char: "b",
            default: 32,
            description: "How many random bytes each secret has",
            min: 1,
        }),
        encoding: Flags.option({
            char: "e",
            default: "hex" as const,
            description: "How the bytes are encoded",
            options: Generators.SECRET_ENCODINGS,
        })(),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenSecret);
        await this.generate(
            () => Generators.secret(flags.bytes, flags.encoding),
            flags
        );
    }
}
