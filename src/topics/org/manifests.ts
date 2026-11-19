import { escapeRegExp, isPlainObject, isString } from "lodash-es";
import path from "node:path";
import semver from "semver";
import { UserError } from "../../shared/errors.js";
import { Git } from "../../shared/git/git.js";

class ManifestError extends UserError {}

type DependencySection =
    | "dependencies"
    | "devDependencies"
    | "optionalDependencies";

type ManifestCheck =
    | {
          current: string;
          currentVersion: string;
          next: string;
          path: string;
          section: DependencySection;
          status: "bump";
      }
    | { current: string; path: string; status: "up-to-date" }
    | { path: string; reason: string; status: "skipped" };

type ManifestBump = Extract<ManifestCheck, { status: "bump" }>;

type Target = {
    pkg: string;
    version: string;
};

const MANIFEST_NAME = "package.json";

const DEPENDENCY_SECTIONS: DependencySection[] = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
];

const SPEC_PATTERN = /^([~^]?)(.+)$/;

class Manifests {
    static check(file: string, text: string, target: Target): ManifestCheck[] {
        let manifest: unknown;
        try {
            manifest = JSON.parse(text);
        } catch {
            return [
                { path: file, reason: "isn't valid JSON", status: "skipped" },
            ];
        }
        if (!isPlainObject(manifest)) {
            return [];
        }
        return DEPENDENCY_SECTIONS.flatMap((section) => {
            const spec = dependencySpec(
                manifest as Record<string, unknown>,
                section,
                target.pkg
            );
            return spec == null ? [] : [checkSpec(file, section, spec, target)];
        });
    }

    static oldestVersion(bumps: ManifestBump[]): string {
        return semver.sort(bumps.map((bump) => bump.currentVersion))[0]!;
    }

    static rewrite(text: string, pkg: string, bumps: ManifestBump[]): string {
        let result = text;
        for (const bump of bumps) {
            const pattern = new RegExp(
                `("${bump.section}"\\s*:\\s*\\{[^}]*?${escapeRegExp(JSON.stringify(pkg))}\\s*:\\s*)${escapeRegExp(JSON.stringify(bump.current))}`
            );
            result = result.replace(
                pattern,
                (_, before: string) => `${before}${JSON.stringify(bump.next)}`
            );
        }

        const rewritten = JSON.parse(result) as Record<string, unknown>;
        for (const bump of bumps) {
            if (dependencySpec(rewritten, bump.section, pkg) !== bump.next) {
                throw new ManifestError(
                    `couldn't change ${pkg} in ${bump.path}'s ${bump.section}`
                );
            }
        }
        return result;
    }

    static async scan(
        repoDir: string,
        ref: string,
        target: Target
    ): Promise<ManifestCheck[]> {
        const files = await Git.paths(
            repoDir,
            "ls-tree",
            "-r",
            "-z",
            "--name-only",
            ref
        );
        const manifests = files.filter(
            (file) =>
                path.posix.basename(file) === MANIFEST_NAME &&
                !file.split("/").includes("node_modules")
        );
        const checks: ManifestCheck[] = [];
        for (const file of manifests) {
            const text = await Git.run(repoDir, "show", `${ref}:${file}`);
            if (text.includes(JSON.stringify(target.pkg))) {
                checks.push(...Manifests.check(file, text, target));
            }
        }
        return checks;
    }
}

function dependencySpec(
    manifest: Record<string, unknown>,
    section: DependencySection,
    pkg: string
): null | string {
    const dependencies = manifest[section];
    if (!isPlainObject(dependencies)) {
        return null;
    }
    const spec = (dependencies as Record<string, unknown>)[pkg];
    return isString(spec) ? spec : null;
}

function checkSpec(
    file: string,
    section: DependencySection,
    spec: string,
    target: Target
): ManifestCheck {
    const [, prefix = "", version = ""] = SPEC_PATTERN.exec(spec) ?? [];
    if (semver.valid(version) == null) {
        return {
            path: file,
            reason: `${spec} isn't a version, or a ^ or ~ range`,
            status: "skipped",
        };
    }
    if (semver.eq(version, target.version)) {
        return { current: spec, path: file, status: "up-to-date" };
    }
    if (semver.gt(version, target.version)) {
        return {
            path: file,
            reason: `${spec} is newer than ${target.version}`,
            status: "skipped",
        };
    }
    return {
        current: spec,
        currentVersion: version,
        next: `${prefix}${target.version}`,
        path: file,
        section,
        status: "bump",
    };
}

export type { DependencySection, ManifestBump, ManifestCheck, Target };
export { ManifestError, Manifests };
