import { styleText } from "node:util";
import type { Style } from "../../shared/text.js";
import type { Alignment, Table } from "./markdown-table.js";
import { MarkdownTable } from "./markdown-table.js";

type Position = { column: number; row: number };

type RenderOptions = {
    // Whether the grid is being edited, which highlights the selected cell.
    active: boolean;
    // Styles are left out when this stream doesn't support them.
    stream: NodeJS.WritableStream;
    // The widest a line can be.
    width: number;
};

// Aligning a column steps through these.
const NEXT_ALIGNMENT: Record<Alignment, Alignment> = {
    center: "right",
    left: "center",
    none: "left",
    right: "none",
};

// Columns are drawn at least this wide, so empty cells are easy to see and select.
const MIN_CELL_WIDTH = 6;

// A table being edited a cell at a time, with the cursor on one cell.
class TableGrid {
    cursor: Position = { column: 0, row: 0 };
    #table: Table;

    constructor(table: Table) {
        this.#table = MarkdownTable.normalize(table);
    }

    get table(): Table {
        return this.#table;
    }

    // Adds a column after the cursor's and moves to its header.
    addColumn(): void {
        const column = this.cursor.column + 1;
        this.#table.alignments.splice(column, 0, "none");
        for (const row of this.#table.rows) {
            row.splice(column, 0, "");
        }
        this.cursor = { column, row: 0 };
    }

    // Adds a row after the cursor's and moves down to it.
    addRow(): void {
        const row = this.cursor.row + 1;
        this.#table.rows.splice(
            row,
            0,
            this.#table.alignments.map(() => "")
        );
        this.cursor = { ...this.cursor, row };
    }

    alignColumn(): void {
        const { alignments } = this.#table;
        alignments[this.cursor.column] =
            NEXT_ALIGNMENT[alignments[this.cursor.column]!];
    }

    backspace(): void {
        this.#setCell(Array.from(this.#cell()).slice(0, -1).join(""));
    }

    // Deletes the cursor's column, unless it's the only one.
    deleteColumn(): void {
        if (this.#table.alignments.length === 1) {
            return;
        }
        this.#table.alignments.splice(this.cursor.column, 1);
        for (const row of this.#table.rows) {
            row.splice(this.cursor.column, 1);
        }
        this.move(0, 0);
    }

    // Deletes the cursor's row, unless it's the header.
    deleteRow(): void {
        if (this.cursor.row === 0) {
            return;
        }
        this.#table.rows.splice(this.cursor.row, 1);
        this.move(0, 0);
    }

    // Moves down a row, adding one after the last.
    down(): void {
        if (this.cursor.row === this.#table.rows.length - 1) {
            this.addRow();
        } else {
            this.move(1, 0);
        }
    }

    // Moves the cursor by rows and columns, stopping at the edges.
    move(rows: number, columns: number): void {
        this.cursor = {
            column: clamp(
                this.cursor.column + columns,
                this.#table.alignments.length - 1
            ),
            row: clamp(this.cursor.row + rows, this.#table.rows.length - 1),
        };
    }

    // Moves to the next cell, wrapping onto the next row and adding one after the last cell.
    next(): void {
        if (this.cursor.column < this.#table.alignments.length - 1) {
            this.move(0, 1);
            return;
        }
        this.down();
        this.cursor = { ...this.cursor, column: 0 };
    }

    // Moves to the previous cell, wrapping onto the row above.
    previous(): void {
        if (this.cursor.column > 0) {
            this.move(0, -1);
        } else if (this.cursor.row > 0) {
            this.cursor = {
                column: this.#table.alignments.length - 1,
                row: this.cursor.row - 1,
            };
        }
    }

    // Lines of the grid drawn with box characters, with the header in bold and the alignment of
    // each column marked with colons like in markdown. Columns are cut short to fit in width.
    render(options: RenderOptions): string[] {
        const { alignments, rows } = this.#table;
        const style = (format: Style, text: string): string =>
            styleText(format, text, { stream: options.stream });
        const texts = rows.map((row) =>
            row.map((cell) => cell.replace(/\n/g, "↵"))
        );

        // Each cell has a space either side and a border before it, plus the closing border.
        const available = options.width - alignments.length * 3 - 1;
        const widest = Math.max(3, Math.floor(available / alignments.length));
        const widths = alignments.map((_, column) =>
            Math.min(
                widest,
                Math.max(
                    MIN_CELL_WIDTH,
                    ...texts.map((row) => [...row[column]!].length)
                )
            )
        );

        const border = (left: string, middle: string, right: string) =>
            style(
                "gray",
                `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`
            );
        const delimiter = style(
            "gray",
            `├${alignments
                .map((alignment, column) => {
                    const dashes = "─".repeat(widths[column]!);
                    const left = alignment === "left" || alignment === "center";
                    const right =
                        alignment === "right" || alignment === "center";
                    return `${left ? ":" : "─"}${dashes}${right ? ":" : "─"}`;
                })
                .join("┼")}┤`
        );
        const bar = style("gray", "│");

        const lines = texts.map((row, rowIndex) => {
            const cells = row.map((text, column) => {
                const selected =
                    options.active &&
                    rowIndex === this.cursor.row &&
                    column === this.cursor.column;
                const content = ` ${align(
                    // The selected cell shows its end, where typing goes.
                    selected
                        ? truncateStart(text, widths[column]!)
                        : truncateEnd(text, widths[column]!),
                    widths[column]!,
                    alignments[column]!
                )} `;
                if (selected) {
                    return style("inverse", content);
                }
                return rowIndex === 0 ? style("bold", content) : content;
            });
            return `${bar}${cells.join(bar)}${bar}`;
        });

        return [
            border("┌", "┬", "┐"),
            lines[0]!,
            delimiter,
            ...lines.slice(1),
            border("└", "┴", "┘"),
        ];
    }

    // Adds text to the end of the cursor's cell.
    type(text: string): void {
        this.#setCell(`${this.#cell()}${text}`);
    }

    #cell(): string {
        return this.#table.rows[this.cursor.row]![this.cursor.column]!;
    }

    #setCell(value: string): void {
        this.#table.rows[this.cursor.row]![this.cursor.column] = value;
    }
}

function align(text: string, width: number, alignment: Alignment): string {
    const padding = width - [...text].length;
    switch (alignment) {
        case "center": {
            const left = Math.floor(padding / 2);
            return `${" ".repeat(left)}${text}${" ".repeat(padding - left)}`;
        }

        case "right": {
            return `${" ".repeat(padding)}${text}`;
        }

        default: {
            return `${text}${" ".repeat(padding)}`;
        }
    }
}

function clamp(value: number, max: number): number {
    return Math.min(Math.max(value, 0), max);
}

function truncateEnd(text: string, width: number): string {
    const chars = [...text];
    return chars.length > width
        ? `${chars.slice(0, width - 1).join("")}…`
        : text;
}

function truncateStart(text: string, width: number): string {
    const chars = [...text];
    return chars.length > width
        ? `…${chars.slice(-(width - 1)).join("")}`
        : text;
}

export type { Position, RenderOptions };
export { TableGrid };
