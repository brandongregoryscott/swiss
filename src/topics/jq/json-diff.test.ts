import { describe, expect, it } from "vitest";
import { JsonDiff } from "./json-diff.js";

describe("JsonDiff", () => {
    describe("compare", () => {
        it("finds nothing between equal values, ignoring key order", () => {
            expect(
                JsonDiff.compare(
                    { a: 1, b: [1, { c: null }] },
                    JSON.parse('{"b": [1, {"c": null}], "a": 1}')
                )
            ).toEqual([]);
        });

        it("reports added, removed and changed keys by path", () => {
            expect(
                JsonDiff.compare(
                    { name: "Widget", old: true, price: { amount: 5 } },
                    { name: "Widget", price: { amount: 6 }, tags: ["a"] }
                )
            ).toEqual([
                { kind: "removed", path: ".old", value: true },
                { from: 5, kind: "changed", path: ".price.amount", to: 6 },
                { kind: "added", path: ".tags", value: ["a"] },
            ]);
        });

        it("compares arrays by index", () => {
            expect(JsonDiff.compare([1, 2, 3], [1, 5])).toEqual([
                { from: 2, kind: "changed", path: ".[1]", to: 5 },
                { kind: "removed", path: ".[2]", value: 3 },
            ]);
            expect(
                JsonDiff.compare({ items: [] }, { items: [{ id: 1 }] })
            ).toEqual([{ kind: "added", path: ".items[0]", value: { id: 1 } }]);
        });

        it("reports a change of type as one change", () => {
            expect(JsonDiff.compare({ a: { b: 1 } }, { a: [1] })).toEqual([
                { from: { b: 1 }, kind: "changed", path: ".a", to: [1] },
            ]);
        });

        it("reports a changed root as .", () => {
            expect(JsonDiff.compare(1, "1")).toEqual([
                { from: 1, kind: "changed", path: ".", to: "1" },
            ]);
        });

        it("quotes keys that aren't identifiers", () => {
            expect(JsonDiff.compare({ "my-key": 1 }, { "my-key": 2 })).toEqual([
                { from: 1, kind: "changed", path: '."my-key"', to: 2 },
            ]);
        });
    });
});
