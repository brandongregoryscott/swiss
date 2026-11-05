import { last } from "lodash-es";
// Just enough of zsh's syntax to find the aliases, functions, variables, PATH changes and sourced files in
// startup files, and to know which of them can be changed without touching anything else.
import Parser from "tree-sitter";
import Zsh from "tree-sitter-zsh";

type SyntaxNode = Parser.SyntaxNode;

type Span = { end: number; start: number };

type StatementBase = {
    // A statement in a function, a conditional or a loop, or that spans several lines or shares
    // its line with other commands, is listed but not changed.
    editable: boolean;
    // 1-based.
    line: number;
    lineCount: number;
    // Inside a function, conditional or loop, so it might not run, or not when the file loads.
    nested: boolean;
};

type ZshAlias = {
    kind: "alias";
    name: string;
    value: string;
    // Where the value is in the line, for changing it in place.
    valueSpan: Span;
} & StatementBase;

type ZshFunction = {
    kind: "function";
    name: string;
    value: string;
} & StatementBase;

type ZshVariable = {
    exported: boolean;
    kind: "variable";
    name: string;
    // Where the name is in the line, for renaming it in place.
    nameSpan: Span;
    // The value as it's written, quotes and all.
    rawValue: string;
    value: string;
    valueSpan: Span;
} & StatementBase;

// path=(...) or path+=(...), zsh's array form of PATH.
type ZshPathArray = {
    append: boolean;
    kind: "path-array";
    // Each word as it's written, quotes and all, for rewriting the array without changing what
    // the rest mean.
    rawWords: string[];
    // The whole statement, for rewriting it.
    span: Span;
    words: string[];
} & StatementBase;

type ZshSource = {
    kind: "source";
    target: string;
} & StatementBase;

type ZshStatement =
    | ZshAlias
    | ZshFunction
    | ZshPathArray
    | ZshSource
    | ZshVariable;

// A file as its lines, so it can be changed without losing anything else in it.
type ZshDocument = {
    eol: string;
    lines: string[];
    trailingNewline: boolean;
};

const NAME_PATTERN = /^[A-Za-z_]\w*$/;
// Alias names can hold most characters, but not ones the shell would split on or expand.
const ALIAS_NAME_PATTERN = /^[^\s=$`'"\\;&|()<>]+$/;
const UNNESTED_PARENTS = new Set([
    "list",
    "negated_command",
    "pipeline",
    "program",
    "redirected_statement",
]);
const STATEMENT_LISTS = new Set([
    "case_item",
    "command_substitution",
    "compound_statement",
    "do_group",
    "elif_clause",
    "else_clause",
    "if_statement",
    "subshell",
]);
const CLOSING_WORDS = new Set(["done", "esac", "fi"]);

const parser = new Parser();
parser.setLanguage(Zsh as Parser.Language);

class ZshSyntax {
    // In double quotes, so $VARIABLES and $(commands) in it still expand.
    static doubleQuote(value: string): string {
        return `"${value.replaceAll(/["\\`]/g, String.raw`\$&`)}"`;
    }

    static isAliasName(name: string): boolean {
        return ALIAS_NAME_PATTERN.test(name);
    }

    static isVariableName(name: string): boolean {
        return NAME_PATTERN.test(name);
    }

    static parse(text: string): ZshDocument {
        const eol = text.includes("\r\n") ? "\r\n" : "\n";
        const trailingNewline = text === "" || text.endsWith("\n");
        const lines = text.split(/\r?\n/);
        if (trailingNewline) {
            lines.pop();
        }
        return { eol, lines, trailingNewline };
    }

    // Double-quoted unless it's a plain word, so $VARIABLES and $(commands) in it still expand.
    static quoteExpandable(value: string): string {
        if (/^[\w@%+=:,./~$-]+$/.test(value) && !value.includes("$(")) {
            return value;
        }
        return ZshSyntax.doubleQuote(value);
    }

    // Single-quoted unless it's a plain word, for alias values, which are kept as they are.
    static quoteLiteral(value: string): string {
        if (/^[\w@%+=:,./-]+$/.test(value)) {
            return value;
        }
        return `'${value.replaceAll("'", String.raw`'\''`)}'`;
    }

    static serialize(doc: ZshDocument): string {
        const text = doc.lines.join(doc.eol);
        return doc.trailingNewline && text !== "" ? `${text}${doc.eol}` : text;
    }

    static statements(doc: ZshDocument): ZshStatement[] {
        const text = doc.lines.join("\n");
        const tree = parser.parse(text, null, {
            bufferSize: Math.max(text.length + 1, 32 * 1024),
        });
        const statements: ZshStatement[] = [];
        collect(tree.rootNode, doc.lines, statements);
        return statements;
    }
}

