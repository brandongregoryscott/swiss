import { Args, Flags } from "@oclif/core";
import { format, isToday } from "date-fns";
import { isEmpty } from "lodash-es";
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

Holds caffeinate's display, idle and system sleep assertions. The system one keeps the Mac awake with its lid closed while it's plugged in, even when an external display turns off; on battery, closing the lid still sleeps it.

--pid ties the hold to another process too, so an app or script that starts this can't leave the Mac awake after it's gone, however it exits. The "Keeping this Mac awake" line is printed once the hold is in place.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> 2h",
            description: "Stay awake for the next two hours",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --pid 4321",
            description: "Stay awake while process 4321 runs",
        },
    ];

    static override flags = {
        pid: Flags.integer({
            description: "Only stay awake while this process runs too",
            min: 1,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Caffeine);

        if (process.platform !== "darwin") {
            this.error("caffeinate is only on macOS");
        }

        const caffeinateArgs = ["-d", "-i", "-s", "-w", String(process.pid)];
        const limits: string[] = [];
        if (flags.pid != null) {
            if (!isRunning(flags.pid)) {
                this.error(`No process ${flags.pid} is running`);
            }
            caffeinateArgs.push("-w", String(flags.pid));
            limits.push(`while process ${flags.pid} runs`);
        }
        if (args.duration != null) {
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
            limits.push(
                `until ${this.style("bold", format(until, isToday(until) ? "HH:mm" : "EEE d MMM HH:mm"))}`
            );
        }

        const caffeinate = spawn("caffeinate", caffeinateArgs, {
            stdio: "ignore",
        });
        for (const signal of ["SIGINT", "SIGTERM"] as const) {
            process.once(signal, () => caffeinate.kill());
        }
        await once(caffeinate, "spawn");
        if (isEmpty(limits)) {
            this.log("Keeping this Mac awake until Ctrl+C");
        } else {
            this.log(`Keeping this Mac awake ${limits.join(" and ")}`);
            this.log(this.style("dim", "Press Ctrl+C to stop"));
        }
        await once(caffeinate, "exit");
        this.log("This Mac can sleep again");
    }
}

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}
