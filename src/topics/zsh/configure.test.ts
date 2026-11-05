import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigSection } from "../../shared/config/config.js";
import { ZshConfigSection } from "../../shared/config/zsh-config.js";
import { configureZsh } from "./configure.js";
import { ZshStartup } from "./startup.js";

describe("configure zsh", () => {
    let home: string;
    const load = () => ZshStartup.load({ env: {}, home });
    const settings = () => structuredClone(ZshConfigSection.TEMPLATE);

    beforeEach(() => {
        home = mkdtempSync(path.join(tmpdir(), "swiss-configure-"));
    });
    afterEach(() => rmSync(home, { force: true, recursive: true }));

    it("creates a standalone startup file and makes no changes on a second run", async () => {
        const startup = await load();
        const changes = configureZsh(startup, settings());
        expect(changes).toHaveLength(8);
        expect(changes.every(({ change }) => change.status === "added")).toBe(
            true
        );
        await startup.save();
        const text = readFileSync(path.join(home, ".zshrc"), "utf8");
        expect(text).toContain("alias gcsquash='swiss git squash'");
        expect(text).not.toContain("source ");
        const reloaded = await load();
        expect(
            configureZsh(reloaded, settings()).every(
                ({ change }) => change.status === "unchanged"
            )
        ).toBe(true);
        expect(await reloaded.save()).toEqual([]);
        expect(readFileSync(path.join(home, ".zshrc"), "utf8")).toBe(text);
    });

    it("migrates the old function to an alias while preserving unrelated settings", async () => {
        writeFileSync(
            path.join(home, ".zshrc"),
            "# keep me\nalias reload='old'\nexport EDITOR=vi\nfunction gcsquash() { echo old; }\n"
        );
        const startup = await load();
        const config = settings();
        config.env = { EDITOR: "nvim", GOPATH: "$HOME/go" };
        config.path = ["$GOPATH/bin"];
        configureZsh(startup, config);
        await startup.save();
        const reloaded = await load();
        expect(
            reloaded
                .exports()
                .map(({ statement }) => [statement.name, statement.value])
        ).toEqual(
            expect.arrayContaining([
                ["EDITOR", "nvim"],
                ["GOPATH", "$HOME/go"],
            ])
        );
        expect(reloaded.pathAdditions()[0]?.expanded).toBe(
            path.join(home, "go/bin")
        );
        expect(readFileSync(path.join(home, ".zshrc"), "utf8")).toContain(
            "# keep me"
        );
        expect(
            reloaded
                .aliases()
                .filter(({ statement }) => statement.name === "gcsquash")
        ).toHaveLength(1);
    });

    it("leaves read-only functions and files unchanged when planning fails", async () => {
        const text =
            "if true; then\n function gcsquash() { echo custom; }\nfi\n";
        writeFileSync(path.join(home, ".zshrc"), text);
        const startup = await load();
        expect(() => configureZsh(startup, settings())).toThrow(
            "Can't change gcsquash"
        );
        expect(readFileSync(path.join(home, ".zshrc"), "utf8")).toBe(text);
    });

    it("accepts a custom alias selection", () => {
        const parsed = ZshConfigSection.parse(
            new ConfigSection("config.json", "zsh", {
                aliases: { gs: "git status" },
                env: { EDITOR: "nvim" },
                path: ["~/bin"],
            })
        );
        expect(parsed).toEqual({
            aliases: { gs: "git status" },
            env: { EDITOR: "nvim" },
            path: ["~/bin"],
        });
    });

    it("honors custom gcsquash aliases and omitting it from an explicit selection", async () => {
        const startup = await load();
        const config = settings();
        config.aliases = { gs: "git status" };
        configureZsh(startup, config);
        expect(
            startup.aliases().map(({ statement }) => statement.name)
        ).toEqual(["gs"]);
        config.aliases.gcsquash = "sws git squash";
        configureZsh(startup, config);
        expect(
            startup
                .aliases()
                .find(({ statement }) => statement.name === "gcsquash")
                ?.statement.value
        ).toBe("sws git squash");
    });

    it.each([
        { aliases: [] },
        { env: { EDITOR: 1 } },
        { helpers: ["unknown"] },
        { path: "~/bin" },
        { unknown: true },
    ])("rejects invalid settings %j", (values) => {
        expect(() =>
            ZshConfigSection.parse(
                new ConfigSection("config.json", "zsh", values)
            )
        ).toThrow();
    });
});
