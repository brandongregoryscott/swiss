import { faker } from "@faker-js/faker";
import { upperFirst } from "lodash-es";
import { UserError } from "../../shared/errors.js";

type ArnOptions = {
    account?: string;
    partition?: ArnPartition;
    region?: string;
    type?: ArnType;
};

type ArnPartition = (typeof ARN_PARTITIONS)[number];

type ArnType = keyof typeof TEMPLATES;

type Names = {
    account: string;
    kebab: string;
    pascal: string;
    region: string;
};

type Template = {
    // Global resources leave the region out of the ARN, and S3 buckets the account too.
    omit?: "region-and-account" | "region";
    resource: (names: Names) => string;
    service: string;
};

const ARN_PARTITIONS = ["aws", "aws-cn", "aws-us-gov"] as const;

const REGIONS: Record<ArnPartition, string[]> = {
    aws: [
        "us-east-1",
        "us-east-2",
        "us-west-1",
        "us-west-2",
        "ca-central-1",
        "eu-west-1",
        "eu-west-2",
        "eu-central-1",
        "eu-north-1",
        "ap-south-1",
        "ap-southeast-1",
        "ap-southeast-2",
        "ap-northeast-1",
        "sa-east-1",
    ],
    "aws-cn": ["cn-north-1", "cn-northwest-1"],
    "aws-us-gov": ["us-gov-east-1", "us-gov-west-1"],
};

const TEMPLATES = {
    dynamodb: {
        resource: ({ pascal }) => `table/${pascal}`,
        service: "dynamodb",
    },
    ec2: {
        resource: () =>
            `instance/i-${faker.string.hexadecimal({ casing: "lower", length: 17, prefix: "" })}`,
        service: "ec2",
    },
    ecr: {
        resource: ({ kebab }) => `repository/${kebab}`,
        service: "ecr",
    },
    "iam-policy": {
        omit: "region",
        resource: ({ pascal }) => `policy/${pascal}Policy`,
        service: "iam",
    },
    "iam-role": {
        omit: "region",
        resource: ({ pascal }) => `role/${pascal}Role`,
        service: "iam",
    },
    "iam-user": {
        omit: "region",
        resource: () => `user/${faker.internet.username().toLowerCase()}`,
        service: "iam",
    },
    kms: {
        resource: () => `key/${faker.string.uuid()}`,
        service: "kms",
    },
    lambda: {
        resource: ({ kebab }) => `function:${kebab}`,
        service: "lambda",
    },
    logs: {
        resource: ({ kebab }) => `log-group:/aws/lambda/${kebab}`,
        service: "logs",
    },
    rds: {
        resource: ({ kebab }) => `db:${kebab}-db`,
        service: "rds",
    },
    s3: {
        omit: "region-and-account",
        resource: ({ kebab }) =>
            `${kebab}-${faker.string.alphanumeric({ casing: "lower", length: 6 })}`,
        service: "s3",
    },
    secretsmanager: {
        resource: ({ kebab }) =>
            `secret:prod/${kebab}-${faker.string.alphanumeric(6)}`,
        service: "secretsmanager",
    },
    sns: {
        resource: ({ kebab }) => `${kebab}-topic`,
        service: "sns",
    },
    sqs: {
        resource: ({ kebab }) => `${kebab}-queue`,
        service: "sqs",
    },
} satisfies Record<string, Template>;

class ArnError extends UserError {}

class Arn {
    static readonly PARTITIONS = ARN_PARTITIONS;
    static readonly TYPES = Object.keys(TEMPLATES) as ArnType[];

    // A realistic-looking ARN, picking a random type, region and account for those not given.
    static generate(options: ArnOptions = {}): string {
        if (options.account != null && !/^\d{12}$/.test(options.account)) {
            throw new ArnError(
                `${options.account} isn't an AWS account ID, which is 12 digits`
            );
        }
        if (
            options.region != null &&
            !/^[a-z]{2}(-[a-z]+)+-\d+$/.test(options.region)
        ) {
            throw new ArnError(
                `${options.region} isn't an AWS region, like us-east-1`
            );
        }

        const partition =
            options.partition ??
            (options.region == null
                ? "aws"
                : (ARN_PARTITIONS.find((name) =>
                      REGIONS[name].includes(options.region!)
                  ) ?? "aws"));
        const type = options.type ?? faker.helpers.arrayElement(Arn.TYPES);
        const template: Template = TEMPLATES[type];
        const [adjective, noun] = [
            faker.word.adjective(),
            faker.word.noun(),
        ].map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const names: Names = {
            account: options.account ?? Arn.randomAccount(),
            kebab: `${adjective}-${noun}`,
            pascal: `${upperFirst(adjective)}${upperFirst(noun)}`,
            region:
                options.region ??
                faker.helpers.arrayElement(REGIONS[partition]),
        };

        const region = template.omit == null ? names.region : "";
        const account =
            template.omit === "region-and-account" ? "" : names.account;
        return `arn:${partition}:${template.service}:${region}:${account}:${template.resource(names)}`;
    }

    // 12 digits that don't start with 0, like most real account IDs.
    static randomAccount(): string {
        return faker.string.numeric({ allowLeadingZeros: false, length: 12 });
    }
}

export type { ArnOptions, ArnPartition, ArnType };
export { Arn, ArnError };
