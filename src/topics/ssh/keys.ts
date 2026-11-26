import { createHash } from "node:crypto";

type PublicKey = {
    comment: string;
    fingerprint: string;
    line: string;
    type: string;
};

const KEY_TYPES: Record<string, string> = {
    "ecdsa-sha2-nistp256": "ECDSA",
    "ecdsa-sha2-nistp384": "ECDSA",
    "ecdsa-sha2-nistp521": "ECDSA",
    "sk-ecdsa-sha2-nistp256@openssh.com": "ECDSA-SK",
    "sk-ssh-ed25519@openssh.com": "ED25519-SK",
    "ssh-dss": "DSA",
    "ssh-ed25519": "ED25519",
    "ssh-rsa": "RSA",
};

class SshKeys {
    static isPrivateKey(text: string): boolean {
        return /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text);
    }

    static parsePublicKey(text: string): null | PublicKey {
        const line = text.trim();
        const match = /^(\S+)\s+([A-Za-z0-9+/]+={0,2})(?:\s+(.*))?$/.exec(line);
        if (match == null || !(match[1]! in KEY_TYPES)) {
            return null;
        }
        const blob = Buffer.from(match[2]!, "base64");
        const digest = createHash("sha256").update(blob).digest("base64");
        return {
            comment: match[3] ?? "",
            fingerprint: `SHA256:${digest.replace(/=+$/, "")}`,
            line,
            type: KEY_TYPES[match[1]!]!,
        };
    }
}

export type { PublicKey };
export { SshKeys };
