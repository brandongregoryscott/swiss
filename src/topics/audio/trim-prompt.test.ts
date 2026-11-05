import { Prompt } from "@clack/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrimPair } from "./trim.js";
import { SamplePlayer } from "./player.js";
import { TrimPrompt } from "./trim-prompt.js";

vi.mock("./player.js", () => ({
    SamplePlayer: vi.fn(
        class {
            message = "Space to listen";
            stop = vi.fn();
            toggle = vi.fn();
        }
    ),
}));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

const state = { dev: 1, ino: 1, mtimeMs: 1, size: 1 };
const pairs: TrimPair[] = ["one", "two"].map((name) => ({
    original: `/samples/${name}.wav`,
    originalDuration: 2,
    originalState: state,
    trimmed: `/samples/${name}-trimmed.wav`,
    trimmedDuration: 1,
    trimmedState: state,
}));

describe("trim comparison", () => {
    it("switches playback between versions and collects only marked originals without deleting", () => {
        const prompt = new TrimPrompt(pairs, process.stderr);
        const player = vi.mocked(SamplePlayer).mock.instances[0]!;
        prompt.emit("key", undefined, { name: "left" });
        expect(player.toggle).toHaveBeenLastCalledWith(pairs[0]!.original);
        prompt.emit("key", undefined, { name: "right" });
        expect(player.toggle).toHaveBeenLastCalledWith(pairs[0]!.trimmed);
        prompt.emit("key", "d", { name: "d" });
        prompt.emit("key", undefined, { name: "down" });
        expect(player.stop).toHaveBeenCalledTimes(3);
        prompt.emit("key", "d", { name: "d" });
        prompt.emit("key", "d", { name: "d" });
        prompt.emit("key", undefined, { name: "return" });
        expect(prompt.value).toEqual([pairs[0]]);
        expect(prompt.state).toBe("submit");
    });

    it("stops playback when leaving review without a deletion plan", async () => {
        vi.spyOn(Prompt.prototype, "prompt").mockResolvedValue(undefined);
        expect(await TrimPrompt.review(pairs, process.stderr)).toBeNull();
        expect(
            vi.mocked(SamplePlayer).mock.instances[0]!.stop
        ).toHaveBeenCalledOnce();
    });
});
