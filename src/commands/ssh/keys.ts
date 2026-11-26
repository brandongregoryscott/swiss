import { Flags } from "@oclif/core";
import { readFile } from "node:fs/promises";
import type { SshKeyPair } from "../../topics/ssh/files.js";
import { Clipboard } from "../../shared/clipboard.js";
import {
    LIST_FLAGS,
    listHelp,
    searchArg,
    SwissCommand,
} from "../../shared/command.js";
import { CommandError } from "../../shared/exec.js";
import { matchesSearch } from "../../shared/listing.js";
import { Text } from "../../shared/text.js";
import { SshFiles } from "../../topics/ssh/files.js";

export default class SshKeys extends SwissCommand {
    static override args = {
        search: searchArg("keys", "name or comment"),
    };

    static override description = `List the key pairs in ~/.ssh, with each one's type, fingerprint and comment.

${listHelp("copy its public key, like for adding it to GitHub")}

--private copies the private key instead, for pasting into something like a CI secret. Clipboard managers keep a history of what's copied, so clear it from yours afterwards.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> github --private",
            description: "Copy the private key of a key pair named github",
        },
    ];

    static override flags = {
        ...LIST_FLAGS,
        private: Flags.boolean({
            description: "Copy the private key instead of the public key",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SshKeys);
        const directory = await SshFiles.load();
        const keys = directory.keys.filter((key) =>
            matchesSearch(args.search, [key.name, key.publicKey?.comment ?? ""])
        );
        const which = flags.private ? "private" : "public";

        await this.listItems<SshKeyPair>({
            action: `copy its ${which} key`,
            choice: (key) => ({
                hint: [
                    key.publicKey?.type ?? "",
                    key.publicKey?.comment ?? "",
                    key.publicKey?.fingerprint ?? "no .pub file",
                ]
                    .filter((part) => part !== "")
                    .join(" · "),
                label: key.name,
            }),
            columns: ["NAME", "TYPE", "COMMENT", "FINGERPRINT"],
            empty:
                args.search == null
                    ? `No keys in ${Text.displayPath(directory.path)}`
                    : `No keys match ${JSON.stringify(args.search)}`,
            fit: false,
            items: keys,
            noun: [`${which} key`, `${which} keys`],
            async open(key) {
                await Clipboard.copy(await keyText(key, flags.private));
                return `Copied the ${which} key of ${key.name}`;
            },
            row: (key) => [
                key.name,
                key.publicKey?.type ?? "",
                key.publicKey?.comment ?? "",
                key.publicKey?.fingerprint ?? "no .pub file",
            ],
            table: flags.table,
            title: `Your ssh keys`,
            verb: "Copied",
        });
    }
}

async function keyText(key: SshKeyPair, isPrivate: boolean): Promise<string> {
    if (isPrivate) {
        if (key.privatePath == null) {
            throw new CommandError(`${key.name} has only a public key`);
        }
        return readFile(key.privatePath, "utf8");
    }
    if (key.publicKey == null) {
        const display = Text.displayPath(key.privatePath!);
        throw new CommandError(
            `${key.name} has no .pub file; make one with \`ssh-keygen -y -f ${display} > ${display}.pub\``
        );
    }
    return key.publicKey.line;
}
