import { Args, Flags } from "@oclif/core";
import { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS } from "../../topics/jq/flags.js";
import { JqRecipeCommand } from "../../topics/jq/recipe-command.js";
import { JqRecipes } from "../../topics/jq/recipes.js";

export default class JqCsv extends JqRecipeCommand {
    // oclif reads positional args in the order they're declared.

    static override args = {
        array: JQ_ARRAY_ARG,
        fields: Args.string({
            description:
                "Comma-separated fields, one per column, like id,customer.name",
            required: true,
        }),
        file: JQ_FILE_ARG,
    };

    static override description = `Turn an array into CSV, with a row per element and a column per field.

Fields are dotted names, like customer.email, or jq paths starting with a dot, like .items[0].sku. Values that are objects or arrays can't go in a CSV, so pick the fields inside them instead.

The filter it runs goes to stderr, so it can be reused with \`<%= config.bin %> jq -r\`.`;

    static override examples = [
        {
            command:
                "<%= config.bin %> <%= command.id %> .orders id,customer.name,total --header orders.json > orders.csv",
            description: "Write a CSV file with a header row",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> . name,email --tsv users.json",
            description: "Tab-separated, for pasting into a spreadsheet",
        },
    ];

    static override flags = {
        header: Flags.boolean({
            char: "H",
            description: "Start with a row of the field names",
        }),
        slurp: JQ_FLAGS.slurp,
        tsv: Flags.boolean({
            char: "t",
            description: "Separate columns with tabs instead of commas",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JqCsv);
        await this.runRecipe({
            array: args.array,
            file: args.file,
            filter: () =>
                JqRecipes.csv(args.array, JqRecipes.parseFields(args.fields), {
                    header: flags.header,
                    tsv: flags.tsv,
                }),
            options: { raw: true, slurp: flags.slurp },
        });
    }
}
