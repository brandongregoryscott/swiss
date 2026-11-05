import { describe, expect, it } from "vitest";
import { MarkdownTable, MarkdownTableError } from "./markdown-table.js";

describe("MarkdownTable", () => {
    describe("format", () => {
        it("pads columns to line up, with at least 3 dashes", () => {
            expect(
                MarkdownTable.format({
                    alignments: ["none", "none"],
                    rows: [
                        ["Name", "Cost"],
                        ["t3.micro", "$7"],
                    ],
                })
            ).toBe(
                [
                    "| Name     | Cost |",
                    "| -------- | ---- |",
                    "| t3.micro | $7   |",
                ].join("\n")
            );
        });

        it("aligns cells and marks the delimiter row", () => {
            expect(
                MarkdownTable.format({
                    alignments: ["left", "center", "right"],
                    rows: [
                        ["a", "b", "c"],
                        ["left", "center", "right"],
                    ],
                })
            ).toBe(
                [
                    "| a    |   b    |     c |",
                    "| :--- | :----: | ----: |",
                    "| left | center | right |",
                ].join("\n")
            );
        });

        it("escapes pipes and turns new lines into <br>", () => {
            expect(
                MarkdownTable.format({
                    alignments: ["none"],
                    rows: [["Value"], ["a | b\nc"]],
                })
            ).toBe(
                ["| Value       |", "| ----------- |", "| a \\| b<br>c |"].join(
                    "\n"
                )
            );
        });

        it("keeps empty cells as placeholders", () => {
            expect(MarkdownTable.format(MarkdownTable.empty(2, 1))).toBe(
                ["|     |     |", "| --- | --- |", "|     |     |"].join("\n")
            );
        });
    });

    describe("parse", () => {
        it("reads the first markdown table in text", () => {
            const text = [
                "## Costs",
                "",
                "| Name | Cost |",
                "| :--- | ---: |",
                "| a \\| b | 1<br>2 |",
                "| short |",
                "",
                "Thanks!",
            ].join("\n");

            expect(MarkdownTable.parse(text)).toEqual({
                alignments: ["left", "right"],
                rows: [
                    ["Name", "Cost"],
                    ["a | b", "1\n2"],
                    ["short", ""],
                ],
            });
        });

        it("reads tables without outer pipes", () => {
            expect(MarkdownTable.parse("a | b\n--|:-:\n1 | 2")).toEqual({
                alignments: ["none", "center"],
                rows: [
                    ["a", "b"],
                    ["1", "2"],
                ],
            });
        });

        it("round-trips through format", () => {
            const table = {
                alignments: ["center", "none"] as const,
                rows: [
                    ["x", "y"],
                    ["a | b", "line\nbreak"],
                ],
            };

            expect(
                MarkdownTable.parse(
                    MarkdownTable.format({
                        ...table,
                        alignments: [...table.alignments],
                    })
                )
            ).toEqual({ ...table, alignments: [...table.alignments] });
        });

        it("reads TSV when there are tabs, with spreadsheet quoting", () => {
            expect(
                MarkdownTable.parse('a\tb\n1\t"two\nlines"\n3\t4\n')
            ).toEqual({
                alignments: ["none", "none"],
                rows: [
                    ["a", "b"],
                    ["1", "two\nlines"],
                    ["3", "4"],
                ],
            });
        });

        it("reads CSV otherwise", () => {
            expect(
                MarkdownTable.parse('name,note\r\nx,"a, ""b"""\r\ny\r\n')
            ).toEqual({
                alignments: ["none", "none"],
                rows: [
                    ["name", "note"],
                    ["x", 'a, "b"'],
                    ["y", ""],
                ],
            });
        });

        it("rejects empty input", () => {
            expect(() => MarkdownTable.parse(" \n ")).toThrow(
                MarkdownTableError
            );
        });
    });
});
