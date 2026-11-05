import { Flags } from "@oclif/core";
import { GEN_FLAGS, GenCommand } from "../../topics/gen/command.js";
import { Generators } from "../../topics/gen/generators.js";

export default class GenPassword extends GenCommand {
    static override description = `Generate strong random passwords.

They're made with a cryptographically secure generator, and have at least one lowercase letter, uppercase letter, digit and symbol. The symbols are ones that rarely need quoting in shells, .env files or URLs: - _ . ! @ # % ^ * + = ~`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command:
                "<%= config.bin %> <%= command.id %> -l 32 --no-symbols -c",
            description:
                "Generate a 32-character password without symbols, and copy it",
        },
    ];

    static override flags = {
        ...GEN_FLAGS,
        length: Flags.integer({
            char: "l",
            default: 24,
            description: "How many characters each password has",
            min: 4,
        }),
        symbols: Flags.boolean({
            allowNo: true,
            default: true,
            description: "Include symbols",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(GenPassword);
        await this.generate(
            () => Generators.password(flags.length, { symbols: flags.symbols }),
            flags
        );
    }
}
