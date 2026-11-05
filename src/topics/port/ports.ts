import { isEmpty, sortBy, uniq } from "lodash-es";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isExternalFailure, UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";
import { Text } from "../../shared/text.js";

class PortError extends UserError {}

// A process listening on a TCP port. A process listening on several ports is one listener per port.
type Listener = {
    // Local addresses it's bound to, with "*" for every interface.
    addresses: string[];
    // Its command line with the program shortened to its name, or just its name when ps can't see it.
    command: string;
    // Its working directory, or null when lsof can't see it (usually another user's process).
    cwd: null | string;
    pid: number;
    port: number;
};

type KillOutcome =
    | { pid: number; reason: string; status: "error" }
    | { pid: number; status: "killed" }
    | { pid: number; status: "running" };

// How long to wait for a process to exit after signalling it.
const KILL_TIMEOUT_MS = 3000;
// Longer directories keep their end, which is the part that tells projects apart.
const MAX_DIRECTORY_LENGTH = 40;
const KILL_POLL_MS = 100;

class Ports {
    // The header of a table of listeners.
    static readonly COLUMNS = [
        "PORT",
        "PID",
        "ADDRESS",
        "DIRECTORY",
        "COMMAND",
    ];

    // Sends signal to the process and waits for it to exit. A process that's already gone counts
    // as killed.
    static async kill(
        pid: number,
        signal: NodeJS.Signals
    ): Promise<KillOutcome> {
        try {
            process.kill(pid, signal);
        } catch (error) {
            if (!isExternalFailure(error)) {
                throw error;
            }
            const { code } = error as NodeJS.ErrnoException;
            if (code === "ESRCH") {
                return { pid, status: "killed" };
            }
            return {
                pid,
                reason:
                    code === "EPERM"
                        ? "owned by another user; try again with sudo"
                        : error.message,
                status: "error",
            };
        }

        for (let waited = 0; waited < KILL_TIMEOUT_MS; waited += KILL_POLL_MS) {
            if (!isRunning(pid)) {
                return { pid, status: "killed" };
            }
            await sleep(KILL_POLL_MS);
        }
        return isRunning(pid)
            ? { pid, status: "running" }
            : { pid, status: "killed" };
    }

    // Listening TCP sockets, sorted by port, optionally only on the given port.
    static async list(port?: number): Promise<Listener[]> {
        const output = await lsof([
            "-nP",
            `-iTCP${port == null ? "" : `:${port}`}`,
            "-sTCP:LISTEN",
            "+c0",
            "-Fpcn",
        ]);
        const sockets = Ports.parseSockets(output);
        if (isEmpty(sockets)) {
            return [];
        }

        const pids = uniq(sockets.map((socket) => socket.pid));
        const [commands, cwds] = await Promise.all([
            commandLines(pids),
            workingDirectories(pids),
        ]);
        return sockets.map((socket) => ({
            ...socket,
            command: commands.get(socket.pid) ?? socket.command,
            cwd: cwds.get(socket.pid) ?? null,
        }));
    }

    // Reads a port number from user input.
    static parsePort(input: string): number {
        const port = Number(input);
        if (!/^\d+$/.test(input) || port < 1 || port > 65535) {
            throw new PortError(
                `${JSON.stringify(input)} isn't a port; ports are 1-65535`
            );
        }
        return port;
    }

    // Parses `lsof -F pcn` output into one entry per process and port, merging the IPv4 and IPv6
    // sockets a server usually opens for the same port.
    static parseSockets(output: string): Array<Omit<Listener, "cwd">> {
        const byKey = new Map<string, Omit<Listener, "cwd">>();
        let pid: null | number = null;
        let command = "";
        for (const line of output.split("\n")) {
            const value = line.slice(1);
            switch (line[0]) {
                case "c": {
                    command = value;
                    break;
                }

                case "n": {
                    const socket = parseAddress(value);
                    if (pid == null || socket == null) {
                        break;
                    }
                    const key = `${pid}:${socket.port}`;
                    const existing = byKey.get(key);
                    if (existing == null) {
                        byKey.set(key, {
                            addresses: [socket.address],
                            command,
                            pid,
                            port: socket.port,
                        });
                    } else if (!existing.addresses.includes(socket.address)) {
                        existing.addresses.push(socket.address);
                    }
                    break;
                }

                case "p": {
                    pid = Number(value);
                    command = "";
                    break;
                }
            }
        }
        return sortBy([...byKey.values()], ["port", "pid"]);
    }

