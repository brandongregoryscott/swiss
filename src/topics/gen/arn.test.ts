import { describe, expect, it } from "vitest";
import { Arn, ArnError } from "./arn.js";

describe("Arn", () => {
    describe("generate", () => {
        it("uses the given region and account", () => {
            expect(
                Arn.generate({
                    account: "123456789012",
                    region: "eu-west-1",
                    type: "lambda",
                })
            ).toMatch(
                /^arn:aws:lambda:eu-west-1:123456789012:function:[a-z0-9]+-[a-z0-9]+$/
            );
        });

        it("leaves the region out of IAM ARNs", () => {
            expect(
                Arn.generate({ account: "123456789012", type: "iam-role" })
            ).toMatch(/^arn:aws:iam::123456789012:role\/[A-Za-z0-9]+Role$/);
        });

        it("leaves the region and account out of S3 ARNs", () => {
            expect(Arn.generate({ type: "s3" })).toMatch(
                /^arn:aws:s3:::[a-z0-9-]+$/
            );
        });

        it("picks the partition from the region", () => {
            expect(Arn.generate({ region: "cn-north-1", type: "sqs" })).toMatch(
                /^arn:aws-cn:sqs:cn-north-1:\d{12}:/
            );
            expect(
                Arn.generate({ partition: "aws-us-gov", type: "sns" })
            ).toMatch(/^arn:aws-us-gov:sns:us-gov-(east|west)-1:\d{12}:/);
        });

        it("generates every type", () => {
            for (const type of Arn.TYPES) {
                expect(Arn.generate({ type })).toMatch(
                    /^arn:aws:[a-z0-9]+:[a-z0-9-]*:(\d{12})?:\S+$/
                );
            }
        });

        it.each([
            [{ account: "123" }, "123 isn't an AWS account ID"],
            [{ region: "europe" }, "europe isn't an AWS region"],
        ])("rejects %o", (options, message) => {
            expect(() => Arn.generate(options)).toThrow(ArnError);
            expect(() => Arn.generate(options)).toThrow(message);
        });
    });
});
