import type { Key } from "node:readline";
import { groupBy } from "lodash-es";
import type { TableGrid } from "./grid.js";

// How a key ends editing, if it does.
type KeyOutcome = "cancel" | "submit";

type KeyAction = (grid: TableGrid) => KeyOutcome | void;

// Keys that do one thing, with the hint that says so. A key can only be bound here, so the hints
// always match what the keys do.
type KeyGroup = {
    // null for keys that need no hint, like Backspace.
    hint: null | string;
    // By name, with modifiers like ctrl+a or shift+tab.
    keys: Record<string, KeyAction>;
    // Which line of hints it's on.
    line: number;
};

const KEY_GROUPS: KeyGroup[] = [
    {
        hint: "arrows/tab move",
        keys: {
            down: (grid) => grid.move(1, 0),
            left: (grid) => grid.move(0, -1),
            right: (grid) => grid.move(0, 1),
            "shift+tab": (grid) => grid.previous(),
            tab: (grid) => grid.next(),
            up: (grid) => grid.move(-1, 0),
        },
        line: 0,
    },
    {
        hint: "enter next row",
        keys: {
            enter: (grid) => grid.down(),
            return: (grid) => grid.down(),
        },
        line: 0,
    },
    {
        hint: "ctrl+a align",
        keys: { "ctrl+a": (grid) => grid.alignColumn() },
        line: 0,
    },
    { hint: "ctrl+s done", keys: { "ctrl+s": () => "submit" }, line: 0 },
    // clack cancels on Escape too, after this.
    { hint: "esc cancel", keys: { escape: () => "cancel" }, line: 0 },
    {
        hint: "ctrl+n/ctrl+t add row/column",
        keys: {
            "ctrl+n": (grid) => grid.addRow(),
            "ctrl+t": (grid) => grid.addColumn(),
        },
        line: 1,
    },
    {
        hint: "ctrl+x/ctrl+k delete row/column",
        keys: {
            "ctrl+k": (grid) => grid.deleteColumn(),
            "ctrl+x": (grid) => grid.deleteRow(),
        },
        line: 1,
    },
    { hint: null, keys: { backspace: (grid) => grid.backspace() }, line: 0 },
];

const BINDINGS = new Map(
    KEY_GROUPS.flatMap((group) => Object.entries(group.keys))
);

// What keys do while editing a table: move around it, change its shape, finish, or type into the
// selected cell. Pasted text is typed as it is, so its newlines stay in the cell rather than
// moving down a row.
class TableKeys {
    readonly grid: TableGrid;

    // The lines of hints shown under the table.
    static readonly HINTS: string[] = Object.values(
        groupBy(
            KEY_GROUPS.filter((group) => group.hint != null),
            "line"
        )
    ).map((groups) => groups.map((group) => group.hint).join(" · "));
    #pasting = false;

    constructor(grid: TableGrid) {
        this.grid = grid;
    }

    // Applies a keypress, as readline reports it, to the grid, returning how it ends editing, if
    // it does. Ctrl and Alt keys that aren't bound do nothing.
    press(char: string | undefined, key: Key): KeyOutcome | null {
        if (key.name === "paste-start" || key.name === "paste-end") {
            this.#pasting = key.name === "paste-start";
            return null;
        }
        if (this.#pasting) {
            if (key.name === "return" || key.name === "enter") {
                this.grid.type("\n");
            } else if (key.name === "tab") {
                this.grid.type(" ");
            } else if (char != null) {
                this.grid.type(char);
            }
            return null;
        }

        const action = BINDINGS.get(keyName(key));
        if (action != null) {
            return action(this.grid) ?? null;
        }
        if (
            char != null &&
            key.ctrl !== true &&
            key.meta !== true &&
            !/[\u0000-\u001F\u007F]/.test(char)
        ) {
            this.grid.type(char);
        }
        return null;
    }
}

// A key's name, like a or tab, with the modifiers that matter: ctrl+, which takes any key's place
// in typing, and shift+ for Tab. Shift with other keys, like an arrow, does the same as without.
function keyName(key: Key): string {
    const name = key.name ?? "";
    if (key.ctrl === true) {
        return `ctrl+${name}`;
    }
    return key.shift === true && name === "tab" ? "shift+tab" : name;
}

export type { KeyOutcome };
export { TableKeys };
