import { SwissCommand } from "../shared/command.js";
import { ConfigFile } from "../shared/config/config.js";
import { ZshConfigSection } from "../shared/config/zsh-config.js";
import { Text } from "../shared/text.js";
import { TerminalProfile } from "../topics/configure/terminal-profile.js";
import { configureZsh } from "../topics/zsh/configure.js";
import { ZshStartup } from "../topics/zsh/startup.js";

export default class Configure extends SwissCommand {
    static override description = `Apply your Swiss configuration to this machine.

Reads ${ConfigFile.DISPLAY_PATH}, using defaults for settings left out. Run \`<%= config.bin %> config init\` to create an editable template.

Applies settings and bundled configuration files for your platform, reporting what changed and where each setting or file was written. Matching settings and files are left unchanged, so this is safe to rerun after updating Swiss or your config.`;

    static override examples = ["<%= config.bin %> <%= command.id %>"];

    async run(): Promise<void> {
        await this.parse(Configure);
        const settings = await ZshConfigSection.load(this.config.configDir);
        const startup = await ZshStartup.load();
        const changes = configureZsh(startup, settings);
        const written = await startup.save();
        this.table([
            ["Kind", "Name", "Status", "File"],
            ...changes.map(({ change, kind, name }) => [
                kind,
                name,
                change.status,
                ZshStartup.location(change),
            ]),
        ]);
        if (written.length === 0) {
            this.log("Your shell already has these settings");
        } else {
            this.log(this.style("dim", ZshStartup.reloadHint(written)));
        }
        const profile = await TerminalProfile.install(this.config.dataDir);
        if (profile != null) {
            this.log(
                `Terminal profile ${profile.status}: ${Text.displayPath(profile.path)}`
            );
            this.log(
                "Import this file in Terminal > Settings > Profiles > Import, then select it as the default if desired."
            );
        }
    }
}
