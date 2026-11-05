import { describe, expect, it } from "vitest";
import { EnvError, EnvFile } from "./env-files.js";

describe("EnvFile", () => {
    describe("parse", () => {
        it("reads values the way dotenv does", () => {
            const doc = EnvFile.parse(
                [
                    "# comment",
                    "PLAIN=hello",
                    "SPACED = padded  ",
                    "COMMENTED=value # note",
                    "export EXPORTED=yes",
                    "SINGLE='a # b'",
                    String.raw`DOUBLE="line1\nline2"`,
                    'BACKTICK=`it\'s "quoted"`',
                    "EMPTY=",
                    "",
                ].join("\n")
            );

            expect(Object.fromEntries(EnvFile.entries(doc))).toEqual({
                BACKTICK: `it's "quoted"`,
                COMMENTED: "value",
                DOUBLE: "line1\nline2",
                EMPTY: "",
                EXPORTED: "yes",
                PLAIN: "hello",
                SINGLE: "a # b",
                SPACED: "padded",
            });
        });

        it("reads quoted values that span several lines", () => {
            const doc = EnvFile.parse(
                'KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1\n'
            );

            expect(Object.fromEntries(EnvFile.entries(doc))).toEqual({
                KEY: "-----BEGIN-----\nabc\n-----END-----",
                NEXT: "1",
            });
        });

        it("lets later entries win", () => {
            const doc = EnvFile.parse("KEY=first\nKEY=second\n");

            expect(EnvFile.entries(doc).get("KEY")).toBe("second");
        });

        it.each([
            ["a trailing newline", "A=1\n# c\n\nB=2\n"],
            ["no trailing newline", "A=1\nB=2"],
            ["CRLF line endings", "A=1\r\nB='x\r\ny'\r\n"],
            ["an empty file", ""],
        ])("round-trips a file with %s", (_, text) => {
            expect(EnvFile.serialize(EnvFile.parse(text))).toBe(text);
        });
    });

    describe("set", () => {
        it("changes the value in place, keeping export, spacing and comments", () => {
            const doc = EnvFile.parse(
                "# db\nexport URL = old # primary\nPORT=3000\n"
            );

            expect(
                EnvFile.serialize(EnvFile.set(doc, "URL", "postgres://new"))
            ).toBe("# db\nexport URL = postgres://new # primary\nPORT=3000\n");
        });

        it("keeps the quotes a value had when they can still hold it", () => {
            const doc = EnvFile.parse(`A="old"\nB='old'\n`);

            expect(
                EnvFile.serialize(
                    EnvFile.set(EnvFile.set(doc, "A", "new"), "B", "it's")
                )
            ).toBe(`A="new"\nB="it's"\n`);
        });

        it("adds new variables at the end", () => {
            const doc = EnvFile.parse("A=1");

            expect(EnvFile.serialize(EnvFile.set(doc, "B", "2"))).toBe(
                "A=1\nB=2\n"
            );
        });

        it("changes every entry for a duplicated key", () => {
            const doc = EnvFile.parse("KEY=1\nKEY=2\n");

            expect(EnvFile.serialize(EnvFile.set(doc, "KEY", "3"))).toBe(
                "KEY=3\nKEY=3\n"
            );
        });

        it("replaces a multi-line value", () => {
            const doc = EnvFile.parse('KEY="a\nb"\nNEXT=1\n');

            expect(EnvFile.serialize(EnvFile.set(doc, "KEY", "c"))).toBe(
                "KEY=c\nNEXT=1\n"
            );
        });

        it.each([
            ["simple", "abc-123/x:y@z"],
            ["spaces and a hash", "a # b"],
            ["a single quote", "it's"],
            ["a newline", "line1\nline2"],
            ["a single quote and a newline", "it's\nok"],
            ["quotes, a newline and a backslash-n", `it's "x"\n\\n`],
            ["nothing", ""],
        ])("quotes values with %s so they read back the same", (_, value) => {
            const written = EnvFile.serialize(
                EnvFile.set(EnvFile.parse(""), "KEY", value)
            );

            expect(EnvFile.entries(EnvFile.parse(written)).get("KEY")).toBe(
                value
            );
        });

        it("refuses values that can't be written", () => {
            expect(() =>
                EnvFile.set(EnvFile.parse(""), "KEY", "'\"`\n")
            ).toThrow(EnvError);
        });

        it("refuses invalid names", () => {
            expect(() => EnvFile.set(EnvFile.parse(""), "1KEY", "x")).toThrow(
                EnvError
            );
        });
    });

    describe("values ending in a backslash", () => {
        it.each([
            ["was double-quoted", 'A="x y"\nB=2\n', "a b\\"],
            ["was bare", "A=x\nB=2\n", "a b\\"],
            ["has no spaces", 'A="x y"\nB=2\n', "C:\\"],
        ])("reads back the same when the old value %s", (_, text, value) => {
            const doc = EnvFile.set(EnvFile.parse(text), "A", value);

            const reread = EnvFile.entries(
                EnvFile.parse(EnvFile.serialize(doc))
            );

            expect(reread.get("A")).toBe(value);
            expect(reread.get("B")).toBe("2");
        });
    });

    describe("unset", () => {
        it("removes every entry for the key and nothing else", () => {
            const doc = EnvFile.parse("A=1\n# keep\nB='x\ny'\nA=2\n");

            expect(EnvFile.serialize(EnvFile.unset(doc, "A"))).toBe(
                "# keep\nB='x\ny'\n"
            );
        });
    });

    describe("lineOf", () => {
        it("finds the last line that sets a key, counting quoted values that span lines", () => {
            const doc = EnvFile.parse(
                'A=1\nKEY="-----BEGIN\nabc\n-----END"\n\nB=2\nA=3\n'
            );

            expect(EnvFile.lineOf(doc, "B")).toBe(6);
            expect(EnvFile.lineOf(doc, "A")).toBe(7);
            expect(EnvFile.lineOf(doc, "KEY")).toBe(2);
            expect(EnvFile.lineOf(doc, "MISSING")).toBeNull();
        });
    });

    describe("rename", () => {
        it("keeps the value and position", () => {
            const doc = EnvFile.parse("A=1\nOLD=keep # c\nB=2\n");

            expect(EnvFile.serialize(EnvFile.rename(doc, "OLD", "NEW"))).toBe(
                "A=1\nNEW=keep # c\nB=2\n"
            );
        });
    });

    describe("parseAssignment", () => {
        it("splits on the first =", () => {
            expect(EnvFile.parseAssignment("URL=a=b")).toEqual({
                key: "URL",
                value: "a=b",
            });
            expect(EnvFile.parseAssignment("EMPTY=")).toEqual({
                key: "EMPTY",
                value: "",
            });
        });

        it("has no value for a bare key", () => {
            expect(EnvFile.parseAssignment("SECRET")).toEqual({
                key: "SECRET",
                value: null,
            });
        });

        it.each(["=value", "1KEY=x", "MY KEY=x"])("rejects %j", (input) => {
            expect(() => EnvFile.parseAssignment(input)).toThrow(EnvError);
        });
    });

    describe("formatValue", () => {
        it("hides values unless revealed", () => {
            expect(EnvFile.formatValue("secret", false)).toBe("••••••••");
            expect(EnvFile.formatValue("a\nb", true)).toBe(String.raw`a\nb`);
            expect(EnvFile.formatValue("", false)).toBe("(empty)");
        });
    });
});
