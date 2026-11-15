import { Config } from "@oclif/core";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Exec } from "../../shared/exec.js";
import { ScriptedPrompts } from "../../shared/scripted-prompts.js";
import { Cancelled, Terminal } from "../../shared/terminal.js";
import Docker from "./index.js";
import DockerPrune from "./prune.js";

afterEach(() => vi.restoreAllMocks());

async function command(
    args: string[],
    answers: unknown[] = [],
    interactive = true
) {
    const { prompts } = ScriptedPrompts.terminal(answers);
    const prune = new DockerPrune(
        args,
        await Config.load(path.join(import.meta.dirname, "../../.."))
    );
    prune.terminal = new Terminal({
        interactive,
        prompts,
        stdoutIsTerminal: false,
    });
    vi.spyOn(prune, "log").mockImplementation(() => {});
    const read = vi.spyOn(Exec, "run").mockResolvedValue("Docker disk usage");
    const remove = vi.spyOn(Exec, "interactive").mockResolvedValue();
    return { prompts, prune, read, remove };
}

describe("Docker cleanup", () => {
    it("does no work without consent in a noninteractive terminal", async () => {
        const { prune, read, remove } = await command([], [], false);
        await expect(prune.run()).rejects.toThrow("Pass --yes");
        expect(read).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it.each([false, ScriptedPrompts.CANCEL])(
        "does not prune when cancelled with %s",
        async (answer) => {
            const { prompts, prune, remove } = await command([], [answer]);
            await expect(prune.run()).rejects.toBeInstanceOf(Cancelled);
            expect(prompts.shown[0]!.initialValue).toBe(false);
            expect(remove).not.toHaveBeenCalled();
        }
    );

    it("shows usage without pruning for a dry run", async () => {
        const { prune, read, remove } = await command(
            ["--all", "--volumes", "--dry-run"],
            [],
            false
        );
        await prune.run();
        expect(read).toHaveBeenCalledWith("docker", ["system", "df"]);
        expect(remove).not.toHaveBeenCalled();
    });

    it("prunes only after consent and keeps volumes by default", async () => {
        const { prune, remove } = await command([], [true]);
        await prune.run();
        expect(remove).toHaveBeenCalledWith("docker", [
            "system",
            "prune",
            "--force",
        ]);
    });

    it.each([
        {
            args: ["images", "--all"],
            expected: ["image", "prune", "--force", "--all"],
        },
        { args: ["cache"], expected: ["builder", "prune", "--force"] },
        {
            args: ["cache", "--all"],
            expected: ["builder", "prune", "--force", "--all"],
        },
        {
            args: ["--all", "--volumes"],
            expected: ["system", "prune", "--force", "--all", "--volumes"],
        },
    ])(
        "limits cleanup to the requested scope: $args",
        async ({ args, expected }) => {
            const { prompts, prune, remove } = await command(
                [...args, "--yes"],
                [],
                false
            );
            await prune.run();
            expect(prompts.shown).toHaveLength(0);
            expect(remove).toHaveBeenCalledWith("docker", expected);
        }
    );

    it("rejects volume cleanup for an image-only operation", async () => {
        const { prune, read, remove } = await command([
            "images",
            "--volumes",
            "--yes",
        ]);
        await expect(prune.run()).rejects.toThrow(
            "--volumes requires the system target"
        );
        expect(read).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it("does not prune if Docker disk usage fails", async () => {
        const { prune, read, remove } = await command(["--yes"]);
        read.mockRejectedValue(new Error("Docker is unavailable"));
        await expect(prune.run()).rejects.toThrow("Docker is unavailable");
        expect(remove).not.toHaveBeenCalled();
    });

    it("surfaces cleanup failures", async () => {
        const { prune, remove } = await command(["--yes"]);
        remove.mockRejectedValue(new Error("Prune failed"));
        await expect(prune.run()).rejects.toThrow("Prune failed");
    });

    it("can show detailed disk usage without cleanup", async () => {
        const docker = new Docker(
            ["--verbose"],
            await Config.load(path.join(import.meta.dirname, "../../.."))
        );
        vi.spyOn(docker, "log").mockImplementation(() => {});
        const read = vi
            .spyOn(Exec, "run")
            .mockResolvedValue("Detailed disk usage");
        await docker.run();
        expect(read).toHaveBeenCalledWith("docker", [
            "system",
            "df",
            "--verbose",
        ]);
    });
});
