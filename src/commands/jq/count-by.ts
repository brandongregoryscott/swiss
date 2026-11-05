import { Args } from "@oclif/core";
import { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { JqRecipeCommand } from "../../topics/jq/recipe-command.js";
import { JqRecipes } from "../../topics/jq/recipes.js";

export default class JqCountBy extends JqRecipeCommand {
    // oclif reads positional args in the order they're declared.

    static override args = {
        array: JQ_ARRAY_ARG,
        field: Args.string({
            description: "The field to group by, like status",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };

    static override description = `Count the elements of an array by the value of a field, most common first.

The field is a dotted name, like customer.name, or a jq path starting with a dot. The filter it runs goes to stderr, so it can be reused with \`<%= config.bin %> jq\`.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> .orders status orders.json",
            description: "How many orders have each status",
        },
    ];

    static override flags = JQ_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqCountBy);
        await this.runRecipe({
            array: args.array,
            file: args.file,
            filter: () => JqRecipes.countBy(args.array, args.field),
            options: flags,
        });
    }
}
