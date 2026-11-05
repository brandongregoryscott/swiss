import { Args, Command, Flags } from "@oclif/core";
import { isEmpty } from "lodash-es";
import { styleText } from "node:util";
import type { ListSpec } from "./listing.js";
import type { RemovalSpec } from "./removal.js";
import type { Style } from "./text.js";
import { Clipboard } from "./clipboard.js";
import { UserError } from "./errors.js";
import { CommandError } from "./exec.js";
import { Cancelled, Terminal } from "./terminal.js";
import { Text } from "./text.js";

type TableOptions = {
    // Rows to print dimmed, like definitions a later one overrides.
    dim?: (index: number) => boolean;
    // Cut lines short to fit the terminal. Off for lists whose last column you need in full, like
    // paths about to be deleted.
    fit?: boolean;
};

// Flags every list command takes.
const LIST_FLAGS = {
    table: Flags.boolean({
        char: "t",
        description:
            "Print a table instead of picking from a list; the default when there's no terminal or the output is piped",
    }),
};

// How every list command shows its things, for its help text. action is what picking one does,
// like "open it in VS Code".
function listHelp(action: string): string {
    return `In a terminal, pick from a list: type to filter, and Enter to ${action}. The list stays open until Esc. --table prints a table instead, which is what happens when there's no terminal or the output is piped.`;
}

// The argument a list command is filtered by. fields is what it searches, like "name or command",
// and many what's listed.
function searchArg(many: string, fields: string) {
    return Args.string({
        description: `Only show ${many} whose ${fields} contains this, ignoring case, or matches a glob like 'AWS_*'`,
    });
}

// Flags every remove command takes.
const REMOVE_FLAGS = {
    yes: Flags.boolean({
        char: "y",
        description:
            "Remove them without asking first, which is required when there's no terminal to ask in",
    }),
};

// How every remove command removes things, for its help text.
const REMOVE_HELP = `What will be removed is listed, along with anything that can't be and why, and nothing changes until you confirm. --yes skips asking, and is required when there's no terminal to ask in. Without any, pick them from a list: type to filter and Tab to pick. Names that match nothing are mentioned but don't fail the command, since there's nothing left to remove; anything that can't be removed does.`;

// The base of every command. It prints a UserError's message and exits, so commands only catch
// errors they handle some other way, and ends a cancelled command with its cancelled message.
abstract class SwissCommand extends Command {
    // What to say when Escape or "no" ends the command, which exits 0.
    static cancelled = "Nothing changed";

    // Set when part of the command has failed, like one repo of many, so it exits 1 once it's
    // done, even if it's then cancelled.
    protected failed = false;

    #terminal: null | Terminal = null;

    // The person at the terminal, if there is one. Settable for tests.
    get terminal(): Terminal {
        this.#terminal ??= Terminal.connect();
        return this.#terminal;
    }

    set terminal(terminal: Terminal) {
        this.#terminal = terminal;
    }

    protected override async catch(error: Error): Promise<unknown> {
        if (error instanceof Cancelled) {
            this.terminal.prompts.cancel(
                (this.constructor as typeof SwissCommand).cancelled
            );
            if (this.failed) {
                this.exit(1);
            }
            return;
        }
        if (error instanceof UserError) {
            this.error(error.message);
        }
        return super.catch(error);
    }

    // Copies text to the clipboard and says so on stderr, so it stays out of output that's piped
    // elsewhere. what is what was copied, like "the URL". Output that's already been printed
    // isn't lost when there's no clipboard to copy to, so that's a warning, and exits 1 at the end.
    protected async copy(text: string, what?: string): Promise<void> {
        try {
            await Clipboard.copy(text);
        } catch (error) {
            if (!(error instanceof CommandError)) {
                throw error;
            }
            this.failed = true;
            this.warn(error.message);
            return;
        }
        this.logToStderr(
            styleText("dim", what == null ? "Copied" : `Copied ${what}`, {
                stream: process.stderr,
            })
        );
    }

    protected override async finally(
        error: Error | undefined
    ): Promise<unknown> {
        const result = await super.finally(error);
        if (error == null && this.failed) {
            this.exit(1);
        }
        return result;
    }

