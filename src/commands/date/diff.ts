import { Args, Flags } from "@oclif/core";
import { isEmpty, max, uniq } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";
import { Dates } from "../../shared/dates/dates.js";
import { DATE_FLAGS } from "../../shared/dates/flags.js";

export default class DateDiff extends SwissCommand {
    // oclif reads positional args in the order they're declared.
    /* eslint-disable perfectionist/sort-objects */
    static override args = {
        start: Args.string({
            description: "The earlier date, in any form `date` reads",
            required: true,
        }),
        end: Args.string({
            default: "now",
            description: "The later date, in any form `date` reads",
        }),
    };
    /* eslint-enable perfectionist/sort-objects */

    static override description = `Show how much time there is between two dates, or between a date and now.

Both dates are read the same way as \`date\` reads them. Alongside the two dates in ISO 8601, it shows:

${Dates.DIFF_FIELDS_HELP}

A month is a calendar month. Totals have up to two decimal places, and everything is negative when END is earlier than START. Those names are what --format takes to print just that value.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> 1761300000",
            description: "How long ago an epoch timestamp was",
        },
        "<%= config.bin %> <%= command.id %> 2025-01-01 2025-10-24T10:00:00Z",
        {
            command:
                "<%= config.bin %> <%= command.id %> today tomorrow --format hours",
            description: "Print just the number of hours in today",
        },
    ];

    static override flags = {
        ...DATE_FLAGS,
        format: Flags.option({
            char: "f",
            description: "Print only this value",
            options: Dates.DIFF_FIELDS,
        })(),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(DateDiff);
        const timeZone = Dates.timeZone(flags.tz);
        const options = { now: new Date(), timeZone, unit: flags.unit };

        let start: Date;
        let end: Date;
        let notes: string[];
        const parsedStart = Dates.parse(args.start, options);
        const parsedEnd = Dates.parse(args.end, options);
        start = parsedStart.date;
        end = parsedEnd.date;
        notes = uniq([...parsedStart.notes, ...parsedEnd.notes]);

        if (flags.format != null) {
            this.log(Dates.formatDiff(start, end, flags.format));
            return;
        }

        const iso = (date: Date) => Dates.format(date, "iso", options);
        const fields: Array<[string, string]> = [
            ["from", iso(start)],
            ["to", iso(end)],
            ...Dates.describeDiff(start, end),
        ];
        const width = max(fields.map(([field]) => field.length)) ?? 0;
        for (const [field, value] of fields) {
            this.log(`${field.padEnd(width)}  ${value}`);
        }
        if (!isEmpty(notes)) {
            this.log(this.style("dim", `\n${notes.join("; ")}`));
        }
    }
}
