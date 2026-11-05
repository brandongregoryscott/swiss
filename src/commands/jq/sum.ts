import { Args } from "@oclif/core";
import { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { JqRecipeCommand } from "../../topics/jq/recipe-command.js";
import { JqRecipes } from "../../topics/jq/recipes.js";

export default class JqSum extends JqRecipeCommand {
    // oclif reads positional args in the order they're declared.

    static override args = {
        array: JQ_ARRAY_ARG,
        field: Args.string({
            description: "The number field to add up, like total",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };

    static override description = `Add up a field across the elements of an array.

Elements without the field are skipped. The field is a dotted name, like price.amount, or a jq path starting with a dot. The filter it runs goes to stderr, so it can be reused with \`<%= config.bin %> jq\`.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> .orders total orders.json",
            description: "The total of every order",
        },
    ];

    static override flags = JQ_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqSum);
        await this.runRecipe({
            array: args.array,
            file: args.file,
            filter: () => JqRecipes.sum(args.array, args.field),
            options: flags,
        });
    }
}
