import { isEmpty } from "lodash-es";
import path from "node:path";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { Setting } from "../../topics/org/config-draft.js";
import type { OrgRepoList } from "../../topics/org/repos.js";
import { SwissCommand } from "../../shared/command.js";
import { ConfigError, ConfigFile } from "../../shared/config/config.js";
import { OrgConfigSection } from "../../shared/config/org-config.js";
import { OrgConfigDraft } from "../../topics/org/config-draft.js";
import { IgnoreList } from "../../topics/org/ignore-list.js";
import { OrgRepos, OrgReposError } from "../../topics/org/repos.js";

type MenuChoice = "discard" | "entries" | "repos" | "save" | "settings";

// The order settings are listed in, most commonly changed first.
const SETTINGS: Setting[] = [
    "name",
    "scmHost",
    "cloneProtocol",
    "rootDir",
    "skipArchived",
    "skipForks",
];

const SETTING_LABELS: Record<Setting, string> = {
    cloneProtocol: "Clone protocol",
    name: "GitHub org",
    rootDir: "Root directory",
    scmHost: "GitHub host",
    skipArchived: "Skip archived repos",
    skipForks: "Skip forks",
};

export default class OrgConfigCommand extends SwissCommand {
    // The org's repos, listed once for each org and host while editing.
    readonly #repos = OrgRepos.cached();

    static override cancelled = "Nothing saved";

    static override description = `Interactively edit the "${OrgConfigSection.NAME}" settings.

Pick repos to ignore from a filterable list of the org's repos (type to filter, Tab to toggle, Enter to confirm), keep or remove existing ignore entries and add new ones, or change the other settings. Repos already ignored by a pattern, archived repos and forks (when they're skipped) aren't listed.

Nothing is written until you choose "Save and exit", and the settings are checked the same way \`org sync\` checks them first. Needs an interactive terminal.

${OrgConfigSection.HELP}`;

    static override examples = ["<%= config.bin %> <%= command.id %>"];
    #draft = new OrgConfigDraft("", "", {});

    async run(): Promise<void> {
        await this.parse(OrgConfigCommand);
        this.terminal.requireInteractive(
            `edit ${path.join(this.config.configDir, ConfigFile.NAME)} directly instead`
        );

        this.#draft = await OrgConfigDraft.load(this.config.configDir);
        this.terminal.prompts.intro(
            `Editing ${OrgConfigSection.NAME} settings in ${this.#draft.path}`
        );

        if (this.#draft.text("name") === "") {
            await this.#editSetting("name");
        }

        for (;;) {
            const choice = await this.terminal.answer(
                this.terminal.prompts.select<MenuChoice>({
                    message: "What do you want to change?",
                    options: this.#menuOptions(),
                })
            );

            switch (choice) {
                case "discard": {
                    this.terminal.prompts.outro("Nothing saved");
                    return;
                }

                case "entries": {
                    await this.#editEntries();
                    break;
                }

                case "repos": {
                    await this.#pickRepos();
                    break;
                }

                case "save": {
                    if (await this.#save()) {
                        return;
                    }
                    break;
                }

                case "settings": {
                    await this.#editSettings();
                    break;
                }
            }
        }
    }