type FoundStatement = {
    node: SyntaxNode;
    // The only definition in its command, so changing or removing it touches nothing else.
    single: boolean;
    statement: DistributiveOmit<ZshStatement, keyof StatementBase>;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
    ? Omit<T, K>
    : never;

function collect(
    node: SyntaxNode,
    lines: string[],
    statements: ZshStatement[]
): void {
    for (const found of read(node)) {
        const start = found.node.startPosition.row;
        const end = found.node.endPosition.row;
        const nested = ancestors(found.node).some(
            (ancestor) => !UNNESTED_PARENTS.has(ancestor.type)
        );
        statements.push({
            ...found.statement,
            editable:
                found.single &&
                !nested &&
                found.node.parent?.type === "program" &&
                aloneOnLines(found.node) &&
                !lines[end]!.trimEnd().endsWith("\\") &&
                (found.statement.kind === "function" || start === end),
            line: start + 1,
            lineCount: end - start + 1,
            nested,
        } as ZshStatement);
    }
    for (const child of node.namedChildren) {
        collect(child, lines, statements);
    }
}

function read(node: SyntaxNode): FoundStatement[] {
    switch (node.type) {
        case "command": {
            return readCommand(node);
        }
        case "declaration_command": {
            if (node.child(0)?.text !== "export") {
                return [];
            }
            const assignments = node.namedChildren.filter(
                (child) => child.type === "variable_assignment"
            );
            return assignments.flatMap((assignment) => {
                const found = readAssignment(assignment);
                return found?.kind === "variable"
                    ? [
                          {
                              node,
                              single: node.namedChildren.length === 1,
                              statement: { ...found, exported: true },
                          },
                      ]
                    : [];
            });
        }
        case "function_definition": {
            const name = node.childForFieldName("name");
            const body = node.childForFieldName("body");
            if (name == null || body == null) {
                return [];
            }
            return [
                {
                    node,
                    single: true,
                    statement: {
                        kind: "function",
                        name: name.text,
                        value: render(body)
                            .replaceAll(/\s*\\?\n\s*/g, " ")
                            .replace(/^\{\s*/, "")
                            .replace(/\s*\}$/, ""),
                    },
                },
            ];
        }
        case "variable_assignment": {
            if (
                [
                    "command",
                    "declaration_command",
                    "variable_assignments",
                ].includes(node.parent?.type ?? "")
            ) {
                return [];
            }
            const found = readAssignment(node);
            return found == null
                ? []
                : [{ node, single: true, statement: found }];
        }
        default: {
            return [];
        }
    }
}

function readCommand(node: SyntaxNode): FoundStatement[] {
    const name = node.childForFieldName("name");
    const command = name == null ? "" : valueOf(name.children);
    const words = adjacentGroups(node.childrenForFieldName("argument"));
    if (command === "alias") {
        const definitions = words
            .filter((word) => !word[0]!.text.startsWith("-"))
            .map((word) => readAlias(word))
            .filter((found) => found != null);
        return definitions.map((statement) => ({
            node,
            single: definitions.length === 1 && words.length === 1,
            statement,
        }));
    }
    if ((command === "source" || command === ".") && words[0] != null) {
        return [
            {
                node,
                single: false,
                statement: { kind: "source", target: valueOf(words[0]) },
            },
        ];
    }
    return [];
}

function readAlias(
    word: SyntaxNode[]
): DistributiveOmit<ZshAlias, keyof StatementBase> | null {
    const pieces = word.flatMap((node) =>
        node.type === "concatenation" ? node.children : [node]
    );
    const [first, ...rest] = pieces;
    const equals = first?.type === "word" ? first.text.indexOf("=") : -1;
    if (first == null || equals <= 0) {
        return null;
    }
    const name = first.text.slice(0, equals);
    if (!ZshSyntax.isAliasName(name)) {
        return null;
    }
    return {
        kind: "alias",
        name,
        value: unescape(first.text.slice(equals + 1)) + valueOf(rest),
        valueSpan: {
            end: last(pieces)!.endPosition.column,
            start: first.startPosition.column + equals + 1,
        },
    };
}

function readAssignment(
    node: SyntaxNode
):
    | DistributiveOmit<ZshPathArray, keyof StatementBase>
    | DistributiveOmit<ZshVariable, keyof StatementBase>
    | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";
    const operator = node.child(1)?.text;
    const value = node.childForFieldName("value");
    if (value?.type === "array") {
        const words = value.namedChildren.filter(
            (child) => child.type !== "comment"
        );
        return name === "path"
            ? {
                  append: operator === "+=",
                  kind: "path-array",
                  rawWords: words.map((child) => child.text),
                  span: {
                      end: node.endPosition.column,
                      start: node.startPosition.column,
                  },
                  words: words.map((child) => valueOf([child])),
              }
            : null;
    }
    if (operator !== "=" || !ZshSyntax.isVariableName(name)) {
        return null;
    }
    const valueEnd = node.child(1)!.endPosition.column;
    return {
        exported: name === "PATH",
        kind: "variable",
        name,
        nameSpan: {
            end: nameNode!.endPosition.column,
            start: nameNode!.startPosition.column,
        },
        rawValue: value?.text ?? "",
        value: value == null ? "" : valueOf([value]),
        valueSpan: {
            end: value?.endPosition.column ?? valueEnd,
            start: value?.startPosition.column ?? valueEnd,
        },
    };
}

