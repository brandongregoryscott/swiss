import { Flags } from "@oclif/core";
import { isEmpty, sumBy } from "lodash-es";
import type { LocGrouping } from "../../topics/loc/loc.js";
import { SwissCommand } from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { LOC_ARGS, LOC_EXCLUSIONS, LOC_FLAGS } from "../../topics/loc/flags.js";
import { Loc } from "../../topics/loc/loc.js";

const GROUPINGS: LocGrouping[] = ["language", "directory"];

export default class LocCommand extends SwissCommand {
    static override args = LOC_ARGS;

    static override description = `Count the lines in a git repo's files, by language or by top-level directory.

Every file git tracks is counted as it is in the working tree, so uncommitted changes count but untracked files don't. Binary files are skipped. Every line counts, including blank lines and comments, the same way git diff counts them, so the total matches the last point of \`<%= config.bin %> loc history\` when there are no uncommitted changes.

${LOC_EXCLUSIONS}

For the line count over time, use \`<%= config.bin %> loc history\`, and for who wrote the lines, \`<%= config.bin %> loc authors\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --by directory",
            description: "Count by top-level directory",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> packages/api -x '**/*.test.ts'",
            description: "Count one package, without its tests",
        },
    ];

    static override flags = {
        ...LOC_FLAGS,
        by: Flags.option({
            default: "language" as const,
            description: "What to group the counts by",
            options: GROUPINGS,
        })(),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(LocCommand);
        const dir = await Loc.resolveDir(args.dir);

        const files = await Loc.count(dir, {
            all: flags.all,
            exclude: flags.exclude,
        });
        const groups = Loc.group(files, flags.by);
        const total = sumBy(files, "lines");

        if (flags.json) {
            this.log(
                JSON.stringify(
                    { files: files.length, groups, lines: total },
                    null,
                    2
                )
            );
            return;
        }

        if (isEmpty(files)) {
            this.log(`No files to count in ${Text.displayPath(dir)}`);
            return;
        }

        this.table(
            [
                [flags.by.toUpperCase(), "FILES", "LINES", "%"],
                ...groups.map((group) => [
                    group.name,
                    Text.number(group.files),
                    Text.number(group.lines),
                    formatPercent(group.lines, total),
                ]),
            ],
            { fit: false }
        );
        this.log(
            this.style(
                "bold",
                `\n${Text.number(total)} lines in ${Text.pluralize(files.length, "file")}`
            )
        );
    }
}

function formatPercent(lines: number, total: number): string {
    if (total === 0) {
        return "0%";
    }
    const percent = (lines / total) * 100;
    return percent < 1 && percent > 0 ? "<1%" : `${Math.round(percent)}%`;
}
