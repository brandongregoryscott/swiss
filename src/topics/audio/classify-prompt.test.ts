import { Prompt } from "@clack/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassifyPrompt } from "./classify-prompt.js";
import { CATEGORIES, Classification } from "./classify.js";
import { SamplePlayer } from "./player.js";

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

function session(): Classification {
    return new Classification(
        [
            { category: null, duration: 1, file: "/samples/1.wav" },
            { category: null, duration: 2, file: "/samples/2.wav" },
        ],
        CATEGORIES
    );
}

describe("classification autoplay", () => {
    it("plays the selected sample on toggle, follows navigation, and leaves category changes uninterrupted", () => {
        const classification = session();
        const prompt = new ClassifyPrompt(classification, process.stderr);
        const player = vi.mocked(SamplePlayer).mock.instances[0]!;
        prompt.emit("key", "a", { name: "a" });
        expect(classification.autoplay).toBe(true);
        expect(player.toggle).toHaveBeenLastCalledWith("/samples/1.wav");
        expect(prompt.frame()).toContain("Autoplay: ON");
        vi.mocked(player.stop).mockClear();
        vi.mocked(player.toggle).mockClear();
        prompt.emit("key", undefined, { name: "right" });
        expect(classification.current.category).toBe("one-shot");
        expect(player.stop).not.toHaveBeenCalled();
        expect(player.toggle).not.toHaveBeenCalled();
        prompt.emit("key", undefined, { name: "down" });
        expect(player.stop).toHaveBeenCalledOnce();
        expect(player.toggle).toHaveBeenLastCalledWith("/samples/2.wav");
        prompt.emit("key", undefined, { name: "down" });
        expect(player.toggle).toHaveBeenCalledOnce();
        prompt.emit("key", undefined, { name: "up" });
        expect(player.toggle).toHaveBeenLastCalledWith("/samples/1.wav");
        prompt.emit("key", "a", { name: "a" });
        expect(classification.autoplay).toBe(false);
        expect(prompt.frame()).toContain("Autoplay: off");
        vi.mocked(player.toggle).mockClear();
        prompt.emit("key", undefined, { name: "down" });
        expect(player.toggle).not.toHaveBeenCalled();
        prompt.emit("key", " ", { name: "space" });
        expect(player.toggle).toHaveBeenCalledWith("/samples/2.wav");
    });

    it("starts playback when entering with autoplay enabled, and stops on exit", async () => {
        const classification = session();
        classification.autoplay = true;
        vi.spyOn(Prompt.prototype, "prompt").mockResolvedValue(classification);
        expect(await ClassifyPrompt.edit(classification, process.stderr)).toBe(
            classification
        );
        const player = vi.mocked(SamplePlayer).mock.instances[0]!;
        expect(player.toggle).toHaveBeenCalledWith("/samples/1.wav");
        expect(player.stop).toHaveBeenCalledOnce();
        expect(classification.autoplay).toBe(true);
    });

    it("keeps playback manual by default and stops on cancellation", async () => {
        const classification = session();
        vi.spyOn(Prompt.prototype, "prompt").mockResolvedValue(undefined);
        expect(
            await ClassifyPrompt.edit(classification, process.stderr)
        ).toBeNull();
        const player = vi.mocked(SamplePlayer).mock.instances[0]!;
        expect(player.toggle).not.toHaveBeenCalled();
        expect(player.stop).toHaveBeenCalledOnce();
    });
});
