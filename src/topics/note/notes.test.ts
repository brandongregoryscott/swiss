import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "./notes.js";
import { NoteError, Notes } from "./notes.js";

const NOTES: Note[] = [
    { createdAt: "2026-10-01T00:00:00.000Z", id: 1, text: "user-123" },
    {
        createdAt: "2026-10-02T00:00:00.000Z",
        id: 2,
        label: "Acme admin",
        text: "user-456",
    },
    { createdAt: "2026-10-03T00:00:00.000Z", id: 3, text: "user-789\nmore" },
];

describe("Notes", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await mkdtemp(path.join(tmpdir(), "swiss-notes-"));
    });

    afterEach(async () => {
        await rm(dataDir, { force: true, recursive: true });
    });

    describe("planRemoval", () => {
        it("finds notes by ID or text, and notes queries that match nothing", async () => {
            await Notes.add(dataDir, "first");
            await Notes.add(dataDir, "deploy steps");
            const notes = await Notes.load(dataDir);

            const plan = Notes.planRemoval(dataDir, notes, [
                "1",
                "deploy",
                "2",
                "missing",
            ]);

            expect(plan.items.map((note) => note.id)).toEqual([1, 2]);
            expect(plan.missing).toEqual(["missing"]);

            await plan.remove();

            expect(await Notes.load(dataDir)).toEqual([]);
        });
    });

    describe("add", () => {
        it("numbers notes after the highest ID", async () => {
            await Notes.add(dataDir, "first");
            await Notes.add(dataDir, "second", " label ");

            const result = await Notes.load(dataDir);

            expect(
                result.map(({ id, label, text }) => ({ id, label, text }))
            ).toEqual([
                { id: 1, label: undefined, text: "first" },
                { id: 2, label: "label", text: "second" },
            ]);
        });

        it("rejects an empty note", async () => {
            await expect(Notes.add(dataDir, "  \n")).rejects.toThrow(NoteError);
        });

        it("makes the file readable only by you", async () => {
            await Notes.add(dataDir, "secret");

            const result = await stat(Notes.path(dataDir));

            expect(result.mode & 0o777).toBe(0o600);
        });
    });

    describe("load", () => {
        it("returns no notes when there's no file", async () => {
            const result = await Notes.load(dataDir);

            expect(result).toEqual([]);
        });

        it("rejects a file that isn't a list of notes", async () => {
            await writeFile(Notes.path(dataDir), '{"id": 1}');

            await expect(Notes.load(dataDir)).rejects.toThrow(
                "must contain a list of notes"
            );
        });
    });

    describe("find", () => {
        it("finds a note by ID, with or without #", () => {
            expect(Notes.find(NOTES, "2")?.id).toBe(2);
            expect(Notes.find(NOTES, "#2")?.id).toBe(2);
        });

        it("finds the newest note whose text or label contains the query", () => {
            expect(Notes.find(NOTES, "USER")?.id).toBe(3);
            expect(Notes.find(NOTES, "acme")?.id).toBe(2);
        });

        it("searches text when no note has the number as its ID", () => {
            const result = Notes.find(NOTES, "123");

            expect(result?.id).toBe(1);
        });

        it("returns undefined when nothing matches", () => {
            const result = Notes.find(NOTES, "nope");

            expect(result).toBeUndefined();
        });
    });

    describe("preview", () => {
        it("shows the first line of a note spanning several", () => {
            const result = Notes.preview(NOTES[2]!);

            expect(result).toBe("user-789 …");
        });
    });

    describe("remove", () => {
        it("removes the notes with the IDs and returns them", async () => {
            await writeFile(Notes.path(dataDir), JSON.stringify(NOTES));

            const removed = await Notes.remove(dataDir, [1, 3, 99]);

            expect(removed.map((note) => note.id)).toEqual([1, 3]);
            expect(
                JSON.parse(await readFile(Notes.path(dataDir), "utf8"))
            ).toEqual([NOTES[1]]);
        });
    });
});
