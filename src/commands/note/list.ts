import {
    LIST_FLAGS,
    listHelp,
    searchArg,
    SwissCommand,
} from "../../shared/command.js";
import { noteList } from "../../topics/note/list.js";
import { Notes } from "../../topics/note/notes.js";

export default class NoteList extends SwissCommand {
    static override aliases = ["note:ls"];

    static override args = {
        search: searchArg("notes", "label or text"),
    };

    static override description = `List your saved notes, newest first.

${listHelp("copy it to the clipboard")}

\`<%= config.bin %> note\` without any text lists them too.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> acme",
            description: "Find the notes that mention acme",
        },
    ];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(NoteList);
        await this.listItems(
            noteList(await Notes.load(this.config.dataDir), {
                bin: this.config.bin,
                search: args.search,
                table: flags.table,
            })
        );
    }
}