    // The settings as `org sync` reads them, or null, after explaining why, when it would reject
    // them.
    #check(): null | OrgConfig {
        try {
            return this.#draft.check();
        } catch (error) {
            if (!(error instanceof ConfigError)) {
                throw error;
            }
            this.terminal.prompts.log.error(error.message);
            return null;
        }
    }

    async #editEntries(): Promise<void> {
        const ignore = this.#draft.ignore();
        let kept = ignore;
        if (!isEmpty(ignore)) {
            kept = await this.terminal.answer(
                this.terminal.prompts.multiselect<string>({
                    initialValues: ignore,
                    message: "Ignore entries to keep",
                    options: ignore.map((entry) => ({
                        hint: IgnoreList.isPattern(entry) ? "pattern" : "repo",
                        value: entry,
                    })),
                    required: false,
                })
            );
        }

        const added: string[] = [];
        for (;;) {
            const entry = await this.terminal.answer(
                this.terminal.prompts.text({
                    message: "Add an ignore entry (leave blank to finish)",
                    placeholder: "a repo name, or a glob like ARCHIVED_*",
                })
            );
            const trimmed = (entry ?? "").trim();
            if (trimmed === "") {
                break;
            }
            added.push(trimmed);
        }

        this.#draft.setIgnore([...kept, ...added]);
    }

    async #editSetting(setting: Setting): Promise<void> {
        switch (setting) {
            case "cloneProtocol": {
                this.#draft.setText(
                    setting,
                    await this.terminal.answer(
                        this.terminal.prompts.select<string>({
                            initialValue: this.#draft.text(setting),
                            message: SETTING_LABELS.cloneProtocol,
                            options: [{ value: "ssh" }, { value: "https" }],
                        })
                    )
                );
                break;
            }

            case "name":
            case "rootDir":
            case "scmHost": {
                const value = await this.terminal.answer(
                    this.terminal.prompts.text({
                        initialValue: this.#draft.text(setting),
                        message: SETTING_LABELS[setting],
                        validate: (input) =>
                            (input ?? "").trim() === "" && setting === "name"
                                ? "Enter the GitHub org to sync"
                                : undefined,
                    })
                );
                this.#draft.setText(setting, value ?? "");
                break;
            }

            case "skipArchived":
            case "skipForks": {
                this.#draft.setFlag(
                    setting,
                    await this.terminal.answer(
                        this.terminal.prompts.confirm({
                            initialValue: this.#draft.flag(setting),
                            message: SETTING_LABELS[setting],
                        })
                    )
                );
                break;
            }
        }
    }

    async #editSettings(): Promise<void> {
        const setting = await this.terminal.answer(
            this.terminal.prompts.select<"back" | Setting>({
                message: "Which setting?",
                options: [
                    ...SETTINGS.map((key) => ({
                        hint: this.#draft.display(key),
                        label: SETTING_LABELS[key],
                        value: key,
                    })),
                    { label: "Back", value: "back" as const },
                ],
            })
        );
        if (setting !== "back") {
            await this.#editSetting(setting);
        }
    }

    // The org's repos with the draft's settings applied.
    async #listRepos(config: OrgConfig): Promise<null | OrgRepoList> {
        const listed = this.#repos.has(config.name, config.scmHost);
        const progress = this.terminal.spinner();
        if (!listed) {
            progress.start(`Listing repos in ${config.name}`);
        }
        try {
            const list = await OrgRepos.list(config, this.#repos.list);
            if (!listed) {
                progress.stop(`Found ${list.listed} repos in ${config.name}`);
            }
            if (list.truncated) {
                this.terminal.prompts.log.warn(OrgRepos.limitWarning(config));
            }
            return list;
        } catch (error) {
            if (!(error instanceof OrgReposError)) {
                throw error;
            }
            progress.error(error.message);
            return null;
        }
    }

    #menuOptions(): Array<{ hint?: string; label: string; value: MenuChoice }> {
        const ignore = this.#draft.ignore();
        const dirty = this.#draft.changed();
        return [
            {
                hint: `${ignore.filter((entry) => !IgnoreList.isPattern(entry)).length} ignored by name`,
                label: "Pick repos to ignore",
                value: "repos",
            },
            {
                hint: `${ignore.length} entries`,
                label: "Edit ignore entries and patterns",
                value: "entries",
            },
            { label: "Other settings", value: "settings" },
            {
                hint: dirty ? "unsaved changes" : undefined,
                label: "Save and exit",
                value: "save",
            },
            {
                label: dirty ? "Discard changes and exit" : "Exit",
                value: "discard",
            },
        ];
    }

    async #pickRepos(): Promise<void> {
        const config = this.#check();
        if (config == null) {
            return;
        }
        const list = await this.#listRepos(config);
        if (list == null) {
            return;
        }

        const { candidates, hiddenByPattern, selected } = IgnoreList.choices(
            list.syncable,
            config
        );
        if (!isEmpty(hiddenByPattern)) {
            this.terminal.prompts.log.info(
                `${hiddenByPattern.length} repos already ignored by a pattern aren't listed; change those under "Edit ignore entries and patterns"`
            );
        }

        const picked = await this.terminal.answer(
            this.terminal.prompts.autocompleteMultiselect<string>({
                initialValues: selected,
                maxItems: 15,
                message: "Repos to ignore",
                options: candidates.map((repo) => ({ value: repo.name })),
                placeholder: "Type to filter",
                required: false,
            })
        );

        this.#draft.setIgnore(
            IgnoreList.update(
                this.#draft.ignore(),
                candidates.map((repo) => repo.name),
                picked
            )
        );
    }

    // Saves the draft, or explains why it can't be saved and returns false.
    async #save(): Promise<boolean> {
        try {
            const configPath = await this.#draft.save();
            this.terminal.prompts.outro(`Saved to ${configPath}`);
            return true;
        } catch (error) {
            if (!(error instanceof ConfigError)) {
                throw error;
            }
            this.terminal.prompts.log.error(error.message);
            return false;
        }
    }
}
