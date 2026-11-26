import { describe, expect, it } from "vitest";
import { SshForward } from "./forward.js";

describe("SshForward", () => {
    describe("parsePorts", () => {
        it("forwards a single port to the same port", () => {
            const result = SshForward.parsePorts(["3000"]);

            expect(result).toEqual([{ here: 3000, there: 3000 }]);
        });

        it("expands ranges and comma lists", () => {
            const result = SshForward.parsePorts(["3100-3102,5432", "8080"]);

            expect(result.map(({ here }) => here)).toEqual([
                3100, 3101, 3102, 5432, 8080,
            ]);
        });

        it("maps a port here to a different port there", () => {
            const result = SshForward.parsePorts(["8080:80"]);

            expect(result).toEqual([{ here: 8080, there: 80 }]);
        });

        it("rejects specs that aren't ports", () => {
            const testCases = ["abc", "0", "70000", "3005-3000", "1-2:3", ""];

            for (const spec of testCases) {
                expect(() => SshForward.parsePorts([spec]), spec).toThrow();
            }
        });

        it("rejects the same port here twice", () => {
            const act = () => SshForward.parsePorts(["3000-3002", "3001:80"]);

            expect(act).toThrow("Port 3001 is given more than once");
        });
    });

    describe("args", () => {
        it("builds local forwards that don't open a shell", () => {
            const result = SshForward.args({
                forwards: [
                    { here: 3100, there: 3100 },
                    { here: 8080, there: 80 },
                ],
                host: "work",
                reverse: false,
                shell: false,
                target: "localhost",
            });

            expect(result).toEqual([
                "-N",
                "-o",
                "ExitOnForwardFailure=yes",
                "-L",
                "3100:localhost:3100",
                "-L",
                "8080:localhost:80",
                "work",
            ]);
        });

        it("builds reverse forwards with the remote port first, keeping a shell", () => {
            const result = SshForward.args({
                forwards: [{ here: 3000, there: 9000 }],
                host: "work",
                reverse: true,
                shell: true,
                target: "localhost",
            });

            expect(result).toEqual([
                "-o",
                "ExitOnForwardFailure=yes",
                "-R",
                "9000:localhost:3000",
                "work",
            ]);
        });
    });
});
