import { Args, Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";
import { Dates } from "../../shared/dates/dates.js";
import { Input } from "../../shared/input.js";
import { Cron } from "../../topics/cron/cron.js";

export default class CronCommand extends SwissCommand {
    static override args = {
        pattern: Args.string({
            description:
                "The cron pattern, quoted so the shell doesn't expand its * [default: stdin if piped, otherwise the clipboard]",
            // Input.read handles stdin, and the pattern's fields are joined from argv.
            ignoreStdin: true,
        }),
    };

    static override description = `Explain a cron pattern in words, with how often it runs, and show when it runs next.

Patterns have 5 fields (minute, hour, day of the month, month and day of the week), or 6 with seconds first. Names like MON and JAN, ranges, steps, lists, L for the last day, 5#2 for the second Friday, and macros like @daily and @hourly all work.

The run times are in the local time zone, or --tz, which should be the zone the cron runs in. Servers and most CI and cloud schedulers run cron in UTC.

The pattern is read from the argument, from stdin when it's piped in, or otherwise from the clipboard.

For common patterns to start from, use \`<%= config.bin %> cron examples\`.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> '*/15 9-17 * * 1-5'",
            description: "Explain a pattern",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> '0 2 * * *' --tz UTC -n 3",
            description: "Show the next 3 runs of a UTC schedule",
        },
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Explain the pattern on the clipboard",
        },
    ];

    static override flags = {
        count: Flags.integer({
            char: "n",
            default: 5,
            description: "How many of the next runs to show",
            min: 0,
        }),
        tz: Flags.string({
            description:
                "IANA time zone the cron runs in, like Europe/London or UTC [default: the system zone]",
        }),
    };

    // An unquoted pattern spans several words.
    static override strict = false;

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(CronCommand);
        const words = argv as string[];

        const timeZone = Dates.timeZone(flags.tz);
        const options = { now: new Date(), timeZone };
        const {
            source,
            text: pattern,
            value: explained,
        } = await Input.parse(
            {
                arg: isEmpty(words) ? undefined : words.join(" "),
                kind: "a cron pattern",
                noun: "a cron pattern",
            },
            (text) => Cron.explain(text, flags.count, options)
        );

        if (source === "clipboard") {
            this.log(
                this.style("dim", `Read ${pattern.trim()} from the clipboard\n`)
            );
        }
        this.log(explained.description);
        if (explained.frequency != null) {
            this.log(explained.frequency);
        }
        for (const note of explained.notes) {
            this.log(this.style("yellow", note));
        }

        if (isEmpty(explained.runs)) {
            return;
        }
        this.log(
            this.style("bold", `\nnext runs`) +
                this.style("dim", `  (${timeZone})`)
        );
        for (const run of explained.runs) {
            this.log(
                `${Cron.formatRun(run, timeZone, explained.seconds)}  ${this.style("dim", Dates.format(run, "relative", options))}`
            );
        }
    }
}
