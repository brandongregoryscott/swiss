import { isEmpty, times } from "lodash-es";
import { UserError } from "../../shared/errors.js";

type Alignment = "center" | "left" | "none" | "right";

type Table = {
    // One for each column.
    alignments: Alignment[];
    // The header row first.
    rows: string[][];
};

// GitHub needs at least 3 dashes in each cell of the delimiter row.
const MIN_WIDTH = 3;

const DELIMITER_ROW = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

class MarkdownTableError extends UserError {}

class MarkdownTable {
    // A table with columns columns, and rows rows under the header.
    static empty(columns: number, rows: number): Table {
        return {
            alignments: times(columns, () => "none"),
            rows: times(rows + 1, () => times(columns, () => "")),
        };
    }

    // GitHub-flavored markdown for a table, with its columns padded to line up. Empty cells are
    // kept, as placeholders to fill in on GitHub.
    static format(table: Table): string {
        const { alignments, rows } = MarkdownTable.normalize(table);
        const cells = rows.map((row) => row.map(escapeCell));
        const widths = alignments.map((_, column) =>
            Math.max(MIN_WIDTH, ...cells.map((row) => row[column]!.length))
        );
        const lines = cells.map((row) =>
            formatRow(
                row.map((cell, column) =>
                    pad(cell, widths[column]!, alignments[column]!)
                )
            )
        );
        lines.splice(
            1,
            0,
            formatRow(
                alignments.map((alignment, column) =>
                    delimiter(alignment, widths[column]!)
                )
            )
        );
        return lines.join("\n");
    }

    static isEmpty(table: Table): boolean {
        return table.rows.every((row) => row.every((cell) => cell === ""));
    }

    // Gives every row a cell for each column, and every column an alignment, with at least a
    // header row and one column.
    static normalize(table: Table): Table {
        const columns = Math.max(
            1,
            table.alignments.length,
            ...table.rows.map((row) => row.length)
        );
        const rows = isEmpty(table.rows) ? [[]] : table.rows;
        return {
            alignments: Array.from(
                { length: columns },
                (_, column) => table.alignments[column] ?? "none"
            ),
            rows: rows.map((row) =>
                Array.from(
                    { length: columns },
                    (_, column) => row[column] ?? ""
                )
            ),
        };
    }

    // Reads the first markdown table in text, so a whole PR description can be pasted, or
    // otherwise reads text as TSV when it has tabs, like cells copied from a spreadsheet, or as
    // CSV.
    static parse(text: string): Table {
        const normalized = text.replace(/\r\n?/g, "\n");
        if (normalized.trim() === "") {
            throw new MarkdownTableError("There's no table in the input");
        }
        const table =
            parseMarkdown(normalized) ??
            parseDelimited(normalized, normalized.includes("\t") ? "\t" : ",");
        return MarkdownTable.normalize(table);
    }
}

function alignmentOf(cell: string): Alignment {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(":");
    const right = trimmed.endsWith(":");
    if (left && right) {
        return "center";
    }
    if (right) {
        return "right";
    }
    return left ? "left" : "none";
}

function delimiter(alignment: Alignment, width: number): string {
    switch (alignment) {
        case "center": {
            return `:${"-".repeat(width - 2)}:`;
        }

        case "left": {
            return `:${"-".repeat(width - 1)}`;
        }

        case "none": {
            return "-".repeat(width);
        }

        case "right": {
            return `${"-".repeat(width - 1)}:`;
        }
    }
}

// Pipes would end the cell and newlines the row, so they're escaped and turned into <br>.
function escapeCell(cell: string): string {
    return cell.trim().replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function formatRow(cells: string[]): string {
    return `| ${cells.join(" | ")} |`;
}

function pad(cell: string, width: number, alignment: Alignment): string {
    switch (alignment) {
        case "center": {
            const left = Math.floor((width - cell.length) / 2);
            return cell.padStart(cell.length + left).padEnd(width);
        }

        case "right": {
            return cell.padStart(width);
        }

        default: {
            return cell.padEnd(width);
        }
    }
}

// Splits CSV or TSV into rows, following its quoting, so quoted cells can hold the delimiter,
// newlines and "" for a quote.
function parseDelimited(text: string, separator: string): Table {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index]!;
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') {
                cell += '"';
                index++;
            } else if (char === '"') {
                quoted = false;
            } else {
                cell += char;
            }
        } else if (char === '"' && cell === "") {
            quoted = true;
        } else if (char === separator) {
            row.push(cell);
            cell = "";
        } else if (char === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }
    row.push(cell);
    rows.push(row);
    return {
        alignments: [],
        rows: rows
            .filter((cells) => cells.some((value) => value.trim() !== ""))
            .map((cells) => cells.map((value) => value.trim())),
    };
}

// The first markdown table in text, which is a row with pipes followed by a delimiter row, and
// the rows with pipes after it. Null when there isn't one.
function parseMarkdown(text: string): null | Table {
    const lines = text.split("\n").map((line) => line.trim());
    const start = lines.findIndex(
        (line, index) =>
            line.includes("|") &&
            index + 1 < lines.length &&
            DELIMITER_ROW.test(lines[index + 1]!)
    );
    if (start === -1) {
        return null;
    }
    const body: string[] = [];
    for (const line of lines.slice(start + 2)) {
        if (!line.includes("|")) {
            break;
        }
        body.push(line);
    }
    return {
        alignments: splitRow(lines[start + 1]!).map(alignmentOf),
        rows: [lines[start]!, ...body].map((line) =>
            splitRow(line).map(unescapeCell)
        ),
    };
}

function splitRow(line: string): string[] {
    let row = line.trim();
    if (row.startsWith("|")) {
        row = row.slice(1);
    }
    if (row.endsWith("|") && !row.endsWith("\\|")) {
        row = row.slice(0, -1);
    }
    return row.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function unescapeCell(cell: string): string {
    return cell.replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, "\n");
}

export type { Alignment, Table };
export { MarkdownTable, MarkdownTableError };
