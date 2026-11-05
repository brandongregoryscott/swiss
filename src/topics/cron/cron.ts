import type { CronFieldCollection } from "cron-parser";
import { tz } from "@date-fns/tz";
import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";
import { format } from "date-fns";
import { compact, isString, trim } from "lodash-es";
import { UserError } from "../../shared/errors.js";

type CronExample = {
    description: string;
    pattern: string;
};

type CronOptions = {
    now: Date;
    // IANA zone the pattern's times are read in.
    timeZone: string;
};

type ExplainedCron = {
    description: string;
    // How often it runs, like "Runs once a day", when that can be counted.
    frequency: string | undefined;
    // Gotchas in how the pattern runs, like matching either day field.
    notes: string[];
    runs: Date[];
    // Whether the pattern has a seconds field, so times should show seconds.
    seconds: boolean;
};

class CronError extends UserError {}

const EXAMPLES: CronExample[] = [
    { description: "Every minute", pattern: "* * * * *" },
    { description: "Every 5 minutes", pattern: "*/5 * * * *" },
    { description: "Every 15 minutes", pattern: "*/15 * * * *" },
    { description: "Every 30 minutes", pattern: "*/30 * * * *" },
    { description: "Every hour, on the hour", pattern: "0 * * * *" },
    { description: "Every hour, at half past", pattern: "30 * * * *" },
    { description: "Every 2 hours", pattern: "0 */2 * * *" },
    { description: "Every 6 hours", pattern: "0 */6 * * *" },
    { description: "Every day at midnight", pattern: "0 0 * * *" },
    { description: "Every day at 9am", pattern: "0 9 * * *" },
    { description: "Every day at 9am and 5pm", pattern: "0 9,17 * * *" },
    { description: "Every day at 2:30am", pattern: "30 2 * * *" },
    { description: "Every weekday at 9am", pattern: "0 9 * * 1-5" },
    {
        description: "Every 15 minutes during work hours on weekdays",
        pattern: "*/15 9-17 * * 1-5",
    },
    { description: "Every weekend day at 10am", pattern: "0 10 * * 0,6" },
    { description: "Every Monday at 9am", pattern: "0 9 * * 1" },
    { description: "Every Friday at 5pm", pattern: "0 17 * * 5" },
    { description: "Every Sunday at midnight", pattern: "0 0 * * 0" },
    {
        description: "On the 1st of every month at midnight",
        pattern: "0 0 1 * *",
    },
    {
        description: "On the 1st and 15th of every month at midnight",
        pattern: "0 0 1,15 * *",
    },
    {
        description: "On the last day of every month at midnight",
        pattern: "0 0 L * *",
    },
    {
        description: "On the first Monday of every month at 9am",
        pattern: "0 9 * * 1#1",
    },
    {
        description: "On the last Friday of every month at 5pm",
        pattern: "0 17 * * 5L",
    },
    {
        description: "At midnight at the start of every quarter",
        pattern: "0 0 1 1,4,7,10 *",
    },
    {
        description: "Every year on January 1st at midnight",
        pattern: "0 0 1 1 *",
    },
    {
        description: "Every 30 seconds (6 fields, the first is seconds)",
        pattern: "*/30 * * * * *",
    },
];

// Fields that leave the day unrestricted, so cron only matches the other day field.
const ANY_DAY = new Set(["*", "?"]);

class Cron {
    static readonly EXAMPLES = EXAMPLES;

    // Describes a pattern in words and finds its next count run times after now. Accepts 5 fields,
    // 6 with seconds first, and macros like @daily.
    static explain(
        pattern: string,
        count: number,
        options: CronOptions
    ): ExplainedCron {
        const trimmed = trim(pattern);
        if (trimmed === "") {
            throw new CronError("The cron pattern is empty");
        }
        if (trimmed === "@reboot") {
            throw new CronError(
                "@reboot runs once when cron starts, so it has no schedule to explain"
            );
        }

        let description: string;
        try {
            description = cronstrue.toString(trimmed, {
                throwExceptionOnParseError: true,
                use24HourTimeFormat: true,
            });
        } catch (error) {
            // cronstrue throws strings, prefixed with "Error: ".
            throw new CronError(
                `${trimmed} isn't a valid cron pattern: ${String(error).replace(/^Error: /, "")}`
            );
        }

        const runs: Date[] = [];
        let frequency: string | undefined;
        try {
            const expression = CronExpressionParser.parse(trimmed, {
                currentDate: options.now,
                tz: options.timeZone,
            });
            frequency = describeFrequency(expression.fields);
            while (runs.length < count && expression.hasNext()) {
                runs.push(expression.next().toDate());
            }
        } catch (error) {
            if (error instanceof Error) {
                throw new CronError(
                    `${trimmed} isn't a valid cron pattern: ${error.message}`
                );
            }
            throw error;
        }

        const fields = trimmed.split(/\s+/);
        const seconds = fields.length === 6;
        const [dayOfMonth, , dayOfWeek] = fields.slice(seconds ? 3 : 2);
        const notes: string[] = [];
        if (
            dayOfMonth != null &&
            dayOfWeek != null &&
            !ANY_DAY.has(dayOfMonth) &&
            !ANY_DAY.has(dayOfWeek)
        ) {
            notes.push(
                "Both day fields are set, so it runs on days matching either one, not both"
            );
        }
        if (seconds) {
            notes.push("The first of the 6 fields is read as seconds");
        }
        return { description, frequency, notes, runs, seconds };
    }

