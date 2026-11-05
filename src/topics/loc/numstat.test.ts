import { describe, expect, it } from "vitest";
import { Numstat } from "./numstat.js";

describe("Numstat", () => {
    describe("parse", () => {
        it("sums text file changes and skips binary files", () => {
            const output = [
                "\x1eaaa\x1fAda\0\n3\t1\tsrc/a.ts\0-\t-\tlogo.png\0",
                "\x1ebbb\x1fGrace\0",
            ].join("\0");

            expect(Numstat.parse(output)).toEqual([
                {
                    added: 3,
                    fields: ["Ada"],
                    files: [
                        { added: 3, path: "src/a.ts", removed: 1 },
                        { added: null, path: "logo.png", removed: null },
                    ],
                    removed: 1,
                    sha: "aaa",
                },
                {
                    added: 0,
                    fields: ["Grace"],
                    files: [],
                    removed: 0,
                    sha: "bbb",
                },
            ]);
        });
    });
});