    // A listener's row in a table of them, under COLUMNS.
    static row(listener: Listener): string[] {
        return [
            String(listener.port),
            String(listener.pid),
            listener.addresses.join(", "),
            listener.cwd == null ? "" : shortenPath(listener.cwd),
            listener.command,
        ];
    }

    // Shortens the program in a command line to its name, so /opt/homebrew/bin/node server.js
    // becomes node server.js. The executable's path, when known, lets paths with spaces in them
    // (like macOS app bundles) be shortened too.
    static shortenCommand(command: string, executable?: string): string {
        if (
            executable != null &&
            executable.includes("/") &&
            command.startsWith(executable)
        ) {
            return `${path.basename(executable)}${command.slice(executable.length)}`;
        }
        const [program = "", ...rest] = command.split(" ");
        return [path.basename(program), ...rest].join(" ");
    }

    // Rows of a table of listeners, header first.
    static tableRows(listeners: Listener[]): string[][] {
        return [
            Ports.COLUMNS,
            ...listeners.map((listener) => Ports.row(listener)),
        ];
    }
}

// Splits an lsof socket name like *:3000, 127.0.0.1:5432 or [::1]:8080.
function parseAddress(name: string): { address: string; port: number } | null {
    const match = /^(.*):(\d+)$/.exec(name);
    if (match == null) {
        return null;
    }
    return {
        address: match[1]!.replace(/^\[(.*)\]$/, "$1"),
        port: Number(match[2]),
    };
}

// Shortened command lines by PID.
async function commandLines(pids: number[]): Promise<Map<number, string>> {
    // Fetched separately because both can contain spaces. comm is the executable's full path on
    // macOS, but only its name on Linux.
    const [args, executables] = await Promise.all([
        psField(pids, "args"),
        psField(pids, "comm"),
    ]);
    const commands = new Map<number, string>();
    for (const [pid, command] of args) {
        commands.set(pid, Ports.shortenCommand(command, executables.get(pid)));
    }
    return commands;
}

async function psField(
    pids: number[],
    field: string
): Promise<Map<number, string>> {
    // ps exits 1 when any of the processes has already exited, but still lists the rest.
    const output = await Exec.run(
        "ps",
        ["-o", `pid=,${field}=`, "-p", pids.join(",")],
        { okExitCodes: [1] }
    );
    const values = new Map<number, string>();
    for (const line of output.split("\n")) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (match != null) {
            values.set(Number(match[1]), match[2]!);
        }
    }
    return values;
}

async function workingDirectories(
    pids: number[]
): Promise<Map<number, string>> {
    const output = await lsof(["-a", "-d", "cwd", "-p", pids.join(","), "-Fn"]);
    const cwds = new Map<number, string>();
    let pid: null | number = null;
    for (const line of output.split("\n")) {
        if (line.startsWith("p")) {
            pid = Number(line.slice(1));
        } else if (line.startsWith("n") && pid != null) {
            cwds.set(pid, line.slice(1));
        }
    }
    return cwds;
}

function shortenPath(dir: string): string {
    const display = Text.displayPath(dir);
    return display.length > MAX_DIRECTORY_LENGTH
        ? `…${display.slice(-(MAX_DIRECTORY_LENGTH - 1))}`
        : display;
}

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (!isExternalFailure(error)) {
            throw error;
        }
        // EPERM means it exists but belongs to someone else.
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

// lsof exits 1 when it finds nothing, or when it can't see some of what it was asked about.
async function lsof(args: string[]): Promise<string> {
    try {
        return await Exec.run("lsof", args, { okExitCodes: [1] });
    } catch (error) {
        throw new PortError((error as Error).message);
    }
}

export type { KillOutcome, Listener };
export { PortError, Ports };
