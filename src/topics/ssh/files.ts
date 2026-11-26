import { sortBy } from "lodash-es";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SshConfigFile } from "./config.js";
import type { PublicKey } from "./keys.js";
import { nullIfMissing } from "../../shared/errors.js";
import { Text } from "../../shared/text.js";
import { SshConfig } from "./config.js";
import { SshKeys } from "./keys.js";

type SshFileKind =
    | "authorized keys"
    | "config"
    | "known hosts"
    | "other"
    | "private key"
    | "public key";

type SshFile = {
    detail: string;
    display: string;
    kind: SshFileKind;
    path: string;
};

type SshKeyPair = {
    name: string;
    privatePath: null | string;
    publicKey: null | PublicKey;
    publicPath: null | string;
};

type SshDirectory = {
    configs: SshConfigFile[];
    files: SshFile[];
    keys: SshKeyPair[];
    path: string;
};

type LoadedEntry = {
    kind: SshFileKind;
    mode: number;
    name: string;
    path: string;
    text: null | string;
};

const KIND_ORDER: SshFileKind[] = [
    "config",
    "known hosts",
    "authorized keys",
    "private key",
    "public key",
    "other",
];
const MAX_READ_BYTES = 1024 * 1024;

class SshFiles {
    static readonly DEFAULT_DIR = path.join(homedir(), ".ssh");

    static async load(sshDir = SshFiles.DEFAULT_DIR): Promise<SshDirectory> {
        const configs = await SshConfig.load(sshDir);
        const configPaths = new Set(configs.map((config) => config.path));
        const names = (await readdir(sshDir).catch(nullIfMissing)) ?? [];
        const entries = (
            await Promise.all(
                names.map((name) =>
                    loadEntry(path.join(sshDir, name), configPaths)
                )
            )
        ).filter((entry) => entry != null);
        const keys = keyPairs(entries);

        const configFiles = configs.map((config) => ({
            detail: Text.pluralize(SshConfig.hosts([config]).length, "host"),
            display: config.display,
            kind: "config" as const,
            path: config.path,
        }));
        const otherFiles = sortBy(
            entries.filter((entry) => entry.kind !== "config"),
            (entry) => KIND_ORDER.indexOf(entry.kind),
            (entry) => entry.name
        ).map((entry) => ({
            detail: detail(entry, keys),
            display: Text.displayPath(entry.path),
            kind: entry.kind,
            path: entry.path,
        }));
        return {
            configs,
            files: [...configFiles, ...otherFiles],
            keys,
            path: sshDir,
        };
    }
}

async function loadEntry(
    file: string,
    configPaths: Set<string>
): Promise<LoadedEntry | null> {
    const stats = await stat(file).catch(() => null);
    if (stats?.isFile() !== true) {
        return null;
    }
    const name = path.basename(file);
    const text =
        stats.size > MAX_READ_BYTES
            ? null
            : await readFile(file, "utf8").catch(() => null);
    return {
        kind: classify(name, file, text, configPaths),
        mode: stats.mode,
        name,
        path: file,
        text,
    };
}

function classify(
    name: string,
    file: string,
    text: null | string,
    configPaths: Set<string>
): SshFileKind {
    if (configPaths.has(file)) {
        return "config";
    }
    if (name.startsWith("known_hosts")) {
        return "known hosts";
    }
    if (name === "authorized_keys" || name === "authorized_keys2") {
        return "authorized keys";
    }
    if (text == null) {
        return "other";
    }
    if (name.endsWith(".pub") && SshKeys.parsePublicKey(text) != null) {
        return "public key";
    }
    return SshKeys.isPrivateKey(text) ? "private key" : "other";
}

function keyPairs(entries: LoadedEntry[]): SshKeyPair[] {
    const pairs = new Map<string, SshKeyPair>();
    const pairFor = (name: string): SshKeyPair => {
        let pair = pairs.get(name);
        if (pair == null) {
            pair = {
                name,
                privatePath: null,
                publicKey: null,
                publicPath: null,
            };
            pairs.set(name, pair);
        }
        return pair;
    };
    for (const entry of entries) {
        if (entry.kind === "private key") {
            pairFor(entry.name).privatePath = entry.path;
        } else if (entry.kind === "public key") {
            const pair = pairFor(entry.name.slice(0, -".pub".length));
            pair.publicPath = entry.path;
            pair.publicKey = SshKeys.parsePublicKey(entry.text!);
        }
    }
    return sortBy([...pairs.values()], (pair) => pair.name);
}

function detail(entry: LoadedEntry, keys: SshKeyPair[]): string {
    switch (entry.kind) {
        case "authorized keys": {
            return Text.pluralize(countLines(entry.text), "key");
        }
        case "known hosts": {
            return Text.pluralize(countLines(entry.text), "host");
        }
        case "private key": {
            const pair = keys.find((key) => key.privatePath === entry.path);
            const details = [
                pair?.publicPath == null
                    ? "no .pub file"
                    : `pairs with ${path.basename(pair.publicPath)}`,
            ];
            if ((entry.mode & 0o077) !== 0) {
                details.push("readable by others, so ssh won't use it");
            }
            return details.join(", ");
        }
        case "public key": {
            const key = SshKeys.parsePublicKey(entry.text!)!;
            return [key.type, key.fingerprint, key.comment]
                .filter((part) => part !== "")
                .join(" ");
        }
        default: {
            return "";
        }
    }
}

function countLines(text: null | string): number {
    return (text ?? "")
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
        .length;
}

export type { SshDirectory, SshFile, SshFileKind, SshKeyPair };
export { SshFiles };
