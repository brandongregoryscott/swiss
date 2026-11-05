import { Args, Flags } from "@oclif/core";
import { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { JqRecipeCommand } from "../../topics/jq/recipe-command.js";
import { JqRecipes } from "../../topics/jq/recipes.js";

export default class JqSort extends JqRecipeCommand {
    // oclif reads positional args in the order they're declared.

    static override args = {
        array: JQ_ARRAY_ARG,
        field: Args.string({
            description: "The field to sort by, like total",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };

    static override description = `Sort the elements of an array by a field.

Elements without the field come first (or last with --desc). The field is a dotted name, like customer.name, or a jq path starting with a dot. The filter it runs goes to stderr, so it can be reused with \`<%= config.bin %> jq\`.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> .orders total --desc orders.json",
            description: "Orders from largest to smallest",
        },
    ];

    static override flags = {
        ...JQ_FLAGS,
        desc: Flags.boolean({
            char: "d",
            description: "Sort from largest to smallest",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqSort);
        await this.runRecipe({
            array: args.array,
            file: args.file,
            filter: () => JqRecipes.sort(args.array, args.field, flags.desc),
            options: flags,
        });
    }
}
