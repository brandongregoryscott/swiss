import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SshConfig } from "./config.js";

describe("SshConfig", () => {
    let home: string;
    let sshDir: string;

    beforeEach(async () => {
        home = await mkdtemp(path.join(tmpdir(), "swiss-ssh-"));
        sshDir = path.join(home, ".ssh");
        await mkdir(path.join(sshDir, "config.d"), { recursive: true });
    });

    afterEach(async () => {
        await rm(home, { force: true, recursive: true });
    });

    describe("parse", () => {
        it("reads keywords case-insensitively, with = or spaces, and quoted arguments", () => {
            const text = [
                "# comment",
                "",
                "Host web db",
                "    HostName=10.0.0.1",
                '  IdentityFile "~/My Keys/id_rsa"',
            ].join("\n");

            const result = SshConfig.parse(text);

            expect(result).toEqual([
                { args: ["web", "db"], keyword: "host", line: 3 },
                { args: ["10.0.0.1"], keyword: "hostname", line: 4 },
                {
                    args: ["~/My Keys/id_rsa"],
                    keyword: "identityfile",
                    line: 5,
                },
            ]);
        });
    });

    describe("hosts", () => {
        it("keeps the first HostName, User and Port of each host, and ignores Match blocks", () => {
            const directives = SshConfig.parse(
                [
                    "User everyone",
                    "Host web",
                    "  HostName web.example.com",
                    "  HostName ignored.example.com",
                    "  User deploy",
                    "  Port 2222",
                    "Match host db",
                    "  User ignored",
                    "Host *",
                    "  ServerAliveInterval 60",
                ].join("\n")
            );
            const file = { directives, display: "config", path: "config" };

            const result = SshConfig.hosts([file]);

            expect(result).toEqual([
                {
                    file,
                    hostName: "web.example.com",
                    line: 2,
                    patterns: ["web"],
                    port: "2222",
                    user: "deploy",
                },
                {
                    file,
                    hostName: null,
                    line: 9,
                    patterns: ["*"],
                    port: null,
                    user: null,
                },
            ]);
        });
    });

    describe("load", () => {
        it("follows Include to files relative to ~/.ssh, under ~, and matching globs", async () => {
            await writeFile(
                path.join(sshDir, "config"),
                "Include config.d/* ~/elsewhere/config\nHost main\n"
            );
            await writeFile(path.join(sshDir, "config.d", "b"), "Host b\n");
            await writeFile(path.join(sshDir, "config.d", "a"), "Host a\n");
            await mkdir(path.join(home, "elsewhere"));
            await writeFile(
                path.join(home, "elsewhere", "config"),
                "Include ~/.ssh/config\nHost elsewhere\n"
            );

            const result = await SshConfig.load(sshDir);

            expect(result.map((file) => file.path)).toEqual([
                path.join(sshDir, "config"),
                path.join(sshDir, "config.d", "a"),
                path.join(sshDir, "config.d", "b"),
                path.join(home, "elsewhere", "config"),
            ]);
        });

        it("skips included files that don't exist", async () => {
            await writeFile(
                path.join(sshDir, "config"),
                "Include missing\nHost main\n"
            );

            const result = await SshConfig.load(sshDir);

            expect(result.map((file) => file.path)).toEqual([
                path.join(sshDir, "config"),
            ]);
        });

        it("is empty without a config", async () => {
            const result = await SshConfig.load(sshDir);

            expect(result).toEqual([]);
        });
    });
});
