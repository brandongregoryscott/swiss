import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigFile, ConfigSection } from "./config.js";

let configDir: string;

beforeEach(() => {
    configDir = mkdtempSync(path.join(tmpdir(), "swiss-config-"));
});

afterEach(() => {
    rmSync(configDir, { force: true, recursive: true });
});

describe("ConfigFile", () => {
    describe("load", () => {
        it("reads config.json from the config directory", async () => {
            writeFileSync(
                path.join(configDir, "config.json"),
                '{"org": {"name": "acme"}}'
            );

            const result = await ConfigFile.load(configDir);

            expect(result).toEqual({
                path: path.join(configDir, "config.json"),
                sections: { org: { name: "acme" } },
            });
        });

        it("treats a missing file as empty", async () => {
            const result = await ConfigFile.load(configDir);

            expect(result.sections).toEqual({});
        });

        it("rejects invalid JSON", async () => {
            writeFileSync(path.join(configDir, "config.json"), '{"org": ');

            const result = ConfigFile.load(configDir);

            await expect(result).rejects.toThrow(
                `${path.join(configDir, "config.json")} is not valid JSON`
            );
        });

        it("rejects a top-level value that is not an object", async () => {
            writeFileSync(path.join(configDir, "config.json"), "[]");

            const result = ConfigFile.load(configDir);

            await expect(result).rejects.toThrow("must contain a JSON object");
        });
    });

    describe("scaffold", () => {
        it("creates the config directory and file", async () => {
            const nestedDir = path.join(configDir, "swiss");

            const result = await ConfigFile.scaffold(nestedDir, {
                org: { name: "" },
            });

            expect(result).toEqual({
                added: ["org"],
                path: path.join(nestedDir, "config.json"),
            });
            expect(readFileSync(result.path, "utf8")).toBe(
                '{\n  "org": {\n    "name": ""\n  }\n}\n'
            );
        });

        it("adds missing sections without touching existing ones", async () => {
            writeFileSync(
                path.join(configDir, "config.json"),
                '{"org": {"name": "acme"}}'
            );

            const result = await ConfigFile.scaffold(configDir, {
                org: { name: "" },
                other: { enabled: true },
            });

            expect(result.added).toEqual(["other"]);
            expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
                org: { name: "acme" },
                other: { enabled: true },
            });
        });

        it("leaves the file alone when every section is present", async () => {
            writeFileSync(
                path.join(configDir, "config.json"),
                '{"org":{"name":"acme"}}'
            );

            const result = await ConfigFile.scaffold(configDir, {
                org: { name: "" },
            });

            expect(result.added).toEqual([]);
            expect(readFileSync(result.path, "utf8")).toBe(
                '{"org":{"name":"acme"}}'
            );
        });

        it("refuses to overwrite invalid JSON", async () => {
            writeFileSync(path.join(configDir, "config.json"), '{"org": ');

            await expect(
                ConfigFile.scaffold(configDir, { org: { name: "" } })
            ).rejects.toThrow("is not valid JSON");
            expect(
                readFileSync(path.join(configDir, "config.json"), "utf8")
            ).toBe('{"org": ');
        });
    });

    describe("writeSection", () => {
        it("replaces one section and keeps the others", async () => {
            writeFileSync(
                path.join(configDir, "config.json"),
                '{"org": {"name": "acme"}, "other": {"enabled": true}}'
            );

            const result = await ConfigFile.writeSection(configDir, "org", {
                ignore: ["sandbox"],
                name: "globex",
            });

            expect(result).toBe(path.join(configDir, "config.json"));
            expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({
                org: { ignore: ["sandbox"], name: "globex" },
                other: { enabled: true },
            });
        });

        it("creates the file when it doesn't exist", async () => {
            const result = await ConfigFile.writeSection(configDir, "org", {
                name: "acme",
            });

            expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({
                org: { name: "acme" },
            });
        });
    });

    describe("getSection", () => {
        it("returns null for a missing section", () => {
            const result = ConfigFile.getSection(
                { path: "config.json", sections: {} },
                "org"
            );

            expect(result).toBeNull();
        });

        it("rejects a section that is not an object", () => {
            expect(() =>
                ConfigFile.getSection(
                    { path: "config.json", sections: { org: "acme" } },
                    "org"
                )
            ).toThrow("config.json: org must be an object");
        });
    });
});

describe("ConfigSection", () => {
    describe("boolean", () => {
        it("names the file, section and key in type errors", () => {
            const section = new ConfigSection("config.json", "org", {
                skipForks: "yes",
            });

            expect(() => section.boolean("skipForks")).toThrow(
                "config.json: org.skipForks must be true or false"
            );
        });
    });

    describe("rejectUnknownKeys", () => {
        it("rejects unknown keys", () => {
            const section = new ConfigSection("config.json", "org", {
                name: "acme",
                skipArchive: true,
            });

            expect(() => section.rejectUnknownKeys(["name"])).toThrow(
                "config.json: org has unknown keys: skipArchive"
            );
        });
    });

    describe("string", () => {
        it("trims the value", () => {
            const section = new ConfigSection("config.json", "org", {
                name: " acme ",
            });

            expect(section.string("name")).toBe("acme");
        });
    });

    describe("stringList", () => {
        it("trims entries and drops blank ones", () => {
            const section = new ConfigSection("config.json", "org", {
                ignore: [" sandbox ", ""],
            });

            expect(section.stringList("ignore")).toEqual(["sandbox"]);
        });
    });
});
