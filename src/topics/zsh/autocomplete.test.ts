import { describe, expect, it } from "vitest";
import type { ZshDocument } from "./syntax.js";
import { Autocomplete } from "./autocomplete.js";

const CLI = {
    aliases: ["sws"],
    bin: "swiss",
    cacheDir: "/Users/me/Library/Caches/swiss",
};

const SETUP_LINE =
    "SWISS_AC_ZSH_SETUP_PATH=/Users/me/Library/Caches/swiss/autocomplete/zsh_setup && test -f $SWISS_AC_ZSH_SETUP_PATH && source $SWISS_AC_ZSH_SETUP_PATH && compdef _swiss sws; # swiss autocomplete setup";

const PLUGIN_LINE =
    "SWISS_AC_ZSH_SETUP_PATH=/Users/me/Library/Caches/swiss/autocomplete/zsh_setup && test -f $SWISS_AC_ZSH_SETUP_PATH && source $SWISS_AC_ZSH_SETUP_PATH; # swiss autocomplete setup";

describe("Autocomplete", () => {
    describe("zshSetupLine", () => {
        it("registers the completion for each alias", () => {
            const result = Autocomplete.zshSetupLine(CLI);

            expect(result).toBe(SETUP_LINE);
        });

        it("leaves out compdef when there are no aliases", () => {
            const result = Autocomplete.zshSetupLine({ ...CLI, aliases: [] });

            expect(result).toBe(PLUGIN_LINE);
        });
    });

    describe("zshSetup", () => {
        it("adds the line at the end, after a blank line", () => {
            const doc = document(["export EDITOR=vim"]);

            const result = Autocomplete.zshSetup(doc, CLI);

            expect(result.outcome).toBe("added");
            expect(result.line).toBe(3);
            expect(result.doc.lines).toEqual([
                "export EDITOR=vim",
                "",
                SETUP_LINE,
            ]);
        });

        it("leaves the file alone when the line is already there", () => {
            const doc = document([
                "export EDITOR=vim",
                SETUP_LINE,
                "alias g=git",
            ]);

            const result = Autocomplete.zshSetup(doc, CLI);

            expect(result.outcome).toBe("unchanged");
            expect(result.line).toBe(2);
            expect(result.doc).toBe(doc);
        });

        it("replaces an older setup line in place", () => {
            const doc = document([
                "export EDITOR=vim",
                PLUGIN_LINE,
                "alias g=git",
            ]);

            const result = Autocomplete.zshSetup(doc, CLI);

            expect(result.outcome).toBe("updated");
            expect(result.line).toBe(2);
            expect(result.doc.lines).toEqual([
                "export EDITOR=vim",
                SETUP_LINE,
                "alias g=git",
            ]);
        });

        it("keeps only the first of several setup lines", () => {
            const doc = document([
                PLUGIN_LINE,
                "export EDITOR=vim",
                PLUGIN_LINE,
                SETUP_LINE,
            ]);

            const result = Autocomplete.zshSetup(doc, CLI);

            expect(result.outcome).toBe("updated");
            expect(result.doc.lines).toEqual([SETUP_LINE, "export EDITOR=vim"]);
        });
    });
});

function document(lines: string[]): ZshDocument {
    return { eol: "\n", lines, trailingNewline: true };
}
