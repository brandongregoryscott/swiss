import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { LIST_FLAGS, listHelp, SwissCommand } from "../../shared/command.js";
import { Input } from "../../shared/input.js";
import { noteList } from "../../topics/note/list.js";
import { NoteError, Notes } from "../../topics/note/notes.js";

export default class NoteCommand extends SwissCommand {
    static override description = `Jot down a note, like a user ID or a snippet, or list the ones you've saved.

With text, from the arguments, stdin or --clipboard, it's saved as a new note. Without any, your notes are listed, newest first, like \`<%= config.bin %> note list\`, which can also search them.

${listHelp("copy it to the clipboard")}

Notes are kept in ${Notes.DISPLAY_PATH}, outside any repo, and only you can read the file. Copy one back with \`<%= config.bin %> note copy\` and delete them with \`<%= config.bin %> note remove\`.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "List your notes",
        },
        {
            command:
                '<%= config.bin %> <%= command.id %> 8f3a2c1e-acme --label "acme test user"',
            description: "Save a user ID with a label to find it by",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --clipboard",
            description: "Save what's on the clipboard",
        },
        {
            command:
                "curl -s localhost:3000/health | <%= config.bin %> <%= command.id %>",
            description: "Save a command's output",
        },
    ];

    static override flags = {
        ...LIST_FLAGS,
        clipboard: Flags.boolean({
            char: "c",
            description: "Save what's on the clipboard",
        }),
        label: Flags.string({
            char: "l",
            description:
                "Label shown next to the note, which `note copy` and `note remove` search too",
        }),
    };

    static override strict = false;

    static override usage = "note [TEXT...] [-c] [-l <value>] [-t]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(NoteCommand);

        const text = await this.#read(argv as string[], flags.clipboard);
        if (text == null) {
            await this.listItems(
                noteList(await Notes.load(this.config.dataDir), {
                    bin: this.config.bin,
                    table: flags.table,
                })
            );
            return;
        }

        const note = await Notes.add(this.config.dataDir, text, flags.label);
        this.log(
            this.style(
                "green",
                `Saved note #${note.id}: ${Notes.preview(note)}`
            )
        );
    }

    async #read(
        argv: string[],
        clipboard: boolean
    ): Promise<string | undefined> {
        if (clipboard) {
            if (!isEmpty(argv)) {
                throw new NoteError("Pass text or --clipboard, not both");
            }
            return withoutFinalNewline(await Input.clipboard("the note"));
        }
        if (!isEmpty(argv)) {
            return argv.join(" ");
        }
        if (Input.isPiped()) {
            const piped = withoutFinalNewline(await Input.piped());
            return piped === "" ? undefined : piped;
        }
        return undefined;
    }
}

// The text, without the newline that usually ends piped or copied text.
function withoutFinalNewline(data: Buffer): string {
    return data.toString("utf8").replace(/\r?\n$/, "");
}
