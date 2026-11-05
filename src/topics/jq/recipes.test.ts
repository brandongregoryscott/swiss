import { describe, expect, it } from "vitest";
import { Jq } from "./jq.js";
import { JqRecipeError, JqRecipes } from "./recipes.js";

const orders = JSON.stringify({
    orders: [
        { customer: { name: "Ada" }, id: 1, status: "shipped", total: 40 },
        { customer: { name: "Grace" }, id: 2, status: "pending", total: 10 },
        { customer: { name: "Ada" }, id: 3, status: "shipped", total: 25.5 },
    ],
});

async function run(filter: string, raw = false): Promise<unknown> {
    const output = await Jq.run(orders, filter, { compact: true, raw });
    return raw ? output : JSON.parse(output);
}

describe("JqRecipes", () => {
    describe("pluck", () => {
        it("picks one field's values", async () => {
            const filter = JqRecipes.pluck(".orders", ["customer.name"]);

            expect(filter).toBe(".orders | map(.customer.name)");
            expect(await run(filter)).toEqual(["Ada", "Grace", "Ada"]);
        });

        it("keys several fields by their last name", async () => {
            const filter = JqRecipes.pluck(".orders", ["id", "customer.name"]);

            expect(filter).toBe(
                ".orders | map({id: .id, name: .customer.name})"
            );
            expect(await run(filter)).toEqual([
                { id: 1, name: "Ada" },
                { id: 2, name: "Grace" },
                { id: 3, name: "Ada" },
            ]);
        });

        it("keys fields by their whole path when their last names clash", () => {
            expect(JqRecipes.pluck(".", ["a.name", "b.name"])).toBe(
                'map({"a.name": .a.name, "b.name": .b.name})'
            );
        });

        it("quotes names that aren't identifiers", () => {
            expect(JqRecipes.pluck("items", ["my-key", "x"])).toBe(
                '.items | map({"my-key": ."my-key", x: .x})'
            );
        });

        it("uses jq paths as they are", () => {
            expect(JqRecipes.pluck(".", [".items[0].sku", "id"])).toBe(
                "map({sku: .items[0].sku, id: .id})"
            );
        });
    });

    describe("where", () => {
        it("keeps the matching elements", async () => {
            const filter = JqRecipes.where(".orders", ".total > 20");

            expect(filter).toBe(".orders | map(select(.total > 20))");
            expect(await run(`${filter} | map(.id)`)).toEqual([1, 3]);
        });
    });

    describe("countBy", () => {
        it("counts by a field, most common first", async () => {
            const filter = JqRecipes.countBy(".orders", "status");

            expect(await run(filter)).toEqual([
                { count: 2, status: "shipped" },
                { count: 1, status: "pending" },
            ]);
        });

        it("names the key after a nested field's last name", async () => {
            expect(
                await run(JqRecipes.countBy(".orders", "customer.name"))
            ).toEqual([
                { count: 2, name: "Ada" },
                { count: 1, name: "Grace" },
            ]);
        });
    });

    describe("sum", () => {
        it("adds up a field", async () => {
            expect(await run(JqRecipes.sum(".orders", "total"))).toBe(75.5);
        });
    });

    describe("uniq", () => {
        it("lists distinct values, sorted", async () => {
            expect(
                await run(JqRecipes.uniq(".orders", "customer.name"))
            ).toEqual(["Ada", "Grace"]);
        });
    });

    describe("sort", () => {
        it("sorts by a field", async () => {
            expect(
                await run(`${JqRecipes.sort(".orders", "total")} | map(.id)`)
            ).toEqual([2, 3, 1]);
        });

        it("sorts from largest to smallest with descending", async () => {
            expect(
                await run(
                    `${JqRecipes.sort(".orders", "total", true)} | map(.id)`
                )
            ).toEqual([1, 3, 2]);
        });
    });

    describe("csv", () => {
        it("makes a row per element", async () => {
            const filter = JqRecipes.csv(".orders", ["id", "customer.name"]);

            expect(filter).toBe(".orders[] | [.id, .customer.name] | @csv");
            expect(await run(filter, true)).toBe('1,"Ada"\n2,"Grace"\n3,"Ada"');
        });

        it("starts with a header row with header", async () => {
            const filter = JqRecipes.csv(".orders", ["id", "customer.name"], {
                header: true,
            });

            expect(await run(filter, true)).toBe(
                '"id","customer.name"\n1,"Ada"\n2,"Grace"\n3,"Ada"'
            );
        });

        it("separates with tabs with tsv", async () => {
            const filter = JqRecipes.csv(".", ["id", "status"], { tsv: true });

            expect(filter).toBe(".[] | [.id, .status] | @tsv");
        });
    });

    describe("parseFields", () => {
        it("splits on commas and drops blanks", () => {
            expect(JqRecipes.parseFields("id, customer.name,,")).toEqual([
                "id",
                "customer.name",
            ]);
        });

        it("rejects an empty list", () => {
            expect(() => JqRecipes.parseFields(" , ")).toThrow(JqRecipeError);
        });
    });
});
