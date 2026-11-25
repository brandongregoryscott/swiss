import { Args } from "@oclif/core";
import { format, isToday } from "date-fns";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { SwissCommand } from "../../shared/command.js";
import { Dates } from "../../shared/dates/dates.js";

export default class Caffeine extends SwissCommand {
    static override args = {
        duration: Args.string({
            description:
                "How long to stay awake, like 30m, 2h or 1h30m; until Ctrl+C when not given",
        }),
    };

    static override description = `Keep this Mac awake until Ctrl+C, or for a while.

Holds caffeinate's display, idle and system sleep assertions. The system one keeps the Mac awake with its lid closed while it's plugged in, even when an external display turns off; on battery, closing the lid still sleeps it.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> 2h",
            description: "Stay awake for the next two hours",
        },
    ];

    async run(): Promise<void> {
        const { args } = await this.parse(Caffeine);

        if (process.platform !== "darwin") {
            this.error("caffeinate is only on macOS");
        }

        const caffeinateArgs = ["-d", "-i", "-s", "-w", String(process.pid)];
        if (args.duration == null) {
            this.log("Keeping this Mac awake until Ctrl+C");
        } else {
            const now = new Date();
            const until = Dates.addDuration(
                now,
                Dates.parseDuration(args.duration),
                Dates.timeZone()
            );
            const seconds = Math.ceil((until.getTime() - now.getTime()) / 1000);
            if (seconds <= 0) {
                this.error(`${args.duration} isn't a duration in the future`);
            }
            caffeinateArgs.push("-t", String(seconds));
            this.log(
                `Keeping this Mac awake until ${this.style("bold", format(until, isToday(until) ? "HH:mm" : "EEE d MMM HH:mm"))}`
            );
            this.log(this.style("dim", "Press Ctrl+C to stop"));
        }

        const caffeinate = spawn("caffeinate", caffeinateArgs, {
            stdio: "ignore",
        });
        process.once("SIGINT", () => caffeinate.kill());
        await once(caffeinate, "exit");
        this.log("This Mac can sleep again");
    }
}
