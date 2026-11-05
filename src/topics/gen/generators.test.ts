import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { GeneratorError, Generators } from "./generators.js";

describe("Generators", () => {
    describe("password", () => {
        it("has the length and one of each kind of character", () => {
            for (let index = 0; index < 50; index++) {
                const password = Generators.password(8, { symbols: true });

                expect(password).toHaveLength(8);
                expect(password).toMatch(/[a-z]/);
                expect(password).toMatch(/[A-Z]/);
                expect(password).toMatch(/[0-9]/);
                expect(password).toMatch(/[-_.!@#%^*+=~]/);
            }
        });

        it("leaves symbols out without symbols", () => {
            expect(Generators.password(64, { symbols: false })).toMatch(
                /^[a-zA-Z0-9]{64}$/
            );
        });

        it("rejects lengths too short for one of each kind", () => {
            expect(() => Generators.password(3, { symbols: true })).toThrow(
                GeneratorError
            );
            expect(Generators.password(3, { symbols: false })).toHaveLength(3);
        });
    });

    describe("randomSlug", () => {
        it("joins the words with hyphens", () => {
            faker.seed(1);

            expect(Generators.randomSlug(3)).toMatch(
                /^[a-z0-9]+(-[a-z0-9]+){2,}$/
            );
        });
    });

    describe("secret", () => {
        it.each([
            ["hex", 32, /^[0-9a-f]{64}$/],
            ["base64", 3, /^[A-Za-z0-9+/]{4}$/],
            ["base64url", 16, /^[A-Za-z0-9_-]{22}$/],
        ] as const)("encodes as %s", (encoding, bytes, pattern) => {
            expect(Generators.secret(bytes, encoding)).toMatch(pattern);
        });
    });

    describe("slugify", () => {
        it.each([
            ["Hello, World!", "hello-world"],
            ["Café Owner’s Guide", "cafe-owners-guide"],
            ["  --already-a-slug--  ", "already-a-slug"],
            ["v2.0 Release_Notes", "v2-0-release-notes"],
        ])("slugifies %s", (text, slug) => {
            expect(Generators.slugify(text)).toBe(slug);
        });

        it("rejects text without letters or numbers", () => {
            expect(() => Generators.slugify("!!!")).toThrow(GeneratorError);
        });
    });

    describe("uuid", () => {
        it("generates v4 UUIDs", () => {
            expect(Generators.uuid(4)).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
            );
        });

        it("generates v7 UUIDs that start with the current time", () => {
            const uuid = Generators.uuid(7);

            expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
            const millis = parseInt(uuid.replace("-", "").slice(0, 12), 16);
            expect(Math.abs(millis - Date.now())).toBeLessThan(5000);
        });
    });

    describe("hash", () => {
        it("hashes text", () => {
            expect(Generators.hash("sha256", "hello world")).toBe(
                "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
            );
            expect(Generators.hash("md5", "hello world")).toBe(
                "5eb63bbbe01eeed093cb22bb8f5acdc3"
            );
        });

        it.each([
            ["md5", 32],
            ["sha1", 40],
            ["sha256", 64],
            ["sha512", 128],
        ] as const)("generates random %s-length hex", (algorithm, length) => {
            expect(Generators.hash(algorithm)).toMatch(
                new RegExp(`^[0-9a-f]{${length}}$`)
            );
        });
    });

    describe("ip", () => {
        const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

        it("generates IPv4 addresses by default", () => {
            expect(Generators.ip()).toMatch(ipv4);
        });

        it("picks from a private range", () => {
            for (let index = 0; index < 50; index++) {
                expect(Generators.ip({ network: "private" })).toMatch(
                    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/
                );
            }
        });

        it("picks from a CIDR block", () => {
            expect(Generators.ip({ cidr: "10.20.0.0/16" })).toMatch(
                /^10\.20\.\d+\.\d+$/
            );
        });

        it("generates IPv6 addresses", () => {
            expect(Generators.ip({ v6: true })).toMatch(
                /^([0-9a-f]{4}:){7}[0-9a-f]{4}$/
            );
        });

        it.each([
            [{ cidr: "nope" }, "isn't a CIDR block, like"],
            [{ cidr: "10.0.0.0/40" }, "Prefix length must be between"],
            [{ network: "private", v6: true }, "only work for IPv4"],
        ] as const)("rejects %o", (options, message) => {
            expect(() => Generators.ip(options)).toThrow(GeneratorError);
            expect(() => Generators.ip(options)).toThrow(message);
        });
    });

    describe("lorem", () => {
        it("generates the number of each unit", () => {
            expect(Generators.lorem("words", 5).split(" ")).toHaveLength(5);
            expect(
                Generators.lorem("paragraphs", 3).split("\n\n")
            ).toHaveLength(3);
            expect(Generators.lorem("sentences", 2)).not.toContain("\n");
        });
    });

    describe("mac", () => {
        it.each([
            ["colon", /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/],
            ["dash", /^([0-9a-f]{2}-){5}[0-9a-f]{2}$/],
            ["dot", /^([0-9a-f]{4}\.){2}[0-9a-f]{4}$/],
            ["none", /^[0-9a-f]{12}$/],
        ] as const)("formats with %s", (format, pattern) => {
            expect(Generators.mac({ format })).toMatch(pattern);
        });

        it("uses uppercase digits with upper", () => {
            expect(Generators.mac({ format: "none", upper: true })).toMatch(
                /^[0-9A-F]{12}$/
            );
        });

        it("sets the local bit and clears the multicast bit with local", () => {
            for (let index = 0; index < 50; index++) {
                const first = parseInt(
                    Generators.mac({ format: "none", local: true }).slice(0, 2),
                    16
                );

                expect(first & 0b11).toBe(0b10);
            }
        });
    });
});
