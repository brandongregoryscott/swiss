import { cloneDeep, isArray, isBoolean, isEqual, isString } from "lodash-es";
import type { OrgConfig } from "../../shared/config/org-config.js";
import { ConfigFile, ConfigSection } from "../../shared/config/config.js";
import { OrgConfigSection } from "../../shared/config/org-config.js";

// Settings given as text, which go back to their default when left blank.
type TextSetting = "cloneProtocol" | "name" | "rootDir" | "scmHost";

type FlagSetting = "skipArchived" | "skipForks";

type Setting = FlagSetting | TextSetting;

// The org settings being edited. It holds only what's in the file, so a setting that's left out
// keeps following its default, and nothing is written until save().
class OrgConfigDraft {
    readonly #configDir: string;
    readonly path: string;
    #saved: Record<string, unknown>;
    #values: Record<string, unknown>;

    constructor(
        configDir: string,
        configPath: string,
        values: Record<string, unknown>
    ) {
        this.#configDir = configDir;
        this.path = configPath;
        this.#values = values;
        this.#saved = cloneDeep(values);
    }

    // The org settings in configDir's config file, or every setting with its default and the org
    // left blank when there aren't any yet.
    static async load(configDir: string): Promise<OrgConfigDraft> {
        const config = await ConfigFile.load(configDir);
        const section = ConfigFile.getSection(config, OrgConfigSection.NAME);
        return new OrgConfigDraft(
            configDir,
            config.path,
            section?.raw() ?? cloneDeep(OrgConfigSection.TEMPLATE)
        );
    }

    // Whether anything has changed since it was loaded or saved.
    changed(): boolean {
        return !isEqual(this.#values, this.#saved);
    }

    // The settings as `org sync` reads them, or a ConfigError saying what `org sync` would reject.
    check(): OrgConfig {
        return OrgConfigSection.parse(
            new ConfigSection(
                ConfigFile.NAME,
                OrgConfigSection.NAME,
                this.#values
            )
        );
    }

    // A setting for listing, like "yes", "github.com" or "(not set)".
    display(setting: Setting): string {
        if (setting === "skipArchived" || setting === "skipForks") {
            return this.flag(setting) ? "yes" : "no";
        }
        const value = this.text(setting);
        return value === "" ? "(not set)" : value;
    }

    // The setting, or its default when it isn't set to true or false.
    flag(setting: FlagSetting): boolean {
        const value = this.#values[setting];
        return isBoolean(value) ? value : OrgConfigSection.DEFAULTS[setting];
    }

    ignore(): string[] {
        const value = this.#values.ignore;
        return isArray(value) ? value.filter(isString) : [];
    }

    // Checks the settings the way `org sync` will, then writes them. Returns the file written.
    async save(): Promise<string> {
        this.check();
        const configPath = await ConfigFile.writeSection(
            this.#configDir,
            OrgConfigSection.NAME,
            this.#values
        );
        this.#saved = cloneDeep(this.#values);
        return configPath;
    }

    setFlag(setting: FlagSetting, value: boolean): void {
        this.#values[setting] = value;
    }

    setIgnore(entries: string[]): void {
        this.#values.ignore = entries;
    }

    // Sets a text setting, or removes it when value is blank, so its default applies again.
    setText(setting: TextSetting, value: string): void {
        const trimmed = value.trim();
        if (trimmed === "") {
            delete this.#values[setting];
        } else {
            this.#values[setting] = trimmed;
        }
    }

    // The setting, or its default when it isn't set. The org has no default, so it's "" then.
    text(setting: TextSetting): string {
        const value = this.#values[setting];
        if (isString(value) && value.trim() !== "") {
            return value.trim();
        }
        return setting === "name" ? "" : OrgConfigSection.DEFAULTS[setting];
    }
}

export type { FlagSetting, Setting, TextSetting };
export { OrgConfigDraft };
