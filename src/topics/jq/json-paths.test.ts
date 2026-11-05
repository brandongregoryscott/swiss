import { describe, expect, it } from "vitest";
import { JsonPaths, JsonPathsError } from "./json-paths.js";

// Each path as a "path: types, e.g. example" line, to keep expectations short.
function describePaths(text: string): string[] {
    return JsonPaths.list(text).map(
        ({ example, path, types }) =>
            `${path}: ${types.join(" | ")}${example == null ? "" : `, e.g. ${example}`}`
    );
}

describe("JsonPaths", () => {
    describe("list", () => {
        it("lists each path with its type and an example", () => {
            const input = JSON.stringify({
                count: 2,
                items: [
                    { name: "Widget", tags: ["a"] },
                    { name: "Gadget", price: null, tags: [] },
                ],
            });

            expect(describePaths(input)).toEqual([
                ".: object",
                ".count: number, e.g. 2",
                ".items: array",
                ".items[]: object",
                '.items[].name: string, e.g. "Widget"',
                ".items[].tags: array",
                '.items[].tags[]: string, e.g. "a"',
                ".items[].price: null",
            ]);
        });

        it("merges the types seen at a path", () => {
            expect(describePaths('[{"id": 1}, {"id": "two"}]')).toEqual([
                ".: array",
                ".[]: object",
                ".[].id: number | string, e.g. 1",
            ]);
        });

        it("quotes keys that aren't identifiers", () => {
            expect(describePaths('{"my-key": {"a b": true}}')).toEqual([
                ".: object",
                '."my-key": object',
                '."my-key"."a b": boolean, e.g. true',
            ]);
        });

        it("shortens long examples", () => {
            const [, text] = JsonPaths.list(
                JSON.stringify({ text: "x".repeat(100) })
            );

            expect(text!.example).toBe(`"${"x".repeat(38)}…`);
        });

        it("reads newline-delimited JSON as values at the root", () => {
            expect(describePaths('{"a": 1}\n{"a": 2, "b": "x"}\n')).toEqual([
                ".: object",
                ".a: number, e.g. 1",
                '.b: string, e.g. "x"',
            ]);
        });

        it("rejects input that isn't JSON", () => {
            expect(() => JsonPaths.list("not json")).toThrow(JsonPathsError);
        });
    });
});
