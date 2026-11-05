import type { Config } from "@oclif/core";
import { Flags } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { Autocomplete } from "../../topics/zsh/autocomplete.js";
import { ZshStartup } from "../../topics/zsh/startup.js";

export default class AutocompleteCommand extends SwissCommand {
    static override description = `Set up tab completion for commands and flags in zsh.

Builds the completion files, then adds a line to your ~/.zshrc that loads them. The line is only added once: running this again leaves it alone, or brings it up to date. It also registers the completion for <%= config.binAliases %>, so it completes like <%= config.bin %>.

<%= config.bin %> and <%= config.binAliases %> need to be commands or functions, not aliases, since zsh completes what an alias expands to.

Run it again with --refresh-cache after adding or changing commands.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --refresh-cache",
            description: "Rebuild the completions without touching ~/.zshrc",
        },
    ];

    static override flags = {
        "refresh-cache": Flags.boolean({
            char: "r",
            description:
                "Only rebuild the completions, without changing ~/.zshrc",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(AutocompleteCommand);
        const Create = (await this.config
            .findCommand("autocomplete:create", { must: true })
            .load()) as unknown as new (
            argv: string[],
            config: Config
        ) => { run(): Promise<unknown> };
        await new Create([], this.config).run();
        this.log("Built the completions");
        if (flags["refresh-cache"]) {
            return;
        }

        const startup = await ZshStartup.load();
        const file = startup.zshrc();
        const change = Autocomplete.zshSetup(file.doc, {
            aliases: this.config.binAliases ?? [],
            bin: this.config.bin,
            cacheDir: this.config.cacheDir,
        });
        if (change.outcome === "unchanged") {
            this.log(
                this.style(
                    "dim",
                    `${file.display}:${change.line} already loads them`
                )
            );
            return;
        }

        startup.update(file, change.doc);
        const written = await startup.save();
        this.log(
            `${this.style("green", change.outcome === "added" ? "Added" : "Updated")} the setup line at ${file.display}:${change.line}`
        );
        this.log(this.style("dim", ZshStartup.reloadHint(written)));
    }
}
