import type { Duration } from "date-fns";
import { tz } from "@date-fns/tz";
import {
    add,
    addDays,
    format,
    intervalToDuration,
    isValid,
    parseISO,
    startOfDay,
} from "date-fns";
import { isEmpty } from "lodash-es";
import { UserError } from "../errors.js";
import { Text } from "../text.js";

type EpochUnit = "ms" | "ns" | "s" | "us";

type DateField = "epoch" | "iso-local" | "iso" | "local" | "ms" | "relative";

type DiffField = "days" | "duration" | "hours" | "ms" | "seconds";

type DateOptions = {
    now: Date;
    // IANA zone that local times are shown in, and that inputs without an offset are read in.
    timeZone: string;
};

type ParseOptions = {
    // How to read a bare number, instead of guessing from its digit count.
    unit?: EpochUnit;
} & DateOptions;

type ParsedDate = {
    date: Date;
    // How an ambiguous input was read, like which epoch unit a bare number was taken to be.
    notes: string[];
};

class DateInputError extends UserError {}

const DATE_FIELDS: DateField[] = [
    "iso",
    "iso-local",
    "local",
    "epoch",
    "ms",
    "relative",
];

const DIFF_FIELDS: DiffField[] = ["duration", "days", "hours", "seconds", "ms"];

// What each field shows, for help text.
const DATE_FIELD_HELP: Record<DateField, string> = {
    epoch: "Seconds since the Unix epoch",
    iso: "ISO 8601 in UTC",
    "iso-local": "ISO 8601 with the local (or --tz) offset",
    local: "The full local (or --tz) date and time",
    ms: "Milliseconds since the Unix epoch",
    relative: 'From now, like "3d 2h ago" or "in 1h 30m"',
};

const DIFF_FIELD_HELP: Record<DiffField, string> = {
    days: "Total days",
    duration: "Calendar-aware, like 2mo 1d 6h 30m",
    hours: "Total hours",
    ms: "Total milliseconds",
    seconds: "Total seconds",
};

const EPOCH_UNITS: EpochUnit[] = ["s", "ms", "us", "ns"];

// Nanoseconds per unit, as bigints so 19-digit nanosecond epochs keep every digit while parsing.
const NANOS_PER_UNIT: Record<EpochUnit, bigint> = {
    ms: 1_000_000n,
    ns: 1n,
    s: 1_000_000_000n,
    us: 1000n,
};

const UNIT_NAMES: Record<EpochUnit, string> = {
    ms: "milliseconds",
    ns: "nanoseconds",
    s: "seconds",
    us: "microseconds",
};

const OFFSET_UNITS: Record<string, "milliseconds" | keyof Duration> = {
    d: "days",
    h: "hours",
    m: "minutes",
    mo: "months",
    ms: "milliseconds",
    s: "seconds",
    w: "weeks",
    y: "years",
};

// Units in the order they're listed in a compact duration, like 1y 2mo 3d 4h 5m 6s.
const DURATION_UNITS: Array<[keyof Duration, string]> = [
    ["years", "y"],
    ["months", "mo"],
    ["days", "d"],
    ["hours", "h"],
    ["minutes", "m"],
    ["seconds", "s"],
];

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

type SplitArgsResult = { input: string; offsets: string[] };

// A length of time as amounts of each unit, negative when it goes backwards.
type Span = Array<{ amount: number; unit: "milliseconds" | keyof Duration }>;

class Dates {
    static readonly DATE_FIELDS = DATE_FIELDS;
    // Each field and what it shows, in order, for help text.
    static readonly DATE_FIELDS_HELP = Text.definitionList(
        DATE_FIELDS.map((field) => [field, DATE_FIELD_HELP[field]])
    );
    static readonly DIFF_FIELDS = DIFF_FIELDS;
    static readonly DIFF_FIELDS_HELP = Text.definitionList(
        DIFF_FIELDS.map((field) => [field, DIFF_FIELD_HELP[field]])
    );
    static readonly EPOCH_UNITS = EPOCH_UNITS;

    // Moves date by each offset in turn, like +90m, -3d or +1h30m. Days and longer keep the
    // wall-clock time in options.timeZone across daylight saving changes.
    // Adds a duration to date, with calendar units like days and months counted in timeZone, so
    // a day across a DST change is still a day.
    static addDuration(date: Date, span: Span, timeZone: string): Date {
        let result = date;
        for (const { amount, unit } of span) {
            result =
                unit === "milliseconds"
                    ? new Date(result.getTime() + amount)
                    : add(result, { [unit]: amount }, { in: tz(timeZone) });
        }
        return new Date(result.getTime());
    }

    // Each field as [name, value], in the order they're listed.
    static describe(
        date: Date,
        options: DateOptions
    ): Array<[DateField, string]> {
        return DATE_FIELDS.map((field) => [
            field,
            Dates.format(date, field, options),
        ]);
    }

