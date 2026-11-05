import { mkdtempSync, rmSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isExternalFailure, nullIfMissing, settle } from "./errors.js";
import { CommandError } from "./exec.js";

describe("isExternalFailure", () => {
    it("counts failed commands and file errors, but not bugs", async () => {
        const fileError = await lstat("/nonexistent/swiss").catch(
            (error: unknown) => error
        );

        expect(isExternalFailure(new CommandError("git failed"))).toBe(true);
        expect(isExternalFailure(fileError)).toBe(true);
        expect(isExternalFailure(new TypeError("x is undefined"))).toBe(false);
        expect(isExternalFailure("thrown string")).toBe(false);
    });
});

describe("nullIfMissing", () => {
    it("treats only a missing file as missing", async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "swiss-errors-"));
        try {
            expect(
                await lstat(path.join(dir, "missing")).catch(nullIfMissing)
            ).toBeNull();
            // A file in place of a directory is a different error, which is passed on.
            await expect(
                lstat(path.join(import.meta.filename, "child")).catch(
                    nullIfMissing
                )
            ).rejects.toMatchObject({ code: "ENOTDIR" });
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });
});

describe("settle", () => {
    it("records an external failure for the item, and lets bugs through", async () => {
        expect(await settle(() => Promise.resolve("cloned"))).toBe("cloned");
        expect(
            await settle(() => Promise.reject(new CommandError("git failed")))
        ).toEqual({ reason: "git failed", status: "error" });
        await expect(
            settle(() => Promise.reject(new TypeError("x is undefined")))
        ).rejects.toThrow(TypeError);
    });
});
