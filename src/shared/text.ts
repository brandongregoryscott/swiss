import type { styleText } from "node:util";
import { max } from "lodash-es";
import { homedir } from "node:os";
import path from "node:path";

// A style for styleText, like "dim" or ["bold", "red"].
type Style = Parameters<typeof styleText>[0];

class Text {
    // Indented "term  definition" lines with the definitions lined up, for help text.
    static definitionList(entries: Array<[string, string]>): string {
        const width = max(entries.map(([term]) => term.length)) ?? 0;
        return entries
            .map(
                ([term, definition]) => `  ${term.padEnd(width)}  ${definition}`
            )
            .join("\n");
    }

    // Shortens paths under the home directory to ~/..., for display.
    static displayPath(dir: string): string {
        const home = homedir();
        if (dir === home) {
            return "~";
        }
        return dir.startsWith(`${home}${path.sep}`)
            ? `~${dir.slice(home.length)}`
            : dir;
    }

    // Numbers with thousands separators, like 12,345.
    static number(value: number): string {
        return value.toLocaleString("en-US");
    }

    static pluralize(count: number, noun: string, plural = `${noun}s`): string {
        return `${count} ${count === 1 ? noun : plural}`;
    }

    // Lines of a table with its columns lined up, cutting lines short to fit within width when
    // there is one. The last column isn't padded, so it's the one to put long values in.
    static table(rows: string[][], width?: number): string[] {
        const widths = rows[0]!.map(
            (_, column) => max(rows.map((row) => row[column]!.length)) ?? 0
        );
        return rows.map((row) => {
            const line = row
                .map((cell, column) =>
                    column === row.length - 1
                        ? cell
                        : cell.padEnd(widths[column]!)
                )
                .join("  ");
            return width == null ? line : Text.truncate(line, width);
        });
    }

    // text cut short with … to fit within width.
    static truncate(text: string, width: number): string {
        return text.length > width
            ? `${text.slice(0, Math.max(width - 1, 0))}…`
            : text;
    }
}

export type { Style };
export { Text };
