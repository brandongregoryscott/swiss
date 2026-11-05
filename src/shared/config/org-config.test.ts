import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, ConfigSection } from "./config.js";
import { OrgConfigSection } from "./org-config.js";

describe("OrgConfigSection", () => {
    describe("parse", () => {
        it("fills in defaults when only name is set", () => {
            const result = OrgConfigSection.parse(orgSection({ name: "acme" }));

            expect(result).toEqual({
                cloneProtocol: "ssh",
                ignore: [],
                name: "acme",
                rootDir: homedir(),
                scmHost: "github.com",
                skipArchived: true,
                skipForks: true,
            });
        });

        it("accepts the config init template once name is filled in", () => {
            const result = OrgConfigSection.parse(
                orgSection({ ...OrgConfigSection.TEMPLATE, name: "acme" })
            );

            expect(result).toEqual(
                OrgConfigSection.parse(orgSection({ name: "acme" }))
            );
        });

        it("expands ~ in rootDir", () => {
            const result = OrgConfigSection.parse(
                orgSection({ name: "acme", rootDir: "~/code" })
            );

            expect(result.rootDir).toBe(path.join(homedir(), "code"));
        });

        it("rejects a relative rootDir", () => {
            expect(() =>
                OrgConfigSection.parse(
                    orgSection({ name: "acme", rootDir: "code" })
                )
            ).toThrow(/org\.rootDir must be an absolute path/);
        });

        it("requires name", () => {
            expect(() =>
                OrgConfigSection.parse(orgSection({ scmHost: "github.com" }))
            ).toThrow("config.json: org.name must be set to a GitHub org");
        });

        it("rejects an unsupported cloneProtocol", () => {
            expect(() =>
                OrgConfigSection.parse(
                    orgSection({ cloneProtocol: "git", name: "acme" })
                )
            ).toThrow(/org\.cloneProtocol must be ssh or https/);
        });

        it("rejects unknown keys", () => {
            expect(() =>
                OrgConfigSection.parse(
                    orgSection({ name: "acme", skipArchive: true })
                )
            ).toThrow("config.json: org has unknown keys: skipArchive");
        });
    });

    describe("load", () => {
        let configDir: string;

        beforeEach(() => {
            configDir = mkdtempSync(path.join(tmpdir(), "swiss-config-"));
        });

        afterEach(() => {
            rmSync(configDir, { force: true, recursive: true });
        });

        it("reads the org section of config.json, ignoring other sections", async () => {
            const config = {
                org: {
                    cloneProtocol: "https",
                    ignore: ["sandbox"],
                    name: "acme",
                    rootDir: "/srv/repos",
                },
                other: { anything: true },
            };
            writeFileSync(
                path.join(configDir, "config.json"),
                JSON.stringify(config)
            );

            const result = await OrgConfigSection.load(configDir);

            expect(result).toMatchObject({
                cloneProtocol: "https",
                ignore: ["sandbox"],
                name: "acme",
                rootDir: "/srv/repos",
            });
        });

        it("explains where to add settings when the file is missing", async () => {
            const result = OrgConfigSection.load(configDir);

            await expect(result).rejects.toThrow(ConfigError);
            await expect(result).rejects.toThrow(
                `Add org settings to ${path.join(configDir, "config.json")}`
            );
        });

        it("explains where to add settings when the org section is missing", async () => {
            writeFileSync(path.join(configDir, "config.json"), '{"other": {}}');

            const result = OrgConfigSection.load(configDir);

            await expect(result).rejects.toThrow(
                `Add org settings to ${path.join(configDir, "config.json")}`
            );
        });
    });
});

function orgSection(values: Record<string, unknown>): ConfigSection {
    return new ConfigSection("config.json", "org", values);
}