    // Every field for the time from start to end, which is negative when end is earlier.
    static describeDiff(start: Date, end: Date): Array<[DiffField, string]> {
        return DIFF_FIELDS.map((field) => [
            field,
            Dates.formatDiff(start, end, field),
        ]);
    }

    static format(date: Date, field: DateField, options: DateOptions): string {
        switch (field) {
            case "epoch": {
                return String(Math.floor(date.getTime() / 1000));
            }

            case "iso": {
                return new Date(date.getTime()).toISOString();
            }

            case "iso-local": {
                return format(date, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx", {
                    in: tz(options.timeZone),
                });
            }

            case "local": {
                return new Intl.DateTimeFormat(undefined, {
                    dateStyle: "full",
                    timeStyle: "long",
                    timeZone: options.timeZone,
                }).format(date);
            }

            case "ms": {
                return String(date.getTime());
            }

            case "relative": {
                return formatRelative(date, options.now);
            }
        }
    }

    static formatDiff(start: Date, end: Date, field: DiffField): string {
        const ms = end.getTime() - start.getTime();
        switch (field) {
            case "days": {
                return formatDecimal(ms / MS_PER_DAY);
            }

            case "duration": {
                return formatDuration(start, end);
            }

            case "hours": {
                return formatDecimal(ms / MS_PER_HOUR);
            }

            case "ms": {
                return String(ms);
            }

            case "seconds": {
                return formatDecimal(ms / 1000);
            }
        }
    }

    // Applies offsets like +90m or -3d to date in turn.
    static offset(date: Date, offsets: string[], timeZone: string): Date {
        let result = date;
        for (const offset of offsets) {
            const span = /^[+-]/.test(offset) ? readSpan(offset) : null;
            if (span == null) {
                throw new DateInputError(
                    `${offset} isn't an offset; use something like +90m, -3d or +1h30m (units: ${Object.keys(OFFSET_UNITS).join(", ")})`
                );
            }
            result = Dates.addDuration(result, span, timeZone);
        }
        return new Date(result.getTime());
    }

    static parse(input: string, options: ParseOptions): ParsedDate {
        const trimmed = input.trim();
        const keyword = parseKeyword(trimmed.toLowerCase(), options);
        if (keyword != null) {
            return { date: keyword, notes: [] };
        }
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return parseEpoch(trimmed, options.unit);
        }
        if (options.unit != null) {
            throw new DateInputError(
                `--unit only applies to epoch numbers, not ${trimmed}`
            );
        }
        if (/^\d{4}-\d{2}/.test(trimmed)) {
            return parseIsoDate(trimmed, options.timeZone);
        }

        // Anything else Date can read, like an RFC 2822 date from an HTTP header or email.
        const date = new Date(trimmed);
        if (!isValid(date)) {
            throw new DateInputError(
                `Couldn't read ${trimmed} as a date; use an epoch number, an ISO 8601 date, or now`
            );
        }
        return { date, notes: [] };
    }

    // A duration like 30m, 7d or 1h30m, going backwards when it starts with -.
    static parseDuration(input: string): Span {
        const span = readSpan(input.trim());
        if (span == null) {
            throw new DateInputError(
                `${input} isn't a duration; use something like 30m, 7d, 1h30m or -5m (units: ${Object.keys(OFFSET_UNITS).join(", ")})`
            );
        }
        return span;
    }

    // Splits command-line words into the date and the offsets after it, so a date with spaces,
    // like an RFC 2822 one, doesn't need quoting. Offsets start at the first word like +90m.
    // No date words means now.
    static splitArgs(words: string[]): SplitArgsResult {
        const index = words.findIndex((word) => /^[+-]\d+[a-z]/i.test(word));
        const inputWords = index === -1 ? words : words.slice(0, index);
        return {
            input: isEmpty(inputWords) ? "now" : inputWords.join(" "),
            offsets: index === -1 ? [] : words.slice(index),
        };
    }

    // Throws when timeZone isn't an IANA zone Intl knows, like America/New_York or UTC.
    // The time zone given, like with --tz, checked to be a real one, or the system's when none is.
    static timeZone(given?: string): string {
        if (given == null) {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
        try {
            new Intl.DateTimeFormat(undefined, { timeZone: given });
        } catch {
            throw new DateInputError(
                `${given} isn't a time zone; use an IANA name like America/New_York, Europe/London or UTC`
            );
        }
        return given;
    }
}

function parseKeyword(input: string, options: DateOptions): Date | null {
    const today = () => startOfDay(options.now, { in: tz(options.timeZone) });
    switch (input) {
        case "now": {
            return options.now;
        }

        case "today": {
            return new Date(today().getTime());
        }

        case "tomorrow": {
            return new Date(addDays(today(), 1).getTime());
        }

        case "yesterday": {
            return new Date(addDays(today(), -1).getTime());
        }

        default: {
            return null;
        }
    }
}

