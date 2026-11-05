import { Flags } from "@oclif/core";
import { compact, isEmpty, uniq } from "lodash-es";
import type {
    WorktreeInfo,
    WorktreeRemovalPlan,
} from "../../topics/worktree/worktrees.js";
import {
    REMOVE_FLAGS,
    REMOVE_HELP,
    SwissCommand,
} from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { Worktrees } from "../../topics/worktree/worktrees.js";

export default class WorktreeRemove extends SwissCommand {
    static override aliases = ["worktree:rm", "wt:remove", "wt:rm"];

    static override cancelled = "Nothing removed";

    static override description = `Remove linked git worktrees.

Give worktrees by branch, path or directory name. Each one's directory is deleted, but its branch and commits are kept. When there's one to remove, its branch is then checked out in the main worktree, so you can carry on there; pass --no-checkout to leave the main worktree on the branch it's on. The checkout needs the main worktree to have no uncommitted changes, which is checked before anything is removed.

A worktree with uncommitted changes, untracked files or a lock is left in place unless you pass --force, which loses them.

${REMOVE_HELP}

If you're in a worktree being removed, cd out of it afterwards.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %>",
            description: "Pick worktrees to remove from a list",
        },
        {
            command: "<%= config.bin %> <%= command.id %> my-feature",
            description:
                "Remove the worktree with my-feature checked out, and check out my-feature in the main worktree",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> ../api-hotfix --no-checkout --yes",
            description:
                "Remove a worktree by path without switching branches or asking",
        },
    ];

    static override flags = {
        checkout: Flags.boolean({
            allowNo: true,
            default: true,
            description:
                "When removing one worktree, check its branch out in the main worktree afterwards",
        }),
        dir: Flags.string({
            char: "d",
            default: ".",
            description: "Directory in the repo whose worktrees to look in",
        }),
        force: Flags.boolean({
            char: "f",
            description:
                "Remove them even with uncommitted changes or untracked files, or when they're locked",
        }),
        ...REMOVE_FLAGS,
    };

    // Takes any number of worktrees.
    static override strict = false;

    static override usage =
        "worktree remove [WORKTREE...] [--no-checkout] [-f] [-y]";

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(WorktreeRemove);
        const worktrees = await Worktrees.list(flags.dir);
        const main = worktrees.find((worktree) => worktree.isMain)!;
        // Read now, since process.cwd() throws once its directory is removed.
        const current = await Worktrees.containing(worktrees, process.cwd());

        let plan: null | WorktreeRemovalPlan = null;
        await this.removeItems<WorktreeInfo>({
            afterwards: (items) =>
                plan?.checkout === true
                    ? `Then checks out ${Worktrees.branchName(items[0]!)} in ${Text.displayPath(main.path)}`
                    : null,
            choices: async () =>
                worktrees
                    .filter((worktree) => !worktree.isMain)
                    .map((worktree) => ({
                        hint: `${Worktrees.status(worktree)}, ${Text.displayPath(worktree.path)}`,
                        label: Worktrees.branchName(worktree),
                        value: worktree.path,
                    })),
            columns: ["BRANCH", "PATH", "STATUS"],
            describe: (worktree) => Text.displayPath(worktree.path),
            hint: (removed) => {
                const notes = compact([
                    plan?.checkout === true &&
                        `Checked out ${Worktrees.branchName(removed[0]!)} in ${Text.displayPath(main.path)}`,
                    removed.some(
                        (worktree) => worktree.path === current?.path
                    ) &&
                        `You're in a removed directory; cd ${Text.displayPath(main.path)}`,
                ]);
                return isEmpty(notes) ? null : notes.join("; ");
            },
            names: uniq(argv as string[]),
            notFound: (missing) =>
                `No worktree has ${missing.join(", ")} checked out or is at ${missing.length === 1 ? "it" : "them"}; run \`${this.config.bin} worktree\` to list them`,
            noun: ["worktree", "worktrees"],
            plan: async (names) => {
                plan = await Worktrees.planRemoval(worktrees, names, {
                    checkout: flags.checkout,
                    force: flags.force,
                });
                return plan;
            },
            row: (worktree) => [
                Worktrees.branchName(worktree),
                Text.displayPath(worktree.path),
                Worktrees.status(worktree),
            ],
            yes: flags.yes,
        });
    }
}
