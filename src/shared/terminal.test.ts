import { describe, expect, it } from "vitest";
import { UserError } from "./errors.js";
import { ScriptedPrompts } from "./scripted-prompts.js";
import { Cancelled, Terminal } from "./terminal.js";

describe("Terminal", () => {
    describe("consent", () => {
        it("asks, defaulting to no, and cancels unless the answer is yes", async () => {
            const { prompts, terminal } = ScriptedPrompts.terminal([
                true,
                false,
                ScriptedPrompts.CANCEL,
            ]);
            const consent = terminal.consent(false, "delete");

            await consent.confirm("Delete 2 directories?");
            await expect(consent.confirm("Delete them?")).rejects.toThrow(
                Cancelled
            );
            await expect(consent.confirm("Delete them?")).rejects.toThrow(
                Cancelled
            );
            expect(prompts.shown[0]).toMatchObject({
                initialValue: false,
                message: "Delete 2 directories?",
            });
        });

        it("goes ahead without asking when --yes is passed", async () => {
            const { prompts, terminal } = ScriptedPrompts.terminal();

            await terminal.consent(true, "delete").confirm("Delete?");

            expect(prompts.shown).toEqual([]);
        });

        it("needs --yes when there's no one to ask, before anything is done", () => {
            const terminal = scripted(false);

            expect(() =>
                terminal.consent(false, "delete", "or --dry-run to only list")
            ).toThrow(
                new UserError(
                    "Pass --yes to delete without an interactive terminal, or --dry-run to only list"
                )
            );
            expect(() => terminal.consent(true, "delete")).not.toThrow();
        });
    });

    describe("answers", () => {
        it("cancels the command on Escape, or gives null where Escape means done", async () => {
            const { terminal } = ScriptedPrompts.terminal([
                ScriptedPrompts.CANCEL,
                ScriptedPrompts.CANCEL,
                "picked",
            ]);
            const pick = (): Promise<string | symbol> =>
                terminal.prompts.select({ message: "Pick", options: [] });

            await expect(terminal.answer(pick())).rejects.toThrow(Cancelled);
            expect(await terminal.optional(pick())).toBeNull();
            expect(await terminal.answer(pick())).toBe("picked");
        });
    });

    describe("requirements", () => {
        it("asks for an argument or a terminal only when there's no one to ask", () => {
            const absent = scripted(false);
            const present = scripted(true);

            expect(() =>
                absent.requireArgument("the worktree to remove")
            ).toThrow(
                "Give the worktree to remove when there's no interactive terminal"
            );
            expect(() =>
                absent.requireInteractive("use `env set` instead")
            ).toThrow(
                "This command needs an interactive terminal; use `env set` instead"
            );
            expect(() =>
                absent.requireInteractive(undefined, "--pick")
            ).toThrow("--pick needs an interactive terminal");
            expect(() => present.requireArgument("the worktree")).not.toThrow();
            expect(() => present.requireInteractive()).not.toThrow();
        });
    });

    describe("spinner", () => {
        it("shows only while someone's watching", () => {
            const prompts = new ScriptedPrompts();
            const watched = new Terminal({
                interactive: true,
                prompts,
                stdoutIsTerminal: true,
            });
            const unwatched = new Terminal({
                interactive: false,
                prompts,
                stdoutIsTerminal: false,
            });

            unwatched.spinner().start("Searching");
            watched.spinner().start("Counting");

            expect(prompts.said).toEqual(["spinner: Counting"]);
        });
    });
});

function scripted(interactive: boolean): Terminal {
    return new Terminal({
        interactive,
        prompts: new ScriptedPrompts(),
        stdoutIsTerminal: interactive,
    });
}
