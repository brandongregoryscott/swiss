import { faker } from "@faker-js/faker";
import { sortBy } from "lodash-es";
import { describe, expect, it } from "vitest";
import { Fake, FakeError } from "./fake.js";

describe("Fake", () => {
    describe("call", () => {
        it("calls the method, repeatably with a seed", () => {
            faker.seed(1);
            const email = Fake.call("internet.email");
            faker.seed(1);

            expect(email).toContain("@");
            expect(Fake.call("internet.email")).toBe(email);
        });

        it("parses arguments as JSON, falling back to strings", () => {
            expect(Fake.call("number.int", ['{"max":0}'])).toBe("0");
            expect(Fake.call("string.alpha", ["5"])).toMatch(/^[a-zA-Z]{5}$/);
            expect(Fake.call("helpers.fromRegExp", ["AKIA[0-9]{4}"])).toMatch(
                /^AKIA\d{4}$/
            );
        });

        it("formats dates as ISO 8601 and objects as JSON", () => {
            expect(Fake.call("date.past")).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
            expect(
                JSON.parse(Fake.call("location.nearbyGPSCoordinate"))
            ).toHaveLength(2);
        });

        it.each([
            ["nope.thing", "faker has no nope module"],
            ["person", "Name a method of person"],
            ["person.fullName.extra", "Name a method of person"],
            ["person.nope", "faker's person module has no nope method"],
        ])("rejects %s", (path, message) => {
            expect(() => Fake.call(path)).toThrow(FakeError);
            expect(() => Fake.call(path)).toThrow(message);
        });
    });

    describe("modules", () => {
        it("lists modules with their methods, leaving out internals", () => {
            const modules = Fake.modules();
            const names = modules.map(({ name }) => name);

            expect(names).toContain("person");
            expect(names).not.toContain("fakerCore");
            expect(names).toEqual(sortBy(names));
            expect(
                modules.find(({ name }) => name === "person")?.methods
            ).toContain("fullName");
        });
    });
});
