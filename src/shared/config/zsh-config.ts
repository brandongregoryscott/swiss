import { isPlainObject } from "lodash-es";
import type { ConfigSection } from "./config.js";
import { ConfigFile } from "./config.js";

type ZshConfig = {
    aliases: Record<string, string>;
    env: Record<string, string>;
    path: string[];
};

class ZshConfigSection {
    static readonly NAME = "zsh";

    static readonly TEMPLATE: ZshConfig = {
        aliases: {
            gcsquash: "swiss git squash",
            hidedotfiles: "hidefiles",
            hidefiles:
                "defaults write com.apple.finder AppleShowAllFiles -bool false && killall Finder",
            hidehiddenfiles: "hidefiles",
            reload: "exec zsh -l",
            showdotfiles: "showfiles",
            showfiles:
                "defaults write com.apple.finder AppleShowAllFiles -bool true && killall Finder",
            showhiddenfiles: "showfiles",
        },
        env: {},
        path: [],
    };

    static async load(configDir: string): Promise<ZshConfig> {
        const config = await ConfigFile.load(configDir);
        const section = ConfigFile.getSection(config, ZshConfigSection.NAME);
        return section == null
            ? structuredClone(ZshConfigSection.TEMPLATE)
            : ZshConfigSection.parse(section);
    }

    static parse(section: ConfigSection): ZshConfig {
        section.rejectUnknownKeys(Object.keys(ZshConfigSection.TEMPLATE));
        return {
            aliases: stringMap(
                section,
                "aliases",
                ZshConfigSection.TEMPLATE.aliases
            ),
            env: stringMap(section, "env", {}),
            path: section.stringList("path"),
        };
    }
}

function stringMap(
    section: ConfigSection,
    key: string,
    fallback: Record<string, string>
): Record<string, string> {
    const value = section.raw()[key];
    if (value == null) {
        return { ...fallback };
    }
    if (
        !isPlainObject(value) ||
        !Object.values(value as object).every(
            (entry) => typeof entry === "string"
        )
    ) {
        throw section.error(key, "must be an object whose values are strings");
    }
    return value as Record<string, string>;
}

export type { ZshConfig };
export { ZshConfigSection };
