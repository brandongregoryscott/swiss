import { Args, Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { Note } from "../../topics/note/notes.js";
import { SwissCommand } from "../../shared/command.js";
import { NoteError, Notes } from "../../topics/note/notes.js";

export default class NoteCopy extends SwissCommand {
    static override aliases = ["note:cp"];

    static override args = {
        note: Args.string({
            description:
                "ID of the note, or text to find the newest note whose text or label contains it [default: pick from a list]",
        }),
    };

    static override cancelled = "Nothing copied";

    static override description = `Copy a saved note to the clipboard.

Without a note, pick one from a list of your notes, newest first; type to filter it. Without an interactive terminal, the newest note is used. Pass --print to write the note to stdout instead, like in $(...).`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick a note to copy",
        },
        {
            command: "<%= config.bin %> <%= command.id %> 3",
            description: "Copy note #3",
        },
        {
            command:
                'curl -H "x-user-id: $(<%= config.bin %> <%= command.id %> acme --print)" localhost:3000/me',
            description:
                "Use the newest note mentioning acme in another command",
        },
    ];

    static override flags = {
        print: Flags.boolean({
            char: "p",
            description: "Write the note to stdout instead of the clipboard",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(NoteCopy);

        const notes = await Notes.load(this.config.dataDir);
        if (isEmpty(notes)) {
            throw new NoteError(
                `No notes yet; save one with \`${this.config.bin} note TEXT\``
            );
        }

        const note =
            args.note == null
                ? await this.#pick(notes)
                : Notes.find(notes, args.note);
        if (note == null) {
            throw new NoteError(
                `No note has ID ${args.note} or mentions it; run \`${this.config.bin} note\` to list them`
            );
        }

        if (flags.print) {
            process.stdout.write(`${note.text}\n`);
            return;
        }
        await this.copy(note.text, `note #${note.id}: ${Notes.preview(note)}`);
    }

    async #pick(notes: Note[]): Promise<Note> {
        const newest = Notes.newestFirst(notes);
        if (!this.terminal.interactive) {
            return newest[0]!;
        }

        const now = new Date();
        const picked = await this.terminal.answer(
            this.terminal.prompts.autocomplete({
                maxItems: 15,
                message: "Pick a note to copy",
                options: newest.map((note) => Notes.option(note, now)),
            })
        );
        return picked as Note;
    }
}
