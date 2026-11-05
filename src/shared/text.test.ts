import { describe, expect, it } from "vitest";
import { Text } from "./text.js";

describe("Text", () => {
    describe("table", () => {
        const rows = [
            ["PORT", "PID", "COMMAND"],
            ["3000", "123", "node server.js"],
            ["5432", "45", "postgres -D /var/db"],
        ];

        it("lines up the columns, leaving the last one unpadded", () => {
            expect(Text.table(rows)).toEqual([
                "PORT  PID  COMMAND",
                "3000  123  node server.js",
                "5432  45   postgres -D /var/db",
            ]);
        });

        it("cuts lines short to fit the width", () => {
            const lines = Text.table(rows, 24);

            expect(lines[2]).toBe("5432  45   postgres -D …");
            expect(lines.every((line) => line.length <= 24)).toBe(true);
        });
    });
});