    // Shows spec's items the same way in every list command: in a terminal, as a picker where
    // picking one opens it and the picker stays open until Escape; otherwise, or with --table, as
    // a table. A table is also printed when stdout is piped, so the list can be read by another
    // command.
    protected async listItems<T>(spec: ListSpec<T>): Promise<void> {
        if (isEmpty(spec.items)) {
            this.log(spec.empty);
            return;
        }
        if (
            spec.table ||
            !this.terminal.interactive ||
            !this.terminal.stdoutIsTerminal
        ) {
            const { dim } = spec;
            this.table(
                [spec.columns, ...spec.items.map((item) => spec.row(item))],
                {
                    dim:
                        dim == null
                            ? undefined
                            : (index) => dim(spec.items[index]!),
                    fit: spec.fit,
                }
            );
            if (spec.footer != null) {
                this.log(`\n${spec.footer}`);
            }
            return;
        }

        const { prompts } = this.terminal;
        prompts.intro(spec.title);
        if (spec.footer != null) {
            prompts.log.info(spec.footer);
        }
        // Items are picked by index, since the picker can't take any T as a value.
        let previous: number | undefined;
        let opened = 0;
        for (;;) {
            const picked = await this.terminal.optional(
                prompts.autocomplete({
                    initialValue: previous,
                    maxItems: 15,
                    message: `Pick one to ${spec.action} (Esc to finish)`,
                    options: spec.items.map((item, index) => {
                        const { hint, label } = spec.choice(item);
                        return {
                            // Room for the label and the picker's own marks.
                            hint: Text.truncate(
                                hint,
                                Math.max(
                                    this.terminal.promptWidth -
                                        label.length -
                                        10,
                                    10
                                )
                            ),
                            label,
                            value: index,
                        };
                    }),
                })
            );
            if (picked == null) {
                break;
            }
            previous = picked;
            try {
                prompts.log.success(await spec.open(spec.items[picked]!));
                opened++;
            } catch (error) {
                if (!(error instanceof CommandError)) {
                    throw error;
                }
                prompts.log.error(error.message);
            }
        }
        const [one, many] = spec.noun;
        prompts.outro(`${spec.verb} ${Text.pluralize(opened, one, many)}`);
    }

    // Removes the things spec names, or ones picked from a list when it names none, the same way
    // in every remove command: what will be removed is listed, along with what can't be and
    // names that matched nothing, and nothing changes until it's confirmed or --yes is passed.
    // Something that can't be removed fails the command; a name that matched nothing doesn't,
    // since it's already gone.
    protected async removeItems<T>(spec: RemovalSpec<T>): Promise<void> {
        const [one, many] = spec.noun;
        let names = spec.names;
        if (isEmpty(names)) {
            this.terminal.requireArgument(`the ${many} to remove`);
        }
        const consent = this.terminal.consent(spec.yes, `remove ${many}`);

        if (isEmpty(names)) {
            const choices = await spec.choices();
            if (isEmpty(choices)) {
                this.log(`No ${many} to remove`);
                return;
            }
            names = await this.terminal.answer(
                this.terminal.prompts.autocompleteMultiselect<string>({
                    maxItems: 15,
                    message: `Pick ${many} to remove (type to filter, Tab to pick)`,
                    options: choices,
                    required: false,
                })
            );
            if (isEmpty(names)) {
                throw new Cancelled();
            }
        }

        const plan = await spec.plan(names);
        if (!isEmpty(plan.missing)) {
            this.log(spec.notFound(plan.missing));
        }
        for (const { item, reason } of plan.blocked) {
            this.failed = true;
            this.warn(`Left ${spec.describe(item)} in place, since ${reason}`);
        }
        if (isEmpty(plan.items)) {
            return;
        }

        this.table(
            [spec.columns, ...plan.items.map((item) => spec.row(item))],
            {
                fit: false,
            }
        );
        const afterwards = spec.afterwards?.(plan.items);
        if (afterwards != null) {
            this.log(this.style("dim", afterwards));
        }
        await consent.confirm(
            `Remove ${Text.pluralize(plan.items.length, one, many)}?`
        );

        const failures = await plan.remove();
        for (const { item, reason } of failures) {
            this.failed = true;
            this.log(
                `${this.style("red", "Couldn't remove")} ${spec.describe(item)}: ${reason}`
            );
        }
        const removed = plan.items.filter(
            (item) => !failures.some((failure) => failure.item === item)
        );
        if (isEmpty(removed)) {
            return;
        }
        this.log(
            this.style(
                "green",
                `Removed ${Text.pluralize(removed.length, one, many)}`
            )
        );
        const hint = spec.hint?.(removed);
        if (hint != null) {
            this.log(this.style("dim", hint));
        }
    }

    // text styled for stdout, so it's left plain when stdout isn't a terminal.
    protected style(style: Style, text: string): string {
        return styleText(style, text, { stream: process.stdout });
    }

    // Prints rows as a table with a bold header row, fitted to the terminal unless fit is false.
    protected table(rows: string[][], options: TableOptions = {}): void {
        const [header, ...lines] = Text.table(
            rows,
            options.fit === false ? undefined : this.terminal.width
        );
        this.log(this.style("bold", header!));
        for (const [index, line] of lines.entries()) {
            this.log(
                options.dim?.(index) === true ? this.style("dim", line) : line
            );
        }
    }
}

export {
    LIST_FLAGS,
    listHelp,
    REMOVE_FLAGS,
    REMOVE_HELP,
    searchArg,
    SwissCommand,
};
