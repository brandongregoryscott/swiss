import { groupBy, isEmpty, last, orderBy, uniq } from "lodash-es";
import { homedir } from "node:os";
import path from "node:path";
import type { RemovalPlan } from "../../shared/removal.js";
import type { AdditionKind, LoadOptions, ZshFile } from "./files.js";
import type { PathAddition, PathEntry, PathReport } from "./path.js";
import type {
    ZshAlias,
    ZshDocument,
    ZshFunction,
    ZshStatement,
    ZshVariable,
} from "./syntax.js";
import { Text } from "../../shared/text.js";
import { ZshEdit, ZshError, ZshFiles } from "./files.js";
import { ZshPath } from "./path.js";
import { ZshSyntax } from "./syntax.js";

// A statement and the file it's in.
type Located<T extends ZshStatement = ZshStatement> = {
    file: ZshFile;
    statement: T;
};

// What setting or adding something did, with the statement as it is afterwards.
type Change<T extends ZshStatement = ZshStatement> = {
    status: "added" | "changed" | "unchanged";
} & Located<T>;

// Your zsh startup files, loaded once. Changes are made in memory, where later reads see them, and
// only written by save().
type AddPathOptions = { append: boolean; file?: string };

class ZshStartup {
    readonly #options: LoadOptions;

    // What each file holds on disk, to tell which ones have changes to save.
    readonly #saved: Map<string, ZshFile>;
    // Which files are read, for help text.
    static readonly FILES_HELP = `Your zsh startup files are ~/.zshenv, ~/.zprofile and ~/.zshrc (in $ZDOTDIR when it's set), along with the files they source that are your own: files in your home directory that aren't inside a hidden directory, like ~/.oh-my-zsh or ~/.nvm, apart from ~/.config, ~/.dotfiles, ~/.zsh and ~/.zshrc.d. \`<%= config.bin %> zsh files\` lists them.`;
    #files: ZshFile[];

    constructor(files: ZshFile[], options: LoadOptions = {}) {
        this.#files = files;
        this.#options = options;
        this.#saved = new Map(files.map((file) => [file.path, file]));
    }

    // How to drop removed statements from a shell that's already running, since changing the
    // startup files only changes new ones.
    static forgetHint(removed: Located[]): null | string {
        const named = (kind: "alias" | "function" | "variable"): string[] =>
            uniq(
                removed.flatMap(({ statement }) =>
                    statement.kind === kind &&
                    !(kind === "variable" && isPathStatement(statement))
                        ? [(statement as { name: string }).name]
                        : []
                )
            );
        const commands = [
            ["unalias", named("alias")],
            ["unfunction", named("function")],
            ["unset", named("variable")],
        ] as const;
        const run = commands
            .filter(([, names]) => !isEmpty(names))
            .map(([command, names]) => `${command} ${names.join(" ")}`);
        const hints = isEmpty(run)
            ? []
            : [
                  `Run \`${run.join("; ")}\` to remove ${removed.length === 1 ? "it" : "them"} from this shell too`,
              ];
        if (removed.some(({ statement }) => isPathStatement(statement))) {
            hints.push("Open a new terminal for PATH to leave them out");
        }
        return isEmpty(hints) ? null : hints.join("; ");
    }

    // Whether statement is of kind, like an alias or a PATH change.
    static is(statement: ZshStatement, kind: AdditionKind): boolean {
        return ZshFiles.is(statement, kind);
    }

    // The name an alias or function is listed under, with () for functions.
    static label(statement: ZshAlias | ZshFunction): string {
        return statement.kind === "function"
            ? `${statement.name}()`
            : statement.name;
    }

    // The startup files and the ones they source, in the order zsh reads them.
    static async load(options: LoadOptions = {}): Promise<ZshStartup> {
        return new ZshStartup(await ZshFiles.load(options), options);
    }

    static location({ file, statement }: Located): string {
        return `${file.display}:${statement.line}`;
    }

    // Why a statement can't be changed, for errors.
    static readOnlyReason(located: Located): string {
        return located.statement.nested
            ? `it's inside a function, conditional or loop at ${ZshStartup.location(located)}`
            : `it shares ${ZshStartup.location(located)} with other commands or spans several lines`;
    }

    static reloadHint(files: ZshFile[]): string {
        const sources = uniq(files.map((file) => file.display))
            .map((display) => `source ${display}`)
            .join(" && ");
        return `Run \`${sources}\` or open a new terminal to pick this up`;
    }

