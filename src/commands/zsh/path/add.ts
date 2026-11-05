import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { ZshFile } from "../../../topics/zsh/startup.js";
import { SwissCommand } from "../../../shared/command.js";
import { Files } from "../../../shared/files.js";
import { Text } from "../../../shared/text.js";
import { zshFileFlag } from "../../../topics/zsh/flags.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

export default class ZshPathAdd extends SwissCommand {
    static override description = `Add directories to PATH in your zsh startup files.

Each directory gets its own line, like export PATH="$HOME/.local/bin:$PATH", using $HOME for directories in your home directory. They go at the front of PATH, so commands in them win over ones with the same name elsewhere, unless you pass --append.

The lines go in the file that changes PATH the most already, after the last of those changes, unless --file says otherwise. Directories your startup files already add are left alone, and ones that don't exist yet are added with a warning.

The file is checked with zsh -n afterwards, and put back as it was if zsh finds a syntax error.

${ZshStartup.FILES_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> ~/.local/bin",
        {
            command:
                "<%= config.bin %> <%= command.id %> /opt/tools/bin --append",
            description: "Add a directory at the end, so it's searched last",
        },
    ];

    static override flags = {
        append: Flags.boolean({
            char: "a",
            description:
                "Add to the end of PATH instead of the front, so other directories win",
        }),
        file: zshFileFlag("PATH changes"),
    };

    // Takes any number of directories.
    static override strict = false;

    static override usage = "zsh path add DIR... [-a] [-f FILE]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(ZshPathAdd);
        if (isEmpty(argv)) {
            this.error("Give at least one directory to add, like ~/.local/bin");
        }

        const startup = await ZshStartup.load();
        const changed: ZshFile[] = [];
        for (const input of argv as string[]) {
            const dir = startup.resolveDir(input);
            const change = startup.addPath(dir, {
                append: flags.append,
                file: flags.file,
            });
            if (change.status === "unchanged") {
                this.log(
                    `${Text.displayPath(dir)} ${this.style("dim", `is already added at ${ZshStartup.location(change)}`)}`
                );
                continue;
            }
            if (!(await Files.isDirectory(dir))) {
                this.warn(`${Text.displayPath(dir)} doesn't exist yet`);
            }
            changed.push(...(await startup.save()));
            this.log(
                `${this.style("green", "Added")} ${Text.displayPath(dir)} at ${ZshStartup.location(change)}`
            );
        }
        if (!isEmpty(changed)) {
            this.log(this.style("dim", ZshStartup.reloadHint(changed)));
        }
    }
}
