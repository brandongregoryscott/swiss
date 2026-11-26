import { describe, expect, it } from "vitest";
import { SshExamples } from "./examples.js";

describe("SshExamples", () => {
    describe("search", () => {
        it("lists every example without a search", () => {
            const result = SshExamples.search(undefined);

            expect(result).toEqual(SshExamples.EXAMPLES);
        });

        it("matches every word in the command or description, in any case", () => {
            const result = SshExamples.search("REVERSE -R");

            expect(result.map(({ command }) => command)).toEqual([
                "ssh -N -R 9000:localhost:3000 host",
            ]);
        });
    });
});
