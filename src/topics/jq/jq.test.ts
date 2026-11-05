import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "../../shared/input.js";
import { Jq, JqError } from "./jq.js";

describe("Jq", () => {
    describe("run", () => {
        const input = JSON.stringify({ items: [{ name: "a" }, { name: "b" }] });

        it("runs a filter", async () => {
            expect(await Jq.run(input, ".items | length")).toBe("2");
        });

        it("passes on raw, compact and slurp", async () => {
            expect(await Jq.run(input, ".items[].name", { raw: true })).toBe(
                "a\nb"
            );
            expect(await Jq.run(input, ".items", { compact: true })).toBe(
                '[{"name":"a"},{"name":"b"}]'
            );
            expect(
                await Jq.run('{"n": 1}\n{"n": 2}', "map(.n)", {
                    compact: true,
                    slurp: true,
                })
            ).toBe("[1,2]");
        });

        it("throws jq's message without its prefixes", async () => {
            await expect(Jq.run(input, ".items |")).rejects.toThrow(JqError);
            await expect(Jq.run(input, ".items |")).rejects.toThrow(
                /^syntax error, unexpected end of file/
            );
            await expect(Jq.run(input, ".items |")).rejects.not.toThrow(
                /compile error/
            );
        });

        it("leaves out where in the input a runtime error happened", async () => {
            await expect(Jq.run(input, ".items | .name")).rejects.toThrow(
                /^Cannot index array with string \("name"\)$/
            );
        });

        it("throws when the input isn't JSON", async () => {
            await expect(Jq.run("not json", ".")).rejects.toThrow(
                "parse error: Invalid numeric literal at line 1, column 4"
            );
        });
    });

    describe("readInput", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        function stubInput(text: string, source: "clipboard" | "stdin") {
            vi.spyOn(Input, "read").mockResolvedValue({
                data: Buffer.from(text),
                source,
            });
        }

        it("reads JSON from the clipboard", async () => {
            stubInput('{"a": 1}', "clipboard");

            expect(await Jq.readInput(undefined)).toBe('{"a": 1}');
        });

        it("reads newline-delimited JSON from the clipboard", async () => {
            stubInput('{"a": 1}\n{"a": 2}\n', "clipboard");

            expect(await Jq.readInput(undefined)).toBe('{"a": 1}\n{"a": 2}\n');
        });

        it("says when the clipboard doesn't hold JSON", async () => {
            stubInput("some copied text", "clipboard");

            await expect(Jq.readInput(undefined)).rejects.toThrow(
                /^The clipboard doesn't hold JSON: /
            );
        });

        it("leaves checking piped input to jq", async () => {
            stubInput("not json", "stdin");

            expect(await Jq.readInput(undefined)).toBe("not json");
        });

        it("reads a file", async () => {
            expect(await Jq.readInput("package.json")).toContain('"swiss"');
        });

        it("throws for a missing file", async () => {
            await expect(Jq.readInput("missing.json")).rejects.toThrow(
                "missing.json doesn't exist"
            );
        });
    });
});
