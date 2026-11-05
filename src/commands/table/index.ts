import { Args, Flags } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { Input } from "../../shared/input.js";
import { MarkdownTable } from "../../topics/table/markdown-table.js";
import { TablePrompt } from "../../topics/table/prompt.js";

export default class Table extends SwissCommand {
    static override args = {
        file: Args.string({
            description:
                "Markdown, CSV or TSV file to start from [default: an empty table]",
        }),
    };

    static override description = `Fill out a markdown table in the terminal, for pasting into GitHub.

Move between cells with the arrow keys and Tab, and type to fill them in. Enter moves down a row, adding one at the end. Ctrl+N and Ctrl+T add a row and a column, Ctrl+X and Ctrl+K delete them, and Ctrl+A steps the column through left, center and right alignment.

Press Ctrl+S when you're done, and the markdown is printed and copied to the clipboard, or Escape to quit without it. Columns are padded to line up, pipes in cells are escaped and new lines become <br>. Empty cells are kept, so they can be placeholders for images you paste in on GitHub.

Start from an existing table by passing a file or using --paste. The first markdown table in it is used, so a whole PR description works, and otherwise it's read as TSV when it has tabs or as CSV. Needs an interactive terminal.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description:
                "Fill out a table with 2 columns and a row, like before and after screenshots",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --paste",
            description: "Edit the table on the clipboard",
        },
        {
            command: "<%= config.bin %> <%= command.id %> results.csv",
            description: "Start from a CSV file",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> --columns 4 --rows 6 --no-copy > table.md",
            description: "Start from a bigger empty table, and save the result",
        },
    ];

    static override flags = {
        columns: Flags.integer({
            default: 2,
            description: "Columns in an empty table",
            max: 50,
            min: 1,
        }),
        copy: Flags.boolean({
            allowNo: true,
            default: true,
            description: "Copy the markdown to the clipboard when you finish",
        }),
        paste: Flags.boolean({
            char: "p",
            description: "Start from the table on the clipboard",
        }),
        rows: Flags.integer({
            default: 1,
            description: "Rows under the header in an empty table",
            max: 500,
            min: 1,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Table);
        if (args.file != null && flags.paste) {
            this.error("Pass a file or --paste, not both");
        }
        this.terminal.requireInteractive();

        const input = await this.#readInput(args.file, flags.paste);
        const table =
            input == null
                ? MarkdownTable.empty(flags.columns, flags.rows)
                : MarkdownTable.parse(input);

        // The grid is drawn on stderr, so the markdown can be redirected to a file.
        const edited = await TablePrompt.edit({
            message: "Fill out the table",
            output: process.stderr,
            table,
        });
        if (edited == null) {
            return;
        }
        if (MarkdownTable.isEmpty(edited)) {
            this.logToStderr("The table is empty, so there's nothing to copy");
            return;
        }

        const markdown = MarkdownTable.format(edited);
        this.log(markdown);
        if (flags.copy) {
            await this.copy(markdown, "the markdown");
        }
    }

    // The text of the table to start from, or null for an empty table.
    async #readInput(
        file: string | undefined,
        paste: boolean
    ): Promise<null | string> {
        if (file != null) {
            return (await Input.file(file)).toString("utf8");
        }
        return paste
            ? (await Input.clipboard("a file")).toString("utf8")
            : null;
    }
}
