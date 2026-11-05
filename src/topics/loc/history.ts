import {
    addDays,
    addMonths,
    addWeeks,
    addYears,
    differenceInCalendarDays,
    format,
    startOfDay,
    startOfMonth,
    startOfWeek,
    startOfYear,
} from "date-fns";
import { compact, isEmpty, last, max, maxBy, sum } from "lodash-es";
import type { Style } from "../../shared/text.js";
import type { LocOptions } from "./loc.js";
import { Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";
import { BarChart } from "./bar-chart.js";
import { Loc } from "./loc.js";
import { Numstat } from "./numstat.js";

type LocInterval = "day" | "month" | "week" | "year";

// The line count just after a commit.
type LocPoint = {
    date: Date;
    lines: number;
    sha: string;
};

type LocBucket = {
    // Lines gained or lost since the previous bucket.
    change: number;
    label: string;
    // The line count after the last commit in the bucket, or carried over when it has none.
    lines: number;
    start: Date;
};

type ChartOptions = {
    // Styles text for where the chart is printed, leaving it plain where styles aren't shown.
    style: (style: Style, text: string) => string;
    // How wide the chart can be, so the bars fill what the columns leave.
    width: number;
};

// The narrowest a bar gets, even in a narrow terminal.
const MIN_BAR_WIDTH = 10;
const COLUMN_GAP = "  ";

const LOC_INTERVALS: LocInterval[] = ["day", "week", "month", "year"];
// The most buckets the automatic interval picks, so a chart fits on screen.
const MAX_AUTO_BUCKETS = 60;

const INTERVALS: Record<
    LocInterval,
    {
        add: (date: Date, amount: number) => Date;
        // Roughly, for picking an interval.
        days: number;
        label: string;
        start: (date: Date) => Date;
    }
> = {
    day: { add: addDays, days: 1, label: "yyyy-MM-dd", start: startOfDay },
    month: { add: addMonths, days: 30, label: "yyyy-MM", start: startOfMonth },
    week: {
        add: addWeeks,
        days: 7,
        label: "yyyy-MM-dd",
        start: (date) => startOfWeek(date, { weekStartsOn: 1 }),
    },
    year: { add: addYears, days: 365, label: "yyyy", start: startOfYear },
};

class LocHistory {
    // The smallest interval that keeps the chart to a screenful of rows.
    static autoInterval(first: Date, latest: Date): LocInterval {
        const days = differenceInCalendarDays(latest, first) + 1;
        return (
            LOC_INTERVALS.find(
                (interval) =>
                    days / INTERVALS[interval].days <= MAX_AUTO_BUCKETS
            ) ?? "year"
        );
    }

    // One bucket per interval from the first commit to the last, in local time.
    static bucket(points: LocPoint[], interval: LocInterval): LocBucket[] {
        const { add, label, start } = INTERVALS[interval];
        if (isEmpty(points)) {
            return [];
        }
        const buckets: LocBucket[] = [];
        const end = start(last(points)!.date);
        let index = 0;
        let lines = 0;
        let previous = 0;
        for (
            let bucketStart = start(points[0]!.date);
            bucketStart <= end;
            bucketStart = add(bucketStart, 1)
        ) {
            const next = add(bucketStart, 1);
            while (index < points.length && points[index]!.date < next) {
                lines = points[index]!.lines;
                index++;
            }
            buckets.push({
                change: lines - previous,
                label: format(bucketStart, label),
                lines,
                start: bucketStart,
            });
            previous = lines;
        }
        return buckets;
    }

    // The buckets as a table, header first, with each row's change in green or red and a bar for
    // its line count, scaled so the most lines fill the width the columns leave.
    static chart(
        buckets: LocBucket[],
        interval: LocInterval,
        options: ChartOptions
    ): string[] {
        const { style } = options;
        const header = [interval.toUpperCase(), "LINES", "CHANGE"];
        const rows = buckets.map((bucket) => [
            bucket.label,
            Text.number(bucket.lines),
            formatChange(bucket.change),
        ]);
        const widths = header.map(
            (_, column) =>
                max([header, ...rows].map((row) => row[column]!.length)) ?? 0
        );
        const tableWidth = sum(widths) + COLUMN_GAP.length * widths.length;
        // One column spare, so a full-width bar doesn't wrap.
        const barWidth = Math.max(
            options.width - tableWidth - 1,
            MIN_BAR_WIDTH
        );
        const most = maxBy(buckets, "lines")?.lines ?? 0;
        const pad = (text: string, column: number): string =>
            " ".repeat(widths[column]! - text.length);

        return [
            style(
                "bold",
                header
                    .map((cell, column) =>
                        column === header.length - 1
                            ? cell
                            : cell + pad(cell, column)
                    )
                    .join(COLUMN_GAP)
            ),
            ...buckets.map((bucket, index) => {
                const [label, lines, change] = rows[index]!;
                const styledChange =
                    bucket.change === 0
                        ? change!
                        : style(bucket.change > 0 ? "green" : "red", change!);
                return [
                    label! + pad(label!, 0),
                    lines! + pad(lines!, 1),
                    styledChange + pad(change!, 2),
                    style("cyan", BarChart.bar(bucket.lines, most, barWidth)),
                ].join(COLUMN_GAP);
            }),
        ];
    }

    // The line count after each commit on the first-parent history of HEAD, oldest first. It's
    // a running total of the lines each commit added and removed, so a merge counts the
    // changes it brought in, and the last point matches Loc.count for a clean checkout.
    static async points(
        dir: string,
        options: LocOptions = {}
    ): Promise<LocPoint[]> {
        const commits = await Numstat.log(
            dir,
            ["%ct"],
            ["--first-parent", "--diff-merges=first-parent", "--reverse"],
            Loc.pathspecs(options)
        );
        // Lines in each file so far, so a file that turns binary, or back, can be corrected.
        const fileLines = new Map<string, number>();
        let lines = 0;
        const points: LocPoint[] = [];
        for (const commit of commits) {
            const binary = commit.files.filter((file) => file.added == null);
            const resolved = isEmpty(binary)
                ? new Map<string, number>()
                : await linesAt(
                      dir,
                      commit.sha,
                      binary.map((file) => file.path)
                  );
            for (const file of commit.files) {
                const before = fileLines.get(file.path) ?? 0;
                const after =
                    file.added == null
                        ? (resolved.get(file.path) ?? 0)
                        : before + file.added - file.removed!;
                fileLines.set(file.path, after);
                lines += after - before;
            }
            points.push({
                date: new Date(Number(commit.fields[0]) * 1000),
                lines,
                sha: commit.sha,
            });
        }
        return points;
    }
}

function formatChange(change: number): string {
    return change > 0 ? `+${Text.number(change)}` : Text.number(change);
}

// Lines in each of paths as of sha, for the ones that are text there. git diff shows no counts
// when either side of a change is binary, so a file that stops or starts being binary is
// counted from its contents instead.
async function linesAt(
    dir: string,
    sha: string,
    paths: string[]
): Promise<Map<string, number>> {
    // grep exits 1 when nothing matches, like when every path is binary or deleted.
    const output = await Git.runWith(
        dir,
        { okExitCodes: [1] },
        "grep",
        "-z",
        "-c",
        "-I",
        "--full-name",
        "",
        sha,
        "--",
        ...paths.map((file) => `:(top,literal)${file}`)
    );
    const counts = new Map<string, number>();
    // Each match is sha:path, a NUL, then its count.
    for (const line of compact(output.split("\n"))) {
        const [name = "", count] = line.split("\0");
        counts.set(name.slice(sha.length + 1), Number(count));
    }
    return counts;
}

export type { LocBucket, LocInterval, LocPoint };
export { LOC_INTERVALS, LocHistory };
