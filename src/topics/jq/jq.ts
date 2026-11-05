import { raw } from "jq-wasm";
import { UserError } from "../../shared/errors.js";
import { Input } from "../../shared/input.js";
import { JsonPaths } from "./json-paths.js";

class JqError extends UserError {}

type JqOptions = {
    // Print each result on one line (-c).
    compact?: boolean;
    // Print strings without quotes (-r).
    raw?: boolean;
    // Read all the inputs into one array (-s).
    slurp?: boolean;
};

class Jq {
    // Reads JSON text from file when there is one, otherwise from stdin or the clipboard.
    // Clipboard text is checked to be JSON first, so a clipboard read by accident says so rather
    // than showing jq's parse error.
    static async readInput(file: string | undefined): Promise<string> {
        const { text } = await Input.parse(
            { file, kind: "JSON", noun: "a JSON file" },
            (text, source) => {
                if (source === "clipboard") {
                    JsonPaths.parse(text);
                }
            }
        );
        return text;
    }

    // Runs filter over JSON text with the bundled jq, returning its output without a trailing
    // newline.
    static async run(
        input: string,
        filter: string,
        options: JqOptions = {}
    ): Promise<string> {
        const flags = [
            options.raw === true && "-r",
            options.compact === true && "-c",
            options.slurp === true && "-s",
        ].filter((flag) => flag !== false);
        const result = await raw(input, filter, flags);
        if (result.exitCode !== 0) {
            throw new JqError(describeError(result.stderr, result.exitCode));
        }
        return result.stdout;
    }
}

// jq prefixes every message with "jq: ", says where in stdin a runtime error happened (always
// stdin here, even for a file), and adds a count of compile errors, none of which help.
function describeError(stderr: string, exitCode: number): string {
    const message = stderr
        .split("\n")
        .filter((line) => !/^jq: \d+ compile errors?$/.test(line))
        .map((line) =>
            line
                .replace(/^jq: (error: )?/, "")
                .replace(/^error \(at [^)]*\): /, "")
        )
        .join("\n")
        .trim();
    return message === "" ? `jq exited with code ${exitCode}` : message;
}

export type { JqOptions };
export { Jq, JqError };
