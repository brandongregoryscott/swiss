import { faker } from "@faker-js/faker";
import { Flags } from "@oclif/core";
import { times } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";

type GenOptions = {
    copy: boolean;
    count: number;
    seed?: number;
};

// Flags shared by the gen commands.
const GEN_FLAGS = {
    copy: Flags.boolean({
        char: "c",
        description: "Also copy the result to the clipboard",
    }),
    count: Flags.integer({
        char: "n",
        default: 1,
        description: "How many to generate, one per line",
        min: 1,
    }),
};

// For the commands that use faker, whose output isn't random enough for secrets but can be
// repeated.
const SEED_FLAG = {
    seed: Flags.integer({
        description:
            "Seed the generator so the same seed gives the same output",
    }),
};

// A command that prints values made by a generator, one per line, and can copy them.
abstract class GenCommand extends SwissCommand {
    protected async generate(
        generator: () => string,
        options: GenOptions
    ): Promise<void> {
        if (options.seed != null) {
            faker.seed(options.seed);
        }

        const values = times(options.count, () => generator());
        for (const value of values) {
            this.log(value);
        }

        if (options.copy) {
            await this.copy(values.join("\n"));
        }
    }
}

export type { GenOptions };
export { GEN_FLAGS, GenCommand, SEED_FLAG };
