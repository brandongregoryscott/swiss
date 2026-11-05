import { Config, Errors } from "@oclif/core";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SwissCommand } from "./command.js";
import { UserError } from "./errors.js";
import { ScriptedPrompts } from "./scripted-prompts.js";
import { Cancelled } from "./terminal.js";

// The repo, so oclif reads swiss's config rather than looking for one in its own package.
const ROOT = path.join(import.meta.dirname, "../..");

class Failing extends SwissCommand {
    static override cancelled = "Nothing deleted";
    static error: Error = new Error();

    fail(): void {
        this.failed = true;
    }

    async run(): Promise<void> {
        throw Failing.error;
    }

    // Runs it the way oclif does, through catch, on an instance a test can give a terminal.
    async start(): Promise<void> {
        await this._run();
    }
}

describe("SwissCommand", () => {
    it("exits with the message of a user error", async () => {
        class ZshError extends UserError {}
        Failing.error = new ZshError("zsh doesn't read ~/x.zsh when it starts");

        const error = await Failing.run([], ROOT).catch(
            (caught: unknown) => caught
        );

        expect(error).toBeInstanceOf(Errors.CLIError);
        expect((error as Errors.CLIError).message).toBe(
            "zsh doesn't read ~/x.zsh when it starts"
        );
        expect((error as Errors.CLIError).oclif.exit).toBe(2);
    });

    it("leaves other errors alone, so bugs keep their stack trace", async () => {
        Failing.error = new TypeError("x is undefined");

        await expect(Failing.run([], ROOT)).rejects.toBe(Failing.error);
    });

    it("ends a cancelled command with its cancelled message, as a success", async () => {
        Failing.error = new Cancelled();
        const { prompts, terminal } = ScriptedPrompts.terminal();
        const command = new Failing([], await Config.load(ROOT));
        command.terminal = terminal;

        await command.start();

        expect(prompts.said).toEqual(["cancel: Nothing deleted"]);
    });

    it("exits 1 at the end when part of it failed", async () => {
        class PartlyFailing extends SwissCommand {
            async run(): Promise<void> {
                this.failed = true;
            }

            async start(): Promise<void> {
                await this._run();
            }
        }
        const command = new PartlyFailing([], await Config.load(ROOT));

        const error = await command.start().catch((caught: unknown) => caught);

        expect((error as Errors.ExitError).oclif.exit).toBe(1);
    });

    it("still exits 1 when it's cancelled after part of it failed", async () => {
        Failing.error = new Cancelled();
        const command = new Failing([], await Config.load(ROOT));
        command.terminal = ScriptedPrompts.terminal().terminal;
        command.fail();

        const error = await command.start().catch((caught: unknown) => caught);

        expect((error as Errors.ExitError).oclif.exit).toBe(1);
    });
});
