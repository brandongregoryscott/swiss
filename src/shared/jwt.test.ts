import { describe, expect, it } from "vitest";
import type { DateOptions } from "./dates/dates.js";
import { Jwt, JwtError } from "./jwt.js";

const NOW = new Date("2026-10-24T14:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const UTC: DateOptions = { now: NOW, timeZone: "UTC" };

describe("Jwt", () => {
    describe("decode", () => {
        it("decodes the header and payload", () => {
            const token = encode(
                { alg: "HS256", typ: "JWT" },
                { name: "Zoë", sub: "user_123" },
                "c2ln"
            );

            expect(Jwt.decode(token)).toEqual({
                header: { alg: "HS256", typ: "JWT" },
                payload: { name: "Zoë", sub: "user_123" },
                signature: "c2ln",
            });
        });

        it.each([
            ["a Bearer prefix", (token: string) => `Bearer ${token}`],
            [
                "an Authorization header",
                (token: string) => `Authorization: Bearer ${token}\n`,
            ],
            ["quotes", (token: string) => `"${token}"`],
            ["surrounding whitespace", (token: string) => `  ${token}\n`],
        ])("accepts a token with %s", (_, wrap) => {
            const token = encode({ alg: "HS256" }, { sub: "x" }, "c2ln");

            expect(Jwt.decode(wrap(token)).payload).toEqual({ sub: "x" });
        });

        it("decodes an unsecured token with an empty signature", () => {
            const token = encode({ alg: "none" }, { sub: "x" }, "");

            expect(Jwt.decode(token).signature).toBe("");
        });

        it.each([
            ["a.b.c.d.e", "encrypted JWT (JWE)"],
            ["abc", "3 parts separated by dots, but this has 1"],
            ["a.b", "3 parts separated by dots, but this has 2"],
            ["not!b64.e30.x", "The header isn't base64url-encoded"],
            [`e30.${base64url("{nope")}.x`, "The payload isn't valid JSON"],
            [
                `${base64url("[1]")}.e30.x`,
                "The header is JSON but not an object",
            ],
        ])("rejects %s", (token, message) => {
            expect(() => Jwt.decode(token)).toThrow(JwtError);
            expect(() => Jwt.decode(token)).toThrow(message);
        });
    });

    describe("status", () => {
        it("is expired once exp has passed", () => {
            expect(
                Jwt.status(
                    { exp: NOW_SECONDS - 60, nbf: NOW_SECONDS + 60 },
                    NOW
                )
            ).toEqual({
                at: new Date(NOW.getTime() - 60_000),
                status: "expired",
            });
            expect(Jwt.status({ exp: NOW_SECONDS }, NOW).status).toBe(
                "expired"
            );
        });

        it("is not yet valid before nbf", () => {
            expect(Jwt.status({ nbf: NOW_SECONDS + 60 }, NOW)).toEqual({
                at: new Date(NOW.getTime() + 60_000),
                status: "not-yet-valid",
            });
        });

        it("is valid otherwise, with or without exp", () => {
            expect(Jwt.status({ exp: NOW_SECONDS + 60 }, NOW).status).toBe(
                "valid"
            );
            expect(Jwt.status({ exp: "soon" }, NOW)).toEqual({
                at: null,
                status: "valid",
            });
        });
    });

    describe("formatStatus", () => {
        it("describes each status relative to now", () => {
            const at = (seconds: number) =>
                new Date(NOW.getTime() + seconds * 1000);

            expect(
                Jwt.formatStatus({ at: at(-3 * 3600), status: "expired" }, UTC)
            ).toBe("expired 3h ago");
            expect(
                Jwt.formatStatus({ at: at(600), status: "not-yet-valid" }, UTC)
            ).toBe("not valid yet, becomes valid in 10m");
            expect(
                Jwt.formatStatus({ at: at(90 * 60), status: "valid" }, UTC)
            ).toBe("valid, expires in 1h 30m");
            expect(Jwt.formatStatus({ at: null, status: "valid" }, UTC)).toBe(
                "valid, never expires"
            );
        });
    });

    describe("timeClaims", () => {
        it("lists numeric time claims in a fixed order and skips the rest", () => {
            const claims = Jwt.timeClaims({
                auth_time: NOW_SECONDS - 7200,
                exp: NOW_SECONDS + 3600.5,
                iat: NOW_SECONDS - 3600,
                nbf: "later",
                sub: "x",
            });

            expect(claims).toEqual([
                { date: new Date("2026-10-24T13:00:00.000Z"), name: "iat" },
                { date: new Date("2026-10-24T15:00:00.500Z"), name: "exp" },
                {
                    date: new Date("2026-10-24T12:00:00.000Z"),
                    name: "auth_time",
                },
            ]);
        });
    });
    describe("sign", () => {
        it("matches jwt.io's example token", () => {
            // Parsed so the claims keep jwt.io's order, which the signature covers.
            const payload = JSON.parse(
                '{"sub":"1234567890","name":"John Doe","iat":1516239022}'
            ) as Record<string, unknown>;

            expect(Jwt.sign(payload, "your-256-bit-secret", "HS256")).toBe(
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
            );
        });

        it("names the algorithm in the header", () => {
            const token = Jwt.sign({ sub: "a" }, "secret", "HS512");

            expect(Jwt.decode(token).header).toEqual({
                alg: "HS512",
                typ: "JWT",
            });
            expect(Jwt.decode(token).payload).toEqual({ sub: "a" });
        });
    });

    describe("parseClaim", () => {
        it.each([
            ["role=admin", ["role", "admin"]],
            ["age=42", ["age", 42]],
            ['scopes=["read"]', ["scopes", ["read"]]],
            ["url=https://a.b/?c=d", ["url", "https://a.b/?c=d"]],
            ["empty=", ["empty", ""]],
        ])("parses %s", (claim, expected) => {
            expect(Jwt.parseClaim(claim)).toEqual(expected);
        });

        it.each(["role", "=admin"])("rejects %s", (claim) => {
            expect(() => Jwt.parseClaim(claim)).toThrow(JwtError);
        });
    });
});

function encode(header: object, payload: object, signature: string): string {
    return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}.${signature}`;
}

function base64url(value: string): string {
    return Buffer.from(value).toString("base64url");
}
