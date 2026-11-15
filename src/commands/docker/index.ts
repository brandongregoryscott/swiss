import { Flags } from "@oclif/core";
import { SwissCommand } from "../../shared/command.js";
import { Exec } from "../../shared/exec.js";

export default class Docker extends SwissCommand {
    static override description = `Show Docker disk usage and reclaimable space.

Uses your current Docker context and environment. Run docker prune to clean up unused resources.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        "<%= config.bin %> <%= command.id %> --verbose",
    ];

    static override flags = {
        verbose: Flags.boolean({
            char: "v",
            description:
                "Include individual images, containers, volumes and build cache",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Docker);
        this.log(
            await Exec.run("docker", [
                "system",
                "df",
                ...(flags.verbose ? ["--verbose"] : []),
            ])
        );
    }
}
