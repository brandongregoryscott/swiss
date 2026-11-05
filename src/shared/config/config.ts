import {
    cloneDeep,
    compact,
    isArray,
    isBoolean,
    isEmpty,
    isObjectLike,
    isString,
} from "lodash-es";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.js";

type Config = {
    path: string;
    sections: Record<string, unknown>;
};

class ConfigError extends UserError {}

class ConfigSection {
    constructor(
        readonly source: string,
        readonly name: string,
        private readonly values: Record<string, unknown>
    ) {}

    boolean(key: string): boolean | undefined {
        const value = this.values[key];
        if (value == null) {
            return undefined;
        }
        if (!isBoolean(value)) {
            throw this.error(key, "must be true or false");
        }
        return value;
    }

    error(key: string, message: string): ConfigError {
        return new ConfigError(
            `${this.source}: ${this.name}.${key} ${message}`
        );
    }

    // A copy of the section's values, as they are in the file.
    raw(): Record<string, unknown> {
        return cloneDeep(this.values);
    }

    rejectUnknownKeys(knownKeys: string[]): void {
        const unknownKeys = Object.keys(this.values).filter(
            (key) => !knownKeys.includes(key)
        );
        if (!isEmpty(unknownKeys)) {
            throw new ConfigError(
                `${this.source}: ${this.name} has unknown keys: ${unknownKeys.join(", ")}`
            );
        }
    }

    string(key: string): string | undefined {
        const value = this.values[key];
        if (value == null) {
            return undefined;
        }
        if (!isString(value)) {
            throw this.error(key, "must be a string");
        }
        return value.trim();
    }

    stringList(key: string): string[] {
        const value = this.values[key];
        if (value == null) {
            return [];
        }
        if (!isArray(value) || !value.every(isString)) {
            throw this.error(key, "must be a list of strings");
        }

        return compact(value.map((entry) => entry.trim()));
    }
}

class ConfigFile {
    // Where the file is, for help text. oclif resolves the real path from XDG_CONFIG_HOME.
    static readonly DISPLAY_PATH =
        "~/.config/swiss/config.json (or $XDG_CONFIG_HOME/swiss/config.json)";

    static readonly NAME = "config.json";

    static getSection(config: Config, name: string): ConfigSection | null {
        const values = config.sections[name];
        if (values == null) {
            return null;
        }
        if (!isObject(values)) {
            throw new ConfigError(`${config.path}: ${name} must be an object`);
        }
        return new ConfigSection(config.path, name, values);
    }

    static async load(configDir: string): Promise<Config> {
        const configPath = path.join(configDir, ConfigFile.NAME);
        let contents: string;
        try {
            contents = await readFile(configPath, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return { path: configPath, sections: {} };
            }
            throw error;
        }

        let sections: unknown;
        try {
            sections = JSON.parse(contents);
        } catch (error) {
            throw new ConfigError(
                `${configPath} is not valid JSON: ${(error as Error).message}`
            );
        }

        if (!isObject(sections)) {
            throw new ConfigError(`${configPath} must contain a JSON object`);
        }
        return { path: configPath, sections };
    }

    // Adds any template section that config.json doesn't have yet, creating the file if needed.
    // Existing sections are left exactly as they are.
    static async scaffold(
        configDir: string,
        templates: Record<string, Record<string, unknown>>
    ): Promise<{ added: string[]; path: string }> {
        const config = await ConfigFile.load(configDir);
        const added = Object.keys(templates).filter(
            (name) => !(name in config.sections)
        );
        if (isEmpty(added)) {
            return { added, path: config.path };
        }

        const sections = { ...config.sections };
        for (const name of added) {
            sections[name] = templates[name];
        }

        await writeSections(configDir, config.path, sections);
        return { added, path: config.path };
    }

    // Replaces one section, leaving the others as they are. Returns the path written to.
    static async writeSection(
        configDir: string,
        name: string,
        values: Record<string, unknown>
    ): Promise<string> {
        const config = await ConfigFile.load(configDir);
        await writeSections(configDir, config.path, {
            ...config.sections,
            [name]: values,
        });
        return config.path;
    }
}

async function writeSections(
    configDir: string,
    configPath: string,
    sections: Record<string, unknown>
): Promise<void> {
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, `${JSON.stringify(sections, null, 2)}\n`);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return isObjectLike(value) && !isArray(value);
}

export type { Config };
export { ConfigError, ConfigFile, ConfigSection };
