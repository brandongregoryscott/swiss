import { Args, Flags } from "@oclif/core";
import { REMOVE_FLAGS, SwissCommand } from "../../shared/command.js";
import { UserError } from "../../shared/errors.js";
import { Exec } from "../../shared/exec.js";

export default class DockerPrune extends SwissCommand {
    static override args = {
        target: Args.string({
            default: "system",
            description:
                "Clean up the whole system, only images, or only build cache",
            options: ["system", "images", "cache"],
        }),
    };

    static override cancelled = "Nothing pruned";

    static override description = `Free disk space by pruning unused Docker resources.

By default, remove stopped containers (including their writable data), unused networks, dangling images and unused build cache. Use images or cache to limit cleanup. --all also removes images without any container referencing them, or all unused build cache for the cache target. Images and cache may need to be downloaded or rebuilt later.

Volumes are kept unless --volumes is passed with the system target; that also removes unused anonymous volumes and their data. Named volumes are kept.

Shows disk usage, cleanup scope and the Docker command before asking for consent. --dry-run only shows this information; Docker does not provide an exact prune preview. --yes skips asking and is required without an interactive terminal. Uses your current Docker context and environment.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        "<%= config.bin %> <%= command.id %> images --all",
        "<%= config.bin %> <%= command.id %> cache",
        "<%= config.bin %> <%= command.id %> --all --dry-run",
        "<%= config.bin %> <%= command.id %> --yes",
    ];

    static override flags = {
        ...REMOVE_FLAGS,
        all: Flags.boolean({
            char: "a",
            description:
                "Also remove all unused images, or all unused build cache for the cache target",
        }),
        "dry-run": Flags.boolean({
            description: "Show disk usage and cleanup scope without pruning",
        }),
        volumes: Flags.boolean({
            description:
                "Also delete unused anonymous volumes and their data (system target only)",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(DockerPrune);
        if (flags.volumes && args.target !== "system") {
            throw new UserError("--volumes requires the system target");
        }
        const consent = this.terminal.consent(
            flags.yes || flags["dry-run"],
            "prune Docker resources",
            "or --dry-run to only show cleanup scope"
        );
        const target =
            args.target === "images"
                ? "image"
                : args.target === "cache"
                  ? "builder"
                  : "system";
        const command = [
            target,
            "prune",
            "--force",
            ...(flags.all ? ["--all"] : []),
            ...(flags.volumes ? ["--volumes"] : []),
        ];
        this.log(await Exec.run("docker", ["system", "df"]));
        const images = flags.all
            ? "All images not referenced by any container"
            : "Dangling images";
        const cache =
            flags.all && args.target === "cache"
                ? "All unused build cache"
                : args.target === "cache"
                  ? "Dangling build cache"
                  : "Unused build cache";
        const rows =
            args.target === "images"
                ? [["Images", images]]
                : args.target === "cache"
                  ? [["Build cache", cache]]
                  : [
                        [
                            "Containers",
                            "All stopped containers, including their writable data",
                        ],
                        ["Networks", "Networks not used by any container"],
                        ["Images", images],
                        ["Build cache", cache],
                        [
                            "Volumes",
                            flags.volumes
                                ? "Unused anonymous volumes and their data"
                                : "Kept",
                        ],
                    ];
        this.table([["RESOURCE", "CLEANUP SCOPE"], ...rows], { fit: false });
        this.log(`\nCommand: docker ${command.join(" ")}`);
        if (flags["dry-run"]) {
            this.log(
                "\nNothing pruned; scope shown above is not an exact list of resources to delete."
            );
            return;
        }
        await consent.confirm("Prune these Docker resources?");
        await Exec.interactive("docker", command);
    }
}
