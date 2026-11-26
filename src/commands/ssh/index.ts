import type { SshFile } from "../../topics/ssh/files.js";
import { LIST_FLAGS, listHelp, SwissCommand } from "../../shared/command.js";
import { Editor } from "../../shared/editor.js";
import { Text } from "../../shared/text.js";
import { SshFiles } from "../../topics/ssh/files.js";

export default class SshCommand extends SwissCommand {
    static override description = `List your ssh files: your config and the files it includes, known hosts, authorized keys, and key pairs, with what's in each.

${listHelp("open it in VS Code")}

Config files are ~/.ssh/config and any it pulls in with Include, wherever they are. Everything else is what's in ~/.ssh. A private key that other users can read is flagged, since ssh refuses to use it.

To open your config straight away, use \`<%= config.bin %> ssh edit\`. To see your hosts, use \`<%= config.bin %> ssh hosts\`, and to copy a public key, \`<%= config.bin %> ssh keys\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --table",
            description: "Print them as a table",
        },
    ];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { flags } = await this.parse(SshCommand);
        const directory = await SshFiles.load();

        await this.listItems<SshFile>({
            action: "open it in VS Code",
            choice: (file) => ({
                hint: [file.kind, file.detail]
                    .filter((part) => part !== "")
                    .join(" · "),
                label: file.display,
            }),
            columns: ["KIND", "FILE", "DETAILS"],
            empty: `No ssh files in ${Text.displayPath(directory.path)}`,
            fit: false,
            items: directory.files,
            noun: ["file", "files"],
            async open(file) {
                await Editor.open(file.path);
                return `Opened ${file.display}`;
            },
            row: (file) => [file.kind, file.display, file.detail],
            table: flags.table,
            title: "Your ssh files",
            verb: "Opened",
        });
    }
}