function parseEpoch(input: string, unit: EpochUnit | undefined): ParsedDate {
    const [whole = "", fraction] = input.split(".");
    const digits = whole.replace(/^-/, "").replace(/^0+(?=\d)/, "").length;
    // A decimal is almost always seconds, like Python's time.time() or a Slack message ts.
    const resolved = unit ?? (fraction != null ? "s" : guessEpochUnit(digits));
    if (resolved == null) {
        throw new DateInputError(
            `${input} has too many digits to be an epoch timestamp; nanoseconds have at most 19`
        );
    }

    const nanosPerUnit = NANOS_PER_UNIT[resolved];
    const fractionDigits = (fraction ?? "").slice(0, 9);
    const nanos =
        BigInt(whole) * nanosPerUnit +
        (whole.startsWith("-") ? -1n : 1n) *
            ((BigInt(fractionDigits === "" ? "0" : fractionDigits) *
                nanosPerUnit) /
                10n ** BigInt(fractionDigits.length));
    const date = new Date(Number(nanos / NANOS_PER_UNIT.ms));
    if (!isValid(date)) {
        throw new DateInputError(
            `${input} ${UNIT_NAMES[resolved]} is out of range`
        );
    }

    const notes =
        unit == null ? [`read ${input} as ${UNIT_NAMES[resolved]}`] : [];
    if (nanos % NANOS_PER_UNIT.ms !== 0n) {
        notes.push("anything finer than a millisecond is dropped");
    }
    return { date, notes };
}

function guessEpochUnit(digits: number): EpochUnit | null {
    if (digits <= 11) {
        return "s";
    }
    if (digits <= 14) {
        return "ms";
    }
    if (digits <= 17) {
        return "us";
    }
    return digits <= 19 ? "ns" : null;
}

function parseIsoDate(input: string, timeZone: string): ParsedDate {
    const date = parseISO(input, { in: tz(timeZone) });
    if (!isValid(date)) {
        throw new DateInputError(`Couldn't read ${input} as an ISO 8601 date`);
    }
    const hasOffset =
        /(z|[+-]\d{2}(:?\d{2})?)$/i.test(input) && /[t ]\d/i.test(input);
    return {
        date: new Date(date.getTime()),
        notes: hasOffset
            ? []
            : [`no offset given, so read as ${timeZone} time`],
    };
}

// Like "in 1h 30m" or "1y ago": the largest unit of the gap from now, plus the next one down
// when it isn't zero, rounded down.
function formatRelative(date: Date, now: Date): string {
    if (Math.abs(date.getTime() - now.getTime()) < 1000) {
        return "now";
    }
    const [start, end] = date < now ? [date, now] : [now, date];
    const duration = intervalToDuration({ end, start });
    const largest = DURATION_UNITS.findIndex(
        ([unit]) => (duration[unit] ?? 0) > 0
    );
    const parts = DURATION_UNITS.slice(largest, largest + 2)
        .filter(([unit]) => (duration[unit] ?? 0) > 0)
        .map(([unit, suffix]) => `${duration[unit]}${suffix}`)
        .join(" ");
    return date > now ? `in ${parts}` : `${parts} ago`;
}

// The calendar-aware gap between two dates, like 1y 2mo 3d 4h 5m 6s, prefixed with - when end
// is earlier than start.
function formatDuration(start: Date, end: Date): string {
    const ms = end.getTime() - start.getTime();
    if (ms === 0) {
        return "0s";
    }
    return `${ms < 0 ? "-" : ""}${durationParts(start, end).join(" ")}`;
}

// Each nonzero unit of the gap between two dates, in either order, largest first.
function durationParts(a: Date, b: Date): string[] {
    const [start, end] = a <= b ? [a, b] : [b, a];
    const duration = intervalToDuration({ end, start });
    const parts = DURATION_UNITS.filter(
        ([unit]) => (duration[unit] ?? 0) > 0
    ).map(([unit, suffix]) => `${duration[unit]}${suffix}`);
    const remainderMs = (end.getTime() - start.getTime()) % 1000;
    if (remainderMs > 0) {
        parts.push(`${remainderMs}ms`);
    }
    return parts;
}

// Up to two decimal places, without trailing zeros.
function formatDecimal(value: number): string {
    return String(Math.round(value * 100) / 100);
}

// The span text means, like +1h30m or 90m, with an optional sign, or null when it isn't one.
function readSpan(text: string): null | Span {
    const match = /^([+-]?)((?:\d+(?:ms|mo|[ywdhms]))+)$/i.exec(text);
    if (match == null) {
        return null;
    }
    const sign = match[1] === "-" ? -1 : 1;
    return [...match[2]!.matchAll(/(\d+)(ms|mo|[ywdhms])/gi)].map(
        ([, amount, unit]) => ({
            amount: sign * Number(amount),
            unit: OFFSET_UNITS[unit!.toLowerCase()]!,
        })
    );
}

export type {
    DateField,
    DateOptions,
    DiffField,
    EpochUnit,
    ParsedDate,
    ParseOptions,
    Span,
};
export { DateInputError, Dates };
