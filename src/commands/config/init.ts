import { isEmpty } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";
import { ConfigFile } from "../../shared/config/config.js";
import { OrgConfigSection } from "../../shared/config/org-config.js";
import { ZshConfigSection } from "../../shared/config/zsh-config.js";

const TEMPLATES = {
    [OrgConfigSection.NAME]: OrgConfigSection.TEMPLATE,
    [ZshConfigSection.NAME]: ZshConfigSection.TEMPLATE,
};

export default class ConfigInit extends SwissCommand {
    static override description = `Create the config file with every setting at its default.

The file is ${ConfigFile.DISPLAY_PATH}. Sections already in it are left untouched, so this is safe to rerun after upgrading to pick up sections for new commands. Required settings, like ${OrgConfigSection.NAME}.name, are left blank for you to fill in.`;

    static override examples = ["<%= config.bin %> <%= command.id %>"];

    async run(): Promise<void> {
        await this.parse(ConfigInit);

        const result = await ConfigFile.scaffold(
            this.config.configDir,
            TEMPLATES
        );

        if (isEmpty(result.added)) {
            this.log(`${result.path} already has every section`);
            return;
        }

        this.log(`Added ${result.added.join(", ")} to ${result.path}`);
    }
}
