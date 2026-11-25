import { isArray, isEmpty, isPlainObject, isString } from "lodash-es";
import path from "node:path";
import type { ConfigSection } from "./config.js";
import { Files } from "../files.js";
import { Text } from "../text.js";
import { ConfigError, ConfigFile } from "./config.js";

type DeployRepo = {
    checkout: string;
    copy: string[];
    name: string;
    path: string;
};

type DeployConfig = {
    dir: string;
    repos: DeployRepo[];
};

const REPO_KEYS = ["copy", "path"];

class DeployConfigSection {
    static readonly DEFAULTS = { dir: "~/deploy" } as const;

    static readonly EXAMPLE = {
        dir: DeployConfigSection.DEFAULTS.dir,
        repos: { api: { copy: [".env"], path: "~/code/api" } },
    };

    static readonly NAME = "deploy";

    static readonly HELP = `Settings live in the "${DeployConfigSection.NAME}" section of ${ConfigFile.DISPLAY_PATH}, which is plain JSON:

  ${JSON.stringify({ [DeployConfigSection.NAME]: DeployConfigSection.EXAMPLE })}

${Text.definitionList([
    [
        "dir",
        `Where the deploy checkouts live, one per repo at <dir>/<name> [default: ${DeployConfigSection.DEFAULTS.dir}]`,
    ],
    [
        "repos",
        "The repos that can be deployed, by name. path is the repo's main clone, and copy lists files git ignores, like .env, that are copied from it into the checkout on every deploy",
    ],
])}`;

    static readonly TEMPLATE = {
        dir: DeployConfigSection.DEFAULTS.dir,
        repos: {},
    };

    static async load(configDir: string): Promise<DeployConfig> {
        const config = await ConfigFile.load(configDir);
        const section = ConfigFile.getSection(config, DeployConfigSection.NAME);
        const settings =
            section == null ? null : DeployConfigSection.parse(section);
        if (settings == null || isEmpty(settings.repos)) {
            throw new ConfigError(
                `Add the repos to deploy to ${config.path}, like:\n\n  ${JSON.stringify({ [DeployConfigSection.NAME]: DeployConfigSection.EXAMPLE })}`
            );
        }
        return settings;
    }

    static parse(section: ConfigSection): DeployConfig {
        section.rejectUnknownKeys(Object.keys(DeployConfigSection.TEMPLATE));

        const dir = Files.expandHome(
            section.string("dir") ?? DeployConfigSection.DEFAULTS.dir
        );
        if (!path.isAbsolute(dir)) {
            throw section.error(
                "dir",
                `must be an absolute path or start with ~, got ${dir}`
            );
        }

        const repos = section.raw().repos ?? {};
        if (!isPlainObject(repos)) {
            throw section.error("repos", "must be an object of repos by name");
        }
        return {
            dir,
            repos: Object.entries(repos as Record<string, unknown>).map(
                ([name, value]) => parseRepo(section, dir, name, value)
            ),
        };
    }
}

function parseRepo(
    section: ConfigSection,
    dir: string,
    name: string,
    value: unknown
): DeployRepo {
    const key = `repos.${name}`;
    if (!/^[\w.-]+$/.test(name) || name === "." || name === "..") {
        throw section.error(
            key,
            "must be named with letters, digits, dots, dashes and underscores, since the name is its checkout's directory"
        );
    }
    if (!isPlainObject(value)) {
        throw section.error(key, "must be an object with a path");
    }

    const settings = value as Record<string, unknown>;
    const unknownKeys = Object.keys(settings).filter(
        (setting) => !REPO_KEYS.includes(setting)
    );
    if (!isEmpty(unknownKeys)) {
        throw section.error(key, `has unknown keys: ${unknownKeys.join(", ")}`);
    }

    const repoPath = isString(settings.path)
        ? Files.expandHome(settings.path.trim())
        : null;
    if (repoPath == null || !path.isAbsolute(repoPath)) {
        throw section.error(
            `${key}.path`,
            "must be the absolute path of the repo's main clone, or start with ~"
        );
    }

    const copy = settings.copy ?? [];
    if (
        !isArray(copy) ||
        !copy.every(
            (file) =>
                isString(file) &&
                file.trim() !== "" &&
                !path.isAbsolute(file) &&
                !file.split(/[\\/]/).includes("..")
        )
    ) {
        throw section.error(
            `${key}.copy`,
            "must be a list of paths inside the repo, like .env"
        );
    }

    return {
        checkout: path.join(dir, name),
        copy: (copy as string[]).map((file) => file.trim()),
        name,
        path: repoPath,
    };
}

export type { DeployConfig, DeployRepo };
export { DeployConfigSection };
