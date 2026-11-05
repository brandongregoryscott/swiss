import { Args, Flags } from "@oclif/core";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenLorem extends GenCommand {
    static override args = {
        unit: Args.string({
            default: "paragraphs",
            description: "What to generate",
            // Otherwise oclif reads piped stdin as the argument.
            ignoreStdin: true,
            options: [...Generators.LOREM_UNITS],
        }),
    };

    static override description = `Generate lorem ipsum placeholder text.

Words and sentences run on in one line, and paragraphs are separated by blank lines.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> -n 3 -c",
            description: "Generate 3 paragraphs, and copy them",
        },
        {
            command: "<%= config.bin %> <%= command.id %> words -n 5",
            description: "Generate 5 words, like for a title",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        count: Flags.integer({
            char: "n",
            default: 1,
            description: "How many words, sentences or paragraphs to generate",
            min: 1,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(GenLorem);
        const unit = args.unit as (typeof Generators.LOREM_UNITS)[number];
        await this.generate(() => Generators.lorem(unit, flags.count), {
            ...flags,
            count: 1,
        });
    }
}
