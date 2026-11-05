import { flatten, last } from "lodash-es";
import { describe, expect, it } from "vitest";
import type { ShownPrompt } from "./scripted-prompts.js";
import type { VariableStore } from "./variable-editor.js";
import { UserError } from "./errors.js";
import { ScriptedPrompts } from "./scripted-prompts.js";
import { Cancelled } from "./terminal.js";
import { VariableEditor } from "./variable-editor.js";

describe("VariableEditor", () => {
    it("adds, changes, renames and removes variables, writing them when saved", async () => {
        const { saved, store } = fakeStore({ A: "1", B: "2", C: "3" });
        const { prompts, terminal } = ScriptedPrompts.terminal([
            ...["+add", "D", "4"],
            ...["A", "value", "10"],
            ...["B", "rename", "B2"],
            ...["C", "remove"],
            "+save",
        ]);

        await VariableEditor.edit(terminal, store, { reveal: false });

        expect(saved()).toEqual({ A: "10", B2: "2", D: "4" });
        expect(last(prompts.said)).toBe("outro: Saved");
    });

    it("writes nothing when it exits without saving", async () => {
        const { saved, store } = fakeStore({ A: "1" });
        const { prompts, terminal } = ScriptedPrompts.terminal(
            flatten([["A", "value", "2"], ["+discard"]])
        );

        await VariableEditor.edit(terminal, store, { reveal: false });

        expect(saved()).toEqual({ A: "1" });
        expect(labels(last(prompts.shown)!)).toContain(
            "Discard changes and exit"
        );
        expect(last(prompts.said)).toBe("outro: Nothing saved");
    });

    it("leaves without saving on Escape", async () => {
        const { saved, store } = fakeStore({ A: "1" });
        const { terminal } = ScriptedPrompts.terminal([
            ...["A", "value", "2"],
            ...["+add", ScriptedPrompts.CANCEL],
        ]);

        // SwissCommand turns this into the command's "Nothing saved".
        await expect(
            VariableEditor.edit(terminal, store, { reveal: false })
        ).rejects.toThrow(Cancelled);
        expect(saved()).toEqual({ A: "1" });
    });

    it("asks again for a name that's taken or that the store won't take", async () => {
        const { saved, store } = fakeStore({ A: "1" });
        const { prompts, terminal } = ScriptedPrompts.terminal(
            flatten([["+add", "A", "a b", "B", "2"], ["+save"]])
        );

        await VariableEditor.edit(terminal, store, { reveal: false });

        expect(saved()).toEqual({ A: "1", B: "2" });
        expect(prompts.said).toContain(
            "invalid: A is already set; pick it from the list to change it"
        );
        expect(prompts.said).toContain("invalid: No spaces");
    });

    it("explains a change the store can't make, and carries on", async () => {
        const { saved, store } = fakeStore({ A: "1" });
        const { prompts, terminal } = ScriptedPrompts.terminal(
            flatten([["A", "value", "refused"], ["+save"]])
        );

        await VariableEditor.edit(terminal, store, { reveal: false });

        expect(prompts.said).toContain("error: Can't use that value");
        expect(saved()).toEqual({ A: "1" });
    });

    it("lists read-only variables, but doesn't change them", async () => {
        const { store } = fakeStore(
            { A: "1" },
            { A: "it's inside a conditional" }
        );
        const { prompts, terminal } = ScriptedPrompts.terminal(
            flatten([["A"], ["+discard"]])
        );

        await VariableEditor.edit(terminal, store, { reveal: false });

        expect(prompts.shown[0]!.options![0]!.hint).toBe(
            "read-only, ~/.zshrc:1"
        );
        expect(prompts.said).toContain(
            "warn: Can't change A, since it's inside a conditional"
        );
    });

    it("hides values unless they're revealed", async () => {
        const { store } = fakeStore({ A: "secret" });
        const { prompts, terminal } = ScriptedPrompts.terminal([
            "+discard",
            "+discard",
        ]);

        await VariableEditor.edit(terminal, store, { reveal: false });
        await VariableEditor.edit(terminal, store, { reveal: true });

        expect(prompts.shown.map((menu) => menu.options![0]!.hint)).toEqual([
            "••••••••",
            "secret",
        ]);
    });
});

function labels(menu: ShownPrompt): Array<string | undefined> {
    return (menu.options ?? []).map((option) => option.label);
}

// Variables kept in memory, which refuses names with spaces and the value "refused".
type FakeStoreResult = {
    saved: () => Record<string, string>;
    store: VariableStore;
};

function fakeStore(
    initial: Record<string, string>,
    readOnly: Record<string, string> = {}
): FakeStoreResult {
    let variables = new Map(Object.entries(initial));
    let saved = new Map(variables);
    const store: VariableStore = {
        changed: () =>
            JSON.stringify([...variables]) !== JSON.stringify([...saved]),
        checkName: (name) => (name.includes(" ") ? "No spaces" : undefined),
        placeholder: "API_KEY",
        remove: (name) => {
            variables.delete(name);
        },
        rename: (from, to) => {
            variables = new Map(
                [...variables].map(([name, value]) => [
                    name === from ? to : name,
                    value,
                ])
            );
        },
        save: async () => {
            saved = new Map(variables);
            return "Saved";
        },
        set: (name, value) => {
            if (value === "refused") {
                throw new UserError("Can't use that value");
            }
            variables.set(name, value);
        },
        title: "Editing",
        variables: () =>
            [...variables].map(([name, value]) => ({
                location: "~/.zshrc:1",
                name,
                readOnly: readOnly[name],
                value,
            })),
    };
    return { saved: () => Object.fromEntries(saved), store };
}
