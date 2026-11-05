import { Args, Flags } from "@oclif/core";
import { isEmpty, max } from "lodash-es";
import type { ParsedDate } from "../../shared/dates/dates.js";
import { SwissCommand } from "../../shared/command.js";
import { Dates } from "../../shared/dates/dates.js";
import { DATE_FLAGS } from "../../shared/dates/flags.js";

export default class DateCommand extends SwissCommand {
    static override args = {
        input: Args.string({
            default: "now",
            description:
                "An epoch number (s, ms, us or ns), an ISO 8601 date, an RFC 2822 date, or now, today, yesterday or tomorrow, then any offsets like +90m, -3d or +1h30m. Spaces don't need quoting.",
        }),
    };

    static override description = `Show a date in every common format.

With no input, it shows the current time:

${Dates.DATE_FIELDS_HELP}

Those names are what --format takes to print just that value.

Input can be an epoch number, an ISO 8601 date, an RFC 2822 date (like the ones in HTTP headers and emails), or now, today, yesterday or tomorrow. Dates with spaces don't need quoting.

Epoch numbers are read by their digit count: up to 11 is seconds, 12-14 milliseconds, 15-17 microseconds and 18-19 nanoseconds. Decimals are read as seconds. --unit overrides the guess, and anything finer than a millisecond is dropped.

ISO dates without an offset are read in the local time zone, or in --tz, so --tz UTC reads them as UTC.

Offsets after the date move it. Units are y, mo, w, d, h, m, s and ms, and can be combined, like +1h30m. Days and longer keep the same wall-clock time across daylight saving changes.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Show the current time in every format",
        },
        {
            command: "<%= config.bin %> <%= command.id %> 1761300000",
            description: "Convert an epoch timestamp",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> 2025-10-24T10:00:00Z --tz Asia/Tokyo",
            description: "Show a UTC time in another time zone",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> now +90m --format iso --copy",
            description: "Copy the ISO timestamp for 90 minutes from now",
        },
        {
            command: "<%= config.bin %> <%= command.id %> today -1w",
            description: "Show midnight a week ago",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> Fri, 24 Oct 2025 10:00:00 GMT",
            description: "Convert a date from an HTTP header",
        },
    ];

    static override flags = {
        ...DATE_FLAGS,
        copy: Flags.boolean({
            char: "c",
            description:
                "Also copy the --format value (iso by default) to the clipboard",
        }),
        format: Flags.option({
            char: "f",
            description: "Print only this value",
            options: Dates.DATE_FIELDS,
        })(),
    };

    // The date can span several words, and offsets after it can start with -.
    static override strict = false;

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(DateCommand);
        const { input, offsets } = Dates.splitArgs(argv as string[]);
        const timeZone = Dates.timeZone(flags.tz);
        const options = { now: new Date(), timeZone };

        let parsed: ParsedDate;
        let date: Date;
        parsed = Dates.parse(input, { ...options, unit: flags.unit });
        date = Dates.offset(parsed.date, offsets, timeZone);

        if (flags.format == null) {
            const fields = Dates.describe(date, options);
            const width = max(fields.map(([field]) => field.length)) ?? 0;
            for (const [field, value] of fields) {
                const zone =
                    field === "iso-local"
                        ? this.style("dim", `  (${timeZone})`)
                        : "";
                this.log(`${field.padEnd(width)}  ${value}${zone}`);
            }
            if (!isEmpty(parsed.notes)) {
                this.log(this.style("dim", `\n${parsed.notes.join("; ")}`));
            }
        } else {
            this.log(Dates.format(date, flags.format, options));
        }

        if (flags.copy) {
            const field = flags.format ?? "iso";
            await this.copy(Dates.format(date, field, options), field);
        }
    }
}
