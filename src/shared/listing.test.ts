import { Config } from "@oclif/core";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SwissCommand } from "./command.js";
import { CommandError } from "./exec.js";
import { matchesSearch } from "./listing.js";
import { ScriptedPrompts } from "./scripted-prompts.js";
import { Terminal } from "./terminal.js";

// The repo, so oclif reads swiss's config rather than looking for one in its own package.
const ROOT = path.join(import.meta.dirname, "../..");

class ListThings extends SwissCommand {
    readonly lines: string[] = [];
    readonly opened: string[] = [];

    asTable = false;
    things = ["a", "b", "c"];

    override log(message = ""): void {
        this.lines.push(message);
    }

    async run(): Promise<void> {
        await this.listItems<string>({
            action: "open it",
            choice: (thing) => ({ hint: `thing ${thing}`, label: thing }),
            columns: ["NAME"],
            empty: "No things",
            footer: "Some things are elsewhere",
            items: this.things,
            noun: ["thing", "things"],
            open: async (thing) => {
                if (thing === "c") {
                    throw new CommandError("c won't open");
                }
                this.opened.push(thing);
                return `Opened ${thing}`;
            },
            row: (thing) => [thing],
            table: this.asTable,
            title: "Things",
            verb: "Opened",
        });
    }

    // Runs it the way oclif does, through catch and finally.
    async start(): Promise<void> {
        await this._run();
    }
}

async function listThings(): Promise<ListThings> {
    return new ListThings([], await Config.load(ROOT));
}

describe("SwissCommand.listItems", () => {
    it("opens what's picked until Escape, starting each pick at the last one", async () => {
        const command = await listThings();
        const { prompts, terminal } = ScriptedPrompts.terminal([
            1,
            0,
            ScriptedPrompts.CANCEL,
        ]);
        command.terminal = terminal;

        await command.start();

        expect(command.opened).toEqual(["b", "a"]);
        expect(prompts.shown.map((shown) => shown.initialValue)).toEqual([
            undefined,
            1,
            0,
        ]);
        expect(prompts.said).toEqual([
            "intro: Things",
            "info: Some things are elsewhere",
            "success: Opened b",
            "success: Opened a",
            "outro: Opened 2 things",
        ]);
        expect(command.lines).toEqual([]);
    });

    it("says why one couldn't be opened and keeps the picker open", async () => {
        const command = await listThings();
        const { prompts, terminal } = ScriptedPrompts.terminal([
            2,
            ScriptedPrompts.CANCEL,
        ]);
        command.terminal = terminal;

        await command.start();

        expect(prompts.said).toContain("error: c won't open");
        expect(prompts.said).toContain("outro: Opened 0 things");
    });

    it("prints a table with --table, or when the output is piped", async () => {
        const tabled = await listThings();
        tabled.terminal = ScriptedPrompts.terminal().terminal;
        tabled.asTable = true;
        const piped = await listThings();
        piped.terminal = new Terminal({
            interactive: true,
            prompts: new ScriptedPrompts(),
            stdoutIsTerminal: false,
        });

        await tabled.start();
        await piped.start();

        const table = ["NAME", "a", "b", "c", "\nSome things are elsewhere"];
        expect(tabled.lines).toEqual(table);
        expect(piped.lines).toEqual(table);
    });

    it("says when there's nothing to list", async () => {
        const command = await listThings();
        command.terminal = ScriptedPrompts.terminal().terminal;
        command.things = [];

        await command.start();

        expect(command.lines).toEqual(["No things"]);
    });
});

describe("matchesSearch", () => {
    it("matches everything when there's nothing to search for", () => {
        expect(matchesSearch(undefined, ["anything"])).toBe(true);
    });

    it("finds text inside any field, ignoring case", () => {
        expect(matchesSearch("GIT", ["gs", "git status"])).toBe(true);
        expect(matchesSearch("push", ["gs", "git status"])).toBe(false);
    });

    it("matches a whole field against a glob, ignoring case", () => {
        expect(matchesSearch("aws_*", ["AWS_PROFILE"])).toBe(true);
        expect(matchesSearch("AWS_*", ["MY_AWS_PROFILE"])).toBe(false);
        expect(matchesSearch("NODE_?NV", ["NODE_ENV"])).toBe(true);
    });
});
