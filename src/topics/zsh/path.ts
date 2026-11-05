import { homedir } from "node:os";
import path from "node:path";
import type { LoadOptions, ZshFile } from "./files.js";
import type { ZshDocument, ZshPathArray, ZshVariable } from "./syntax.js";
import { Files } from "../../shared/files.js";
import { ZshEdit, ZshFiles } from "./files.js";
import { ZshSyntax } from "./syntax.js";

type PathPosition = "append" | "prepend" | "set";

type PathStatement = ZshPathArray | ZshVariable;

// A directory a startup file adds to PATH.
type PathAddition = {
    // As written, without its quotes, like ~/bin or $HOME/my dir.
    dir: string;
    // Null when it can't be worked out without running the shell, like $(brew --prefix)/bin.
    expanded: null | string;
    file: ZshFile;
    position: PathPosition;
    // The variables as they are where the statement runs, which its directories are read with.
    scope: Map<string, string>;
    statement: PathStatement;
};

// A directory in the shell's PATH, and the startup file lines that add it.
type PathEntry = {
    addedBy: PathAddition[];
    dir: string;
    // Already earlier in PATH, or not an existing directory.
    problem: "duplicate" | "missing" | null;
};

// The shell's PATH compared with what the startup files add to it.
type PathReport = {
    entries: PathEntry[];
    // Added by the startup files but not in the shell's PATH yet, like after editing them.
    pending: PathAddition[];
    // Added in a way that can't be worked out without running the files.
    unknown: PathAddition[];
};

// One part of a PATH statement: the text it's written as, and what it says once its quotes are
// taken off.
type PathPart = {
    dir: string;
    raw: string;
};

// How PATH and the path array refer to themselves, to keep what's already in them.
const SELF_REFERENCES = new Set(["$PATH", "${PATH}"]);
const ARRAY_SELF_REFERENCES = new Set([
    "$path",
    "${path}",
    "$path[@]",
    "${path[@]}",
]);

class ZshPath {
    // Every directory added to PATH, in the order zsh runs the statements that add them, each
    // read with the variables set before it.
    static additions(
        files: ZshFile[],
        options: LoadOptions = {}
    ): PathAddition[] {
        const home = options.home ?? homedir();
        const additions: PathAddition[] = [];
        ZshFiles.walk(files, options, (file, statement, variables) => {
            if (!isPathStatement(statement)) {
                return;
            }
            const scope = new Map(variables);
            for (const { dir, position } of ZshPath.entries(statement)) {
                const expanded = ZshFiles.expand(dir, scope, home);
                additions.push({
                    dir,
                    expanded:
                        expanded == null ? null : ZshPath.normalize(expanded),
                    file,
                    position,
                    scope,
                    statement,
                });
            }
        });
        return additions;
    }

    // The directories a statement adds, and whether they go before or after what's already in
    // PATH, or replace it.
    static entries(
        statement: PathStatement
    ): Array<{ dir: string; position: PathPosition }> {
        const parts = partsOf(statement);
        const self = parts.findIndex((part) => isSelf(statement, part));
        return parts
            .map(({ dir }, index) => ({
                dir,
                position:
                    statement.kind === "path-array" && statement.append
                        ? ("append" as const)
                        : self === -1
                          ? ("set" as const)
                          : index < self
                            ? ("prepend" as const)
                            : ("append" as const),
            }))
            .filter(({ dir }, index) => dir !== "" && index !== self);
    }

    // A line that adds dir to PATH, using $HOME for directories under the home directory.
    static line(dir: string, append: boolean, home = homedir()): string {
        const relative = path.relative(home, dir);
        const written =
            relative === ""
                ? "$HOME"
                : relative.startsWith("..") || path.isAbsolute(relative)
                  ? dir
                  : `$HOME/${relative}`;
        const value = append ? `$PATH:${written}` : `${written}:$PATH`;
        return `export PATH=${ZshSyntax.doubleQuote(value)}`;
    }

    static normalize(dir: string): string {
        return path.resolve(dir).replace(/(.)\/+$/, "$1");
    }

    // Takes dirs out of a statement, read with the variables in scope where it runs, removing the
    // statement when nothing else is left in it. The parts that are left are kept exactly as
    // they're written, so ~ and globs still expand and quoting doesn't change.
    static remove(
        doc: ZshDocument,
        statement: PathStatement,
        dirs: Set<string>,
        scope: Map<string, string>,
        home = homedir()
    ): ZshDocument {
        const removed = (part: PathPart): boolean => {
            if (part.dir === "" || isSelf(statement, part)) {
                return false;
            }
            const expanded = ZshFiles.expand(part.dir, scope, home);
            return expanded != null && dirs.has(ZshPath.normalize(expanded));
        };
        const kept = partsOf(statement).filter((part) => !removed(part));
        if (kept.every((part) => part.dir === "" || isSelf(statement, part))) {
            return ZshEdit.remove(doc, statement);
        }
        const raw = kept.map((part) => part.raw);
        if (statement.kind === "variable") {
            const quote = isQuotedWhole(statement.rawValue) ? '"' : "";
            return ZshEdit.replace(
                doc,
                statement,
                statement.valueSpan,
                `${quote}${raw.join(":")}${quote}`
            );
        }
        return ZshEdit.replace(
            doc,
            statement,
            statement.span,
            `path${statement.append ? "+=" : "="}(${raw.join(" ")})`
        );
    }

