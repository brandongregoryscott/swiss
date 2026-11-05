import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sample } from "./classify.js";
import {
    applyRenames,
    categoriesFrom,
    CATEGORIES,
    Classification,
    renamePlan,
    sampleFiles,
} from "./classify.js";

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof fs>();
    return { ...actual, link: vi.fn(actual.link) };
});

describe("sample classification", () => {
    const sample = (file: string, category: null | string = null): Sample => ({
        category,
        duration: 1.25,
        file,
    });

    it("cycles categories in both directions and retains assignments across navigation", () => {
        const samples = [sample("1.wav"), sample("2.wav")];
        const session = new Classification(samples, CATEGORIES);
        session.press({ name: "right" });
        expect(session.current.category).toBe("one-shot");
        session.press({ name: "left" });
        expect(session.current.category).toBeNull();
        session.press({ name: "left" });
        expect(session.current.category).toBe("fx");
        session.press({ name: "down" });
        session.press({ name: "right" });
        session.press({ name: "up" });
        expect(session.current.category).toBe("fx");
        session.press({ name: "backspace" });
        expect(session.current.category).toBeNull();
        expect(session.press({ name: "space" })).toBe("play");
        expect(session.press({ name: "return" })).toBe("review");
        expect(session.press({ ctrl: true, name: "c" })).toBe("cancel");
        expect(session.press({ name: "escape" })).toBe("cancel");
        expect(session.samples[1]!.category).toBe("one-shot");
        session.press({ name: "up" });
        expect(session.index).toBe(0);
        session.press({ meta: true, name: "right" });
        expect(session.current.category).toBeNull();
    });

    it("validates custom category names before they become paths", () => {
        expect(categoriesFrom("one-shot, field recording,fx")).toEqual([
            "one-shot",
            "field recording",
            "fx",
        ]);
        for (const text of [
            "",
            "one-shot,",
            "../escape",
            "fx,FX",
            "a/b",
            "a\nfoo",
        ]) {
            expect(() => categoriesFrom(text)).toThrow();
        }
    });

    it("numbers by category across formats, preserving extensions and unassigned files", () => {
        const samples = [
            sample("/samples/1.WAV", "one-shot"),
            sample("/samples/2.aiff", "one-shot"),
            sample("/samples/3.wav", "phrase"),
            sample("/samples/4.wav"),
        ];
        expect(
            renamePlan(samples, [
                "1.WAV",
                "2.aiff",
                "3.wav",
                "4.wav",
                "ONE-SHOT 1.WAV",
            ])
        ).toEqual([
            { from: "/samples/1.WAV", to: "/samples/one-shot 2.WAV" },
            { from: "/samples/2.aiff", to: "/samples/one-shot 3.aiff" },
            { from: "/samples/3.wav", to: "/samples/phrase 1.wav" },
        ]);
    });

    it("can exchange names, and excludes renames that would do nothing", () => {
        expect(
            renamePlan(
                [
                    sample("/s/one-shot 1.wav", "phrase"),
                    sample("/s/phrase 1.wav", "one-shot"),
                ],
                ["one-shot 1.wav", "phrase 1.wav"]
            )
        ).toEqual([
            { from: "/s/one-shot 1.wav", to: "/s/phrase 1.wav" },
            { from: "/s/phrase 1.wav", to: "/s/one-shot 1.wav" },
        ]);
        expect(
            renamePlan(
                [sample("/s/one-shot 1.wav", "one-shot")],
                ["one-shot 1.wav"]
            )
        ).toEqual([]);
    });
});

describe("sample files and batch renames", () => {
    let directory: string;
    const file = (name: string): string => path.join(directory, name);

    beforeEach(async () => {
        directory = await fs.mkdtemp(
            path.join(tmpdir(), "swiss-classify-test-")
        );
    });

    afterEach(async () => {
        const actual = await vi.importActual<typeof fs>("node:fs/promises");
        vi.mocked(fs.link).mockReset().mockImplementation(actual.link);
        await fs.rm(directory, { force: true, recursive: true });
    });

    it("discovers only regular audio files, in natural numeric order", async () => {
        await Promise.all(
            ["10.WAV", "2.wav", "1.wav", "notes.txt"].map((name) =>
                fs.writeFile(file(name), name)
            )
        );
        await fs.mkdir(file("nested.wav"));
        await fs.symlink(file("1.wav"), file("linked.wav"));
        expect(
            (await sampleFiles(directory)).map((name) => path.basename(name))
        ).toEqual(["1.wav", "2.wav", "10.WAV"]);
    });

    it("exchanges filenames without changing audio data and removes staging copies", async () => {
        await fs.writeFile(file("one-shot 1.wav"), "first audio");
        await fs.writeFile(file("phrase 1.wav"), "second audio");
        await applyRenames([
            { from: file("one-shot 1.wav"), to: file("phrase 1.wav") },
            { from: file("phrase 1.wav"), to: file("one-shot 1.wav") },
        ]);
        expect(await fs.readFile(file("phrase 1.wav"), "utf8")).toBe(
            "first audio"
        );
        expect(await fs.readFile(file("one-shot 1.wav"), "utf8")).toBe(
            "second audio"
        );
        expect((await fs.readdir(directory)).sort()).toEqual([
            "one-shot 1.wav",
            "phrase 1.wav",
        ]);
    });

    it("refuses a destination that appeared after review without changing sources", async () => {
        await fs.writeFile(file("1.wav"), "original");
        await fs.writeFile(file("fx 1.wav"), "keep me");
        await expect(
            applyRenames([{ from: file("1.wav"), to: file("fx 1.wav") }])
        ).rejects.toThrow("Already there");
        expect(await fs.readFile(file("1.wav"), "utf8")).toBe("original");
        expect(await fs.readFile(file("fx 1.wav"), "utf8")).toBe("keep me");
    });

    it("restores all original names if a later destination cannot be created", async () => {
        await fs.writeFile(file("1.wav"), "first");
        await fs.writeFile(file("2.wav"), "second");
        const { link: realLink } =
            await vi.importActual<typeof fs>("node:fs/promises");
        vi.mocked(fs.link).mockImplementation(async (from, to) => {
            if (to === file("fx 2.wav")) {
                throw new Error("simulated disk error");
            }
            await realLink(from, to);
        });
        await expect(
            applyRenames([
                { from: file("1.wav"), to: file("fx 1.wav") },
                { from: file("2.wav"), to: file("fx 2.wav") },
            ])
        ).rejects.toThrow("Nothing renamed");
        expect(await fs.readFile(file("1.wav"), "utf8")).toBe("first");
        expect(await fs.readFile(file("2.wav"), "utf8")).toBe("second");
        expect((await fs.readdir(directory)).sort()).toEqual([
            "1.wav",
            "2.wav",
        ]);
    });
});
