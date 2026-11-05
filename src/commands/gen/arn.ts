import { Flags } from "@oclif/core";
import { Arn } from "../../topics/gen/arn.js";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";

export default class GenArn extends GenCommand {
    static override description = `Generate realistic-looking AWS ARNs, for test data and docs.

The resource type, region, account and names are random unless they're given. IAM resources leave the region out, and S3 buckets the region and account, like real ARNs do. The partition follows the region, so cn-north-1 gives arn:aws-cn.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command:
                "<%= config.bin %> <%= command.id %> -t lambda -r eu-west-1 -n 3",
            description: "Generate 3 Lambda function ARNs in eu-west-1",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> -t iam-role -a 123456789012",
            description: "Generate an IAM role ARN in a given account",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        ...SEED_FLAG,
        account: Flags.string({
            char: "a",
            description: "12-digit account ID [default: random]",
        }),
        partition: Flags.option({
            char: "p",
            description: "Partition [default: the region's, or aws]",
            options: Arn.PARTITIONS,
        })(),
        region: Flags.string({
            char: "r",
            description: "Region, like us-east-1 [default: random]",
        }),
        type: Flags.option({
            char: "t",
            description: "Resource type [default: random]",
            options: Arn.TYPES,
        })(),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenArn);
        await this.generate(() => Arn.generate(flags), flags);
    }
}
