import { UserError } from "../../shared/errors.js";

type EncodeOptions = {
    // Use the URL- and filename-safe alphabet (- and _ instead of + and /) without padding.
    url?: boolean;
};

class Base64Error extends UserError {}

class Base64 {
    // Accepts either alphabet, with or without padding, and ignores whitespace so line-wrapped
    // output from other tools decodes too.
    static decode(input: string): Buffer {
        const compact = input.replace(/\s+/g, "");
        const invalid = /[^A-Za-z0-9+/\-_=]/.exec(compact);
        if (invalid != null) {
            throw new Base64Error(
                `${JSON.stringify(invalid[0])} at position ${invalid.index + 1} isn't a base64 character`
            );
        }
        if (!/^[^=]*={0,2}$/.test(compact)) {
            throw new Base64Error("Padding (=) can only appear at the end");
        }

        const unpadded = compact.replace(/=+$/, "");
        if (unpadded.length % 4 === 1) {
            throw new Base64Error(
                "The length is off by one character, so it may have been cut short"
            );
        }
        return Buffer.from(
            unpadded.replaceAll("-", "+").replaceAll("_", "/"),
            "base64"
        );
    }

    static encode(data: Buffer, options: EncodeOptions = {}): string {
        return data.toString(options.url === true ? "base64url" : "base64");
    }

    // Whether data is valid UTF-8 without control characters other than tabs and newlines, so it's
    // safe to print to a terminal.
    static isText(data: Buffer): boolean {
        let text: string;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(data);
        } catch {
            return false;
        }
        return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
    }
}

export type { EncodeOptions };
export { Base64, Base64Error };
