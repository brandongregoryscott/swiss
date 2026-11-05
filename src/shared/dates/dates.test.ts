import { describe, expect, it } from "vitest";
import type { DateOptions } from "./dates.js";
import { DateInputError, Dates } from "./dates.js";

const NOW = new Date("2026-10-24T14:00:00.000Z");
const LA: DateOptions = { now: NOW, timeZone: "America/Los_Angeles" };
const UTC: DateOptions = { now: NOW, timeZone: "UTC" };

describe("Dates", () => {
    describe("parse", () => {
        it.each([
            ["1761300000", "2025-10-24T10:00:00.000Z", "seconds"],
            ["1761300000123", "2025-10-24T10:00:00.123Z", "milliseconds"],
            ["1761300000123456", "2025-10-24T10:00:00.123Z", "microseconds"],
            ["1761300000123456789", "2025-10-24T10:00:00.123Z", "nanoseconds"],
            ["0", "1970-01-01T00:00:00.000Z", "seconds"],
            ["-86400", "1969-12-31T00:00:00.000Z", "seconds"],
        ])("reads epoch %s by its digit count", (input, iso, unit) => {
            const { date, notes } = Dates.parse(input, UTC);

            expect(date.toISOString()).toBe(iso);
            expect(notes[0]).toBe(`read ${input} as ${unit}`);
        });

        it("reads a decimal epoch as seconds", () => {
            const { date, notes } = Dates.parse("1761300000.25", UTC);

            expect(date.toISOString()).toBe("2025-10-24T10:00:00.250Z");
            expect(notes).toEqual(["read 1761300000.25 as seconds"]);
        });

        it("notes when precision finer than a millisecond is dropped", () => {
            expect(Dates.parse("1761300000123456", UTC).notes).toContain(
                "anything finer than a millisecond is dropped"
            );
            expect(Dates.parse("1761300000123000", UTC).notes).not.toContain(
                "anything finer than a millisecond is dropped"
            );
        });

        it("uses --unit instead of guessing, without a note", () => {
            const { date, notes } = Dates.parse("1761300000", {
                ...UTC,
                unit: "ms",
            });

            expect(date.toISOString()).toBe("1970-01-21T09:15:00.000Z");
            expect(notes).toEqual([]);
        });

        it("rejects epochs with too many digits and --unit with a non-epoch", () => {
            expect(() => Dates.parse("12345678901234567890", UTC)).toThrow(
                /too many digits/
            );
            expect(() =>
                Dates.parse("2025-10-24", { ...UTC, unit: "s" })
            ).toThrow(DateInputError);
        });

        it("reads an ISO date without an offset in the given time zone", () => {
            const { date, notes } = Dates.parse("2025-10-24T10:00", LA);

            expect(date.toISOString()).toBe("2025-10-24T17:00:00.000Z");
            expect(notes).toEqual([
                "no offset given, so read as America/Los_Angeles time",
            ]);
            expect(Dates.parse("2025-10-24", LA).date.toISOString()).toBe(
                "2025-10-24T07:00:00.000Z"
            );
        });

        it.each([
            ["2025-10-24T10:00:00Z", "2025-10-24T10:00:00.000Z"],
            ["2025-10-24T10:00:00.5+02:00", "2025-10-24T08:00:00.500Z"],
            ["2025-10-24 10:00-0500", "2025-10-24T15:00:00.000Z"],
        ])("reads ISO date %s with its own offset", (input, iso) => {
            const { date, notes } = Dates.parse(input, LA);

            expect(date.toISOString()).toBe(iso);
            expect(notes).toEqual([]);
        });

        it("reads RFC 2822 dates", () => {
            expect(
                Dates.parse(
                    "Fri, 24 Oct 2025 10:00:00 GMT",
                    LA
                ).date.toISOString()
            ).toBe("2025-10-24T10:00:00.000Z");
        });

        it("reads now, today, yesterday and tomorrow in the given time zone", () => {
            const iso = (input: string) =>
                Dates.parse(input, LA).date.toISOString();

            expect(iso("now")).toBe(NOW.toISOString());
            expect(iso("Today")).toBe("2026-10-24T07:00:00.000Z");
            expect(iso("yesterday")).toBe("2026-10-23T07:00:00.000Z");
            expect(iso("tomorrow")).toBe("2026-10-25T07:00:00.000Z");
        });

        it("rejects anything else", () => {
            expect(() => Dates.parse("garbage", UTC)).toThrow(
                "Couldn't read garbage as a date"
            );
            expect(() => Dates.parse("2025-13-45", UTC)).toThrow(
                "Couldn't read 2025-13-45 as an ISO 8601 date"
            );
        });
    });

    describe("splitArgs", () => {
        it("joins the words before the first offset into the date", () => {
            expect(
                Dates.splitArgs([
                    "Fri,",
                    "24",
                    "Oct",
                    "2025",
                    "+0200",
                    "+1h",
                    "-5m",
                ])
            ).toEqual({
                input: "Fri, 24 Oct 2025 +0200",
                offsets: ["+1h", "-5m"],
            });
        });

        it("means now when there are only offsets or nothing", () => {
            expect(Dates.splitArgs(["+90m"])).toEqual({
                input: "now",
                offsets: ["+90m"],
            });
            expect(Dates.splitArgs([])).toEqual({ input: "now", offsets: [] });
        });

        it("keeps a negative epoch as the date", () => {
            expect(Dates.splitArgs(["-86400"])).toEqual({
                input: "-86400",
                offsets: [],
            });
        });
    });

    describe("offset", () => {
        it("applies each offset and combined units in turn", () => {
            const date = Dates.offset(NOW, ["+1h30m", "-2d", "+500ms"], "UTC");

            expect(date.toISOString()).toBe("2026-10-22T15:30:00.500Z");
        });

        it("distinguishes months from minutes", () => {
            expect(Dates.offset(NOW, ["+1mo"], "UTC").toISOString()).toBe(
                "2026-11-24T14:00:00.000Z"
            );
            expect(Dates.offset(NOW, ["+1m"], "UTC").toISOString()).toBe(
                "2026-10-24T14:01:00.000Z"
            );
        });

        it("keeps the wall-clock time across a daylight saving change", () => {
            const beforeChange = new Date("2026-03-07T18:00:00.000Z");

            expect(
                Dates.offset(
                    beforeChange,
                    ["+1d"],
                    "America/Los_Angeles"
                ).toISOString()
            ).toBe("2026-03-08T17:00:00.000Z");
            expect(
                Dates.offset(
                    beforeChange,
                    ["+24h"],
                    "America/Los_Angeles"
                ).toISOString()
            ).toBe("2026-03-08T18:00:00.000Z");
        });

        it("rejects anything that isn't an offset", () => {
            expect(() => Dates.offset(NOW, ["+3x"], "UTC")).toThrow(
                "+3x isn't an offset"
            );
            expect(() => Dates.offset(NOW, ["90m"], "UTC")).toThrow(
                DateInputError
            );
        });
    });

    describe("describe", () => {
        it("lists every field in order", () => {
            const date = new Date("2025-10-24T10:00:00.123Z");

            expect(Dates.describe(date, LA)).toEqual([
                ["iso", "2025-10-24T10:00:00.123Z"],
                ["iso-local", "2025-10-24T03:00:00.123-07:00"],
                ["local", expect.stringMatching(/2025.*3:00:00/)],
                ["epoch", "1761300000"],
                ["ms", "1761300000123"],
                ["relative", "1y ago"],
            ]);
        });
    });

    describe("format", () => {
        it.each([
            ["2026-10-24T14:00:00.400Z", "now"],
            ["2026-10-24T15:30:20.000Z", "in 1h 30m"],
            ["2026-10-21T12:00:00.000Z", "3d 2h ago"],
            ["2025-10-24T10:00:00.000Z", "1y ago"],
            ["2026-10-24T13:59:15.000Z", "45s ago"],
        ])("shows %s relative to now as %s", (iso, relative) => {
            expect(Dates.format(new Date(iso), "relative", UTC)).toBe(relative);
        });

        it("floors negative epoch seconds", () => {
            expect(Dates.format(new Date(-1500), "epoch", UTC)).toBe("-2");
        });
    });

    describe("describeDiff", () => {
        it("lists the calendar duration and exact totals", () => {
            const start = new Date("2025-01-01T00:00:00.000Z");
            const end = new Date("2025-03-02T06:30:00.250Z");

            expect(Dates.describeDiff(start, end)).toEqual([
                ["duration", "2mo 1d 6h 30m 250ms"],
                ["days", "60.27"],
                ["hours", "1446.5"],
                ["seconds", "5207400.25"],
                ["ms", "5207400250"],
            ]);
        });

        it("is negative when end is earlier, and 0s when they're equal", () => {
            const start = new Date("2025-01-02T00:00:00.000Z");
            const end = new Date("2025-01-01T00:00:00.000Z");

            expect(Dates.formatDiff(start, end, "duration")).toBe("-1d");
            expect(Dates.formatDiff(start, end, "hours")).toBe("-24");
            expect(Dates.formatDiff(start, start, "duration")).toBe("0s");
        });
    });

    describe("timeZone", () => {
        it("checks a given zone, or uses the system's", () => {
            expect(Dates.timeZone("Europe/London")).toBe("Europe/London");
            expect(Dates.timeZone("UTC")).toBe("UTC");
            expect(Dates.timeZone()).toBe(
                Intl.DateTimeFormat().resolvedOptions().timeZone
            );
            expect(() => Dates.timeZone("Mars/Base")).toThrow(
                "Mars/Base isn't a time zone"
            );
        });
    });

    describe("durations", () => {
        it("reads durations with or without a sign, in combined units", () => {
            expect(Dates.parseDuration("1h30m")).toEqual([
                { amount: 1, unit: "hours" },
                { amount: 30, unit: "minutes" },
            ]);
            expect(Dates.parseDuration("-5m")).toEqual([
                { amount: -5, unit: "minutes" },
            ]);
            expect(
                Dates.addDuration(NOW, Dates.parseDuration("+7d"), "UTC")
            ).toEqual(Dates.offset(NOW, ["+7d"], "UTC"));
        });

        it("rejects anything that isn't a duration", () => {
            expect(() => Dates.parseDuration("30x")).toThrow(
                "30x isn't a duration; use something like 30m, 7d, 1h30m or -5m"
            );
            expect(() => Dates.parseDuration("")).toThrow(DateInputError);
        });

        it("counts calendar units in the time zone, across a DST change", () => {
            // Clocks in New York go forward an hour on 2026-03-08, so a day is 23 hours long.
            const before = new Date("2026-03-07T17:00:00Z");

            expect(
                Dates.addDuration(
                    before,
                    Dates.parseDuration("1d"),
                    "America/New_York"
                ).toISOString()
            ).toBe("2026-03-08T16:00:00.000Z");
        });
    });
});