function valueOf(nodes: SyntaxNode[]): string {
    return nodes
        .map((node) => {
            switch (node.type) {
                case "ansi_c_string": {
                    return node.text.slice(2, -1);
                }
                case "command_name":
                case "concatenation": {
                    return valueOf(node.children);
                }
                case "raw_string": {
                    return node.text.slice(1, -1);
                }
                case "string": {
                    return node.text
                        .slice(1, -1)
                        .replaceAll(/\\([\n"\\$`])/g, (_, char: string) =>
                            char === "\n" ? "" : char
                        );
                }
                case "word": {
                    return unescape(node.text);
                }
                default: {
                    return node.text;
                }
            }
        })
        .join("");
}

function unescape(text: string): string {
    return text.replaceAll(/\\(\n|.)/g, (_, char: string) =>
        char === "\n" ? "" : char
    );
}

function adjacentGroups(nodes: SyntaxNode[]): SyntaxNode[][] {
    const groups: SyntaxNode[][] = [];
    for (const node of nodes) {
        const group = last(groups);
        if (group != null && last(group)!.endIndex === node.startIndex) {
            group.push(node);
        } else {
            groups.push([node]);
        }
    }
    return groups;
}

function ancestors(node: SyntaxNode): SyntaxNode[] {
    const found: SyntaxNode[] = [];
    for (let parent = node.parent; parent != null; parent = parent.parent) {
        found.push(parent);
    }
    return found;
}

function aloneOnLines(node: SyntaxNode): boolean {
    return (node.parent?.namedChildren ?? []).every(
        (sibling) =>
            sibling.startIndex === node.startIndex ||
            sibling.type === "comment" ||
            sibling.endPosition.row < node.startPosition.row ||
            sibling.startPosition.row > node.endPosition.row
    );
}

function render(node: SyntaxNode): string {
    if (node.childCount === 0) {
        return node.text;
    }
    let text = "";
    let previous: null | SyntaxNode = null;
    for (const child of node.children) {
        if (child.type === "comment") {
            continue;
        }
        if (previous != null) {
            text += separator(node, previous, child);
        }
        text += render(child);
        previous = child;
    }
    return text;
}

function separator(
    parent: SyntaxNode,
    previous: SyntaxNode,
    next: SyntaxNode
): string {
    const between = parent.text.slice(
        previous.endIndex - parent.startIndex,
        next.startIndex - parent.startIndex
    );
    const endsCommand =
        /(^|[^\\])\n/.test(between) &&
        STATEMENT_LISTS.has(parent.type) &&
        previous.isNamed &&
        (next.isNamed || CLOSING_WORDS.has(next.type));
    return endsCommand ? "; " : between.replaceAll(/#[^\n]*/g, "");
}

export type {
    Span,
    ZshAlias,
    ZshDocument,
    ZshFunction,
    ZshPathArray,
    ZshSource,
    ZshStatement,
    ZshVariable,
};
export { ZshSyntax };
