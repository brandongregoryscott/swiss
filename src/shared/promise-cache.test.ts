import { describe, expect, it, vi } from "vitest";
import { PromiseCache } from "./promise-cache.js";

describe("PromiseCache", () => {
    it("loads each key once", async () => {
        const cache = new PromiseCache<string>();
        const load = vi.fn(() => Promise.resolve("loaded"));

        await cache.get("a", load);
        await cache.get("a", load);
        await cache.get("b", load);

        expect(load).toHaveBeenCalledTimes(2);
    });

    it("shares a load that's still running", async () => {
        const cache = new PromiseCache<string>();
        const load = vi.fn(() => Promise.resolve("loaded"));

        const result = await Promise.all([
            cache.get("a", load),
            cache.get("a", load),
        ]);

        expect(result).toEqual(["loaded", "loaded"]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("forgets a failed load so it's tried again", async () => {
        const cache = new PromiseCache<string>();
        const load = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce("loaded");
        await expect(cache.get("a", load)).rejects.toThrow("offline");

        const result = await cache.get("a", load);

        expect(result).toBe("loaded");
        expect(cache.has("a")).toBe(true);
    });

    it("says whether a key is cached", async () => {
        const cache = new PromiseCache<string>();
        await cache.get("a", () => Promise.resolve("loaded"));

        expect(cache.has("a")).toBe(true);
        expect(cache.has("b")).toBe(false);
    });
});
