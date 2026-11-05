import { compact, isEmpty, last, uniq } from "lodash-es";
import type { Style } from "../../../shared/text.js";
import type { PathAddition, PathEntry } from "../../../topics/zsh/startup.js";
import { LIST_FLAGS, listHelp, SwissCommand } from "../../../shared/command.js";
import { Editor } from "../../../shared/editor.js";
import { Text } from "../../../shared/text.js";
import { ZshStartup } from "../../../topics/zsh/startup.js";

const PROBLEM_STYLES: Record<NonNullable<PathEntry["problem"]>, Style> = {
    duplicate: "yellow",
    missing: "red",
};

export default class ZshPathCommand extends SwissCommand {
    static override description = `List the directories in PATH, in the order they're searched, with the startup file and line that adds each one.

${listHelp("open the line that adds it in VS Code, or the directory when no startup file adds it")}

Directories with no file listed come from elsewhere, like /etc/paths on macOS or a tool that changes PATH when it runs. Ones that don't exist, and ones already earlier in PATH, are marked, since they only slow down finding commands.

PATH is this shell's, so changes since it started show up separately, as directories your startup files add that aren't in it yet.

${ZshStartup.FILES_HELP}

To change it, use \`<%= config.bin %> zsh path add\` and \`<%= config.bin %> zsh path remove\`.`;

    static override examples = ["<%= config.bin %> <%= command.id %>"];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { flags } = await this.parse(ZshPathCommand);
        const report = await (
            await ZshStartup.load()
        ).pathReport(process.env.PATH ?? "");
        const addedBy = (entry: PathEntry): string =>
            uniq(
                entry.addedBy.map((addition) => ZshStartup.location(addition))
            ).join(", ");

        await this.listItems<PathEntry>({
            action: "open the line that adds it in VS Code",
            choice: (entry) => ({
                hint: compact([
                    isEmpty(entry.addedBy)
                        ? "not added by your startup files"
                        : addedBy(entry),
                    entry.problem,
                ]).join(", "),
                label: Text.displayPath(entry.dir),
            }),
            columns: ["#", "DIRECTORY", "ADDED BY", ""],
            empty: "PATH is empty",
            fit: false,
            footer: this.#footer(report.pending, report.unknown),
            items: report.entries,
            noun: ["directory", "directories"],
            async open(entry) {
                // The last addition is the one that put it where it is.
                const addition = last(entry.addedBy);
                if (addition == null) {
                    await Editor.open(entry.dir);
                    return `Opened ${Text.displayPath(entry.dir)}`;
                }
                await Editor.open(addition.file.path, addition.statement.line);
                return `Opened ${ZshStartup.location(addition)}`;
            },
            row: (entry) => [
                String(report.entries.indexOf(entry) + 1),
                Text.displayPath(entry.dir),
                addedBy(entry),
                entry.problem == null
                    ? ""
                    : this.style(PROBLEM_STYLES[entry.problem], entry.problem),
            ],
            table: flags.table,
            title: "Directories in PATH, in the order they're searched",
            verb: "Opened",
        });
    }

    // The additions that aren't in this shell's PATH, or can't be worked out, or null when
    // there are none.
    #footer(pending: PathAddition[], unknown: PathAddition[]): null | string {
        const sections: string[] = [];
        if (!isEmpty(pending)) {
            sections.push(
                this.#section(
                    "Added by your startup files, but not in this shell's PATH yet:",
                    pending.map((addition) => [
                        Text.displayPath(addition.expanded!),
                        ZshStartup.location(addition),
                    ])
                )
            );
        }
        if (!isEmpty(unknown)) {
            sections.push(
                this.#section(
                    "Added by your startup files in a way that can't be worked out without running them:",
                    unknown.map((addition) => [
                        addition.dir,
                        ZshStartup.location(addition),
                    ])
                )
            );
        }
        return isEmpty(sections) ? null : sections.join("\n\n");
    }

    #section(heading: string, rows: string[][]): string {
        return [
            this.style("bold", heading),
            ...Text.table(rows.map(([dir, where]) => [`  ${dir}`, where!])),
        ].join("\n");
    }
}
