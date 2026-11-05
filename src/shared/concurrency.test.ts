import { afterEach, describe, expect, it } from "vitest";
import { Concurrency } from "./concurrency.js";

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
};
process.on("unhandledRejection", onUnhandled);

afterEach(() => {
    unhandled.length = 0;
});

describe("Concurrency", () => {
    describe("map", () => {
        it("runs at most limit at a time", async () => {
            let running = 0;
            let most = 0;
            await Promise.all(
                Concurrency.map([1, 2, 3, 4, 5], 2, async () => {
                    running++;
                    most = Math.max(most, running);
                    await tick(5);
                    running--;
                })
            );

            expect(most).toBe(2);
        });

        it("doesn't leave a failure unhandled while earlier items are still awaited", async () => {
            const pending = Concurrency.map([30, 0], 2, async (wait) => {
                await tick(wait);
                if (wait === 0) {
                    throw new TypeError("x is undefined");
                }
                return wait;
            });

            expect(await pending[0]).toBe(30);
            await expect(pending[1]).rejects.toThrow(TypeError);
            expect(unhandled).toEqual([]);
        });
    });

    describe("inOrder", () => {
        it("reports each result in order as soon as the ones before it are done", async () => {
            const reported: string[] = [];
            const results = await Concurrency.inOrder(
                [20, 0, 10],
                3,
                async (wait) => {
                    await tick(wait);
                    reported.push(`done ${wait}`);
                    return wait * 2;
                },
                (result, item, index) => {
                    reported.push(`report ${index}: ${item} → ${result}`);
                }
            );

            expect(results).toEqual([40, 0, 20]);
            expect(reported).toEqual([
                "done 0",
                "done 10",
                "done 20",
                "report 0: 20 → 40",
                "report 1: 0 → 0",
                "report 2: 10 → 20",
            ]);
        });

        it("stops reporting at a bug and passes it on", async () => {
            const reported: number[] = [];

            await expect(
                Concurrency.inOrder(
                    [1, 2, 3],
                    3,
                    async (item) => {
                        if (item === 2) {
                            throw new TypeError("x is undefined");
                        }
                        return item;
                    },
                    (result) => reported.push(result)
                )
            ).rejects.toThrow(TypeError);
            expect(reported).toEqual([1]);
            expect(unhandled).toEqual([]);
        });
    });
});

function tick(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