    // The shell's PATH, given as its value, compared with additions.
    static async report(
        currentPath: string,
        additions: PathAddition[]
    ): Promise<PathReport> {
        const seen = new Set<string>();
        const entries: PathEntry[] = [];
        for (const dir of currentPath
            .split(":")
            .filter((part) => part !== "")
            .map((part) => ZshPath.normalize(part))) {
            entries.push({
                addedBy: additions.filter(
                    (addition) => addition.expanded === dir
                ),
                dir,
                problem: seen.has(dir)
                    ? "duplicate"
                    : (await Files.isDirectory(dir))
                      ? null
                      : "missing",
            });
            seen.add(dir);
        }
        return {
            entries,
            pending: additions.filter(
                (addition) =>
                    addition.expanded != null && !seen.has(addition.expanded)
            ),
            unknown: additions.filter((addition) => addition.expanded == null),
        };
    }
}

// A statement's parts in order: PATH's value split on its colons, or the path array's words.
function partsOf(statement: PathStatement): PathPart[] {
    if (statement.kind === "path-array") {
        return statement.rawWords.map((raw, index) => ({
            dir: statement.words[index]!,
            raw,
        }));
    }
    const raw = statement.rawValue;
    if (isQuotedWhole(raw)) {
        // Inside double quotes, every colon separates parts, and the parts have no quotes.
        return splitParts(raw.slice(1, -1), false).map((part) => ({
            dir: part.replaceAll(/\\([$`"\\])/g, "$1"),
            raw: part,
        }));
    }
    return splitParts(raw, true).map((part) => ({
        dir: unquote(part),
        raw: part,
    }));
}

function isSelf(statement: PathStatement, part: PathPart): boolean {
    return (
        statement.kind === "variable" ? SELF_REFERENCES : ARRAY_SELF_REFERENCES
    ).has(part.dir);
}

// Whether a value is one double-quoted string, like "$HOME/bin:$PATH".
function isQuotedWhole(raw: string): boolean {
    if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
        return false;
    }
    for (let index = 1; index < raw.length - 1; index++) {
        if (raw[index] === "\\") {
            index++;
        } else if (raw[index] === '"') {
            return false;
        }
    }
    return true;
}

// Splits text on colons, except ones in ${...}, like ${0:A:h}, and, when quotes is set, ones
// inside quotes or escaped.
function splitParts(text: string, quotes: boolean): string[] {
    const parts = [""];
    let depth = 0;
    let quote: null | string = null;
    for (let index = 0; index < text.length; index++) {
        const char = text[index]!;
        if (quotes && char === "\\" && quote !== "'") {
            parts[parts.length - 1] += char + (text[index + 1] ?? "");
            index++;
            continue;
        }
        if (quotes && (char === '"' || char === "'")) {
            quote = quote == null ? char : quote === char ? null : quote;
        } else if (char === "$" && text[index + 1] === "{") {
            depth++;
        } else if (char === "}" && depth > 0) {
            depth--;
        }
        if (char === ":" && depth === 0 && quote == null) {
            parts.push("");
        } else {
            parts[parts.length - 1] += char;
        }
    }
    return parts;
}

// A part of a value without its quotes and escapes, like "$HOME/my dir" as $HOME/my dir.
function unquote(text: string): string {
    let result = "";
    let quote: null | string = null;
    for (let index = 0; index < text.length; index++) {
        const char = text[index]!;
        if (quote === "'") {
            if (char === "'") {
                quote = null;
            } else {
                result += char;
            }
        } else if (char === "\\") {
            result += text[index + 1] ?? "";
            index++;
        } else if (char === '"' && quote == null) {
            quote = '"';
        } else if (char === '"') {
            quote = null;
        } else if (char === "'" && quote == null) {
            quote = "'";
        } else {
            result += char;
        }
    }
    return result;
}

function isPathStatement(
    statement: ZshFile["statements"][number]
): statement is PathStatement {
    return (
        statement.kind === "path-array" ||
        (statement.kind === "variable" && statement.name === "PATH")
    );
}

export type { PathAddition, PathEntry, PathPosition, PathReport };
export { ZshPath };
