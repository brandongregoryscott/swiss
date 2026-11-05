import { Flags } from "@oclif/core";
import { isEmpty, uniq } from "lodash-es";
import type { Note } from "../../topics/note/notes.js";
import {
    REMOVE_FLAGS,
    REMOVE_HELP,
    SwissCommand,
} from "../../shared/command.js";
import { NoteError, Notes } from "../../topics/note/notes.js";

export default class NoteRemove extends SwissCommand {
    static override aliases = ["note:rm"];

    static override cancelled = "Nothing removed";

    static override description = `Remove saved notes.

Give notes by ID, or by text to find the newest note whose text or label contains it, or pass --all to remove every note.

${REMOVE_HELP}`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick notes to remove from a list",
        },
        {
            command: "<%= config.bin %> <%= command.id %> 3 4",
            description: "Remove notes #3 and #4",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --all --yes",
            description: "Remove every note without asking",
        },
    ];

    static override flags = {
        all: Flags.boolean({
            char: "a",
            description: "Remove every note",
        }),
        ...REMOVE_FLAGS,
    };

    // Takes any number of notes.
    static override strict = false;

    static override usage = "note remove [NOTE...] [-a] [-y]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(NoteRemove);
        const queries = uniq(argv as string[]);
        if (flags.all && !isEmpty(queries)) {
            throw new NoteError("Pass notes or --all, not both");
        }

        const notes = await Notes.load(this.config.dataDir);
        const now = new Date();
        await this.removeItems<Note>({
            choices: async () =>
                Notes.newestFirst(notes).map((note) => ({
                    ...Notes.option(note, now),
                    value: String(note.id),
                })),
            columns: ["ID", "NOTE"],
            describe: (note) => `note #${note.id}`,
            names: flags.all ? notes.map((note) => String(note.id)) : queries,
            notFound: (missing) =>
                `No note has the ID or text ${missing.join(", ")}; run \`${this.config.bin} note\` to list them`,
            noun: ["note", "notes"],
            plan: async (picked) =>
                Notes.planRemoval(this.config.dataDir, notes, picked),
            row: (note) => [`#${note.id}`, Notes.preview(note)],
            yes: flags.yes,
        });
    }
}
