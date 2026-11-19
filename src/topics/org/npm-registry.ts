import { isArray, isPlainObject, isString } from "lodash-es";
import semver from "semver";
import type { GitHubRepo } from "../../shared/git/github.js";
import { UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { Git } from "../../shared/git/git.js";

class NpmRegistryError extends UserError {}

type Release = {
    directory: null | string;
    gitHead: null | string;
    repo: GitHubRepo | null;
};

type NpmFailure = {
    error?: { summary?: unknown };
};

type RepositoryFields = {
    directory?: unknown;
    url?: unknown;
};

type ViewedRelease = {
    gitHead?: unknown;
    repository?: unknown;
};

class NpmRegistry {
    static async release(pkg: string, version: string): Promise<Release> {
        const output = await Exec.run("npm", [
            "view",
            `${pkg}@${version}`,
            "--json",
        ]);
        const parsed: unknown =
            output.trim() === "" ? null : JSON.parse(output);
        if (!isPlainObject(parsed)) {
            return { directory: null, gitHead: null, repo: null };
        }
        const viewed = parsed as ViewedRelease;
        const repository = repositoryFields(viewed.repository);
        return {
            directory: isString(repository.directory)
                ? repository.directory
                : null,
            gitHead: isString(viewed.gitHead) ? viewed.gitHead : null,
            repo: isString(repository.url)
                ? parseRepository(repository.url)
                : null,
        };
    }

    static async resolveVersion(pkg: string, spec = "latest"): Promise<string> {
        const output = await Exec.run(
            "npm",
            ["view", `${pkg}@${spec}`, "version", "--json"],
            { okExitCodes: [1] }
        );
        const parsed: unknown = output === "" ? null : JSON.parse(output);
        const failure = (parsed as NpmFailure | null)?.error?.summary;
        if (isString(failure)) {
            throw new NpmRegistryError(
                `Couldn't look up ${pkg}@${spec}: ${failure}`
            );
        }
        const version: unknown = isArray(parsed)
            ? semver.rsort(parsed.filter(isString))[0]
            : parsed;
        if (!isString(version)) {
            throw new NpmRegistryError(
                `No published version of ${pkg} matches ${spec}`
            );
        }
        return version;
    }
}

function repositoryFields(repository: unknown): RepositoryFields {
    if (isString(repository)) {
        return { url: repository };
    }
    return isPlainObject(repository) ? (repository as RepositoryFields) : {};
}

function parseRepository(url: string): GitHubRepo | null {
    const shorthand = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(url);
    if (shorthand != null) {
        return {
            host: "github.com",
            name: shorthand[2]!,
            owner: shorthand[1]!,
        };
    }
    return Git.parseRemoteUrl(url.replace(/^git\+/, ""));
}

export type { Release };
export { NpmRegistry, NpmRegistryError };
