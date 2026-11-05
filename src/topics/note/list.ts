import type { ListSpec } from "../../shared/listing.js";
import type { Note } from "./notes.js";
import { Clipboard } from "../../shared/clipboard.js";
import { matchesSearch } from "../../shared/listing.js";
import { Notes } from "./notes.js";

type NoteListOptions = {
    // The command's name, for saying how to save a note.
    bin: string;
    search?: string;
    table: boolean;
};

// How `note` and `note list` list notes, newest first, copying the one picked.
function noteList(notes: Note[], options: NoteListOptions): ListSpec<Note> {
    const now = new Date();
    return {
        action: "copy it",
        choice: (note) => {
            const { hint, label } = Notes.option(note, now);
            return { hint, label };
        },
        columns: ["ID", "AGE", "LABEL", "NOTE"],
        empty:
            options.search == null
                ? `No notes yet; save one with \`${options.bin} note TEXT\``
                : `No notes match ${JSON.stringify(options.search)}`,
        items: Notes.newestFirst(notes).filter((note) =>
            matchesSearch(options.search, [note.label ?? "", note.text])
        ),
        noun: ["note", "notes"],
        async open(note) {
            await Clipboard.copy(note.text);
            return `Copied note #${note.id}`;
        },
        row: (note) => [
            `#${note.id}`,
            Notes.age(note, now),
            note.label ?? "",
            Notes.preview(note),
        ],
        table: options.table,
        title: "Your notes, newest first",
        verb: "Copied",
    };
}

export { noteList };
