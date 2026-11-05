import { Flags } from "@oclif/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { SwissCommand } from "../../shared/command.js";
import { ConfigFile } from "../../shared/config/config.js";

export default class ConfigShow extends SwissCommand {
    static override description = `Print the path and contents of the config file.

The file is ${ConfigFile.DISPLAY_PATH}. It's shown as written, so settings left out are at their defaults. The path goes to stderr, so stdout can be piped to jq.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: '$EDITOR "$(<%= config.bin %> <%= command.id %> --path)"',
            description: "Open the config file in your editor",
        },
    ];

    static override flags = {
        path: Flags.boolean({
            description: "Print only the path to the config file",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(ConfigShow);
        const configPath = path.join(this.config.configDir, ConfigFile.NAME);

        if (flags.path) {
            this.log(configPath);
            return;
        }

        if (!existsSync(configPath)) {
            this.error(
                `${configPath} doesn't exist yet; run \`${this.config.bin} config init\` to create it`
            );
        }

        const config = await ConfigFile.load(this.config.configDir);
        this.logToStderr(`# ${config.path}`);
        this.log(JSON.stringify(config.sections, null, 2));
    }
}
