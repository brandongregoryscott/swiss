import { Prompt } from "@clack/core";
import { isCancel, S_BAR, S_BAR_END, symbol } from "@clack/prompts";
import { styleText } from "node:util";
import type { Style } from "../../shared/text.js";
import type { Table } from "./markdown-table.js";
import { TableGrid } from "./grid.js";
import { TableKeys } from "./keys.js";

type TablePromptOptions = {
    message: string;
    output: NodeJS.WriteStream;
    table: Table;
};

// Turns bracketed paste on and off, so a newline in pasted text goes into the cell instead of
// moving down a row.
const PASTE_ON = "\u001B[?2004h";
const PASTE_OFF = "\u001B[?2004l";

// A clack prompt for filling out a table in a grid, in the style of @clack/prompts.
class TablePrompt extends Prompt<Table> {
    readonly #keys: TableKeys;
    readonly grid: TableGrid;
    readonly message: string;
    readonly stream: NodeJS.WriteStream;

    constructor(options: TablePromptOptions) {
        super(
            {
                output: options.output,
                render() {
                    return renderFrame(this as unknown as TablePrompt);
                },
            },
            false
        );
        this.grid = new TableGrid(options.table);
        this.#keys = new TableKeys(this.grid);
        this.message = options.message;
        this.stream = options.output;
        this.on("key", (char, key) => {
            // clack finishes the prompt after this key's handlers when the state is submit or
            // cancel.
            switch (this.#keys.press(char, key)) {
                case "cancel": {
                    this.state = "cancel";
                    return;
                }

                case "submit": {
                    this.value = this.grid.table;
                    this.state = "submit";
                    return;
                }
            }
        });
    }

    // Resolves to the finished table, or to null when it's canceled with Escape or Ctrl+C.
    static async edit(options: TablePromptOptions): Promise<null | Table> {
        options.output.write(PASTE_ON);
        try {
            const table = await new TablePrompt(options).prompt();
            return isCancel(table) || table == null ? null : table;
        } finally {
            options.output.write(PASTE_OFF);
        }
    }

    // Enter moves down a row instead of submitting; Ctrl+S submits.
    protected override _shouldSubmit(): boolean {
        return false;
    }
}

function renderFrame(prompt: TablePrompt): string {
    const { stream } = prompt;
    const style = (format: Style, text: string): string =>
        styleText(format, text, { stream });
    const title = `${style("gray", S_BAR)}\n${symbol(prompt.state)}  ${prompt.message}\n`;
    const columns = stream.columns ?? 80;

    switch (prompt.state) {
        case "cancel": {
            return `${title}${style("gray", S_BAR)}  ${style(["strikethrough", "dim"], "Nothing copied")}\n`;
        }

        case "submit": {
            const lines = prompt.grid.render({
                active: false,
                stream,
                width: columns - 3,
            });
            return `${title}${lines.map((line) => `${style("gray", S_BAR)}  ${line}`).join("\n")}\n`;
        }

        default: {
            const bar = style("cyan", S_BAR);
            const lines = [
                ...prompt.grid.render({
                    active: true,
                    stream,
                    width: columns - 3,
                }),
                "",
                ...TableKeys.HINTS.map((hint) => style("dim", hint)),
            ];
            return `${title}${lines.map((line) => `${bar}  ${line}`).join("\n")}\n${style("cyan", S_BAR_END)}\n`;
        }
    }
}

export type { TablePromptOptions };
export { TablePrompt };
