import { describe, expect, it } from "vitest";
import { SshKeys } from "./keys.js";

const PUBLIC_KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH test@example.com";

describe("SshKeys", () => {
    describe("parsePublicKey", () => {
        it("reads the type, comment and the fingerprint ssh-keygen -l gives", () => {
            const result = SshKeys.parsePublicKey(`${PUBLIC_KEY}\n`);

            expect(result).toEqual({
                comment: "test@example.com",
                fingerprint:
                    "SHA256:gNSIRW+2Iyiuvsdp/bgjy38bvWHw6wQm3tuoXrl3WjQ",
                line: PUBLIC_KEY,
                type: "ED25519",
            });
        });

        it("reads a key without a comment", () => {
            const result = SshKeys.parsePublicKey(
                PUBLIC_KEY.replace(" test@example.com", "")
            );

            expect(result?.comment).toBe("");
        });

        it("isn't a public key when the type is unknown", () => {
            const result = SshKeys.parsePublicKey("hello world");

            expect(result).toBeNull();
        });
    });

    describe("isPrivateKey", () => {
        it("recognizes OpenSSH and PEM private keys", () => {
            const testCases = [
                "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n",
                "-----BEGIN RSA PRIVATE KEY-----\nfake\n",
                "-----BEGIN PRIVATE KEY-----\nfake\n",
                "-----BEGIN ENCRYPTED PRIVATE KEY-----\nfake\n",
            ];

            for (const text of testCases) {
                expect(SshKeys.isPrivateKey(text), text).toBe(true);
            }
        });

        it("isn't a private key when it's a public key or certificate", () => {
            const testCases = [
                PUBLIC_KEY,
                "-----BEGIN CERTIFICATE-----\nfake\n",
            ];

            for (const text of testCases) {
                expect(SshKeys.isPrivateKey(text), text).toBe(false);
            }
        });
    });
});
