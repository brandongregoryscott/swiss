import { Flags } from "@oclif/core";
import { isEmpty, last } from "lodash-es";
import type { LocInterval } from "../../topics/loc/history.js";
import { SwissCommand } from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { LOC_ARGS, LOC_EXCLUSIONS, LOC_FLAGS } from "../../topics/loc/flags.js";
import { LOC_INTERVALS, LocHistory } from "../../topics/loc/history.js";
import { Loc } from "../../topics/loc/loc.js";

const DEFAULT_COLUMNS = 80;

export default class LocHistoryCommand extends SwissCommand {
    static override args = LOC_ARGS;

    static override description = `Chart a git repo's line count over time.

The count is a running total of the lines each commit added and removed, following the first parent of each commit back from HEAD, so a merged branch counts when it's merged. That takes one git log, so it's fast even on long histories, and with no uncommitted changes the last point matches \`<%= config.bin %> loc\`.

Commits are grouped by day, week (starting Monday), month or year, in local time, and each row shows the count after the last commit in it. The interval is picked to fit the history in at most 60 rows unless --interval sets it.

${LOC_EXCLUSIONS} They're left out of every commit, so the chart doesn't jump when a lockfile changes.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --interval year",
            description: "One row per year",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --json | jq '.[-1]'",
            description: "Print the latest point as JSON",
        },
    ];

    static override flags = {
        ...LOC_FLAGS,
        interval: Flags.option({
            char: "i",
            description:
                "How much time each row covers [default: the smallest that fits in 60 rows]",
            options: LOC_INTERVALS,
        })(),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(LocHistoryCommand);
        const dir = await Loc.resolveDir(args.dir);

        const progress = this.terminal.spinner();
        progress.start("Reading history");
        const points = await LocHistory.points(dir, {
            all: flags.all,
            exclude: flags.exclude,
        }).finally(() => progress.clear());

        if (isEmpty(points)) {
            if (flags.json) {
                this.log("[]");
            } else {
                this.log(`No commits in ${Text.displayPath(dir)}`);
            }
            return;
        }

        const interval: LocInterval =
            flags.interval ??
            LocHistory.autoInterval(points[0]!.date, last(points)!.date);
        const buckets = LocHistory.bucket(points, interval);

        if (flags.json) {
            this.log(
                JSON.stringify(
                    buckets.map((bucket) => ({
                        change: bucket.change,
                        date: bucket.start.toISOString(),
                        label: bucket.label,
                        lines: bucket.lines,
                    })),
                    null,
                    2
                )
            );
            return;
        }

        for (const line of LocHistory.chart(buckets, interval, {
            style: (style, text) => this.style(style, text),
            width: this.terminal.width ?? DEFAULT_COLUMNS,
        })) {
            this.log(line);
        }
        const first = buckets[0]!;
        const latest = last(buckets)!;
        this.log(
            this.style(
                "dim",
                `\n${Text.number(latest.lines)} lines, from ${Text.pluralize(points.length, "commit")} between ${first.label} and ${latest.label}`
            )
        );
    }
}
