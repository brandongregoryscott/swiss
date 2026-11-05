import { describe, expect, it } from "vitest";
import { Cron, CronError } from "./cron.js";

// A Saturday.
const options = {
    now: new Date("2026-10-24T12:00:00Z"),
    timeZone: "America/New_York",
};

describe("Cron", () => {
    describe("explain", () => {
        it("describes a pattern and finds its next runs in the zone", () => {
            const explained = Cron.explain("0 9 * * 1-5", 2, options);

            expect(explained.description).toBe(
                "At 09:00, Monday through Friday"
            );
            expect(explained.runs).toEqual([
                new Date("2026-10-26T13:00:00Z"),
                new Date("2026-10-27T13:00:00Z"),
            ]);
            expect(explained.notes).toEqual([]);
            expect(explained.seconds).toBe(false);
        });

        it("reads macros", () => {
            const explained = Cron.explain("@daily", 1, options);

            expect(explained.description).toBe("At 00:00");
            expect(explained.runs).toEqual([new Date("2026-10-25T04:00:00Z")]);
        });

        it("reads a 6th field as seconds", () => {
            const explained = Cron.explain("*/30 * * * * *", 2, options);

            expect(explained.seconds).toBe(true);
            expect(explained.notes).toEqual([
                "The first of the 6 fields is read as seconds",
            ]);
            expect(explained.runs).toEqual([
                new Date("2026-10-24T12:00:30Z"),
                new Date("2026-10-24T12:01:00Z"),
            ]);
        });

        it("notes that setting both day fields matches either one", () => {
            const explained = Cron.explain("0 0 1 * 5", 2, options);

            expect(explained.notes).toEqual([
                "Both day fields are set, so it runs on days matching either one, not both",
            ]);
            // Friday the 30th, then the 1st, a Sunday.
            expect(explained.runs).toEqual([
                new Date("2026-10-30T04:00:00Z"),
                new Date("2026-11-01T04:00:00Z"),
            ]);
        });

        it("rejects values out of range", () => {
            expect(() => Cron.explain("61 * * * *", 1, options)).toThrow(
                CronError
            );
        });

        it("rejects the wrong number of fields", () => {
            expect(() => Cron.explain("* * *", 1, options)).toThrow(
                /isn't a valid cron pattern/
            );
        });

        it("rejects days that never come", () => {
            expect(() => Cron.explain("0 0 30 2 *", 1, options)).toThrow(
                CronError
            );
        });

        it("rejects @reboot", () => {
            expect(() => Cron.explain("@reboot", 1, options)).toThrow(
                /runs once when cron starts/
            );
        });
    });

    describe("frequency", () => {
        it.each([
            ["* * * * *", "Runs once a minute"],
            ["*/30 * * * * *", "Runs twice a minute"],
            ["*/15 * * * *", "Runs 4 times an hour"],
            ["@daily", "Runs once a day"],
            ["0 */2 * * *", "Runs 12 times a day"],
            ["0 9 * * 1-5", "Runs once a day, 5 days a week"],
            ["*/15 9-17 * * 1-5", "Runs 36 times a day, 5 days a week"],
            ["0 9 * * 7", "Runs once a week"],
            ["0 0 1,15 * *", "Runs twice a month"],
            ["0 17 * * 5L", "Runs once a month"],
            ["0 9 * * 1#1", "Runs once a month"],
            ["0 0 1 1,4,7,10 *", "Runs 4 times a year"],
            ["0 9 * 3-5 *", "Runs once a day, in 3 months of the year"],
            [
                "0 9 * 6 1-5",
                "Runs once a day, 5 days a week, in one month of the year",
            ],
        ])("%s: %s", (pattern, frequency) => {
            expect(Cron.explain(pattern, 1, options).frequency).toBe(frequency);
        });

        it("isn't counted when both day fields are set", () => {
            expect(
                Cron.explain("0 0 1 * 5", 1, options).frequency
            ).toBeUndefined();
        });
    });

    describe("formatRun", () => {
        it("shows the time in the zone", () => {
            expect(
                Cron.formatRun(
                    new Date("2026-10-26T13:00:00Z"),
                    options.timeZone,
                    false
                )
            ).toBe("Mon 2026-10-26 09:00");
        });

        it("shows seconds for patterns with them", () => {
            expect(
                Cron.formatRun(new Date("2026-10-26T13:00:30Z"), "UTC", true)
            ).toBe("Mon 2026-10-26 13:00:30");
        });
    });

    describe("EXAMPLES", () => {
        it.each(Cron.EXAMPLES)("$pattern is valid", ({ pattern }) => {
            expect(Cron.explain(pattern, 1, options).runs).toHaveLength(1);
        });
    });

    describe("searchExamples", () => {
        it("lists every example without a search", () => {
            expect(Cron.searchExamples(undefined)).toEqual(Cron.EXAMPLES);
        });

        it("matches every word, in any case", () => {
            expect(
                Cron.searchExamples("MONTH midnight").map((e) => e.pattern)
            ).toEqual(["0 0 1 * *", "0 0 1,15 * *", "0 0 L * *"]);
        });

        it("matches patterns", () => {
            expect(Cron.searchExamples("1-5").map((e) => e.pattern)).toEqual([
                "0 9 * * 1-5",
                "*/15 9-17 * * 1-5",
            ]);
        });
    });
});
