import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenSlug extends GenCommand {
    static override description = `Turn text into a slug, or generate a random one.

Slugs are lowercase ASCII words joined by hyphens, with accents stripped and apostrophes dropped, so "Café Owner's Guide" becomes cafe-owners-guide. Without any text, a random slug of words like brave-otter is generated instead.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> 'Hello, World!'",
            description: "Slugify text",
        },
        {
            command: "<%= config.bin %> <%= command.id %> -w 3 -n 5",
            description: "Generate 5 random three-word slugs",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        words: Flags.integer({
            char: "w",
            default: 2,
            description: "How many words random slugs have",
            min: 1,
        }),
    };

    // Unquoted text spans several words.
    static override strict = false;

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(GenSlug);
        const text = (argv as string[]).join(" ");
        if (isEmpty(text)) {
            await this.generate(
                () => Generators.randomSlug(flags.words),
                flags
            );
        } else {
            await this.generate(() => Generators.slugify(text), {
                ...flags,
                count: 1,
            });
        }
    }
}
