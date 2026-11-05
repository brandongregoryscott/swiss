import { Args, Flags } from "@oclif/core";
import { isString, max } from "lodash-es";
import type { JwtStatus } from "../../shared/jwt.js";
import type { Style } from "../../shared/text.js";
import { SwissCommand } from "../../shared/command.js";
import { Dates } from "../../shared/dates/dates.js";
import { DATE_FLAGS } from "../../shared/dates/flags.js";
import { Input } from "../../shared/input.js";
import { Jwt } from "../../shared/jwt.js";

const STATUS_STYLES: Record<JwtStatus["status"], Style> = {
    expired: "red",
    "not-yet-valid": "yellow",
    valid: "green",
};

export default class JwtCommand extends SwissCommand {
    static override args = {
        token: Args.string({
            description:
                "The JWT, optionally with a Bearer or Authorization: Bearer prefix [default: stdin if piped, otherwise the clipboard]",
            // Input.read handles stdin, as raw bytes rather than oclif\'s trimmed string.
            ignoreStdin: true,
        }),
    };

    static override description = `Decode a JWT and show its header, payload, time claims, and whether it's expired.

The time claims (iat, nbf, exp and auth_time) are shown in the local time zone, or --tz, and relative to now. The status says whether the token is expired, not valid yet, or valid.

The token is read from the argument, from stdin when it's piped in, or otherwise from the clipboard, so running it on its own decodes a token you just copied. A Bearer or Authorization: Bearer prefix is ignored.

The signature is not verified, so don't trust the claims for anything that matters.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Decode the token on the clipboard",
        },
        "<%= config.bin %> <%= command.id %> eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2ln",
        {
            command:
                "pbpaste | <%= config.bin %> <%= command.id %> --json | jq .payload",
            description: "Print just the payload as JSON",
        },
    ];

    static override flags = {
        json: Flags.boolean({
            description:
                "Print the header and payload as JSON, for piping to jq",
        }),
        tz: DATE_FLAGS.tz,
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(JwtCommand);
        const { source, value: decoded } = await Input.parse(
            { arg: args.token, kind: "a JWT", noun: "a token" },
            (text) => Jwt.decode(text)
        );

        if (flags.json) {
            this.log(
                JSON.stringify(
                    { header: decoded.header, payload: decoded.payload },
                    null,
                    2
                )
            );
            return;
        }

        const timeZone = Dates.timeZone(flags.tz);
        const options = { now: new Date(), timeZone };

        if (source === "clipboard") {
            this.log(this.style("dim", "Read from the clipboard\n"));
        }
        this.log(this.style("bold", "header"));
        this.log(JSON.stringify(decoded.header, null, 2));
        this.log(this.style("bold", "\npayload"));
        this.log(JSON.stringify(decoded.payload, null, 2));

        const status = Jwt.status(decoded.payload, options.now);
        const alg = isString(decoded.header.alg)
            ? decoded.header.alg
            : "unknown alg";
        const rows: Array<[string, string]> = [
            ...Jwt.timeClaims(decoded.payload).map(
                ({ date, name }): [string, string] => [
                    name,
                    `${Dates.format(date, "iso-local", options)}  ${this.style("dim", Dates.format(date, "relative", options))}`,
                ]
            ),
            [
                "status",
                this.style(
                    STATUS_STYLES[status.status],
                    Jwt.formatStatus(status, options)
                ),
            ],
            [
                "signature",
                decoded.signature === ""
                    ? this.style("yellow", "none, the token is unsecured")
                    : `${alg}, not verified`,
            ],
        ];
        const width = max(rows.map(([name]) => name.length)) ?? 0;
        this.log("");
        for (const [name, value] of rows) {
            this.log(`${name.padEnd(width)}  ${value}`);
        }
    }
}
