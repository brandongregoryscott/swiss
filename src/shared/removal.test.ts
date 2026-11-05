import type { Errors } from "@oclif/core";
import { Config } from "@oclif/core";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { RemovalPlan } from "./removal.js";
import type { Terminal } from "./terminal.js";
import { SwissCommand } from "./command.js";
import { ScriptedPrompts } from "./scripted-prompts.js";
import { Terminal as RealTerminal } from "./terminal.js";

// The repo, so oclif reads swiss's config rather than looking for one in its own package.
const ROOT = path.join(import.meta.dirname, "../..");

// Things kept in memory: ones in blocked can't be removed, and ones in broken fail to.
let things: Set<string>;
let blocked: Set<string>;
let broken: Set<string>;

beforeEach(() => {
    things = new Set(["a", "b", "c"]);
    blocked = new Set();
    broken = new Set();
});

class RemoveThings extends SwissCommand {
    readonly lines: string[] = [];

    static override cancelled = "Nothing removed";
    names: string[] = [];
    yes = false;

    override log(message = ""): void {
        this.lines.push(message);
    }

    async run(): Promise<void> {
        await this.removeItems<string>({
            choices: async () =>
                [...things].map((thing) => ({ label: thing, value: thing })),
            columns: ["NAME"],
            describe: (thing) => `thing ${thing}`,
            hint: (removed) => `Run \`forget ${removed.join(" ")}\``,
            names: this.names,
            notFound: (names) => `${names.join(", ")} isn't a thing`,
            noun: ["thing", "things"],
            plan: async (names): Promise<RemovalPlan<string>> => {
                const found = names.filter((name) => things.has(name));
                const items = found.filter((name) => !blocked.has(name));
                return {
                    blocked: found
                        .filter((name) => blocked.has(name))
                        .map((item) => ({ item, reason: "it's stuck" })),
                    items,
                    missing: names.filter((name) => !things.has(name)),
                    remove: async () => {
                        for (const item of items) {
                            if (!broken.has(item)) {
                                things.delete(item);
                            }
                        }
                        return items
                            .filter((item) => broken.has(item))
                            .map((item) => ({ item, reason: "it broke" }));
                    },
                };
            },
            row: (thing) => [thing],
            yes: this.yes,
        });
    }

    // Runs it the way oclif does, through catch and finally.
    async start(): Promise<void> {
        await this._run();
    }

    override warn(input: Error | string): Error | string {
        this.lines.push(`warning: ${String(input)}`);
        return input;
    }
}

type RunOptions = {
    answers?: unknown[];
    interactive?: boolean;
    names?: string[];
    yes?: boolean;
};

async function run(options: RunOptions = {}): Promise<{
    command: RemoveThings;
    exit: number;
    message: string;
    prompts: ScriptedPrompts;
}> {
    const prompts = new ScriptedPrompts(options.answers ?? []);
    const command = new RemoveThings([], await Config.load(ROOT));
    command.terminal = terminal(prompts, options.interactive ?? true);
    command.names = options.names ?? [];
    command.yes = options.yes ?? false;
    const error = await command.start().catch((caught: unknown) => caught);
    const exit =
        error == null ? 0 : ((error as Errors.CLIError).oclif?.exit ?? -1);
    if (exit === -1) {
        throw error;
    }
    return {
        command,
        exit,
        message: error == null ? "" : (error as Error).message,
        prompts,
    };
}

function terminal(prompts: ScriptedPrompts, interactive: boolean): Terminal {
    return new RealTerminal({
        interactive,
        prompts,
        stdoutIsTerminal: false,
    });
}

describe("removing things", () => {
    it("lists them, asks, then removes them and says how to drop them from the shell", async () => {
        const { command, exit, prompts } = await run({
            answers: [true],
            names: ["a", "b"],
        });

        expect(command.lines).toEqual([
            "NAME",
            "a",
            "b",
            "Removed 2 things",
            "Run `forget a b`",
        ]);
        expect(prompts.shown[0]).toMatchObject({
            initialValue: false,
            message: "Remove 2 things?",
        });
        expect([...things]).toEqual(["c"]);
        expect(exit).toBe(0);
    });

    it("removes nothing when the answer is no", async () => {
        const { exit, prompts } = await run({
            answers: [false],
            names: ["a"],
        });

        expect([...things]).toEqual(["a", "b", "c"]);
        expect(prompts.said).toEqual(["cancel: Nothing removed"]);
        expect(exit).toBe(0);
    });

    it("says which names matched nothing, without failing", async () => {
        const { command, exit } = await run({ names: ["x", "y"] });

        expect(command.lines).toEqual(["x, y isn't a thing"]);
        expect(exit).toBe(0);
    });

    it("fails for things it can't remove, after removing the rest", async () => {
        blocked.add("b");
        const { command, exit } = await run({
            names: ["a", "b"],
            yes: true,
        });

        expect(command.lines).toContain(
            "warning: Left thing b in place, since it's stuck"
        );
        expect(command.lines).toContain("Removed 1 thing");
        expect([...things]).toEqual(["b", "c"]);
        expect(exit).toBe(1);
    });

    it("fails for things that couldn't be removed when it tried", async () => {
        broken.add("a");
        const { command, exit } = await run({
            names: ["a", "b"],
            yes: true,
        });

        expect(command.lines).toContain("Couldn't remove thing a: it broke");
        expect(command.lines).toContain("Removed 1 thing");
        expect(exit).toBe(1);
    });

    it("picks them from a list when none are named", async () => {
        const { exit, prompts } = await run({
            answers: [["a", "c"], true],
        });

        expect(prompts.shown[0]!.message).toMatch(/^Pick things to remove/);
        expect(
            prompts.shown[0]!.options!.map((option) => option.label)
        ).toEqual(["a", "b", "c"]);
        expect([...things]).toEqual(["b"]);
        expect(exit).toBe(0);
    });

    it("removes nothing when nothing is picked", async () => {
        const { exit, prompts } = await run({ answers: [[]] });

        expect([...things]).toEqual(["a", "b", "c"]);
        expect(prompts.said).toEqual(["cancel: Nothing removed"]);
        expect(exit).toBe(0);
    });

    it("needs names, or --yes, when there's no one to ask", async () => {
        const unnamed = await run({ interactive: false });
        const unconfirmed = await run({ interactive: false, names: ["a"] });

        expect([unnamed.exit, unnamed.message]).toEqual([
            2,
            "Give the things to remove when there's no interactive terminal",
        ]);
        expect([unconfirmed.exit, unconfirmed.message]).toEqual([
            2,
            "Pass --yes to remove things without an interactive terminal",
        ]);
        expect([...things]).toEqual(["a", "b", "c"]);

        const { exit } = await run({
            interactive: false,
            names: ["a"],
            yes: true,
        });
        expect([...things]).toEqual(["b", "c"]);
        expect(exit).toBe(0);
    });
});
