import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { PortError, Ports } from "./ports.js";

describe("Ports", () => {
    describe("parseSockets", () => {
        it("merges a process's IPv4 and IPv6 sockets on the same port", () => {
            const output = [
                "p123",
                "cnode",
                "f20",
                "n127.0.0.1:3000",
                "f21",
                "n[::1]:3000",
                "f22",
                "n[::1]:3000",
            ].join("\n");

            expect(Ports.parseSockets(output)).toEqual([
                {
                    addresses: ["127.0.0.1", "::1"],
                    command: "node",
                    pid: 123,
                    port: 3000,
                },
            ]);
        });

        it("keeps one entry per process and port, sorted by port", () => {
            const output = [
                "p572",
                "cControlCenter",
                "f8",
                "n*:7000",
                "f10",
                "n*:5000",
                "p40",
                "cpostgres",
                "f4",
                "n127.0.0.1:5432",
            ].join("\n");

            expect(
                Ports.parseSockets(output).map(({ command, pid, port }) => ({
                    command,
                    pid,
                    port,
                }))
            ).toEqual([
                { command: "ControlCenter", pid: 572, port: 5000 },
                { command: "postgres", pid: 40, port: 5432 },
                { command: "ControlCenter", pid: 572, port: 7000 },
            ]);
        });

        it("returns nothing for empty output", () => {
            expect(Ports.parseSockets("")).toEqual([]);
        });
    });

    describe("parsePort", () => {
        it("accepts 1-65535", () => {
            expect(Ports.parsePort("1")).toBe(1);
            expect(Ports.parsePort("3000")).toBe(3000);
            expect(Ports.parsePort("65535")).toBe(65535);
        });

        it.each(["0", "65536", "-1", "30.5", "abc", ""])(
            "rejects %j",
            (input) => {
                expect(() => Ports.parsePort(input)).toThrow(PortError);
            }
        );
    });

    describe("shortenCommand", () => {
        it("drops the program's directory", () => {
            expect(
                Ports.shortenCommand(
                    "/opt/homebrew/bin/node server.js --port 3000"
                )
            ).toBe("node server.js --port 3000");
            expect(Ports.shortenCommand("postgres")).toBe("postgres");
        });

        it("uses the executable's path to handle spaces in it", () => {
            const executable =
                "/Applications/OrbStack.app/Contents/MacOS/OrbStack Helper";

            expect(
                Ports.shortenCommand(`${executable} vmgr -handoff`, executable)
            ).toBe("OrbStack Helper vmgr -handoff");
        });

        it("falls back to the first word when the executable doesn't match", () => {
            expect(
                Ports.shortenCommand(
                    "/usr/bin/python3 -m http.server",
                    "python3"
                )
            ).toBe("python3 -m http.server");
        });
    });

    describe("tableRows", () => {
        const listeners = [
            {
                addresses: ["*"],
                command: "node server.js",
                cwd: `${homedir()}/app`,
                pid: 123,
                port: 3000,
            },
            {
                addresses: ["127.0.0.1", "::1"],
                command: "postgres -D /var/db",
                cwd: null,
                pid: 45,
                port: 5432,
            },
        ];

        it("has a header and a row for each listener", () => {
            expect(Ports.tableRows(listeners)).toEqual([
                ["PORT", "PID", "ADDRESS", "DIRECTORY", "COMMAND"],
                ["3000", "123", "*", "~/app", "node server.js"],
                ["5432", "45", "127.0.0.1, ::1", "", "postgres -D /var/db"],
            ]);
        });

        it("keeps the end of long directories", () => {
            const [, row] = Ports.tableRows([
                { ...listeners[0]!, cwd: `/very/long/${"x".repeat(40)}/app` },
            ]);

            expect(row![3]).toBe(`…${"x".repeat(35)}/app`);
        });
    });

    describe("kill", () => {
        it("stops a running process", async () => {
            const child = spawn("sleep", ["30"]);
            const exited = new Promise((resolve) => child.on("exit", resolve));

            const outcome = await Ports.kill(child.pid!, "SIGTERM");
            await exited;

            expect(outcome).toEqual({ pid: child.pid, status: "killed" });
        });

        it.skipIf(process.getuid?.() === 0)(
            "explains a process owned by another user",
            async () => {
                // launchd or init, which only root can signal. SIGCONT does nothing either way.
                const outcome = await Ports.kill(1, "SIGCONT");

                expect(outcome).toEqual({
                    pid: 1,
                    reason: "owned by another user; try again with sudo",
                    status: "error",
                });
            }
        );

        it("lets bugs through instead of reporting them as the process's error", async () => {
            await expect(Ports.kill(Number.NaN, "SIGTERM")).rejects.toThrow(
                TypeError
            );
        });
    });
});
