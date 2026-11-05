import { isEmpty } from "lodash-es";
import { readFile } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { Clipboard } from "./clipboard.js";
import { UserError } from "./errors.js";
import { CommandError } from "./exec.js";

type InputSource = "argument" | "clipboard" | "file" | "stdin";

type ReadOptions = {
    // Given on the command line.
    arg?: string;
    // A file to read instead of stdin or the clipboard.
    file?: string;
    // What to give, for errors, like "a token" in "pass a token or pipe it in".
    noun: string;
};

type ParseOptions = {
    // What the clipboard should hold, for errors, like "a JWT".
    kind: string;
} & ReadOptions;

type ReadInput = {
    // Exactly as given: nothing is trimmed, so each command decides what whitespace means.
    data: Buffer;
    source: InputSource;
};

type ParsedInput<T> = {
    source: InputSource;
    text: string;
    value: T;
};

class InputError extends UserError {}

// Input a command reads from an argument, a file, stdin or the clipboard.
class Input {
    // The text on the clipboard. noun is what to copy, for errors.
    static async clipboard(noun: string): Promise<Buffer> {
        let text: string;
        try {
            text = await Clipboard.paste();
        } catch (error) {
            if (error instanceof CommandError) {
                throw new InputError(`${error.message}; pass ${noun} instead`);
            }
            throw error;
        }
        if (text.trim() === "") {
            throw new InputError(
                `The clipboard is empty; pass ${noun} or copy it first`
            );
        }
        return Buffer.from(text);
    }

    static async file(file: string): Promise<Buffer> {
        try {
            return await readFile(file);
        } catch (error) {
            throw new InputError(
                (error as NodeJS.ErrnoException).code === "ENOENT"
                    ? `${file} doesn't exist`
                    : `Couldn't read ${file}: ${(error as Error).message}`
            );
        }
    }

    // Whether something is piped into stdin, rather than it being a terminal.
    static isPiped(): boolean {
        return process.stdin.isTTY !== true;
    }

    // Reads input and parses its text, saying the clipboard doesn't hold kind when parse throws a
    // UserError for clipboard input, since leaving out the input to read the clipboard is easy
    // to do by accident.
    static async parse<T>(
        options: ParseOptions,
        parse: (text: string, source: InputSource) => T
    ): Promise<ParsedInput<T>> {
        const { data, source } = await Input.read(options);
        const text = data.toString("utf8");
        try {
            return { source, text, value: parse(text, source) };
        } catch (error) {
            if (source === "clipboard" && error instanceof UserError) {
                throw new InputError(
                    `The clipboard doesn't hold ${options.kind}: ${error.message}`
                );
            }
            throw error;
        }
    }

    // What's piped into stdin, which is empty when nothing was, like with < /dev/null.
    static async piped(): Promise<Buffer> {
        return buffer(process.stdin);
    }

    // The argument or file when there is one, otherwise stdin when something is piped in,
    // otherwise the clipboard.
    static async read(options: ReadOptions): Promise<ReadInput> {
        if (options.arg != null) {
            return { data: Buffer.from(options.arg), source: "argument" };
        }
        if (options.file != null) {
            return { data: await Input.file(options.file), source: "file" };
        }
        if (Input.isPiped()) {
            return { data: await Input.stdin(options.noun), source: "stdin" };
        }
        return {
            data: await Input.clipboard(options.noun),
            source: "clipboard",
        };
    }

    // What's piped into stdin, which has to be something. noun is what to pipe in, for errors.
    static async stdin(noun: string): Promise<Buffer> {
        const data = await Input.piped();
        if (isEmpty(data)) {
            throw new InputError(
                `Nothing was piped in; pass ${noun} or pipe it in`
            );
        }
        return data;
    }
}

export type { InputSource };
export { Input, InputError };
