import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenHash extends GenCommand {
    static override description = `Hash text, or generate random hashes.

With text, it's hashed with the algorithm. Without, random hex the length of the algorithm's digest is generated instead, like a stand-in commit SHA or checksum. --short cuts either to 7 characters, like git's short SHAs.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> 'hello world'",
            description: "Hash text with SHA-256",
        },
        {
            command: "<%= config.bin %> <%= command.id %> -a sha1 --short -n 3",
            description: "Generate 3 short commit SHAs",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        algorithm: Flags.option({
            char: "a",
            default: "sha256" as const,
            description: "Hash algorithm",
            options: Generators.HASH_ALGORITHMS,
        })(),
        short: Flags.boolean({
            char: "s",
            description: "Cut hashes to 7 characters, like git's short SHAs",
        }),
    };

    // Unquoted text spans several words.
    static override strict = false;

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(GenHash);
        const text = (argv as string[]).join(" ");
        const generator = () => {
            const hash = Generators.hash(
                flags.algorithm,
                isEmpty(text) ? undefined : text
            );
            return flags.short ? hash.slice(0, 7) : hash;
        };
        await this.generate(
            generator,
            isEmpty(text) ? flags : { ...flags, count: 1 }
        );
    }
}
