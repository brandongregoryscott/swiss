import { Args, Flags } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { Input } from "../../shared/input.js";
import { Base64 } from "../../topics/base64/base64.js";

export default class Base64Encode extends SwissCommand {
    static override args = {
        input: Args.string({
            description:
                "Text to encode [default: stdin if piped, otherwise the clipboard]",
            // Input.read handles stdin, as raw bytes rather than oclif\'s trimmed string.
            ignoreStdin: true,
        }),
    };

    static override description = `Base64-encode text or a file.

The input is read from the argument, from stdin when it's piped in, or otherwise from the clipboard. Piped input is encoded byte for byte, including any trailing newline (echo adds one; printf doesn't), so files and binary data work too.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> 'hello world'",
        {
            command: "<%= config.bin %> <%= command.id %> --url --copy",
            description:
                "URL-safe encode what's on the clipboard, and copy the result",
        },
        {
            command: "<%= config.bin %> <%= command.id %> < image.png",
            description: "Encode a file",
        },
    ];

    static override flags = {
        copy: Flags.boolean({
            char: "c",
            description: "Also copy the result to the clipboard",
        }),
        url: Flags.boolean({
            char: "u",
            description:
                "Use the URL-safe alphabet (- and _ instead of + and /) without padding",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Base64Encode);

        const { data } = await Input.read({
            arg: args.input,
            noun: "text to encode",
        });

        const encoded = Base64.encode(data, { url: flags.url });
        this.log(encoded);

        if (flags.copy) {
            await this.copy(encoded);
        }
    }
}
