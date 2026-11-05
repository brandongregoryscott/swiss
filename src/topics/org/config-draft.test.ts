import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "../../shared/config/config.js";
import { OrgConfigDraft } from "./config-draft.js";

let configDir: string;

beforeEach(() => {
    configDir = mkdtempSync(path.join(tmpdir(), "swiss-config-"));
});

afterEach(() => {
    rmSync(configDir, { force: true, recursive: true });
});

describe("OrgConfigDraft", () => {
    it("starts from every default, with the org blank, when there are no settings yet", async () => {
        const draft = await OrgConfigDraft.load(configDir);

        expect(draft.text("name")).toBe("");
        expect(draft.display("name")).toBe("(not set)");
        expect(draft.text("scmHost")).toBe("github.com");
        expect(draft.display("skipForks")).toBe("yes");
        expect(draft.changed()).toBe(false);
        expect(() => draft.check()).toThrow("name must be set");
    });

    it("falls back to defaults for settings the file leaves out", async () => {
        writeConfig({ org: { name: "acme", skipArchived: false } });
        const draft = await OrgConfigDraft.load(configDir);

        expect(draft.text("name")).toBe("acme");
        expect(draft.flag("skipArchived")).toBe(false);
        expect(draft.flag("skipForks")).toBe(true);
        expect(draft.text("cloneProtocol")).toBe("ssh");
        expect(draft.ignore()).toEqual([]);
        expect(draft.check()).toMatchObject({
            name: "acme",
            rootDir: homedir(),
            skipArchived: false,
        });
    });

    it("removes a setting left blank, so its default applies again", async () => {
        writeConfig({ org: { name: "acme", scmHost: "ghe.example.com" } });
        const draft = await OrgConfigDraft.load(configDir);

        draft.setText("scmHost", "  ");
        expect(draft.changed()).toBe(true);
        expect(draft.text("scmHost")).toBe("github.com");

        await draft.save();

        expect(readConfig().org).toEqual({ name: "acme" });
        expect(draft.changed()).toBe(false);
    });

    it("writes only the org settings, keeping the rest of the file", async () => {
        writeConfig({ org: { name: "acme" }, other: { kept: true } });
        const draft = await OrgConfigDraft.load(configDir);

        draft.setIgnore(["sandbox", "ARCHIVED_*"]);
        draft.setFlag("skipForks", false);
        await draft.save();

        expect(readConfig()).toEqual({
            org: {
                ignore: ["sandbox", "ARCHIVED_*"],
                name: "acme",
                skipForks: false,
            },
            other: { kept: true },
        });
    });

    it("won't save settings org sync would reject, leaving the file alone", async () => {
        writeConfig({ org: { name: "acme" } });
        const draft = await OrgConfigDraft.load(configDir);

        draft.setText("cloneProtocol", "ftp");

        await expect(draft.save()).rejects.toThrow(ConfigError);
        await expect(draft.save()).rejects.toThrow(
            "cloneProtocol must be ssh or https, got ftp"
        );
        expect(readConfig()).toEqual({ org: { name: "acme" } });
        expect(draft.changed()).toBe(true);
    });
});

function writeConfig(sections: Record<string, unknown>): void {
    writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify(sections)
    );
}

function readConfig(): Record<string, Record<string, unknown>> {
    return JSON.parse(
        readFileSync(path.join(configDir, "config.json"), "utf8")
    ) as Record<string, Record<string, unknown>>;
}
