import { Args } from "@oclif/core";
import { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { JqRecipeCommand } from "../../topics/jq/recipe-command.js";
import { JqRecipes } from "../../topics/jq/recipes.js";

export default class JqPluck extends JqRecipeCommand {
    // oclif reads positional args in the order they're declared.

    static override args = {
        array: JQ_ARRAY_ARG,
        fields: Args.string({
            description:
                "Comma-separated fields to keep, like name,customer.email",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };

    static override description = `Keep only some fields of each element of an array.

With one field, the result is an array of its values. With several, it's an array of objects with just those fields, each named after the last part of its path, like email for customer.email.

Fields are dotted names, like customer.email, or jq paths starting with a dot, like .items[0].sku. The filter it runs goes to stderr, so it can be reused with \`<%= config.bin %> jq\`.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> .orders id,customer.email orders.json",
            description: "Each order's ID and customer email",
        },
        {
            command: "<%= config.bin %> <%= command.id %> . name -r users.json",
            description: "Every name in an array of users, one per line",
        },
    ];

    static override flags = JQ_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqPluck);
        await this.runRecipe({
            array: args.array,
            file: args.file,
            filter: () =>
                JqRecipes.pluck(args.array, JqRecipes.parseFields(args.fields)),
            options: flags,
        });
    }
}
