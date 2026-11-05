import type { Key } from "node:readline";
import { isString } from "lodash-es";
import { describe, expect, it } from "vitest";
import { TableGrid } from "./grid.js";
import { TableKeys } from "./keys.js";

// A table with a header row and one empty row, being edited from its first cell.
function editing(): TableKeys {
    return new TableKeys(
        new TableGrid({
            alignments: ["none", "none"],
            rows: [
                ["", ""],
                ["", ""],
            ],
        })
    );
}

// Presses keys like readline reports them: a string is typed, and an object is a named key.
function press(keys: TableKeys, ...presses: Array<Key | string>): void {
    for (const pressed of presses) {
        if (isString(pressed)) {
            for (const char of pressed) {
                keys.press(char, { name: char.toLowerCase() });
            }
        } else {
            keys.press(pressed.sequence, pressed);
        }
    }
}

const TAB: Key = { name: "tab", sequence: "\t" };
const ENTER: Key = { name: "return", sequence: "\r" };

describe("TableKeys", () => {
    it("types into the selected cell, and Tab and Enter move to the next one", () => {
        const keys = editing();

        press(keys, "Name", TAB, "Role", ENTER, "Ada");

        expect(keys.grid.table.rows).toEqual([
            ["Name", "Role"],
            ["", "Ada"],
        ]);
    });

    it("moves back with Shift+Tab, and with arrows even when Shift is held", () => {
        const keys = editing();

        press(
            keys,
            TAB,
            { name: "tab", sequence: "\u001B[Z", shift: true },
            "a",
            { name: "down", shift: true },
            "b",
            { name: "right" },
            "c"
        );

        expect(keys.grid.table.rows).toEqual([
            ["a", ""],
            ["b", "c"],
        ]);
    });

    it("keeps pasted newlines and tabs in the cell", () => {
        const keys = editing();

        press(keys, { name: "paste-start" }, "a", ENTER, "b", TAB, "c", {
            name: "paste-end",
        });
        press(keys, ENTER, "after");

        expect(keys.grid.table.rows).toEqual([
            ["a\nb c", ""],
            ["after", ""],
        ]);
    });

    it("changes the table's shape with Ctrl keys", () => {
        const keys = editing();

        press(keys, { ctrl: true, name: "t" }, { ctrl: true, name: "n" });
        expect(keys.grid.table.rows).toEqual([
            ["", "", ""],
            ["", "", ""],
            ["", "", ""],
        ]);

        press(keys, { ctrl: true, name: "k" }, { ctrl: true, name: "x" });
        expect(keys.grid.table.rows).toEqual([
            ["", ""],
            ["", ""],
        ]);

        press(keys, { ctrl: true, name: "a" });
        expect(keys.grid.table.alignments).not.toEqual(["none", "none"]);
    });

    it("finishes on Ctrl+S and cancels on Escape", () => {
        const keys = editing();

        expect(keys.press(undefined, { ctrl: true, name: "s" })).toBe("submit");
        expect(keys.press("\u001B", { name: "escape" })).toBe("cancel");
        expect(keys.press("a", { name: "a" })).toBeNull();
    });

    it("doesn't type control characters or unbound Ctrl and Alt keys", () => {
        const keys = editing();

        press(
            keys,
            { ctrl: true, name: "b", sequence: "\u0002" },
            { meta: true, name: "f", sequence: "\u001Bf" }
        );
        keys.press("\u0007", { name: "undefined" });
        press(keys, { name: "backspace" }, "ok", { name: "backspace" });

        expect(keys.grid.table.rows[0]).toEqual(["o", ""]);
    });

    it("hints at every key that does something", () => {
        expect(TableKeys.HINTS).toEqual([
            "arrows/tab move · enter next row · ctrl+a align · ctrl+s done · esc cancel",
            "ctrl+n/ctrl+t add row/column · ctrl+x/ctrl+k delete row/column",
        ]);
    });
});
