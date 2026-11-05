import { Args } from "@oclif/core";
import type { Listener } from "../../topics/port/ports.js";
import { Browser } from "../../shared/browser.js";
import { LIST_FLAGS, listHelp, SwissCommand } from "../../shared/command.js";
import { Ports } from "../../topics/port/ports.js";

export default class PortCommand extends SwissCommand {
    static override args = {
        port: Args.string({
            description: "Only show what's listening on this port",
        }),
    };

    static override description = `Show which processes are listening on TCP ports.

${listHelp("open it in the browser")}

Each listening process is shown with its port, PID, the addresses it's bound to (* means every interface), its working directory and its command line. The command is cut short to fit the terminal.

Processes owned by other users, like system services, may only show up when run with sudo.

To stop one, use \`<%= config.bin %> port kill\`.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "List everything that's listening",
        },
        {
            command: "<%= config.bin %> <%= command.id %> 3000",
            description: "See what's using port 3000",
        },
    ];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(PortCommand);

        const port = args.port == null ? undefined : Ports.parsePort(args.port);
        await this.listItems<Listener>({
            action: "open it in the browser",
            choice: (listener) => ({
                hint: `PID ${listener.pid} · ${listener.command}`,
                label: String(listener.port),
            }),
            columns: Ports.COLUMNS,
            empty:
                args.port == null
                    ? "Nothing is listening"
                    : `Nothing is listening on ${args.port}`,
            items: await Ports.list(port),
            noun: ["port", "ports"],
            async open(listener) {
                const url = `http://localhost:${listener.port}`;
                await Browser.open(url);
                return `Opened ${url}`;
            },
            row: (listener) => Ports.row(listener),
            table: flags.table,
            title: "Ports with something listening",
            verb: "Opened",
        });
    }
}
