import { faker } from "@faker-js/faker";
import { times } from "lodash-es";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { UserError } from "../../shared/errors.js";

type HashAlgorithm = keyof typeof HASH_LENGTHS;

type IpOptions = {
    // A block to pick from, like 10.0.0.0/16.
    cidr?: string;
    network?: IpNetwork;
    v6?: boolean;
};

type IpNetwork = (typeof IP_NETWORKS)[number];

type LoremUnit = (typeof LOREM_UNITS)[number];

type MacFormat = (typeof MAC_FORMATS)[number];

type MacOptions = {
    format: MacFormat;
    // Locally administered and unicast, like the addresses VMs and containers get.
    local?: boolean;
    upper?: boolean;
};

type PasswordOptions = {
    symbols: boolean;
};

type SecretEncoding = (typeof SECRET_ENCODINGS)[number];

type UuidVersion = 4 | 7;

const SECRET_ENCODINGS = ["base64", "base64url", "hex"] as const;

// Hex digits in each algorithm's digest.
const HASH_LENGTHS = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };

// private picks one of the three private ranges.
const IP_NETWORKS = [
    "private",
    "private-a",
    "private-b",
    "private-c",
    "loopback",
    "link-local",
    "multicast",
] as const;

const LOREM_UNITS = ["words", "sentences", "paragraphs"] as const;

// colon is 00:1a:2b:3c:4d:5e, dash 00-1a-2b-3c-4d-5e, dot (Cisco) 001a.2b3c.4d5e.
const MAC_FORMATS = ["colon", "dash", "dot", "none"] as const;

// Symbols that don't need quoting in most shells, .env files or URLs.
const PASSWORD_SYMBOLS = "-_.!@#%^*+=~";

const PASSWORD_CLASSES = [
    "abcdefghijklmnopqrstuvwxyz",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "0123456789",
];

class GeneratorError extends UserError {}

class Generators {
    static readonly HASH_ALGORITHMS = Object.keys(
        HASH_LENGTHS
    ) as HashAlgorithm[];
    static readonly IP_NETWORKS = IP_NETWORKS;
    static readonly LOREM_UNITS = LOREM_UNITS;
    static readonly MAC_FORMATS = MAC_FORMATS;
    static readonly SECRET_ENCODINGS = SECRET_ENCODINGS;

    // The hex digest of text, or random hex the same length as one when there's no text.
    static hash(algorithm: HashAlgorithm, text?: string): string {
        return text == null
            ? faker.string.hexadecimal({
                  casing: "lower",
                  length: HASH_LENGTHS[algorithm],
                  prefix: "",
              })
            : createHash(algorithm).update(text).digest("hex");
    }

    static ip(options: IpOptions = {}): string {
        if (options.v6 === true) {
            if (options.cidr != null || options.network != null) {
                throw new GeneratorError(
                    "Networks and CIDR blocks only work for IPv4 addresses"
                );
            }
            return faker.internet.ipv6();
        }
        if (options.cidr != null) {
            if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(options.cidr)) {
                throw new GeneratorError(
                    `${options.cidr} isn't a CIDR block, like 10.0.0.0/16`
                );
            }
            try {
                return faker.internet.ipv4({ cidrBlock: options.cidr });
            } catch (error) {
                if (error instanceof Error) {
                    throw new GeneratorError(
                        `${options.cidr} isn't a CIDR block: ${error.message}`
                    );
                }
                throw error;
            }
        }
        const network =
            options.network === "private"
                ? faker.helpers.arrayElement([
                      "private-a",
                      "private-b",
                      "private-c",
                  ] as const)
                : options.network;
        return faker.internet.ipv4({ network: network ?? "any" });
    }

    // Words and sentences run on in one line, and paragraphs are separated by blank lines.
    static lorem(unit: LoremUnit, count: number): string {
        switch (unit) {
            case "paragraphs": {
                return faker.lorem.paragraphs(count, "\n\n");
            }

            case "sentences": {
                return faker.lorem.sentences(count, " ");
            }

            case "words": {
                return faker.lorem.words(count);
            }
        }
    }

    static mac(options: MacOptions): string {
        const octets = times(6, () => faker.number.int({ max: 255, min: 0 }));
        if (options.local === true) {
            // Sets the locally administered bit and clears the multicast bit.
            octets[0] = (octets[0]! | 0b10) & ~0b1;
        }
        const hex = octets
            .map((octet) => octet.toString(16).padStart(2, "0"))
            .join("");
        const digits = options.upper === true ? hex.toUpperCase() : hex;
        switch (options.format) {
            case "colon": {
                return digits.match(/../g)!.join(":");
            }

            case "dash": {
                return digits.match(/../g)!.join("-");
            }

            case "dot": {
                return digits.match(/.{4}/g)!.join(".");
            }

            case "none": {
                return digits;
            }
        }
    }

    // Uses crypto rather than faker, so it's safe for real credentials. It has at least one
    // character of each class, regenerating rather than patching one in so the odds stay even.
    static password(length: number, options: PasswordOptions): string {
        const classes = options.symbols
            ? [...PASSWORD_CLASSES, PASSWORD_SYMBOLS]
            : PASSWORD_CLASSES;
        if (length < classes.length) {
            throw new GeneratorError(
                `Passwords need at least ${classes.length} characters to have one of each kind`
            );
        }
        const characters = classes.join("");
        for (;;) {
            const password = Array.from(
                { length },
                () => characters[randomInt(characters.length)]
            ).join("");
            if (
                classes.every((group) =>
                    [...password].some((character) => group.includes(character))
                )
            ) {
                return password;
            }
        }
    }

    // A random slug of words, like brave-otter.
    static randomSlug(words: number): string {
        return times(words, (index) =>
            index === words - 1 ? faker.word.noun() : faker.word.adjective()
        )
            .map((word) => Generators.slugify(word))
            .join("-");
    }

    // Random bytes from crypto, encoded as text.
    static secret(bytes: number, encoding: SecretEncoding): string {
        return randomBytes(bytes).toString(encoding);
    }

    // Lowercase ASCII words joined by hyphens, with accents stripped and apostrophes dropped.
    static slugify(text: string): string {
        const slug = text
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/['’]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (slug === "") {
            throw new GeneratorError(
                `${JSON.stringify(text)} has no letters or numbers to make a slug from`
            );
        }
        return slug;
    }

    // v7 starts with the current time, so they sort in the order they were made.
    static uuid(version: UuidVersion): string {
        return version === 7
            ? faker.string.uuid({ refDate: new Date(), version: 7 })
            : faker.string.uuid({ version: 4 });
    }
}

export type {
    HashAlgorithm,
    IpNetwork,
    IpOptions,
    LoremUnit,
    MacFormat,
    MacOptions,
    PasswordOptions,
    SecretEncoding,
    UuidVersion,
};
export { GeneratorError, Generators };
