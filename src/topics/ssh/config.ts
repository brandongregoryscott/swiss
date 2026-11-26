import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { Text } from "../../shared/text.js";

type SshDirective = {
    args: string[];
    keyword: string;
    line: number;
};

type SshConfigFile = {
    directives: SshDirective[];
    display: string;
    path: string;
};

type SshHost = {
    file: SshConfigFile;
    hostName: null | string;
    line: number;
    patterns: string[];
    port: null | string;
    user: null | string;
};

const MAX_INCLUDE_DEPTH = 16;

class SshConfig {
    static hosts(files: SshConfigFile[]): SshHost[] {
        const hosts: SshHost[] = [];
        for (const file of files) {
            let current: null | SshHost = null;
            for (const directive of file.directives) {
                const [value = null] = directive.args;
                switch (directive.keyword) {
                    case "host": {
                        current = {
                            file,
                            hostName: null,
                            line: directive.line,
                            patterns: directive.args,
                            port: null,
                            user: null,
                        };
                        hosts.push(current);
                        break;
                    }
                    case "hostname": {
                        if (current != null) {
                            current.hostName ??= value;
                        }
                        break;
                    }
                    case "match": {
                        current = null;
                        break;
                    }
                    case "port": {
                        if (current != null) {
                            current.port ??= value;
                        }
                        break;
                    }
                    case "user": {
                        if (current != null) {
                            current.user ??= value;
                        }
                        break;
                    }
                }
            }
        }
        return hosts;
    }

    static async load(sshDir: string): Promise<SshConfigFile[]> {
        const files: SshConfigFile[] = [];
        const seen = new Set<string>();
        const home = path.dirname(sshDir);

        const visit = async (file: string, depth: number): Promise<void> => {
            if (seen.has(file) || depth > MAX_INCLUDE_DEPTH) {
                return;
            }
            seen.add(file);
            const text = await readFile(file, "utf8").catch(() => null);
            if (text == null) {
                return;
            }
            const loaded = {
                directives: SshConfig.parse(text),
                display: Text.displayPath(file),
                path: file,
            };
            files.push(loaded);
            for (const directive of loaded.directives) {
                if (directive.keyword !== "include") {
                    continue;
                }
                for (const pattern of directive.args) {
                    for (const included of await expandInclude(
                        pattern,
                        sshDir,
                        home
                    )) {
                        await visit(included, depth + 1);
                    }
                }
            }
        };

        await visit(path.join(sshDir, "config"), 0);
        return files;
    }

    static parse(text: string): SshDirective[] {
        const directives: SshDirective[] = [];
        for (const [index, raw] of text.split(/\r?\n/).entries()) {
            const line = raw.trim();
            if (line === "" || line.startsWith("#")) {
                continue;
            }
            const match = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*)$/.exec(
                line
            );
            if (match == null) {
                continue;
            }
            directives.push({
                args: splitArgs(match[2]!),
                keyword: match[1]!.toLowerCase(),
                line: index + 1,
            });
        }
        return directives;
    }
}

function splitArgs(text: string): string[] {
    return [...text.matchAll(/"([^"]*)"|(\S+)/g)].map(
        ([, quoted, bare]) => quoted ?? bare!
    );
}

async function expandInclude(
    pattern: string,
    sshDir: string,
    home: string
): Promise<string[]> {
    const expanded = pattern.startsWith("~/")
        ? path.join(home, pattern.slice(2))
        : path.resolve(sshDir, pattern);
    if (!/[*?[]/.test(expanded)) {
        return [expanded];
    }
    const matches: string[] = [];
    for await (const match of glob(expanded)) {
        matches.push(match);
    }
    return matches.sort();
}

export type { SshConfigFile, SshDirective, SshHost };
export { SshConfig };
