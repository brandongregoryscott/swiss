import type { SshHost } from "../../topics/ssh/config.js";
import {
    LIST_FLAGS,
    listHelp,
    searchArg,
    SwissCommand,
} from "../../shared/command.js";
import { Editor } from "../../shared/editor.js";
import { matchesSearch } from "../../shared/listing.js";
import { SshConfig } from "../../topics/ssh/config.js";
import { SshFiles } from "../../topics/ssh/files.js";

export default class SshHosts extends SwissCommand {
    static override args = {
        search: searchArg("hosts", "name, HostName or user"),
    };

    static override description = `List the Host entries in your ssh config and the files it includes, with the HostName, user and port each sets.

${listHelp("open it in VS Code")}

When a host sets something more than once, the first one is shown, since that's the one ssh uses.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> prod",
            description: "Find the hosts with prod in their name or address",
        },
    ];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SshHosts);
        const hosts = SshConfig.hosts((await SshFiles.load()).configs).filter(
            (host) =>
                matchesSearch(args.search, [
                    ...host.patterns,
                    host.hostName ?? "",
                    host.user ?? "",
                ])
        );
        const location = (host: SshHost): string =>
            `${host.file.display}:${host.line}`;
        const address = (host: SshHost): string =>
            [
                host.user == null ? "" : `${host.user}@`,
                host.hostName ?? "",
                host.port == null ? "" : `:${host.port}`,
            ].join("");

        await this.listItems<SshHost>({
            action: "open it in VS Code",
            choice: (host) => ({
                hint: [address(host), location(host)]
                    .filter((part) => part !== "")
                    .join(" · "),
                label: host.patterns.join(" "),
            }),
            columns: ["HOST", "ADDRESS", "FILE"],
            empty:
                args.search == null
                    ? "No hosts in your ssh config"
                    : `No hosts match ${JSON.stringify(args.search)}`,
            fit: false,
            items: hosts,
            noun: ["host", "hosts"],
            async open(host) {
                await Editor.open(host.file.path, host.line);
                return `Opened ${location(host)}`;
            },
            row: (host) => [
                host.patterns.join(" "),
                address(host),
                location(host),
            ],
            table: flags.table,
            title: "Hosts in your ssh config",
            verb: "Opened",
        });
    }
}
