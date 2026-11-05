import { Args } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { GEN_FLAGS, GenCommand, SEED_FLAG } from "../../topics/gen/command.js";
import { Fake } from "../../topics/gen/fake.js";

export default class GenFake extends GenCommand {
    static override args = {
        method: Args.string({
            description:
                "The faker method, like person.fullName, or a module, like internet, to list its methods [default: list every module]",
            // Otherwise oclif reads piped stdin as the argument.
            ignoreStdin: true,
        }),
    };

    static override description = `Generate fake data with any faker method.

Arguments after the method are passed to it, parsed as JSON when they can be, like 10 or '{"min":1,"max":6}', and as strings otherwise. Objects and arrays are printed as JSON, and dates in ISO 8601.

The methods are documented at https://fakerjs.dev/api/.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> internet.email -n 3",
            description: "Generate 3 email addresses",
        },
        {
            command:
                '<%= config.bin %> <%= command.id %> number.int \'{"min":1,"max":6}\'',
            description: "Roll a die",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> helpers.fromRegExp 'AKIA[A-Z0-9]{16}'",
            description: "Generate a string matching a pattern",
        },
        {
            command: "<%= config.bin %> <%= command.id %> location",
            description: "List the location module's methods",
        },
    ];

    static override flags = { ...GEN_FLAGS, ...SEED_FLAG };

    // The method's arguments follow it.
    static override strict = false;

    async run(): Promise<void> {
        const { args, argv, flags } = await this.parse(GenFake);
        const modules = Fake.modules();
        const listed =
            args.method == null
                ? modules
                : modules.filter(({ name }) => name === args.method);
        if (args.method == null || !isEmpty(listed)) {
            for (const { methods, name } of listed) {
                this.log(`${name}: ${methods.join(", ")}`);
            }
            return;
        }

        const methodArgs = (argv as string[]).slice(1);
        await this.generate(() => Fake.call(args.method!, methodArgs), flags);
    }
}
