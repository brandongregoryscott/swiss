import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { TableGrid } from "./grid.js";
import { MarkdownTable } from "./markdown-table.js";

// Not a TTY, so the lines come out without styles.
const stream = new PassThrough();

function render(grid: TableGrid, width = 80): string {
    return grid.render({ active: true, stream, width }).join("\n");
}

describe("TableGrid", () => {
    it("draws the table with box characters", () => {
        const grid = new TableGrid({
            alignments: ["none", "none"],
            rows: [
                ["Before", "After"],
                ["", ""],
            ],
        });

        expect(render(grid)).toBe(
            [
                "┌────────┬────────┐",
                "│ Before │ After  │",
                "├────────┼────────┤",
                "│        │        │",
                "└────────┴────────┘",
            ].join("\n")
        );
    });

    it("marks alignments with colons and aligns cells", () => {
        const grid = new TableGrid({
            alignments: ["left", "center", "right"],
            rows: [["a", "b", "c"]],
        });

        expect(render(grid).split("\n").slice(1, 3)).toEqual([
            "│ a      │   b    │      c │",
            "├:───────┼:──────:┼───────:┤",
        ]);
    });

    it("cuts columns short to fit, showing the end of the selected cell", () => {
        const grid = new TableGrid({
            alignments: ["none", "none"],
            rows: [["abcdefghijklmnop", "abcdefghijklmnop"]],
        });

        expect(render(grid, 27).split("\n")[1]).toBe(
            "│ …hijklmnop │ abcdefghi… │"
        );
    });

    it("shows new lines as ↵", () => {
        const grid = new TableGrid({
            alignments: ["none"],
            rows: [["a\nb"]],
        });

        expect(render(grid).split("\n")[1]).toBe("│ a↵b    │");
    });

    it("types into and erases from the selected cell", () => {
        const grid = new TableGrid(MarkdownTable.empty(2, 1));

        grid.type("Befor");
        grid.type("e!");
        grid.backspace();
        grid.next();
        grid.type("After");

        expect(grid.table.rows[0]).toEqual(["Before", "After"]);
    });

    it("moves with the arrows, stopping at the edges", () => {
        const grid = new TableGrid(MarkdownTable.empty(2, 1));

        grid.move(-1, -1);
        expect(grid.cursor).toEqual({ column: 0, row: 0 });
        grid.move(5, 5);
        expect(grid.cursor).toEqual({ column: 1, row: 1 });
    });

    it("adds a row when moving down or tabbing past the end", () => {
        const grid = new TableGrid(MarkdownTable.empty(2, 1));

        grid.down();
        grid.down();
        expect(grid.cursor).toEqual({ column: 0, row: 2 });
        expect(grid.table.rows).toHaveLength(3);

        grid.next();
        grid.next();
        expect(grid.cursor).toEqual({ column: 0, row: 3 });
        expect(grid.table.rows).toHaveLength(4);

        grid.previous();
        expect(grid.cursor).toEqual({ column: 1, row: 2 });
    });

    it("adds rows and columns after the cursor", () => {
        const grid = new TableGrid({
            alignments: ["none", "none"],
            rows: [
                ["a", "b"],
                ["1", "2"],
            ],
        });

        grid.addColumn();
        expect(grid.cursor).toEqual({ column: 1, row: 0 });
        grid.move(1, 0);
        grid.addRow();

        expect(grid.cursor).toEqual({ column: 1, row: 2 });
        expect(grid.table).toEqual({
            alignments: ["none", "none", "none"],
            rows: [
                ["a", "", "b"],
                ["1", "", "2"],
                ["", "", ""],
            ],
        });
    });

    it("deletes rows and columns, but not the header or the last column", () => {
        const grid = new TableGrid({
            alignments: ["none", "right"],
            rows: [
                ["a", "b"],
                ["1", "2"],
            ],
        });

        grid.deleteRow();
        expect(grid.table.rows).toHaveLength(2);

        grid.move(1, 1);
        grid.deleteRow();
        expect(grid.cursor).toEqual({ column: 1, row: 0 });
        grid.deleteColumn();
        grid.deleteColumn();

        expect(grid.cursor).toEqual({ column: 0, row: 0 });
        expect(grid.table).toEqual({ alignments: ["none"], rows: [["a"]] });
    });

    it("steps a column through the alignments", () => {
        const grid = new TableGrid(MarkdownTable.empty(1, 1));
        const seen = [];
        for (let step = 0; step < 4; step++) {
            grid.alignColumn();
            seen.push(grid.table.alignments[0]);
        }

        expect(seen).toEqual(["left", "center", "right", "none"]);
    });
});
