import { describe, expect, it } from "vitest";
import { Base64, Base64Error } from "./base64.js";

describe("Base64", () => {
    describe("encode", () => {
        it("uses the standard alphabet with padding", () => {
            expect(Base64.encode(Buffer.from("???>>>"))).toBe("Pz8/Pj4+");
            expect(Base64.encode(Buffer.from("hi"))).toBe("aGk=");
        });

        it("uses the URL-safe alphabet without padding with url", () => {
            expect(Base64.encode(Buffer.from("???>>>"), { url: true })).toBe(
                "Pz8_Pj4-"
            );
            expect(Base64.encode(Buffer.from("hi"), { url: true })).toBe("aGk");
        });
    });

    describe("decode", () => {
        it.each([
            ["standard", "Pz8/Pj4+"],
            ["URL-safe", "Pz8_Pj4-"],
        ])("accepts the %s alphabet", (_, input) => {
            expect(Base64.decode(input).toString()).toBe("???>>>");
        });

        it("accepts missing padding and ignores whitespace", () => {
            expect(Base64.decode("aGVsbG8gd29ybGQ").toString()).toBe(
                "hello world"
            );
            expect(
                Base64.decode(" aGVs\nbG8g\r\nd29y\tbGQ=\n").toString()
            ).toBe("hello world");
        });

        it("round-trips binary data", () => {
            const data = Buffer.from([0, 255, 1, 254, 128, 127]);

            expect(Base64.decode(Base64.encode(data))).toEqual(data);
            expect(Base64.decode(Base64.encode(data, { url: true }))).toEqual(
                data
            );
        });

        it.each([
            ["aGVs*bG8=", '"*" at position 5 isn\'t a base64 character'],
            ["aGV=sbG8", "Padding (=) can only appear at the end"],
            ["aGVsbG8===", "Padding (=) can only appear at the end"],
            ["aGVsb", "The length is off by one character"],
        ])("rejects %s", (input, message) => {
            expect(() => Base64.decode(input)).toThrow(Base64Error);
            expect(() => Base64.decode(input)).toThrow(message);
        });
    });

    describe("isText", () => {
        it("accepts UTF-8 text with tabs and newlines", () => {
            expect(Base64.isText(Buffer.from("héllo\tworld\r\n🎉"))).toBe(true);
            expect(Base64.isText(Buffer.alloc(0))).toBe(true);
        });

        it("rejects invalid UTF-8 and control characters", () => {
            expect(Base64.isText(Buffer.from([0xff, 0xfe]))).toBe(false);
            expect(Base64.isText(Buffer.from("a\u0000b"))).toBe(false);
            expect(Base64.isText(Buffer.from("\u001b[31mred"))).toBe(false);
        });
    });
});