    get #home(): string {
        return this.#options.home ?? homedir();
    }

    get files(): ZshFile[] {
        return this.#files;
    }

    // Adds dir to PATH in the file to add to, unless a startup file adds it already.
    addPath(
        dir: string,
        options: AddPathOptions
    ): Change<PathAddition["statement"]> {
        const existing = this.pathAdditions().find(
            (addition) => addition.expanded === dir
        );
        if (existing != null) {
            return {
                file: existing.file,
                statement: existing.statement,
                status: "unchanged",
            };
        }
        const target = this.target("path", options.file);
        const file = this.update(
            target,
            ZshEdit.add(
                target,
                "path",
                ZshPath.line(dir, options.append, this.#home)
            )
        );
        const added = this.pathAdditions().findLast(
            (addition) =>
                addition.file.path === file.path && addition.expanded === dir
        )!;
        return { file, statement: added.statement, status: "added" };
    }

    // Every alias and function, in the order zsh runs them; the last of each name is the one used.
    aliases(): Array<Located<ZshAlias | ZshFunction>> {
        return this.#find(
            (statement): statement is ZshAlias | ZshFunction =>
                statement.kind === "alias" || statement.kind === "function"
        );
    }

    // The files with changes that haven't been saved.
    changed(): ZshFile[] {
        return this.#files.filter((file) => {
            const saved = this.#saved.get(file.path);
            return (
                saved == null ||
                ZshSyntax.serialize(saved.doc) !== ZshSyntax.serialize(file.doc)
            );
        });
    }

    // Every exported variable, in the order zsh runs them; the last of each name is the one used.
    exports(): Array<Located<ZshVariable>> {
        return this.#find((statement): statement is ZshVariable =>
            ZshFiles.is(statement, "export")
        );
    }

    pathAdditions(): PathAddition[] {
        return ZshPath.additions(this.#files, this.#options);
    }

    pathReport(currentPath: string): Promise<PathReport> {
        return ZshPath.report(currentPath, this.pathAdditions());
    }

    // Every directory added to PATH, in the order the files run.
    // The shell's PATH, given as its value, compared with what the startup files add.
    // Removing every alias and function with each name. A function's name can be given with the
    // () zsh alias lists it with.
    planAliasRemoval(
        names: string[]
    ): RemovalPlan<Located<ZshAlias | ZshFunction>> {
        return this.#planRemoval(
            names,
            this.aliases(),
            // gs matches an alias and a function called gs, and gs() only the function.
            ({ statement }, name) =>
                name === statement.name || name === ZshStartup.label(statement),
            (items) => this.remove(items)
        );
    }

    // Removing every export of each variable.
    planExportRemoval(names: string[]): RemovalPlan<Located<ZshVariable>> {
        return this.#planRemoval(
            names,
            this.exports(),
            ({ statement }, name) => statement.name === name,
            (items) => this.remove(items)
        );
    }

    // Taking each directory, given however it's written, out of every line that adds it to PATH.
    planPathRemoval(dirs: string[]): RemovalPlan<PathAddition> {
        return this.#planRemoval(
            dirs.map((dir) => this.resolveDir(dir)),
            this.pathAdditions(),
            (addition, dir) => addition.expanded === dir,
            (items) => this.removePaths(items),
            (dir) => Text.displayPath(dir)
        );
    }

    // Removes whole statements, like aliases or exports.
    remove(located: Located[]): void {
        for (const group of Object.values(
            groupBy(located, ({ file }) => file.path)
        )) {
            const file = this.#current(group[0]!.file);
            let doc = file.doc;
            // Bottom up, so the line numbers of the rest stay right.
            for (const item of orderBy(
                group,
                ({ statement }) => statement.line,
                "desc"
            )) {
                assertEditable(item);
                doc = ZshEdit.remove(doc, item.statement);
            }
            this.update(file, doc);
        }
    }

    // Removes every export of name, so the variable isn't exported any more.
    removeExport(name: string): void {
        const found = this.exports().filter(
            ({ statement }) => statement.name === name
        );
        if (isEmpty(found)) {
            throw new ZshError(`${name} isn't exported`);
        }
        // All or nothing, so an earlier export doesn't take over from the one removed.
        for (const located of found) {
            assertEditable(located, name);
        }
        this.remove(found);
    }

    // Takes the directories of additions out of the statements that add them, removing a statement
    // when nothing else is left in it.
    removePaths(additions: PathAddition[]): void {
        for (const group of Object.values(
            groupBy(additions, (addition) => addition.file.path)
        )) {
            const file = this.#current(group[0]!.file);
            let doc = file.doc;
            // Bottom up, so the line numbers of the rest stay right.
            for (const statement of orderBy(
                Object.values(
                    groupBy(group, (addition) => addition.statement.line)
                ),
                (additions) => additions[0]!.statement.line,
                "desc"
            )) {
                const [first] = statement;
                assertEditable(first!);
                doc = ZshPath.remove(
                    doc,
                    first!.statement,
                    new Set(
                        statement.flatMap((addition) =>
                            addition.expanded == null ? [] : [addition.expanded]
                        )
                    ),
                    first!.scope,
                    this.#home
                );
            }
            this.update(file, doc);
        }
    }

    // Renames every export of from, where it is, keeping its value and comment, so the variable
    // is exported under the new name instead.
    renameExport(from: string, to: string): void {
        assertExportName(to);
        const exports = this.exports();
        if (exports.some(({ statement }) => statement.name === to)) {
            throw new ZshError(`${to} is already exported`);
        }
        const found = exports.filter(
            ({ statement }) => statement.name === from
        );
        if (isEmpty(found)) {
            throw new ZshError(`${from} isn't exported`);
        }
        // All or nothing, so from isn't left exported by a statement that couldn't change.
        for (const located of found) {
            assertEditable(located, from);
        }
        for (const group of Object.values(
            groupBy(found, ({ file }) => file.path)
        )) {
            const file = this.#current(group[0]!.file);
            let doc = file.doc;
            // Editable statements have a line to themselves, so renaming one doesn't move another.
            for (const { statement } of group) {
                doc = ZshEdit.replace(doc, statement, statement.nameSpan, to);
            }
            this.update(file, doc);
        }
    }

    // The directory input names, expanding ~ and variables the startup files set.
    resolveDir(input: string): string {
        const expanded = ZshFiles.expand(input, this.#variables(), this.#home);
        if (expanded == null) {
            throw new ZshError(`Can't tell which directory ${input} is`);
        }
        return ZshPath.normalize(expanded);
    }

    // Writes the files with changes, checking each with zsh -n and putting it back as it was when
    // zsh finds a syntax error that wasn't there before. Returns the files written.
    async save(): Promise<ZshFile[]> {
        const written: ZshFile[] = [];
        for (const file of this.changed()) {
            const saved = await ZshFiles.write(
                // A file that doesn't exist yet starts out empty.
                this.#saved.get(file.path) ?? {
                    ...file,
                    doc: ZshSyntax.parse(""),
                },
                file.doc
            );
            this.#saved.set(saved.path, saved);
            this.#replace(saved);
            written.push(saved);
        }
        return written;
    }

    // Changes the last definition of the alias name, which is the one that counts, or adds one to
    // the file to add to when there isn't one.
    setAlias(name: string, command: string, file?: string): Change<ZshAlias> {
        if (!ZshSyntax.isAliasName(name)) {
            throw new ZshError(
                `${JSON.stringify(name)} can't be an alias name; it can't have spaces, quotes, =, $ or characters like | and ;`
            );
        }
        if (isEmpty(command.trim())) {
            throw new ZshError(`Give the command for ${name} to run`);
        }
        const named = (statement: ZshStatement): statement is ZshAlias =>
            statement.kind === "alias" && statement.name === name;
        const existing = last(this.#find(named));
        if (existing == null) {
            const target = this.target("alias", file);
            return this.#changed(
                this.update(
                    target,
                    ZshEdit.add(
                        target,
                        "alias",
                        `alias ${name}=${ZshSyntax.quoteLiteral(command)}`
                    )
                ),
                named,
                "added"
            );
        }
        if (existing.statement.value === command) {
            return { ...existing, status: "unchanged" };
        }
        assertEditable(existing, name);
        return this.#changed(
            this.update(
                existing.file,
                ZshEdit.replace(
                    existing.file.doc,
                    existing.statement,
                    existing.statement.valueSpan,
                    ZshSyntax.quoteLiteral(command)
                )
            ),
            named,
            "changed"
        );
    }

    // Changes the last export of name, which is the one that counts, or adds an export to the file
    // to add to when there isn't one.
    setExport(name: string, value: string, file?: string): Change<ZshVariable> {
        assertExportName(name);
        const named = (statement: ZshStatement): statement is ZshVariable =>
            ZshFiles.is(statement, "export") &&
            (statement as ZshVariable).name === name;
        const existing = last(this.#find(named));
        if (existing == null) {
            const target = this.target("export", file);
            return this.#changed(
                this.update(
                    target,
                    ZshEdit.add(
                        target,
                        "export",
                        `export ${name}=${ZshSyntax.quoteExpandable(value)}`
                    )
                ),
                named,
                "added"
            );
        }
        if (existing.statement.value === value) {
            return { ...existing, status: "unchanged" };
        }
        assertEditable(existing, name);
        return this.#changed(
            this.update(
                existing.file,
                ZshEdit.replace(
                    existing.file.doc,
                    existing.statement,
                    existing.statement.valueSpan,
                    ZshSyntax.quoteExpandable(value)
                )
            ),
            named,
            "changed"
        );
    }

    // The file to add a statement of kind to: file, which zsh has to read for the change to do
    // anything, or the one with the most of kind already, or the .zshrc.
    target(kind: AdditionKind, file?: string): ZshFile {
        if (file == null) {
            return this.#current(
                ZshFiles.defaultFile(this.#files, kind, this.#options)
            );
        }
        const resolved = path.resolve(file.replace(/^~(?=\/|$)/, this.#home));
        const found = this.#files.find(
            (candidate) => candidate.path === resolved
        );
        if (found == null) {
            throw new ZshError(
                `zsh doesn't read ${file} when it starts. Pick one of ${this.#files.map((candidate) => candidate.display).join(", ")}, or source it from ~/.zshrc first`
            );
        }
        return found;
    }

    // Puts doc in place of file's contents, to be written by save(). Returns the updated file.
    update(file: ZshFile, doc: ZshDocument): ZshFile {
        const updated = ZshFiles.withDoc(file, doc);
        this.#replace(updated);
        return updated;
    }

    // The .zshrc, or an empty one when it doesn't exist, which save() creates.
    zshrc(): ZshFile {
        return this.#current(ZshFiles.zshrc(this.#files, this.#options));
    }

    #changed<T extends ZshStatement>(
        file: ZshFile,
        named: (statement: ZshStatement) => statement is T,
        status: Change["status"]
    ): Change<T> {
        return { file, statement: file.statements.findLast(named)!, status };
    }

    // file as it is now, with any changes made since it was read.
    #current(file: ZshFile): ZshFile {
        return (
            this.#files.find((candidate) => candidate.path === file.path) ??
            file
        );
    }

    // Statements matching filter in every file, in the order zsh runs them.
    #find<T extends ZshStatement>(
        filter: (statement: ZshStatement) => statement is T
    ): Array<Located<T>> {
        return this.#files.flatMap((file) =>
            file.statements
                .filter(filter)
                .map((statement) => ({ file, statement }))
        );
    }

    // A removal plan for the candidates that match one of names: the ones that can be changed
    // are removed by remove and saved, and read-only ones are left. display shows a name that
    // matched nothing.
    #planRemoval<T extends Located>(
        names: string[],
        candidates: T[],
        matches: (candidate: T, name: string) => boolean,
        remove: (items: T[]) => void,
        display = (name: string): string => name
    ): RemovalPlan<T> {
        const found = candidates.filter((candidate) =>
            names.some((name) => matches(candidate, name))
        );
        const items = found.filter(({ statement }) => statement.editable);
        return {
            blocked: found
                .filter(({ statement }) => !statement.editable)
                .map((item) => ({
                    item,
                    reason: ZshStartup.readOnlyReason(item),
                })),
            items,
            missing: uniq(
                names.filter(
                    (name) =>
                        !found.some((candidate) => matches(candidate, name))
                )
            ).map((name) => display(name)),
            remove: async () => {
                remove(items);
                await this.save();
                return [];
            },
        };
    }

    #replace(file: ZshFile): void {
        this.#files = this.#files.some(
            (candidate) => candidate.path === file.path
        )
            ? this.#files.map((candidate) =>
                  candidate.path === file.path ? file : candidate
              )
            : [...this.#files, file];
    }

    // The variables set by the end of the files, for expanding paths in them.
    #variables(): Map<string, string> {
        return ZshFiles.variables(this.#files, this.#options);
    }
}

// Whether a statement changes PATH, through PATH itself or the path array.
function isPathStatement(statement: ZshStatement): boolean {
    return (
        statement.kind === "path-array" ||
        (statement.kind === "variable" && statement.name === "PATH")
    );
}

function assertExportName(name: string): void {
    if (!ZshSyntax.isVariableName(name)) {
        throw new ZshError(
            `${JSON.stringify(name)} isn't a valid variable name; use letters, digits and underscores, like API_KEY`
        );
    }
    if (name === "PATH") {
        throw new ZshError(
            "Use `zsh path add` and `zsh path remove` to change PATH"
        );
    }
}

function assertEditable(located: Located, name?: string): void {
    if (!located.statement.editable) {
        throw new ZshError(
            `Can't change ${name ?? ZshStartup.location(located)}, since ${ZshStartup.readOnlyReason(located)}`
        );
    }
}

export type {
    AdditionKind,
    Change,
    Located,
    PathAddition,
    PathEntry,
    PathReport,
    ZshFile,
};
export { ZshError, ZshStartup };
