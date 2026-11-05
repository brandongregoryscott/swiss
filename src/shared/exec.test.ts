import { describe, expect, it } from "vitest";
import { Exec } from "./exec.js";

describe("Exec.run", () => {
    it("trims output unless it's asked for as it is", async () => {
        expect(await Exec.run("printf", [" out \\n"])).toBe("out");
        expect(await Exec.run("printf", [" out \\n"], { raw: true })).toBe(
            " out \n"
        );
    });

    it("returns stderr when asked, for tools that report there", async () => {
        expect(
            await Exec.run("sh", ["-c", "echo out; echo err >&2"], {
                stderr: true,
            })
        ).toBe("err");
    });
});
