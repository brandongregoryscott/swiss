import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ManifestBump, Target } from "./manifests.js";
import { nullIfMissing } from "../../shared/errors.js";

type BodyOptions = {
    bumps: ManifestBump[];
    changelog: null | string;
    notes: string[];
    target: Target;
    template: null | string;
};

const TEMPLATE_NAME = "pull_request_template.md";

const TEMPLATE_DIRS = [".github", ".", "docs"];

const TEMPLATES_DIR_NAME = "pull_request_template";

const TECHNICAL_DOCS_CHECKBOX = /^(\s*[-*] )\[ \](.*technical docs)/gim;

class PullRequestBody {
    static build(options: BodyOptions): string {
        const { bumps, changelog, notes, target, template } = options;
        const sections = [
            summarize(target, bumps),
            ...notes.map((note) => note.trim()).filter((note) => note !== ""),
        ];
        if (changelog != null) {
            sections.push(`## Changelog\n\n${changelog}`);
        }
        if (template != null && template.trim() !== "") {
            sections.push(
                template.trim().replace(TECHNICAL_DOCS_CHECKBOX, "$1[x]$2")
            );
        }
        return `${sections.join("\n\n")}\n`;
    }

    static async template(repoDir: string): Promise<null | string> {
        for (const dir of TEMPLATE_DIRS) {
            const name = await findEntry(
                path.join(repoDir, dir),
                (entry) => entry.toLowerCase() === TEMPLATE_NAME
            );
            if (name != null) {
                return readFile(path.join(repoDir, dir, name), "utf8");
            }
        }

        const templatesDir = await findEntry(
            path.join(repoDir, ".github"),
            (entry) => entry.toLowerCase() === TEMPLATES_DIR_NAME
        );
        if (templatesDir == null) {
            return null;
        }
        const dir = path.join(repoDir, ".github", templatesDir);
        const templates = (await readdir(dir)).filter((entry) =>
            entry.toLowerCase().endsWith(".md")
        );
        return templates.length === 1
            ? readFile(path.join(dir, templates[0]!), "utf8")
            : null;
    }
}

function summarize(target: Target, bumps: ManifestBump[]): string {
    const pkg = `\`${target.pkg}\``;
    const version = `\`${target.version}\``;
    const [only] = bumps;
    if (bumps.length === 1 && only != null) {
        const location =
            only.path === "package.json" ? "" : ` in \`${only.path}\``;
        return `Bumps ${pkg} from \`${only.current}\` to \`${only.next}\`${location}.`;
    }
    const lines = bumps.map(
        (bump) => `- \`${bump.path}\`: \`${bump.current}\` → \`${bump.next}\``
    );
    return `Bumps ${pkg} to ${version}:\n\n${lines.join("\n")}`;
}

async function findEntry(
    dir: string,
    matches: (entry: string) => boolean
): Promise<null | string> {
    const entries = await readdir(dir).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOTDIR") {
            return null;
        }
        return nullIfMissing(error);
    });
    return entries?.find(matches) ?? null;
}

export type { BodyOptions };
export { PullRequestBody };
