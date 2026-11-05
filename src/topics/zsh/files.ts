import { isEmpty, last, maxBy } from "lodash-es";
import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Span, ZshDocument, ZshStatement } from "./syntax.js";
import { UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { Text } from "../../shared/text.js";
import { ZshSyntax } from "./syntax.js";

class ZshError extends UserError {}

type ZshFile = {
    display: string;
    doc: ZshDocument;
    path: string;
    statements: ZshStatement[];
};

// The kinds of statement that can be added, which are put in the file that has the most of them.
type AdditionKind = "alias" | "export" | "path";

type LoadOptions = {
    env?: NodeJS.ProcessEnv;
    home?: string;
};

// The files zsh reads when an interactive login shell starts, in order. .zlogin and .zlogout are
// left out, since they're rarely used for aliases or variables.
const STARTUP_FILES = [".zshenv", ".zprofile", ".zshrc"];
// Hidden directories in home that hold your own config, rather than a tool's, like ~/.oh-my-zsh.
const CONFIG_DIRECTORIES = new Set([
    ".config",
    ".dotfiles",
    ".zsh",
    ".zshrc.d",
]);
const ADDITION_KINDS: Record<
    AdditionKind,
    (statement: ZshStatement) => boolean
> = {
    alias: (statement) => statement.kind === "alias",
    export: (statement) =>
        statement.kind === "variable" &&
        statement.exported &&
        statement.name !== "PATH",
    path: (statement) =>
        statement.kind === "path-array" ||
        (statement.kind === "variable" && statement.name === "PATH"),
};
// Deep enough for a file that sources a directory of files, without following loops forever.
const MAX_SOURCE_DEPTH = 4;

class ZshFiles {
    // The file to add a new statement of kind to: the one with the most of them already, or the
    // .zshrc when none have any, which is created when it doesn't exist.
    static defaultFile(
        files: ZshFile[],
        kind: AdditionKind,
        options: LoadOptions = {}
    ): ZshFile {
        const counts = files.map((file) => ({
            count: topLevel(file, kind).length,
            file,
        }));
        const most = maxBy(
            counts.filter((entry) => entry.count > 0),
            "count"
        );
        return most?.file ?? ZshFiles.zshrc(files, options);
    }

    // Expands ~, $NAME, ${NAME} and the :a, :A, :h and :t modifiers, like ${0:A:h} for the
    // directory a file is in. Returns null when it uses a variable that isn't known, runs a
    // command, or uses other syntax.
    static expand(
        text: string,
        variables: Map<string, string>,
        home = homedir()
    ): null | string {
        if (/\$\(|`/.test(text)) {
            return null;
        }
        let unknown = false;
        const expanded = text
            .replace(/^~(?=\/|$)/, home)
            .replaceAll(
                /\$\{(\w+)((?::[aAht])*)\}|\$(\w+)/g,
                (
                    _,
                    braced: string | undefined,
                    modifiers: string | undefined,
                    bare: string | undefined
                ) => {
                    const value = variables.get(braced ?? bare!);
                    if (value == null) {
                        unknown = true;
                        return "";
                    }
                    return applyModifiers(value, modifiers ?? "");
                }
            );
        return unknown || expanded.includes("$") ? null : expanded;
    }

    // Whether statement is of kind, like an alias or a PATH change.
    static is(statement: ZshStatement, kind: AdditionKind): boolean {
        return ADDITION_KINDS[kind](statement);
    }

    // The startup files and the ones they source, in the order zsh reads them, with each sourced
    // file right after the file that sources it.
    static async load(options: LoadOptions = {}): Promise<ZshFile[]> {
        const home = options.home ?? homedir();
        const env = options.env ?? process.env;
        const variables = initialVariables(env, home);
        const zdotdir = env.ZDOTDIR ?? home;
        const files: ZshFile[] = [];
        const seen = new Set<string>();

        const visit = async (file: string, depth: number): Promise<void> => {
            if (seen.has(file) || depth > MAX_SOURCE_DEPTH) {
                return;
            }
            seen.add(file);
            const loaded = await ZshFiles.read(file).catch(() => null);
            if (loaded == null) {
                return;
            }
            files.push(loaded);
            for (const statement of loaded.statements) {
                // $0 is the file being sourced, which nested files change.
                variables.set("0", file);
                trackVariable(statement, variables, home);
                const sourced = sourcedFile(statement, file, variables, home);
                if (
                    sourced != null &&
                    isOwnConfig(sourced, home) &&
                    (await isFile(sourced))
                ) {
                    await visit(sourced, depth + 1);
                }
            }
        };

        for (const name of STARTUP_FILES) {
            const file = path.join(zdotdir, name);
            if (await isFile(file)) {
                await visit(file, 0);
            }
        }
        return files;
    }

    static async read(file: string): Promise<ZshFile> {
        const doc = ZshSyntax.parse(await readFile(file, "utf8"));
        return {
            display: Text.displayPath(file),
            doc,
            path: file,
            statements: ZshSyntax.statements(doc),
        };
    }

    // The variables set by the end of files, starting from env, for expanding paths in them.
    static variables(
        files: ZshFile[],
        options: LoadOptions = {}
    ): Map<string, string> {
        return ZshFiles.walk(files, options, () => {});
    }

    // Goes through files in the order zsh runs them: each startup file's statements in turn,
    // with a sourced file's statements where it's sourced. visit sees each statement with the
    // variables set before it, and $0 as its file; it's a live map, so copy it to keep it. Files
    // nothing sources, like a .zshrc that's only just been added to, go last. Returns the
    // variables set by the end.
    static walk(
        files: ZshFile[],
        options: LoadOptions,
        visit: (
            file: ZshFile,
            statement: ZshStatement,
            variables: Map<string, string>
        ) => void
    ): Map<string, string> {
        const home = options.home ?? homedir();
        const env = options.env ?? process.env;
        const variables = initialVariables(env, home);
        const byPath = new Map(files.map((file) => [file.path, file]));
        const seen = new Set<string>();

        const run = (file: ZshFile, depth: number): void => {
            if (seen.has(file.path) || depth > MAX_SOURCE_DEPTH) {
                return;
            }
            seen.add(file.path);
            for (const statement of file.statements) {
                // $0 is the file being sourced, which nested files change.
                variables.set("0", file.path);
                visit(file, statement, variables);
                trackVariable(statement, variables, home);
                const sourced = sourcedFile(
                    statement,
                    file.path,
                    variables,
                    home
                );
                const child = sourced == null ? null : byPath.get(sourced);
                if (child != null) {
                    run(child, depth + 1);
                }
            }
        };

        const zdotdir = env.ZDOTDIR ?? home;
        for (const name of STARTUP_FILES) {
            const root = byPath.get(path.join(zdotdir, name));
            if (root != null) {
                run(root, 0);
            }
        }
        for (const file of files) {
            run(file, 0);
        }
        return variables;
    }

    // file with doc in place of its contents, for changes that haven't been written yet.
    static withDoc(file: ZshFile, doc: ZshDocument): ZshFile {
        return { ...file, doc, statements: ZshSyntax.statements(doc) };
    }

    // Writes doc to file, then checks it with zsh -n and puts the file back as it was when zsh
    // finds a syntax error that wasn't there before.
    static async write(file: ZshFile, doc: ZshDocument): Promise<ZshFile> {
        const before = ZshSyntax.serialize(file.doc);
        const validBefore =
            before === "" || (await syntaxError(file.path)) == null;
        await writeFile(file.path, ZshSyntax.serialize(doc));
        const error = validBefore ? await syntaxError(file.path) : null;
        if (error != null) {
            await writeFile(file.path, before);
            throw new ZshError(
                `Left ${file.display} unchanged, since the change made zsh report: ${error}`
            );
        }
        return ZshFiles.read(file.path);
    }

    // The .zshrc, or an empty one when it doesn't exist, which is created when it's written.
    static zshrc(files: ZshFile[], options: LoadOptions = {}): ZshFile {
        const env = options.env ?? process.env;
        const zshrc = path.join(
            env.ZDOTDIR ?? options.home ?? homedir(),
            ".zshrc"
        );
        return files.find((file) => file.path === zshrc) ?? emptyFile(zshrc);
    }
}

class ZshEdit {
    // Adds text as a new line after the last top-level statement of kind, so it's grouped with
    // the others, or at the end of the file when there aren't any.
    static add(file: ZshFile, kind: AdditionKind, text: string): ZshDocument {
        const previous = last(topLevel(file, kind));
        const lines = [...file.doc.lines];
        if (previous == null) {
            if (!isEmpty(lines) && last(lines)!.trim() !== "") {
                lines.push("");
            }
            lines.push(text);
        } else {
            lines.splice(previous.line - 1 + previous.lineCount, 0, text);
        }
        return { ...file.doc, lines, trailingNewline: true };
    }

    static remove(doc: ZshDocument, statement: ZshStatement): ZshDocument {
        const lines = [...doc.lines];
        lines.splice(statement.line - 1, statement.lineCount);
        return { ...doc, lines };
    }

    // Replaces part of a statement's line, like its value.
    static replace(
        doc: ZshDocument,
        statement: ZshStatement,
        span: Span,
        text: string
    ): ZshDocument {
        const lines = [...doc.lines];
        const line = lines[statement.line - 1]!;
        lines[statement.line - 1] =
            line.slice(0, span.start) + text + line.slice(span.end);
        return { ...doc, lines };
    }
}

function applyModifiers(value: string, modifiers: string): string {
    let result = value;
    for (const modifier of modifiers.split(":").slice(1)) {
        switch (modifier) {
            case "a":
            case "A": {
                result = path.resolve(result);
                break;
            }
            case "h": {
                result = path.dirname(result);
                break;
            }
            case "t": {
                result = path.basename(result);
                break;
            }
        }
    }
    return result;
}

function topLevel(file: ZshFile, kind: AdditionKind): ZshStatement[] {
    return file.statements.filter(
        (statement) => !statement.nested && ADDITION_KINDS[kind](statement)
    );
}

// Records a top-level variable's value, when it can be worked out, for expanding later paths.
function trackVariable(
    statement: ZshStatement,
    variables: Map<string, string>,
    home: string
): void {
    if (statement.kind !== "variable" || statement.nested) {
        return;
    }
    const value = ZshFiles.expand(statement.value, variables, home);
    if (value != null) {
        variables.set(statement.name, value);
    }
}

// The file a source statement reads, resolved against the directory of the file it's in, or
// null when it isn't one or its target can't be worked out without running the shell.
function sourcedFile(
    statement: ZshStatement,
    file: string,
    variables: Map<string, string>,
    home: string
): null | string {
    if (statement.kind !== "source") {
        return null;
    }
    const target = ZshFiles.expand(statement.target, variables, home);
    return target == null ? null : path.resolve(path.dirname(file), target);
}

function initialVariables(
    env: NodeJS.ProcessEnv,
    home: string
): Map<string, string> {
    const variables = new Map<string, string>();
    for (const [name, value] of Object.entries(env)) {
        if (value != null) {
            variables.set(name, value);
        }
    }
    variables.set("HOME", home);
    return variables;
}

function emptyFile(file: string): ZshFile {
    return {
        display: Text.displayPath(file),
        doc: ZshSyntax.parse(""),
        path: file,
        statements: [],
    };
}

// Whether a sourced file is one of your own config files rather than a tool's or a framework's.
function isOwnConfig(file: string, home: string): boolean {
    const relative = path.relative(home, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
    }
    const directories = relative.split(path.sep).slice(0, -1);
    return directories.every(
        (directory) =>
            directory !== "node_modules" &&
            (!directory.startsWith(".") || CONFIG_DIRECTORIES.has(directory))
    );
}

// What zsh -n reports for file, or null when it's fine or zsh isn't installed.
async function syntaxError(file: string): Promise<null | string> {
    try {
        await Exec.run("zsh", ["-n", file]);
        return null;
    } catch (error) {
        const message = (error as Error).message;
        return message.includes("not installed") ? null : message;
    }
}

async function isFile(file: string): Promise<boolean> {
    const stats = await stat(file).catch(() => null);
    return stats?.isFile() === true;
}

export type { AdditionKind, LoadOptions, ZshFile };
export { ZshEdit, ZshError, ZshFiles };
