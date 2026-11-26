import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SshFiles } from "./files.js";

const PUBLIC_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH test@example.com";
const PRIVATE_KEY =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n";

describe("SshFiles", () => {
    let sshDir: string;

    beforeEach(async () => {
        sshDir = path.join(
            await mkdtemp(path.join(tmpdir(), "swiss-ssh-")),
            ".ssh"
        );
        await mkdir(sshDir);
    });

    afterEach(async () => {
        await rm(path.dirname(sshDir), { force: true, recursive: true });
    });

    describe("load", () => {
        it("lists configs first, then the rest of ~/.ssh by kind", async () => {
            await write("notes.txt", "hello\n");
            await write("id_ed25519.pub", `${PUBLIC_KEY}\n`);
            await write("id_ed25519", PRIVATE_KEY, 0o600);
            await write("authorized_keys", `${PUBLIC_KEY}\n# old\n`);
            await write("known_hosts", "a ssh-ed25519 x\nb ssh-ed25519 y\n");
            await write("work.conf", "Host work\n");
            await write("config", "Include work.conf\nHost a\nHost b\n");
            await mkdir(path.join(sshDir, "sockets"));

            const { files } = await SshFiles.load(sshDir);

            expect(
                files.map((file) => [
                    file.kind,
                    path.basename(file.path),
                    file.detail,
                ])
            ).toEqual([
                ["config", "config", "2 hosts"],
                ["config", "work.conf", "1 host"],
                ["known hosts", "known_hosts", "2 hosts"],
                ["authorized keys", "authorized_keys", "1 key"],
                ["private key", "id_ed25519", "pairs with id_ed25519.pub"],
                [
                    "public key",
                    "id_ed25519.pub",
                    "ED25519 SHA256:gNSIRW+2Iyiuvsdp/bgjy38bvWHw6wQm3tuoXrl3WjQ test@example.com",
                ],
                ["other", "notes.txt", ""],
            ]);
        });

        it("flags a private key that other users can read", async () => {
            await write("id_rsa", PRIVATE_KEY, 0o644);

            const { files } = await SshFiles.load(sshDir);

            expect(files[0]?.detail).toBe(
                "no .pub file, readable by others, so ssh won't use it"
            );
        });

        it("pairs private keys with their public keys, including halves on their own", async () => {
            await write("id_ed25519", PRIVATE_KEY, 0o600);
            await write("id_ed25519.pub", PUBLIC_KEY);
            await write("deploy", PRIVATE_KEY, 0o600);
            await write("github.pub", PUBLIC_KEY);

            const { keys } = await SshFiles.load(sshDir);

            expect(
                keys.map((key) => ({
                    hasPublicKey: key.publicKey != null,
                    name: key.name,
                    privatePath: key.privatePath,
                    publicPath: key.publicPath,
                }))
            ).toEqual([
                {
                    hasPublicKey: false,
                    name: "deploy",
                    privatePath: path.join(sshDir, "deploy"),
                    publicPath: null,
                },
                {
                    hasPublicKey: true,
                    name: "github",
                    privatePath: null,
                    publicPath: path.join(sshDir, "github.pub"),
                },
                {
                    hasPublicKey: true,
                    name: "id_ed25519",
                    privatePath: path.join(sshDir, "id_ed25519"),
                    publicPath: path.join(sshDir, "id_ed25519.pub"),
                },
            ]);
        });

        it("is empty when there's no ~/.ssh", async () => {
            await rm(sshDir, { recursive: true });

            const result = await SshFiles.load(sshDir);

            expect(result).toEqual({
                configs: [],
                files: [],
                keys: [],
                path: sshDir,
            });
        });
    });

    async function write(
        name: string,
        text: string,
        mode?: number
    ): Promise<void> {
        const file = path.join(sshDir, name);
        await writeFile(file, text);
        if (mode != null) {
            await chmod(file, mode);
        }
    }
});
