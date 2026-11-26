import { Args } from "@oclif/core";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { SwissCommand } from "../../shared/command.js";
import { Editor } from "../../shared/editor.js";
import { Files } from "../../shared/files.js";
import { Text } from "../../shared/text.js";
import { SshFiles } from "../../topics/ssh/files.js";

export default class SshEdit extends SwissCommand {
    static override args = {
        file: Args.string({
            default: "config",
            description:
                "File to open, relative to ~/.ssh, like known_hosts, or a path",
        }),
    };

    static override description = `Open your ssh config, or another ssh file, in VS Code.

~/.ssh/config is created when it doesn't exist yet, readable only by you, as ssh requires. To pick from all your ssh files, use \`<%= config.bin %> ssh\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> known_hosts",
            description: "Open your known hosts, like to remove a stale one",
        },
    ];

    async run(): Promise<void> {
        const { args } = await this.parse(SshEdit);
        const file = path.resolve(
            SshFiles.DEFAULT_DIR,
            Files.expandHome(args.file)
        );
        const config = path.join(SshFiles.DEFAULT_DIR, "config");

        if (file === config) {
            await mkdir(SshFiles.DEFAULT_DIR, { mode: 0o700, recursive: true });
            await (await open(file, "a", 0o600)).close();
        } else if (!(await Files.exists(file))) {
            this.error(`${Text.displayPath(file)} doesn't exist`);
        }
        await Editor.open(file);
        this.log(`Opened ${Text.displayPath(file)}`);
    }
}
