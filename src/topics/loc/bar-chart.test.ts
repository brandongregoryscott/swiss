import { describe, expect, it } from "vitest";
import { BarChart } from "./bar-chart.js";

describe("BarChart", () => {
    it("scales to the max and ends with a partial block", () => {
        expect(BarChart.bar(10, 10, 4)).toBe("████");
        expect(BarChart.bar(5, 10, 3)).toBe("█▌");
        expect(BarChart.bar(0, 10, 4)).toBe("");
    });
});
