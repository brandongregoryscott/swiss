import { Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { SwissCommand } from "../../shared/command.js";
import { CommandError } from "../../shared/exec.js";
import { Git } from "../../shared/git/git.js";
import { Text } from "../../shared/text.js";
import { Contributors } from "../../topics/loc/contributors.js";
import { LOC_ARGS, LOC_EXCLUSIONS, LOC_FLAGS } from "../../topics/loc/flags.js";
import { Loc } from "../../topics/loc/loc.js";

export default class LocAuthors extends SwissCommand {
    static override args = LOC_ARGS;

    static override description = `List who has committed to a git repo, with the lines each person added and removed.

Every non-merge commit reachable from HEAD counts. Added and removed lines are churn, so rewriting a file counts each time, and they don't add up to the lines someone wrote that are still in the repo.

People commit with more than one email, so emails are merged into one person when they belong to the same GitHub account:

  - When origin is on GitHub, one commit per email is looked up with the gh CLI to find the account its author is linked to. This only needs gh to be logged in, and is on by default when origin's host has "github" in it; --github forces it for other hosts, like GitHub Enterprise, and --no-github turns it off. Commits that were never pushed, and emails that aren't on any account, can't be looked up.
  - Emails like 123+octocat@users.noreply.github.com belong to the account in them, with or without GitHub.
  - Names and emails go through the repo's .mailmap first, which can merge anyone else.

${LOC_EXCLUSIONS} Commits that only change those files aren't listed.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> --no-github",
            description: "Merge emails without asking GitHub",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> --json | jq '.[0].emails'",
            description: "See which emails were merged for the top committer",
        },
    ];

    static override flags = {
        ...LOC_FLAGS,
        github: Flags.boolean({
            allowNo: true,
            description:
                "Look commit authors up on GitHub to merge their emails [default: when origin's host has github in it]",
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(LocAuthors);
        const dir = await Loc.resolveDir(args.dir);

        const repo = Contributors.lookupRepo(
            await Git.originRepo(dir),
            flags.github
        );
        const progress = this.terminal.spinner();
        progress.start("Reading history");
        const commits = await Contributors.commits(dir, {
            all: flags.all,
            exclude: flags.exclude,
        }).catch((error: unknown) => {
            progress.clear();
            throw error;
        });

        let loginsByEmail = new Map<string, string>();
        let lookupError: null | string = null;
        if (repo != null && !isEmpty(commits)) {
            progress.message(
                `Looking up authors on ${repo.host}/${repo.owner}/${repo.name}`
            );
            try {
                loginsByEmail = await Contributors.logins(repo, commits);
            } catch (error) {
                if (!(error instanceof CommandError)) {
                    progress.clear();
                    throw error;
                }
                lookupError = error.message;
            }
        }
        progress.clear();

        if (lookupError != null) {
            if (flags.github === true) {
                this.error(
                    `Couldn't look up authors on GitHub: ${lookupError}`
                );
            }
            this.warn(
                `Couldn't look up authors on GitHub, so only .mailmap and noreply emails are merged: ${lookupError}`
            );
        }

        const contributors = Contributors.merge(commits, loginsByEmail);
        if (flags.json) {
            this.log(JSON.stringify(contributors, null, 2));
            return;
        }
        if (isEmpty(contributors)) {
            this.log(`No commits in ${Text.displayPath(dir)}`);
            return;
        }

        this.table([
            ["AUTHOR", "COMMITS", "ADDED", "REMOVED", "EMAILS"],
            ...contributors.map((contributor) => [
                contributor.login == null
                    ? contributor.name
                    : `${contributor.name} (@${contributor.login})`,
                Text.number(contributor.commits),
                `+${Text.number(contributor.added)}`,
                `-${Text.number(contributor.removed)}`,
                contributor.emails.join(", "),
            ]),
        ]);
        this.log(
            this.style(
                "dim",
                `\n${Text.pluralize(contributors.length, "author")} across ${Text.pluralize(commits.length, "commit")}`
            )
        );
    }
}
