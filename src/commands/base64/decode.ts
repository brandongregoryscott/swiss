import { Args, Flags } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { Input } from "../../shared/input.js";
import { Base64 } from "../../topics/base64/base64.js";

export default class Base64Decode extends SwissCommand {
    static override args = {
        input: Args.string({
            description:
                "Base64 to decode [default: stdin if piped, otherwise the clipboard]",
            // Input.read handles stdin, as raw bytes rather than oclif\'s trimmed string.
            ignoreStdin: true,
        }),
    };

    static override description = `Decode base64 to text, or to a file.

The input is read from the argument, from stdin when it's piped in, or otherwise from the clipboard. The standard and URL-safe alphabets are both accepted, with or without padding, and whitespace is ignored so line-wrapped base64 works too.

Decoded data that isn't text, like an image, is only written when stdout is redirected, so it doesn't garble the terminal. Redirected output is written byte for byte, with no newline added.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> aGVsbG8gd29ybGQ=",
        {
            command: "<%= config.bin %> <%= command.id %> --copy",
            description: "Decode what's on the clipboard, and copy the result",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> < image.b64 > image.png",
            description: "Decode to a file",
        },
    ];

    static override flags = {
        copy: Flags.boolean({
            char: "c",
            description: "Also copy the result to the clipboard (text only)",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Base64Decode);

        const { value: decoded } = await Input.parse(
            { arg: args.input, kind: "base64", noun: "base64 to decode" },
            (text) => Base64.decode(text)
        );

        const isText = Base64.isText(decoded);
        const toTerminal = this.terminal.stdoutIsTerminal;
        if (!isText && (toTerminal || flags.copy)) {
            this.error(
                `Decoded ${decoded.length} bytes of binary data, which ${flags.copy ? "can't be copied as text" : "would garble the terminal"}; redirect it to a file instead, like > out.bin`
            );
        }

        if (toTerminal) {
            this.log(decoded.toString("utf8").replace(/\n$/, ""));
        } else {
            process.stdout.write(decoded);
        }

        if (flags.copy) {
            await this.copy(decoded.toString("utf8"));
        }
    }
}
