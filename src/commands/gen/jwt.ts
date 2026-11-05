import { faker } from "@faker-js/faker";
import { Flags } from "@oclif/core";
import { fromPairs } from "lodash-es";
import { styleText } from "node:util";
import { Dates } from "../../shared/dates/dates.js";
import { Jwt } from "../../shared/jwt.js";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenJwt extends GenCommand {
    static override description = `Generate signed JWTs for testing.

The payload has a random sub, name and email, an iat of now and an exp of an hour from now. --claim adds to or overrides them, and its value is parsed as JSON when it can be, like 42 or '["admin"]'.

Tokens are signed with an HMAC secret. Without --secret, a random one is generated and printed to stderr, so a server can verify the token.

To read a token back, use \`<%= config.bin %> jwt\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command:
                '<%= config.bin %> <%= command.id %> -s my-secret -C role=admin -C \'scopes=["read","write"]\'',
            description: "Sign a token with your secret and extra claims",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --exp -5m",
            description: "Generate a token that expired 5 minutes ago",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --no-exp",
            description: "Generate a token that never expires",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        alg: Flags.option({
            default: "HS256" as const,
            description: "Signing algorithm",
            options: Jwt.ALGORITHMS,
        })(),
        claim: Flags.string({
            char: "C",
            description: "Claim to add or override, as key=value",
            multiple: true,
        }),
        exp: Flags.string({
            char: "e",
            default: "1h",
            description:
                "When the token expires, from now, like 30m, 7d or -5m for one that's already expired",
        }),
        "no-exp": Flags.boolean({
            description: "Leave the exp claim out, so the token never expires",
            exclusive: ["exp"],
        }),
        secret: Flags.string({
            char: "s",
            description: "HMAC secret to sign with [default: random]",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenJwt);
        const now = new Date();
        // Checked before the secret is printed, so a typo doesn't print one.
        const claims = fromPairs(
            (flags.claim ?? []).map((claim) => Jwt.parseClaim(claim))
        );
        const exp = flags["no-exp"]
            ? undefined
            : Dates.addDuration(
                  now,
                  Dates.parseDuration(flags.exp),
                  Dates.timeZone()
              );

        const secret = flags.secret ?? Generators.secret(32, "hex");
        if (flags.secret == null) {
            this.logToStderr(
                `${styleText("dim", "secret:", { stream: process.stderr })} ${secret}`
            );
        }

        await this.generate(() => {
            const payload = {
                email: faker.internet.email().toLowerCase(),
                exp: exp == null ? undefined : Math.floor(exp.getTime() / 1000),
                iat: Math.floor(now.getTime() / 1000),
                name: faker.person.fullName(),
                sub: faker.string.uuid(),
                ...claims,
            };
            return Jwt.sign(payload, secret, flags.alg);
        }, flags);
    }
}
