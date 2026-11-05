import { isNumber, isPlainObject } from "lodash-es";
import { createHmac } from "node:crypto";
import type { DateOptions } from "./dates/dates.js";
import { Dates } from "./dates/dates.js";
import { UserError } from "./errors.js";

type JwtObject = Record<string, unknown>;

type DecodedJwt = {
    header: JwtObject;
    payload: JwtObject;
    // Empty for an unsecured token (alg "none").
    signature: string;
};

type JwtAlgorithm = (typeof JWT_ALGORITHMS)[number];

type TimeClaim = {
    date: Date;
    name: string;
};

type JwtStatus =
    | { at: Date; status: "expired" }
    | { at: Date; status: "not-yet-valid" }
    | { at: Date | null; status: "valid" };

class JwtError extends UserError {}

// The HMAC algorithms, which sign with a shared secret.
const JWT_ALGORITHMS = ["HS256", "HS384", "HS512"] as const;

// Registered and common claims that hold a NumericDate: seconds since the epoch.
const TIME_CLAIMS = ["iat", "nbf", "exp", "auth_time"];

class Jwt {
    static readonly ALGORITHMS = JWT_ALGORITHMS;

    static decode(input: string): DecodedJwt {
        const token = normalize(input);
        const parts = token.split(".");
        if (parts.length === 5) {
            throw new JwtError(
                "This is an encrypted JWT (JWE), which can't be read without the key"
            );
        }
        if (parts.length !== 3) {
            throw new JwtError(
                `A JWT has 3 parts separated by dots, but this has ${parts.length}`
            );
        }

        const [header = "", payload = "", signature = ""] = parts;
        return {
            header: decodePart(header, "header"),
            payload: decodePart(payload, "payload"),
            signature,
        };
    }

    static formatStatus(status: JwtStatus, options: DateOptions): string {
        const relative = (date: Date) =>
            Dates.format(date, "relative", options);
        switch (status.status) {
            case "expired": {
                return `expired ${relative(status.at)}`;
            }

            case "not-yet-valid": {
                return `not valid yet, becomes valid ${relative(status.at)}`;
            }

            case "valid": {
                return status.at == null
                    ? "valid, never expires"
                    : `valid, expires ${relative(status.at)}`;
            }
        }
    }

    // A key=value claim, with the value parsed as JSON when it can be, like 42 or ["admin"], and
    // kept as a string otherwise.
    static parseClaim(claim: string): [string, unknown] {
        const separator = claim.indexOf("=");
        if (separator <= 0) {
            throw new JwtError(
                `${claim} isn't a claim; use key=value, like role=admin`
            );
        }
        const value = claim.slice(separator + 1);
        try {
            return [claim.slice(0, separator), JSON.parse(value)];
        } catch {
            return [claim.slice(0, separator), value];
        }
    }

    static sign(
        payload: JwtObject,
        secret: string,
        algorithm: JwtAlgorithm
    ): string {
        const encode = (part: JwtObject) =>
            Buffer.from(JSON.stringify(part)).toString("base64url");
        const unsigned = `${encode({ alg: algorithm, typ: "JWT" })}.${encode(payload)}`;
        const signature = createHmac(`sha${algorithm.slice(2)}`, secret)
            .update(unsigned)
            .digest("base64url");
        return `${unsigned}.${signature}`;
    }

    // Whether the token is usable now according to its exp and nbf claims.
    static status(payload: JwtObject, now: Date): JwtStatus {
        const exp = numericDate(payload.exp);
        const nbf = numericDate(payload.nbf);
        if (exp != null && exp <= now) {
            return { at: exp, status: "expired" };
        }
        if (nbf != null && nbf > now) {
            return { at: nbf, status: "not-yet-valid" };
        }
        return { at: exp, status: "valid" };
    }

    // The payload's time claims that hold a number, in the order they're listed.
    static timeClaims(payload: JwtObject): TimeClaim[] {
        return TIME_CLAIMS.flatMap((name) => {
            const date = numericDate(payload[name]);
            return date == null ? [] : [{ date, name }];
        });
    }
}

// Accepts a bare token or one copied with its Authorization header or Bearer prefix.
function normalize(input: string): string {
    return input
        .trim()
        .replace(/^authorization:\s*/i, "")
        .replace(/^bearer\s+/i, "")
        .replace(/^["']|["']$/g, "");
}

function decodePart(part: string, name: string): JwtObject {
    if (!/^[\w-]*$/.test(part)) {
        throw new JwtError(`The ${name} isn't base64url-encoded`);
    }

    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    } catch {
        throw new JwtError(`The ${name} isn't valid JSON once decoded`);
    }
    if (!isPlainObject(value)) {
        throw new JwtError(`The ${name} is JSON but not an object`);
    }
    return value as JwtObject;
}

function numericDate(value: unknown): Date | null {
    if (!isNumber(value) || !Number.isFinite(value)) {
        return null;
    }
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
}

export type { DecodedJwt, JwtAlgorithm, JwtObject, JwtStatus, TimeClaim };
export { Jwt, JwtError };
