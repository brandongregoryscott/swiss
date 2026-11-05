import { styleText } from "node:util";
import type { JqOptions } from "./jq.js";
import { SwissCommand } from "../../shared/command.js";
import { InputError } from "../../shared/input.js";
import { Jq, JqError } from "./jq.js";
import { JqRecipeError } from "./recipes.js";

type RecipeRun = {
    // The ARRAY argument, to point at it when the filter fails because it isn't an array.
    array: string;
    file: string | undefined;
    // Builds the filter, throwing JqRecipeError for arguments that don't make sense.
    filter: () => string;
    options: JqOptions;
};

// A command that runs a filter built from its arguments, printing the filter to stderr so it can
// be reused with `jq` and the output can still be piped.
abstract class JqRecipeCommand extends SwissCommand {
    protected async runRecipe(recipe: RecipeRun): Promise<void> {
        try {
            const filter = recipe.filter();
            const input = await Jq.readInput(recipe.file);
            this.logToStderr(
                `${styleText("dim", "jq:", { stream: process.stderr })} ${filter}`
            );
            const output = await Jq.run(input, filter, recipe.options);
            if (output !== "") {
                this.log(output);
            }
        } catch (error) {
            if (error instanceof JqError) {
                this.error(
                    /Cannot iterate over|Cannot index (object|string|number) with/.test(
                        error.message
                    )
                        ? `${error.message}\n${recipe.array} may not be an array; find the arrays in the input with \`${this.config.bin} jq paths\``
                        : error.message
                );
            }
            if (error instanceof InputError || error instanceof JqRecipeError) {
                this.error(error.message);
            }
            throw error;
        }
    }
}

export type { RecipeRun };
export { JqRecipeCommand };
