import { Args, Flags } from "@oclif/core";
import { format } from "date-fns";
import path from "node:path";
import type { ServedRequest } from "../../topics/serve/static-server.js";
import { Browser } from "../../shared/browser.js";
import { SwissCommand } from "../../shared/command.js";
import { CommandError } from "../../shared/exec.js";
import { Files } from "../../shared/files.js";
import { Text } from "../../shared/text.js";
import { StaticServer } from "../../topics/serve/static-server.js";

const DEFAULT_PORT = 8080;
// How many ports after the default to try when it's in use.
const PORT_TRIES = 20;

export default class Serve extends SwissCommand {
    static override args = {
        dir: Args.string({
            default: ".",
            description: "Directory to serve",
        }),
    };

    static override description = `Serve a directory over HTTP, for trying out static sites and sharing files.

A directory's index.html is served when it has one, and its files are listed otherwise. Responses aren't cached, so refreshing always shows the latest files, and byte ranges are supported so video can be scrubbed. Each request is logged.

Port ${DEFAULT_PORT} is used unless you pick one, or the next free port when it's taken. A port you pick with --port has to be free; see what's on it with \`<%= config.bin %> port\`.

Only this computer can connect unless you pass --host 0.0.0.0, which also lists the addresses others on your network can use. Files and directories starting with a dot, like .env and .git, are hidden unless you pass --dotfiles.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> dist --spa --open",
            description:
                "Serve a single-page app's build, and open it in the browser",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --host 0.0.0.0",
            description: "Share the current directory with your network",
        },
        {
            command: "<%= config.bin %> <%= command.id %> -p 3000 --cors",
            description: "Serve on port 3000 to pages on other origins",
        },
    ];

    static override flags = {
        copy: Flags.boolean({
            char: "c",
            description: "Copy the URL to the clipboard",
        }),
        cors: Flags.boolean({
            description: "Allow requests from any origin",
        }),
        dotfiles: Flags.boolean({
            description: "Serve files and directories starting with a dot",
        }),
        host: Flags.string({
            default: "127.0.0.1",
            description:
                "Address to listen on; 0.0.0.0 lets other devices connect",
        }),
        open: Flags.boolean({
            char: "o",
            description: "Open the URL in the browser",
        }),
        port: Flags.integer({
            char: "p",
            description: `Port to listen on [default: ${DEFAULT_PORT}, or the next free port]`,
            max: 65535,
            min: 1,
        }),
        spa: Flags.boolean({
            char: "s",
            description:
                "Serve index.html for paths that don't exist, for apps with client-side routing",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Serve);

        const root = path.resolve(args.dir);
        await Files.requireDirectory(root);

        const server = StaticServer.create({
            cors: flags.cors,
            dotfiles: flags.dotfiles,
            // The client only gets a 500, so say what went wrong here.
            onError: (error) =>
                this.warn(
                    `Couldn't serve a request: ${error instanceof Error ? error.message : String(error)}`
                ),
            onRequest: (request) => this.log(this.#formatRequest(request)),
            root,
            spa: flags.spa,
        });

        const requested = flags.port ?? DEFAULT_PORT;
        let port: number;
        try {
            port = await StaticServer.listen(
                server,
                flags.host,
                requested,
                flags.port == null ? PORT_TRIES : 1
            );
        } catch (error) {
            this.error(this.#describeListenError(error, flags.host, requested));
        }

        const [url, ...networkUrls] = StaticServer.urls(flags.host, port);
        this.log(`Serving ${this.style("bold", Text.displayPath(root))}`);
        this.log("");
        this.log(`  Local:    ${this.style("cyan", url!)}`);
        for (const networkUrl of networkUrls) {
            this.log(`  Network:  ${this.style("cyan", networkUrl)}`);
        }
        this.log("");
        if (port !== requested) {
            this.log(
                this.style(
                    "yellow",
                    `Port ${requested} is in use, so using ${port}`
                )
            );
        }

        if (flags.copy) {
            await this.copy(url!, "the URL");
        }
        if (flags.open) {
            try {
                await Browser.open(url!);
            } catch (error) {
                if (!(error instanceof CommandError)) {
                    throw error;
                }
                this.warn(error.message);
            }
        }
        this.log(this.style("dim", "Press Ctrl+C to stop"));

        await new Promise<void>((resolve) => {
            process.once("SIGINT", () => {
                server.close();
                server.closeAllConnections();
                resolve();
            });
        });
    }

    #describeListenError(error: unknown, host: string, port: number): string {
        switch ((error as NodeJS.ErrnoException).code) {
            case "EACCES": {
                return `Not allowed to listen on port ${port}; ports below 1024 need sudo`;
            }

            case "EADDRINUSE": {
                return `Port ${port} is in use; see what's on it with \`${this.config.bin} port ${port}\``;
            }

            case "EADDRNOTAVAIL":
            case "ENOTFOUND": {
                return `Can't listen on ${host}; it isn't an address of this computer`;
            }

            default: {
                return (error as Error).message;
            }
        }
    }

    #formatRequest(request: ServedRequest): string {
        const status = String(request.status);
        const statusStyle =
            request.status >= 500
                ? "red"
                : request.status >= 400
                  ? "yellow"
                  : request.status >= 300
                    ? "cyan"
                    : "green";
        return [
            this.style("dim", format(new Date(), "HH:mm:ss")),
            request.method,
            this.style(statusStyle, status),
            request.url,
            this.style("dim", `${Math.round(request.durationMs)}ms`),
        ].join(" ");
    }
}
