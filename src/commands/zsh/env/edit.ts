import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { VariableStore } from "../../../shared/variable-editor.js";
import { SwissCommand } from "../../../shared/command.js";
import { VariableEditor } from "../../../shared/variable-editor.js";
import { zshFileFlag } from "../../../topics/zsh/flags.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";
import { ZshSyntax } from "../../../topics/zsh/syntax.js";

export default class ZshEnvEdit extends SwissCommand {
    static override cancelled = "Nothing saved";

    static override description = `Interactively add, change, rename and remove the environment variables your zsh startup files export.

Pick a variable to change its value, rename it or remove it, or add a new one, which goes in the file that exports the most variables already unless --file says otherwise. Values are hidden in the list unless you pass --reveal, and written in double quotes, so $VARIABLES in them expand when the shell starts.

Nothing is written until you choose "Save and exit". Each changed file is checked with zsh -n, and put back as it was if zsh finds a syntax error. Needs an interactive terminal.

${ZshStartup.FILES_HELP}`;

    static override examples = ["<%= config.bin %> <%= command.id %>"];

    static override flags = {
        file: zshFileFlag("variables"),
        reveal: Flags.boolean({
            char: "r",
            description: "Show values in the list instead of hiding them",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(ZshEnvEdit);
        this.terminal.requireInteractive(
            "use `zsh env set` and `zsh env unset` instead"
        );

        const startup = await ZshStartup.load();
        // Checked now, rather than after typing in a new variable.
        startup.target("export", flags.file);
        const store: VariableStore = {
            changed: () => !isEmpty(startup.changed()),
            checkName: (name) => {
                if (!ZshSyntax.isVariableName(name)) {
                    return "Use letters, digits and underscores, starting with a letter or underscore";
                }
                return name === "PATH"
                    ? "Use `zsh path add` to change PATH"
                    : undefined;
            },
            placeholder: "EDITOR",
            remove: (name) => startup.removeExport(name),
            rename: (from, to) => startup.renameExport(from, to),
            save: async () => {
                const written = await startup.save();
                return isEmpty(written)
                    ? "Nothing to save"
                    : `Saved ${written.map((file) => file.display).join(", ")}. ${ZshStartup.reloadHint(written)}`;
            },
            set: (name, value) => {
                startup.setExport(name, value, flags.file);
            },
            title: "Editing the variables your zsh startup files export",
            // The export of each variable that counts, which is the last one.
            variables: () =>
                [
                    ...new Map(
                        startup
                            .exports()
                            .map((variable) => [
                                variable.statement.name,
                                variable,
                            ])
                    ).values(),
                ].map((variable) => ({
                    location: ZshStartup.location(variable),
                    name: variable.statement.name,
                    readOnly: variable.statement.editable
                        ? undefined
                        : ZshStartup.readOnlyReason(variable),
                    value: variable.statement.value,
                })),
        };
        await VariableEditor.edit(this.terminal, store, {
            reveal: flags.reveal,
        });
    }
}
