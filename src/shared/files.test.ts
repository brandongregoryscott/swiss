import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Files } from "./files.js";

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "swiss-files-"));
    writeFileSync(path.join(dir, "README.md"), "hi\n");
});

afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
});

describe("Files", () => {
    it("says why a path isn't a directory it can use", async () => {
        const file = path.join(dir, "README.md");

        await expect(Files.requireDirectory(dir)).resolves.toBeUndefined();
        await expect(Files.requireDirectory(file)).rejects.toThrow(
            "isn't a directory"
        );
        await expect(
            Files.requireDirectory(path.join(dir, "missing"))
        ).rejects.toThrow("isn't a directory");
        expect(await Files.isDirectory(dir)).toBe(true);
        expect(await Files.isDirectory(file)).toBe(false);
    });

    it("lists the directories from one up to the root", () => {
        const result = Files.ancestors("/repo", "/repo/apps/web");

        expect(result).toEqual(["/repo/apps/web", "/repo/apps", "/repo"]);
    });

    it("stops at the filesystem root when the start isn't under the root", () => {
        const result = Files.ancestors("/repo", "/elsewhere");

        expect(result).toEqual(["/elsewhere", "/"]);
    });

    it("says whether a file exists", async () => {
        expect(await Files.exists(path.join(dir, "README.md"))).toBe(true);
        expect(await Files.exists(path.join(dir, "missing"))).toBe(false);
    });

    it("throws errors other than a missing file", async () => {
        const result = Files.exists(path.join(dir, "README.md", "child"));

        await expect(result).rejects.toThrow("ENOTDIR");
    });
});
