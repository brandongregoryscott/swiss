import { Config } from "@oclif/core";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptedPrompts } from "../../shared/scripted-prompts.js";
import { Cancelled } from "../../shared/terminal.js";
import { Ffmpeg } from "../../topics/audio/ffmpeg.js";
import { TrimPrompt } from "../../topics/audio/trim-prompt.js";
import AudioTrim from "./trim.js";

describe("trim review consent", () => {
    let directory: string;
    let original: string;
    let trimmed: string;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), "swiss-trim-command-"));
        original = path.join(directory, "sample.wav");
        trimmed = path.join(directory, "sample-trimmed.wav");
        await writeFile(original, "original audio");
        await writeFile(trimmed, "trimmed audio");
        vi.spyOn(Ffmpeg, "duration").mockResolvedValue(1);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await rm(directory, { force: true, recursive: true });
    });

    async function command(answers: unknown[]) {
        const configured = ScriptedPrompts.terminal(answers);
        const trim = new AudioTrim(
            [directory, "--review-only"],
            await Config.load(path.join(import.meta.dirname, "../../.."))
        );
        trim.terminal = configured.terminal;
        vi.spyOn(trim, "log").mockImplementation(() => {});
        return { ...configured, trim };
    }

    it("keeps every file when review is cancelled", async () => {
        vi.spyOn(TrimPrompt, "review").mockResolvedValue(null);
        const { prompts, trim } = await command([]);
        await expect(trim.run()).rejects.toBeInstanceOf(Cancelled);
        expect((await readdir(directory)).sort()).toEqual([
            "sample-trimmed.wav",
            "sample.wav",
        ]);
        expect(prompts.shown).toHaveLength(0);
    });

    it("keeps marked originals if final consent is declined, starting on no", async () => {
        vi.spyOn(TrimPrompt, "review").mockImplementation(
            async (pairs) => pairs
        );
        const { prompts, trim } = await command([false]);
        await expect(trim.run()).rejects.toBeInstanceOf(Cancelled);
        expect(await readFile(original, "utf8")).toBe("original audio");
        expect(await readFile(trimmed, "utf8")).toBe("trimmed audio");
        expect(prompts.shown[0]!.initialValue).toBe(false);
    });

    it("replaces only marked originals after consent and drops the trimmed suffix", async () => {
        await writeFile(path.join(directory, "other.wav"), "unpaired");
        await writeFile(
            path.join(directory, "other-trimmed.wav"),
            "unmarked trim"
        );
        vi.spyOn(TrimPrompt, "review").mockImplementation(async (pairs) =>
            pairs.filter((pair) => pair.original === original)
        );
        const { trim } = await command([true]);
        await trim.run();
        expect((await readdir(directory)).sort()).toEqual([
            "other-trimmed.wav",
            "other.wav",
            "sample.wav",
        ]);
        expect(await readFile(original, "utf8")).toBe("trimmed audio");
        expect(await readFile(path.join(directory, "other.wav"), "utf8")).toBe(
            "unpaired"
        );
        expect(
            await readFile(path.join(directory, "other-trimmed.wav"), "utf8")
        ).toBe("unmarked trim");
    });
});
