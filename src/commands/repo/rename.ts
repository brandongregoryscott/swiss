import { Args, Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import type { OwnedRepo } from "../../shared/git/github.js";
import { SwissCommand } from "../../shared/command.js";
import { CommandError } from "../../shared/exec.js";
import { GitHub } from "../../shared/git/github.js";
import { Text } from "../../shared/text.js";
import { RepoRename, RepoRenameSession } from "../../topics/repo/rename.js";

export default class RepoRenameCommand extends SwissCommand {
    static override args = {
        owner: Args.string({
            description:
                "Account or org whose repos to list [default: the account gh is signed in to]",
        }),
    };

    static override description = `Pick repos from a list and rename them, one after another, archiving the ones renamed to ${RepoRename.ARCHIVED_PREFIX}*.

Repos are listed least recently pushed first, with whether they're private, archived or forks. Repos already named ${RepoRename.ARCHIVED_PREFIX}* are left out, including ones you rename while it's running, unless you pass --all. Type to filter, and Enter to pick one. The new name starts as ${RepoRename.ARCHIVED_PREFIX}<name>, which you can edit before pressing Enter to rename. When the new name starts with ${RepoRename.ARCHIVED_PREFIX}, the repo is archived on GitHub too, making it read-only; other names only rename it.

Repos already named ${RepoRename.ARCHIVED_PREFIX}* that aren't archived yet are listed first, and archived together if you confirm. Esc on the name goes back to the list, and Esc on the list exits.

GitHub redirects the old name to the new one, but clones keep pointing at the old remote URL until you update them. Uses \`gh repo rename\`, so gh must be signed in with access to rename the repos. Needs an interactive terminal.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> my-org",
            description: "Rename repos in an org",
        },
        {
            command: "<%= config.bin %> <%= command.id %> --all",
            description: `Also list repos already named ${RepoRename.ARCHIVED_PREFIX}*`,
        },
    ];

    static override flags = {
        all: Flags.boolean({
            char: "a",
            description: `Also list repos already named ${RepoRename.ARCHIVED_PREFIX}*`,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(RepoRenameCommand);
        this.terminal.requireInteractive(
            "use `gh repo rename` directly instead"
        );

        const repos = await this.#listRepos(args.owner);
        if (isEmpty(repos)) {
            this.error(`${args.owner ?? "You"} has no repos`);
        }
        const session = new RepoRenameSession(repos);

        const { prompts } = this.terminal;
        prompts.intro(`Renaming repos in ${session.owner}`);
        await this.#backfill(session);

        for (;;) {
            const listed = session.listed(flags.all);
            if (isEmpty(listed)) {
                prompts.log.info(
                    `Every repo is named ${RepoRename.ARCHIVED_PREFIX}*; pass --all to rename them again`
                );
                break;
            }

            const picked = await this.terminal.optional(
                prompts.autocomplete({
                    maxItems: 15,
                    message: "Pick a repo to rename (Esc to finish)",
                    options: listed.map((repo) => ({
                        hint: RepoRename.hint(repo),
                        label: repo.name,
                        value: repo,
                    })),
                })
            );
            if (picked == null) {
                break;
            }
            await this.#rename(session, picked);
        }
        prompts.outro(session.summary());
    }

    async #archive(session: RepoRenameSession, repo: OwnedRepo): Promise<void> {
        await this.#step(
            [
                `Archiving ${repo.name}`,
                `Archived ${repo.name}`,
                `Could not archive ${repo.name}`,
            ],
            () => session.archive(repo)
        );
    }

    // Offers to archive the repos that were renamed before renaming started archiving them.
    async #backfill(session: RepoRenameSession): Promise<void> {
        const unarchived = session.unarchived();
        if (isEmpty(unarchived)) {
            return;
        }

        this.terminal.prompts.log.message(
            unarchived.map((repo) => repo.name).join("\n")
        );
        // Escape skips archiving them, like "no".
        const answer = await this.terminal.optional(
            this.terminal.prompts.confirm({
                message: `Archive ${unarchived.length === 1 ? "this repo, which is" : `these ${unarchived.length} repos, which are`} named ${RepoRename.ARCHIVED_PREFIX}* but not archived?`,
            })
        );
        if (answer !== true) {
            return;
        }
        for (const repo of unarchived) {
            await this.#archive(session, repo);
        }
    }

    async #listRepos(owner: string | undefined): Promise<OwnedRepo[]> {
        const loading = this.terminal.spinner();
        loading.start("Listing repos");
        try {
            const repos = await GitHub.listOwnedRepos(owner);
            loading.stop(`Found ${Text.pluralize(repos.length, "repo")}`);
            if (repos.length >= GitHub.REPO_LIST_LIMIT) {
                this.terminal.prompts.log.warn(
                    `${owner ?? "You"} ${owner == null ? "have" : "has"} at least ${GitHub.REPO_LIST_LIMIT} repos; only the first ${GitHub.REPO_LIST_LIMIT} are listed`
                );
            }
            return repos;
        } catch (error) {
            loading.stop("Could not list repos");
            throw error;
        }
    }

    // Asks for the new name and renames the repo, then archives it when the name has the
    // archived prefix. Escape on the name goes back to the list.
    async #rename(session: RepoRenameSession, repo: OwnedRepo): Promise<void> {
        const answer = await this.terminal.optional(
            this.terminal.prompts.text({
                initialValue: RepoRename.defaultName(repo.name),
                message: `New name for ${repo.name}`,
                validate: (value) =>
                    session.validate(repo, (value ?? "").trim()),
            })
        );
        if (answer == null) {
            return;
        }

        const oldName = repo.name;
        const newName = answer.trim();
        const renamed = await this.#step(
            [
                `Renaming ${oldName} to ${newName}`,
                `Renamed ${oldName} to ${newName}`,
                `Could not rename ${oldName}`,
            ],
            () => session.rename(repo, newName)
        );
        if (renamed && RepoRename.needsArchiving(repo)) {
            await this.#archive(session, repo);
        }
    }

    // Does work under a spinner saying what it's doing, then that it's done or, when gh fails,
    // that it couldn't and why. False when it failed.
    async #step(
        [doing, done, failed]: [string, string, string],
        work: () => Promise<void>
    ): Promise<boolean> {
        const spinner = this.terminal.spinner();
        spinner.start(doing);
        try {
            await work();
        } catch (error) {
            if (!(error instanceof CommandError)) {
                throw error;
            }
            spinner.stop(failed);
            this.terminal.prompts.log.error(error.message);
            return false;
        }
        spinner.stop(done);
        return true;
    }
}
