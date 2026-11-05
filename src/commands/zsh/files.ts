import type { ZshFile } from "../../topics/zsh/startup.js";
import { LIST_FLAGS, listHelp, SwissCommand } from "../../shared/command.js";
import { Editor } from "../../shared/editor.js";
import { ZshStartup } from "../../topics/zsh/startup.js";

export default class ZshFiles extends SwissCommand {
    static override description = `List the zsh startup files the other zsh commands read and change, in the order zsh runs them, with how many aliases, exported variables and PATH changes are in each.

${listHelp("open it in VS Code")}

${ZshStartup.FILES_HELP.replace(/ `.*$/, "")}`;

    static override examples = ["<%= config.bin %> <%= command.id %>"];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { flags } = await this.parse(ZshFiles);
        const { files } = await ZshStartup.load();
        const count = (
            file: ZshFile,
            kind: Parameters<typeof ZshStartup.is>[1]
        ): number =>
            file.statements.filter((statement) =>
                ZshStartup.is(statement, kind)
            ).length;

        await this.listItems<ZshFile>({
            action: "open it in VS Code",
            choice: (file) => ({
                hint: `${count(file, "alias")} aliases, ${count(file, "export")} variables, ${count(file, "path")} PATH changes`,
                label: file.display,
            }),
            columns: ["ALIASES", "VARIABLES", "PATH", "FILE"],
            empty: "No zsh startup files",
            fit: false,
            items: files,
            noun: ["file", "files"],
            async open(file) {
                await Editor.open(file.path);
                return `Opened ${file.display}`;
            },
            row: (file) => [
                String(count(file, "alias")),
                String(count(file, "export")),
                String(count(file, "path")),
                file.display,
            ],
            table: flags.table,
            title: "Your zsh startup files, in the order zsh runs them",
            verb: "Opened",
        });
    }
}