    // A run time in the pattern's zone, like "Mon 2026-10-26 09:00".
    static formatRun(date: Date, timeZone: string, seconds: boolean): string {
        return format(
            date,
            seconds ? "EEE yyyy-MM-dd HH:mm:ss" : "EEE yyyy-MM-dd HH:mm",
            { in: tz(timeZone) }
        );
    }

    // The examples whose description or pattern contains every word of the search.
    static searchExamples(search: string | undefined): CronExample[] {
        const words = compact((search ?? "").toLowerCase().split(/\s+/));
        return EXAMPLES.filter((example) => {
            const text =
                `${example.description} ${example.pattern}`.toLowerCase();
            return words.every((word) => text.includes(word));
        });
    }
}

type DayScope = "every-day" | { count: number; period: "month" | "week" };

// How often a pattern runs, like "Runs once a day" or "Runs 4 times an hour, 5 days a week", or
// undefined when both day fields are set, since days matching either one can't be counted simply.
function describeFrequency(fields: CronFieldCollection): string | undefined {
    const seconds = fields.second.values.length;
    const minutes = fields.minute.values.length;
    const hours = fields.hour.values.length;
    const months = fields.month.values.length;
    const scope = dayScope(fields);
    if (scope == null) {
        return undefined;
    }
    const perDay = seconds * minutes * hours;
    const inMonths =
        months === 12
            ? ""
            : `, in ${months === 1 ? "one month" : `${months} months`} of the year`;

    if (scope === "every-day") {
        if (months < 12 || hours < 24) {
            return `Runs ${times(perDay)} a day${inMonths}`;
        }
        return minutes === 60
            ? `Runs ${times(seconds)} a minute`
            : `Runs ${times(seconds * minutes)} an hour`;
    }

    // "Runs once a day, 5 days a week" reads better than "Runs 5 times a week".
    if (
        perDay === 1 &&
        months === 12 &&
        (scope.count === 1 || scope.period === "month")
    ) {
        return `Runs ${times(scope.count)} a ${scope.period}`;
    }
    if (perDay === 1 && scope.period === "month" && months < 12) {
        return `Runs ${times(scope.count * months)} a year`;
    }
    const days = scope.count === 1 ? "one day" : `${scope.count} days`;
    return `Runs ${times(perDay)} a day, ${days} a ${scope.period}${inMonths}`;
}

// Which days a pattern runs on: every day, some days of the week, or some days of the month. Days
// of the week like 5L (the last Friday) or 1#1 (the first Monday) come once a month.
function dayScope(fields: CronFieldCollection): DayScope | undefined {
    const daysOfMonth = fields.dayOfMonth.values;
    const daysOfWeek = fields.dayOfWeek.values;
    const monthlyDayOfWeek =
        fields.dayOfWeek.nthDay > 0 || daysOfWeek.some(isString);
    // 0 and 7 are both Sunday.
    const everyDayOfWeek =
        !monthlyDayOfWeek &&
        new Set(daysOfWeek.map((day) => (day === 7 ? 0 : day))).size === 7;
    // A * day of the month is cut short to fit the months, like 1-30 when only June is set.
    const everyDayOfMonth =
        fields.dayOfMonth.isWildcard || daysOfMonth.length === 31;

    if (everyDayOfMonth && everyDayOfWeek) {
        return "every-day";
    }
    if (everyDayOfMonth) {
        return monthlyDayOfWeek
            ? { count: daysOfWeek.length, period: "month" }
            : {
                  count: new Set(daysOfWeek.map((day) => (day === 7 ? 0 : day)))
                      .size,
                  period: "week",
              };
    }
    if (everyDayOfWeek) {
        return { count: daysOfMonth.length, period: "month" };
    }
    return undefined;
}

// "once", "twice", or "N times", with thousands separated.
function times(count: number): string {
    if (count === 1) {
        return "once";
    }
    return count === 2 ? "twice" : `${count.toLocaleString("en-US")} times`;
}

export type { CronExample, CronOptions, ExplainedCron };
export { Cron, CronError };
