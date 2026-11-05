import { Args } from "@oclif/core";
import { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { JqRecipeCommand } from "../../topics/jq/recipe-command.js";
import { JqRecipes } from "../../topics/jq/recipes.js";

export default class JqWhere extends JqRecipeCommand {
    // oclif reads positional args in the order they're declared.

    static override args = {
        array: JQ_ARRAY_ARG,
        condition: Args.string({
            description:
                "A jq condition on each element, like '.total > 20' or '.status == \"shipped\"'",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };

    static override description = `Keep the elements of an array that match a condition.

The condition is jq, run on each element, so fields start with a dot. Combine conditions with and, or and not, and match text with test("regex").

The filter it runs goes to stderr, so it can be reused with \`<%= config.bin %> jq\`.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> .orders '.total > 20' orders.json",
            description: "Orders over 20",
        },
        {
            command:
                '<%= config.bin %> <%= command.id %> .orders \'.status == "shipped" and (.customer.email | test("@x.io$"))\' orders.json',
            description: "Combine conditions",
        },
    ];

    static override flags = JQ_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqWhere);
        await this.runRecipe({
            array: args.array,
            file: args.file,
            filter: () => JqRecipes.where(args.array, args.condition),
            options: flags,
        });
    }
}
