import { isArray, isEmpty } from "lodash-es";
import { homedir } from "node:os";
import path from "node:path";
import type { ConfigSection } from "./config.js";
import { Text } from "../text.js";
import { ConfigError, ConfigFile } from "./config.js";

type CloneProtocol = "https" | "ssh";

type OrgConfig = {
    cloneProtocol: CloneProtocol;
    ignore: string[];
    name: string;
    rootDir: string;
    scmHost: string;
    skipArchived: boolean;
    skipForks: boolean;
};

// What each setting does, for help text.
const SETTING_HELP: Record<keyof OrgConfig, string> = {
    cloneProtocol: "ssh or https",
    ignore: "Skip repos matching any of these globs",
    name: "The GitHub org (required)",
    rootDir: "Repos live at <rootDir>/<repo>, with no org folder",
    scmHost: "The GitHub host",
    skipArchived: "Skip archived repos",
    skipForks: "Skip forks",
};

class OrgConfigSection {
    static readonly DEFAULTS = {
        cloneProtocol: "ssh",
        ignore: [],
        rootDir: "~",
        scmHost: "github.com",
        skipArchived: true,
        skipForks: true,
    } as const satisfies Omit<OrgConfig, "name">;

    // What `config init` writes: every key, with name left blank for the user to fill in.
    static readonly TEMPLATE = { name: "", ...OrgConfigSection.DEFAULTS };

    // Every setting, its default, and how ignore globs match, for help text.
    static readonly HELP = `Settings live in the "org" section of ${ConfigFile.DISPLAY_PATH}, which is plain JSON:

${Text.definitionList(
    Object.keys(OrgConfigSection.TEMPLATE).map((key) => [
        key,
        describeSetting(key as keyof OrgConfig, OrgConfigSection.DEFAULTS),
    ])
)}

Ignore globs match the whole repo name, ignoring case: * matches any run of characters, ? matches one, and {a,b} matches either. So "sandbox" only matches a repo named exactly sandbox, and "*sandbox*" matches any name containing it.`;

    static readonly NAME = "org";

    static async load(configDir: string): Promise<OrgConfig> {
        const config = await ConfigFile.load(configDir);
        const section = ConfigFile.getSection(config, OrgConfigSection.NAME);
        if (section == null) {
            throw new ConfigError(
                `Add ${OrgConfigSection.NAME} settings to ${config.path}, at least:\n\n  {"${OrgConfigSection.NAME}": {"name": "<github-org>"}}`
            );
        }

        return OrgConfigSection.parse(section);
    }

    static parse(section: ConfigSection): OrgConfig {
        section.rejectUnknownKeys(Object.keys(OrgConfigSection.TEMPLATE));

        const name = section.string("name");
        if (name == null || name === "") {
            throw section.error("name", "must be set to a GitHub org");
        }

        const cloneProtocol =
            section.string("cloneProtocol") ??
            OrgConfigSection.DEFAULTS.cloneProtocol;
        if (cloneProtocol !== "ssh" && cloneProtocol !== "https") {
            throw section.error(
                "cloneProtocol",
                `must be ssh or https, got ${cloneProtocol}`
            );
        }

        const rootDir = expandHome(
            section.string("rootDir") ?? OrgConfigSection.DEFAULTS.rootDir
        );
        if (!path.isAbsolute(rootDir)) {
            throw section.error(
                "rootDir",
                `must be an absolute path or start with ~, got ${rootDir}`
            );
        }

        return {
            cloneProtocol,
            ignore: section.stringList("ignore"),
            name,
            rootDir,
            scmHost:
                section.string("scmHost") ?? OrgConfigSection.DEFAULTS.scmHost,
            skipArchived:
                section.boolean("skipArchived") ??
                OrgConfigSection.DEFAULTS.skipArchived,
            skipForks:
                section.boolean("skipForks") ??
                OrgConfigSection.DEFAULTS.skipForks,
        };
    }
}

function describeSetting(
    key: keyof OrgConfig,
    defaults: Partial<Record<keyof OrgConfig, unknown>>
): string {
    if (!(key in defaults)) {
        return SETTING_HELP[key];
    }
    const value = defaults[key];
    const display = isArray(value) && isEmpty(value) ? "none" : String(value);
    return `${SETTING_HELP[key]} [default: ${display}]`;
}

function expandHome(dir: string): string {
    if (dir === "~") {
        return homedir();
    }
    if (dir.startsWith("~/")) {
        return path.join(homedir(), dir.slice(2));
    }
    return dir;
}

export type { CloneProtocol, OrgConfig };
export { OrgConfigSection };
