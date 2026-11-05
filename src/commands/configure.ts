import { SwissCommand } from "../shared/command.js";
import { ConfigFile } from "../shared/config/config.js";
import { ZshConfigSection } from "../shared/config/zsh-config.js";
import { configureZsh } from "../topics/zsh/configure.js";
import { ZshStartup } from "../topics/zsh/startup.js";

export default class Configure extends SwissCommand {
    static override description = `Ensure your zsh startup files contain the aliases, environment variables, and PATH additions in your Swiss config.

Settings live in the "zsh" section of ${ConfigFile.DISPLAY_PATH}. Run \`<%= config.bin %> config init\` to write an editable template. Without that section, the defaults install Finder show/hide aliases, reload and the gcsquash alias. Finder aliases require macOS; no Oh My Zsh plugins are required.

aliases and env map names to command or value strings; path is a list of directories to prepend to PATH. Omitted settings use defaults. An explicit aliases object replaces the default alias selection, including gcsquash. Settings left out do not delete existing shell definitions.

Existing editable definitions are updated where they live. New aliases, exports and paths use the same placement as the zsh set/add commands; gcsquash delegates to the TypeScript git squash command. Matching definitions are left unchanged, so this is safe to rerun. Changes are checked with zsh -n. Existing editable functions with the same names are replaced with aliases. No files from a Swiss checkout are sourced. Environment values are never printed.

gcsquash [--from BRANCH | -f BRANCH] COMMIT MESSAGE... requires a clean working tree and an ancestor base, defaults to origin/HEAD then local main or master, and saves a recovery reference before rewriting history.

${ZshStartup.FILES_HELP}`;

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
    }
}
