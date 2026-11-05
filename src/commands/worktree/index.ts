import { Args } from "@oclif/core";
import path from "node:path";
import type { WorktreeInfo } from "../../topics/worktree/worktrees.js";
import { LIST_FLAGS, listHelp, SwissCommand } from "../../shared/command.js";
import { Editor } from "../../shared/editor.js";
import { Text } from "../../shared/text.js";
import { Worktrees } from "../../topics/worktree/worktrees.js";

export default class WorktreeCommand extends SwissCommand {
    static override aliases = ["wt"];

    static override args = {
        dir: Args.string({
            default: ".",
            description: "Directory in the repo whose worktrees to list",
        }),
    };

    static override description = `List a repo's git worktrees and the branches they have checked out.

${listHelp("open it in VS Code")}

The main worktree is listed first, then the linked ones made with \`git worktree add\`. Each shows its branch (or "(detached)"), the commit it's on, whether it has uncommitted changes or untracked files, and its path. The worktree you're in is marked with *. A worktree whose directory has been deleted shows as missing, and is cleaned up by \`git worktree prune\` or \`<%= config.bin %> worktree remove\`.

To remove one and check its branch out in the main worktree, use \`<%= config.bin %> worktree remove\`.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> ~/code/api",
            description: "List the worktrees of another repo",
        },
    ];

    static override flags = LIST_FLAGS;

    async run(): Promise<void> {
        const { args, flags } = await this.parse(WorktreeCommand);

        const worktrees = await Worktrees.list(path.resolve(args.dir));
        const current = await Worktrees.containing(worktrees, process.cwd());

        await this.listItems<WorktreeInfo>({
            action: "open it in VS Code",
            choice: (worktree) => ({
                hint: `${Worktrees.status(worktree)}, ${Text.displayPath(worktree.path)}`,
                label: `${worktree.path === current?.path ? "* " : ""}${Worktrees.branchName(worktree)}`,
            }),
            columns: Worktrees.COLUMNS,
            empty: "No worktrees",
            items: worktrees,
            noun: ["worktree", "worktrees"],
            async open(worktree) {
                await Editor.open(worktree.path);
                return `Opened ${Text.displayPath(worktree.path)}`;
            },
            row: (worktree) => Worktrees.row(worktree, current),
            table: flags.table,
            title: "Worktrees",
            verb: "Opened",
        });
    }
}
