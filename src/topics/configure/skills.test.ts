import {
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readlinkSync,
    rmSync,
    symlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Skills } from "./skills.js";

describe.each([".claude", ".agents"])("Skills in %s", (agentDir) => {
    let dir: string;
    let assetsDir: string;
    let skillsDir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "swiss-skills-"));
        assetsDir = path.join(dir, "assets");
        skillsDir = path.join(dir, agentDir, "skills");
        mkdirSync(path.join(assetsDir, "pre-review"), { recursive: true });
    });
    afterEach(() => rmSync(dir, { force: true, recursive: true }));

    it("links each bundled skill and leaves it alone on a second run", async () => {
        const first = await Skills.link(skillsDir, assetsDir);

        const second = await Skills.link(skillsDir, assetsDir);

        const destination = path.join(skillsDir, "pre-review");
        expect(first).toEqual([
            { name: "pre-review", path: destination, status: "added" },
        ]);
        expect(second[0]?.status).toBe("unchanged");
        expect(readlinkSync(destination)).toBe(
            path.join(assetsDir, "pre-review")
        );
    });

    it("repoints a link that targets somewhere else", async () => {
        mkdirSync(skillsDir, { recursive: true });
        symlinkSync(
            path.join(dir, "elsewhere"),
            path.join(skillsDir, "pre-review")
        );

        const result = await Skills.link(skillsDir, assetsDir);

        expect(result[0]?.status).toBe("updated");
        expect(readlinkSync(path.join(skillsDir, "pre-review"))).toBe(
            path.join(assetsDir, "pre-review")
        );
    });

    it("skips a real directory with the same name", async () => {
        mkdirSync(path.join(skillsDir, "pre-review"), { recursive: true });

        const result = await Skills.link(skillsDir, assetsDir);

        expect(result[0]?.status).toBe("skipped");
        expect(
            lstatSync(path.join(skillsDir, "pre-review")).isDirectory()
        ).toBe(true);
    });
});

describe("Skills directories", () => {
    it("uses CLAUDE_CONFIG_DIR when it's set", () => {
        const result = Skills.claudeDirectory({ CLAUDE_CONFIG_DIR: "/cfg" });

        expect(result).toBe(path.join("/cfg", "skills"));
    });

    it("defaults to the user's Claude skills directory", () => {
        expect(Skills.claudeDirectory({})).toBe(
            path.join(homedir(), ".claude", "skills")
        );
    });

    it("uses the user's agents skills directory for Codex", () => {
        expect(Skills.codexDirectory()).toBe(
            path.join(homedir(), ".agents", "skills")
        );
    });
});
