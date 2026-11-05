import { Args, Flags } from "@oclif/core";
import { isEmpty, sumBy } from "lodash-es";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { CleanTarget } from "../../topics/clean/clean.js";
import { SwissCommand } from "../../shared/command.js";
import { Concurrency } from "../../shared/concurrency.js";
import { Files } from "../../shared/files.js";
import { Text } from "../../shared/text.js";
import { CLEAN_NAMES, Cleanup } from "../../topics/clean/clean.js";

export default class Clean extends SwissCommand {
    static override args = {
        dir: Args.string({
            default: ".",
            description: "Directory to clean",
        }),
    };

    static override cancelled = "Nothing deleted";

    static override description = `Delete dependency and build output directories, like node_modules and dist, anywhere under a directory.

These directories are cleaned: ${CLEAN_NAMES.join(", ")}. The ones found are listed with their sizes, and nothing is deleted until you confirm. Directories inside them aren't searched, and neither are .git directories or symlinked directories.

In a git repo, a directory is only deleted when git ignores it, so a committed dist or build directory is left alone. Outside a git repo, every directory with one of those names is deleted.

--yes is required when there's no terminal to confirm in.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> ~/code --dry-run",
            description:
                "See what would be deleted across every project in ~/code",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --yes",
            description: "Delete without asking",
        },
    ];

    static override flags = {
        "dry-run": Flags.boolean({
            description: "List what would be deleted without deleting anything",
        }),
        yes: Flags.boolean({
            char: "y",
            description: "Delete without asking first",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Clean);
        const consent = this.terminal.consent(
            flags.yes || flags["dry-run"],
            "delete",
            "or --dry-run to only list"
        );

        // Resolved through symlinks, like macOS's /tmp, since git reports the real path of repos.
        const root = await realpath(path.resolve(args.dir)).catch(() =>
            path.resolve(args.dir)
        );
        await Files.requireDirectory(root);

        const progress = this.terminal.spinner();
        progress.start(`Searching ${Text.displayPath(root)}`);
        const targets = await Cleanup.measure(await Cleanup.find(root));
        progress.clear();

        if (isEmpty(targets)) {
            this.log(`Nothing to clean in ${Text.displayPath(root)}`);
            return;
        }

        this.table(
            [
                ["SIZE", "DIRECTORY"],
                ...targets.map((target) => [
                    Cleanup.formatSize(target.size),
                    path.relative(root, target.path),
                ]),
            ],
            { fit: false }
        );

        const summary = `${Text.pluralize(targets.length, "directory", "directories")} (${Cleanup.formatSize(sumBy(targets, "size"))})`;
        if (flags["dry-run"]) {
            this.log(`\nWould delete ${summary}`);
            return;
        }

        await consent.confirm(`Delete ${summary}?`);
        await this.#remove(root, targets);
    }

    async #remove(root: string, targets: CleanTarget[]): Promise<void> {
        let freed = 0;
        let failures = 0;
        await Concurrency.inOrder(
            targets,
            Cleanup.CONCURRENCY,
            (target) => Cleanup.remove(target.path),
            (outcome, target) => {
                if (outcome.status === "error") {
                    failures++;
                    this.log(
                        `${path.relative(root, outcome.path)}  ${this.style("red", `error: ${outcome.reason}`)}`
                    );
                } else {
                    freed += target.size;
                }
            }
        );
        this.failed = failures > 0;
        this.log(
            failures === 0
                ? this.style("green", `Freed ${Cleanup.formatSize(freed)}`)
                : this.style(
                      "yellow",
                      `Freed ${Cleanup.formatSize(freed)}, but couldn't delete ${Text.pluralize(failures, "directory", "directories")}`
                  )
        );
    }
}
