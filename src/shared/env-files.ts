import { readFile, writeFile } from "node:fs/promises";
import { UserError } from "./errors.js";
import { Text } from "./text.js";

class EnvError extends UserError {}

// A line of an env file. An entry whose value is quoted across several lines is one line here,
// with raw holding all of them.
type EnvLine =
    | { key: string; kind: "entry"; raw: string; value: string }
    | { kind: "other"; raw: string };

// An env file as its lines, so it can be changed without losing comments, blank lines or order.
type EnvDocument = {
    eol: string;
    lines: EnvLine[];
    trailingNewline: boolean;
};

const KEY_PATTERN = /^[A-Za-z_][\w.-]*$/;
const ENTRY_PATTERN = /^(\s*(?:export\s+)?)([A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/;
const MASK = "••••••••";

type Assignment = {
    key: string;
    // Null when only the key was given.
    value: null | string;
};

class EnvFile {
    static entries(doc: EnvDocument): Map<string, string> {
        const entries = new Map<string, string>();
        for (const line of doc.lines) {
            if (line.kind === "entry") {
                // Later entries win, as they do with dotenv.
                entries.delete(line.key);
                entries.set(line.key, line.value);
            }
        }
        return entries;
    }

    // Formats a value for display on one line, hiding it unless reveal is set.
    static formatValue(value: string, reveal: boolean): string {
        if (value === "") {
            return "(empty)";
        }
        if (!reveal) {
            return MASK;
        }
        return value
            .replaceAll("\r", String.raw`\r`)
            .replaceAll("\n", String.raw`\n`);
    }

    static isValidKey(key: string): boolean {
        return KEY_PATTERN.test(key);
    }

    // The line, counting from 1, that sets key's value, which is the last that sets it, or null
    // when none does.
    static lineOf(doc: EnvDocument, key: string): null | number {
        let line = 1;
        let found: null | number = null;
        for (const entry of doc.lines) {
            if (entry.kind === "entry" && entry.key === key) {
                found = line;
            }
            line += entry.raw.split(doc.eol).length;
        }
        return found;
    }

    // Parses the way dotenv does: unquoted values end at a #, single-quoted and backtick-quoted
    // values are taken as they are, and double-quoted values have \n and \r turned into newlines.
    // Quoted values can span several lines.
    static parse(text: string): EnvDocument {
        const eol = text.includes("\r\n") ? "\r\n" : "\n";
        const trailingNewline = text === "" || text.endsWith("\n");
        const rawLines = text.split(/\r?\n/);
        if (trailingNewline) {
            rawLines.pop();
        }

        const lines: EnvLine[] = [];
        for (let index = 0; index < rawLines.length; index++) {
            const raw = rawLines[index]!;
            const match = ENTRY_PATTERN.exec(raw);
            if (match == null) {
                lines.push({ kind: "other", raw });
                continue;
            }

            const key = match[2]!;
            const rest = match[4]!;
            const quote = rest[0];
            if (quote === '"' || quote === "'" || quote === "`") {
                // Join lines until the closing quote, for values like private keys.
                let joined = rest;
                let end = index;
                let closing = findClosingQuote(joined, quote);
                while (closing === -1 && end + 1 < rawLines.length) {
                    end++;
                    joined += `\n${rawLines[end]}`;
                    closing = findClosingQuote(joined, quote);
                }
                if (closing !== -1) {
                    const inner = joined.slice(1, closing);
                    lines.push({
                        key,
                        kind: "entry",
                        raw: rawLines.slice(index, end + 1).join(eol),
                        value:
                            quote === '"'
                                ? inner
                                      .replaceAll(String.raw`\n`, "\n")
                                      .replaceAll(String.raw`\r`, "\r")
                                : inner,
                    });
                    index = end;
                    continue;
                }
            }

            const hash = rest.indexOf("#");
            lines.push({
                key,
                kind: "entry",
                raw,
                value: (hash === -1 ? rest : rest.slice(0, hash)).trim(),
            });
        }
        return { eol, lines, trailingNewline };
    }

    // Splits KEY=VALUE from the command line, with a null value for a bare KEY.
    static parseAssignment(input: string): Assignment {
        const equals = input.indexOf("=");
        const key = equals === -1 ? input : input.slice(0, equals);
        if (!EnvFile.isValidKey(key)) {
            throw new EnvError(
                `${JSON.stringify(key)} isn't a valid variable name; use letters, digits and underscores, like API_KEY`
            );
        }
        return { key, value: equals === -1 ? null : input.slice(equals + 1) };
    }

    static async read(file: string): Promise<EnvDocument> {
        try {
            return EnvFile.parse(await readFile(file, "utf8"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return EnvFile.parse("");
            }
            throw new EnvError(
                `Could not read ${Text.displayPath(file)}: ${(error as Error).message}`
            );
        }
    }

    // Renames every entry for from, keeping its value and place.
    static rename(doc: EnvDocument, from: string, to: string): EnvDocument {
        if (!EnvFile.isValidKey(to)) {
            throw new EnvError(
                `${JSON.stringify(to)} isn't a valid variable name`
            );
        }
        return {
            ...doc,
            lines: doc.lines.map((line) =>
                line.kind === "entry" && line.key === from
                    ? entryLine(to, line.value, line.raw)
                    : line
            ),
        };
    }

    static serialize(doc: EnvDocument): string {
        const text = doc.lines.map((line) => line.raw).join(doc.eol);
        return doc.trailingNewline && text !== "" ? `${text}${doc.eol}` : text;
    }

    // Changes every entry for key in place, or adds one at the end when there isn't one.
    static set(doc: EnvDocument, key: string, value: string): EnvDocument {
        if (!EnvFile.isValidKey(key)) {
            throw new EnvError(
                `${JSON.stringify(key)} isn't a valid variable name`
            );
        }
        const exists = doc.lines.some(
            (line) => line.kind === "entry" && line.key === key
        );
        if (!exists) {
            return {
                ...doc,
                lines: [...doc.lines, entryLine(key, value)],
                trailingNewline: true,
            };
        }
        return {
            ...doc,
            lines: doc.lines.map((line) =>
                line.kind === "entry" && line.key === key
                    ? entryLine(key, value, line.raw)
                    : line
            ),
        };
    }

    static unset(doc: EnvDocument, key: string): EnvDocument {
        return {
            ...doc,
            lines: doc.lines.filter(
                (line) => !(line.kind === "entry" && line.key === key)
            ),
        };
    }

    static async write(file: string, doc: EnvDocument): Promise<void> {
        try {
            await writeFile(file, EnvFile.serialize(doc));
        } catch (error) {
            throw new EnvError(
                `Could not write ${Text.displayPath(file)}: ${(error as Error).message}`
            );
        }
    }
}

// Index of the quote that closes the one at the start of text, or -1. Escaped double quotes
// don't count, as with dotenv.
function findClosingQuote(text: string, quote: string): number {
    for (let index = 1; index < text.length; index++) {
        if (quote === '"' && text[index] === "\\") {
            index++;
        } else if (text[index] === quote) {
            return index;
        }
    }
    return -1;
}

// A line for key=value, keeping the export prefix, spacing and trailing comment of previous.
function entryLine(key: string, value: string, previous?: string): EnvLine {
    const match = previous == null ? null : ENTRY_PATTERN.exec(previous);
    const prefix = match?.[1] ?? "";
    const separator = match?.[3] ?? "=";
    // A comment after a value that spans several lines isn't kept.
    const comment =
        previous != null && !previous.includes("\n") && match != null
            ? trailingComment(match[4]!)
            : "";
    return {
        key,
        kind: "entry",
        raw: `${prefix}${key}${separator}${quoteValue(value, match?.[4]?.[0])}${comment}`,
        value,
    };
}

function trailingComment(rest: string): string {
    if (/^["'`]/.test(rest)) {
        const closing = findClosingQuote(rest, rest[0]!);
        const after = closing === -1 ? "" : rest.slice(closing + 1);
        return /^\s+#/.test(after) ? after : "";
    }
    const match = /\s+#.*$/.exec(rest);
    return match?.[0] ?? "";
}

// Writes value so dotenv reads it back unchanged: in the quotes it had before when they can still
// hold it, otherwise bare when it's simple, otherwise in the first kind of quotes that can hold it.
function quoteValue(value: string, previousQuote?: string): string {
    const quotes = ["'", '"', "`"];
    const fits = (quote: string): boolean => {
        switch (quote) {
            case "'": {
                return !/['\r\n]/.test(value);
            }
            case '"': {
                // dotenv turns \n and \r in double quotes into newlines, so they can't appear
                // literally, and a backslash at the end would escape the closing quote.
                return (
                    !value.includes('"') &&
                    !/\\[nr]/.test(value) &&
                    !value.endsWith("\\")
                );
            }
            default: {
                return !value.includes(quote);
            }
        }
    };
    if (
        previousQuote != null &&
        quotes.includes(previousQuote) &&
        fits(previousQuote)
    ) {
        return `${previousQuote}${value}${previousQuote}`;
    }
    if (/^[^\s#'"`]*$/.test(value)) {
        return value;
    }
    const quote = quotes.find((candidate) => fits(candidate));
    if (quote == null) {
        throw new EnvError(
            "That value has every kind of quote and a newline in it, so it can't be written to an env file"
        );
    }
    return `${quote}${value}${quote}`;
}

export type { Assignment, EnvDocument, EnvLine };
export { EnvError, EnvFile };
