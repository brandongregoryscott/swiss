import { Flags } from "@oclif/core";
import { flatten, isEmpty, max, uniq } from "lodash-es";
import type { KillOutcome } from "../../topics/port/ports.js";
import { SwissCommand } from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { Ports } from "../../topics/port/ports.js";

export default class PortKill extends SwissCommand {
    static override cancelled = "Nothing stopped";

    static override description = `Stop the processes listening on one or more TCP ports.

What's listening is listed, and nothing is stopped until you confirm. Each process is sent SIGTERM so it can shut down cleanly, or SIGKILL with --force, and is reported as still running if it hasn't exited after a few seconds.

A process listening on several of the ports is only stopped once. Processes owned by other users need sudo. --yes is required when there's no terminal to confirm in.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> 3000",
        {
            command: "<%= config.bin %> <%= command.id %> 3000 5173 --yes",
            description: "Stop what's on two ports without asking",
        },
        {
            command: "<%= config.bin %> <%= command.id %> 8080 --force",
            description: "Kill a process that ignores SIGTERM",
        },
    ];

    static override flags = {
        force: Flags.boolean({
            char: "f",
            description:
                "Send SIGKILL, which can't be ignored, instead of SIGTERM",
        }),
        yes: Flags.boolean({
            char: "y",
            description: "Stop them without asking first",
        }),
    };

    // Takes any number of ports.
    static override strict = false;

    static override usage = "<%= command.id %> PORT... [-f] [-y]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(PortKill);
        if (isEmpty(argv)) {
            this.error("Give at least one port to stop, like 3000");
        }
        const consent = this.terminal.consent(flags.yes, "stop processes");

        const ports = uniq(
            (argv as string[]).map((input) => Ports.parsePort(input))
        );
        const found = await Promise.all(ports.map((port) => Ports.list(port)));
        for (const [index, port] of ports.entries()) {
            if (isEmpty(found[index])) {
                this.log(
                    this.style("yellow", `Nothing is listening on ${port}`)
                );
            }
        }
        const listeners = flatten(found);

        if (isEmpty(listeners)) {
            return;
        }

        this.table(Ports.tableRows(listeners));

        const pids = uniq(listeners.map((listener) => listener.pid));
        const signal = flags.force ? "SIGKILL" : "SIGTERM";
        await consent.confirm(
            `${flags.force ? "Kill" : "Stop"} ${Text.pluralize(pids.length, "process", "processes")}?`
        );

        const outcomes = await Promise.all(
            pids.map((pid) => Ports.kill(pid, signal))
        );
        const pidWidth = max(pids.map((pid) => String(pid).length)) ?? 0;
        for (const outcome of outcomes) {
            this.log(
                `${String(outcome.pid).padEnd(pidWidth)}  ${this.#describe(outcome, flags.force)}`
            );
        }
        this.failed = outcomes.some((outcome) => outcome.status !== "killed");
    }

    #describe(outcome: KillOutcome, force: boolean): string {
        switch (outcome.status) {
            case "error": {
                return this.style("red", `error: ${outcome.reason}`);
            }

            case "killed": {
                return this.style("green", force ? "killed" : "stopped");
            }

            case "running": {
                return this.style(
                    "yellow",
                    force
                        ? "still running"
                        : "still running; try again with --force"
                );
            }
        }
    }
}
