import { Args } from "@oclif/core";
import { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { JqRecipeCommand } from "../../topics/jq/recipe-command.js";
import { JqRecipes } from "../../topics/jq/recipes.js";

export default class JqUniq extends JqRecipeCommand {
    // oclif reads positional args in the order they're declared.

    static override args = {
        array: JQ_ARRAY_ARG,
        field: Args.string({
            description: "The field to list the values of, like customer.name",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };

    static override description = `List the distinct values of a field across the elements of an array, sorted.

The field is a dotted name, like customer.name, or a jq path starting with a dot. The filter it runs goes to stderr, so it can be reused with \`<%= config.bin %> jq\`.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> .orders customer.name orders.json",
            description: "Every customer who placed an order",
        },
    ];

    static override flags = JQ_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqUniq);
        await this.runRecipe({
            array: args.array,
            file: args.file,
            filter: () => JqRecipes.uniq(args.array, args.field),
            options: flags,
        });
    }
}
