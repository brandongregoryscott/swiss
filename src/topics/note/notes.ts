import { formatDistanceStrict } from "date-fns";
import {
    compact,
    isArray,
    isEmpty,
    isInteger,
    isString,
    maxBy,
    orderBy,
} from "lodash-es";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RemovalPlan } from "../../shared/removal.js";
import { UserError } from "../../shared/errors.js";

type Note = {
    createdAt: string;
    id: number;
    label?: string;
    text: string;
};

type NoteOption = { hint: string; label: string; value: Note };

class NoteError extends UserError {}

class Notes {
    static readonly DISPLAY_PATH =
        "~/.local/share/swiss/notes.json (or $XDG_DATA_HOME/swiss/notes.json)";

    static readonly FILE_NAME = "notes.json";

    static async add(
        dataDir: string,
        text: string,
        label?: string
    ): Promise<Note> {
        if (text.trim() === "") {
            throw new NoteError("The note is empty");
        }
        const notes = await Notes.load(dataDir);
        const note: Note = {
            createdAt: new Date().toISOString(),
            id: (maxBy(notes, "id")?.id ?? 0) + 1,
            ...(label == null || label.trim() === ""
                ? {}
                : { label: label.trim() }),
            text,
        };
        await save(dataDir, [...notes, note]);
        return note;
    }

    static age(note: Note, now = new Date()): string {
        return formatDistanceStrict(new Date(note.createdAt), now, {
            addSuffix: true,
        });
    }

    static find(notes: Note[], query: string): Note | undefined {
        const trimmed = query.trim().replace(/^#/, "");
        const byId = /^\d+$/.test(trimmed)
            ? notes.find((note) => note.id === Number(trimmed))
            : undefined;
        return byId ?? Notes.search(notes, query)[0];
    }

    static async load(dataDir: string): Promise<Note[]> {
        const notesPath = Notes.path(dataDir);
        let contents: string;
        try {
            contents = await readFile(notesPath, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return [];
            }
            throw error;
        }

        let notes: unknown;
        try {
            notes = JSON.parse(contents);
        } catch (error) {
            throw new NoteError(
                `${notesPath} is not valid JSON: ${(error as Error).message}`
            );
        }
        if (!isArray(notes) || !notes.every(isNote)) {
            throw new NoteError(
                `${notesPath} must contain a list of notes, each with an id, text and createdAt`
            );
        }
        return notes;
    }

    static newestFirst(notes: Note[]): Note[] {
        return orderBy(notes, "id", "desc");
    }

    static option(note: Note, now: Date): NoteOption {
        return {
            hint: compact([note.label, Notes.age(note, now)]).join(", "),
            label: `#${note.id} ${Notes.preview(note)}`,
            value: note,
        };
    }

    static path(dataDir: string): string {
        return path.join(dataDir, Notes.FILE_NAME);
    }

    // Removing the notes queries find, by ID or by text, as find does.
    static planRemoval(
        dataDir: string,
        notes: Note[],
        queries: string[]
    ): RemovalPlan<Note> {
        const items = new Map<number, Note>();
        const missing: string[] = [];
        for (const query of queries) {
            const note = Notes.find(notes, query);
            if (note == null) {
                missing.push(query);
            } else {
                items.set(note.id, note);
            }
        }
        return {
            blocked: [],
            items: [...items.values()],
            missing,
            remove: async () => {
                await Notes.remove(dataDir, [...items.keys()]);
                return [];
            },
        };
    }

    static preview(note: Note): string {
        const lines = note.text.trim().split(/\r?\n/);
        return lines.length > 1 ? `${lines[0]} …` : lines[0]!;
    }

    static async remove(dataDir: string, ids: number[]): Promise<Note[]> {
        const notes = await Notes.load(dataDir);
        const removed = notes.filter((note) => ids.includes(note.id));
        if (!isEmpty(removed)) {
            await save(
                dataDir,
                notes.filter((note) => !ids.includes(note.id))
            );
        }
        return removed;
    }

    static search(notes: Note[], query: string): Note[] {
        const needle = query.trim().toLowerCase();
        return Notes.newestFirst(notes).filter((note) =>
            [note.text, note.label ?? ""].some((value) =>
                value.toLowerCase().includes(needle)
            )
        );
    }
}

async function save(dataDir: string, notes: Note[]): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
        Notes.path(dataDir),
        `${JSON.stringify(notes, null, 2)}\n`,
        { mode: 0o600 }
    );
}

function isNote(value: unknown): value is Note {
    const note = value as null | Partial<Note>;
    return (
        note != null &&
        isInteger(note.id) &&
        isString(note.text) &&
        isString(note.createdAt) &&
        (note.label == null || isString(note.label))
    );
}

export type { Note };
export { NoteError, Notes };
