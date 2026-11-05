import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Clipboard } from "./clipboard.js";
import { UserError } from "./errors.js";
import { CommandError } from "./exec.js";
import { Input, InputError } from "./input.js";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Input", () => {
    describe("read", () => {
        it("takes the argument, then a file, then stdin, then the clipboard", async () => {
            const dir = mkdtempSync(path.join(tmpdir(), "swiss-input-"));
            const file = path.join(dir, "in.json");
            writeFileSync(file, "{}\n");
            vi.spyOn(Clipboard, "paste").mockResolvedValue("copied\n");
            const piped = vi.spyOn(Input, "isPiped").mockReturnValue(false);
            try {
                expect(await read({ arg: "given", file })).toEqual([
                    "argument",
                    "given",
                ]);
                expect(await read({ file })).toEqual(["file", "{}\n"]);
                expect(await read({})).toEqual(["clipboard", "copied\n"]);

                piped.mockReturnValue(true);
                vi.spyOn(Input, "piped").mockResolvedValue(
                    Buffer.from("piped\n")
                );
                expect(await read({})).toEqual(["stdin", "piped\n"]);
            } finally {
                rmSync(dir, { force: true, recursive: true });
            }
        });

        it("keeps clipboard text exactly, like piped text", async () => {
            vi.spyOn(Input, "isPiped").mockReturnValue(false);
            vi.spyOn(Clipboard, "paste").mockResolvedValue("  two\nlines\n");

            const { data } = await Input.read({ noun: "text" });

            expect(data.toString()).toBe("  two\nlines\n");
        });

        it("explains missing or empty input", async () => {
            const isPiped = vi.spyOn(Input, "isPiped").mockReturnValue(true);
            vi.spyOn(Input, "piped").mockResolvedValue(Buffer.alloc(0));
            const paste = vi.spyOn(Clipboard, "paste").mockResolvedValue(" \n");

            await expect(read({})).rejects.toThrow(
                "Nothing was piped in; pass a token or pipe it in"
            );
            isPiped.mockReturnValue(false);
            await expect(read({})).rejects.toThrow(
                "The clipboard is empty; pass a token or copy it first"
            );
            paste.mockRejectedValue(
                new CommandError("Couldn't read the clipboard; install pbpaste")
            );
            await expect(read({})).rejects.toThrow(
                "Couldn't read the clipboard; install pbpaste; pass a token instead"
            );
            await expect(
                read({ file: "/nonexistent/in.json" })
            ).rejects.toThrow(
                new InputError("/nonexistent/in.json doesn't exist")
            );
        });
    });

    describe("parse", () => {
        const decode = (text: string): string => {
            if (!text.includes(".")) {
                throw new UserError("A JWT has 3 parts separated by dots");
            }
            return text.trim();
        };

        it("says the clipboard doesn't hold what was expected", async () => {
            vi.spyOn(Input, "isPiped").mockReturnValue(false);
            vi.spyOn(Clipboard, "paste").mockResolvedValue("hello");

            await expect(
                Input.parse({ kind: "a JWT", noun: "a token" }, decode)
            ).rejects.toThrow(
                "The clipboard doesn't hold a JWT: A JWT has 3 parts separated by dots"
            );
        });

        it("leaves errors about given input, and bugs, as they are", async () => {
            await expect(
                Input.parse(
                    { arg: "hello", kind: "a JWT", noun: "a token" },
                    decode
                )
            ).rejects.toThrow(
                new UserError("A JWT has 3 parts separated by dots")
            );
            await expect(
                Input.parse(
                    { arg: "a.b.c", kind: "a JWT", noun: "a token" },
                    () => {
                        throw new TypeError("x is undefined");
                    }
                )
            ).rejects.toThrow(TypeError);
            expect(
                await Input.parse(
                    { arg: "a.b.c\n", kind: "a JWT", noun: "a token" },
                    decode
                )
            ).toEqual({ source: "argument", text: "a.b.c\n", value: "a.b.c" });
        });
    });
});

type ReadOptions = {
    arg?: string;
    file?: string;
};

async function read(options: ReadOptions): Promise<[string, string]> {
    const { data, source } = await Input.read({ ...options, noun: "a token" });
    return [source, data.toString()];
}
