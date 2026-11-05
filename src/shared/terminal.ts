import type {
    AutocompleteMultiSelectOptions,
    AutocompleteOptions,
    ConfirmOptions,
    GroupMultiSelectOptions,
    MultiLineOptions,
    MultiSelectOptions,
    PasswordOptions,
    SelectOptions,
    SpinnerResult,
    TextOptions,
} from "@clack/prompts";
import type { Writable } from "node:stream";
import * as clack from "@clack/prompts";
import { UserError } from "./errors.js";

type Answer<T> = Promise<symbol | T>;

// The prompts and messages a command can show, already drawing where the terminal puts them.
// Each prompt answers with clack's cancel symbol on Escape or Ctrl+C.
type Prompts = {
    autocomplete<Value>(options: AutocompleteOptions<Value>): Answer<Value>;
    autocompleteMultiselect<Value>(
        options: AutocompleteMultiSelectOptions<Value>
    ): Answer<Value[]>;
    cancel(message: string): void;
    confirm(options: ConfirmOptions): Answer<boolean>;
    groupMultiselect<Value>(
        options: GroupMultiSelectOptions<Value>
    ): Answer<Value[]>;
    intro(title: string): void;
    // Whether an answer is the one a prompt gives on Escape or Ctrl+C.
    isCancel(answer: unknown): answer is symbol;
    log: PromptLog;
    multiline(options: MultiLineOptions): Answer<string>;
    multiselect<Value>(options: MultiSelectOptions<Value>): Answer<Value[]>;
    outro(message: string): void;
    password(options: PasswordOptions): Answer<string>;
    select<Value>(options: SelectOptions<Value>): Answer<Value>;
    spinner(): Spinner;
    text(options: TextOptions): Answer<string>;
};

type PromptLog = {
    error(message: string): void;
    info(message: string): void;
    message(message: string): void;
    success(message: string): void;
    warn(message: string): void;
};

type Spinner = Pick<
    SpinnerResult,
    "clear" | "error" | "message" | "start" | "stop"
>;

type TerminalOptions = {
    // Whether someone can answer prompts: stdin and the stream prompts draw on are terminals.
    interactive: boolean;
    prompts: Prompts;
    // How wide the stream prompts draw on is, for fitting hints in a picker.
    promptWidth?: number;
    // Whether stdout, where results go, is a terminal rather than a pipe or a file.
    stdoutIsTerminal: boolean;
    // How wide stdout is, when it's a terminal.
    width?: number;
};

type ConfirmOptionsDefault = {
    default?: boolean;
};

// Escape or Ctrl+C at a prompt, or "no" when asked to go ahead. SwissCommand ends the command with
// its cancelled message and exit code 0, since choosing not to do something isn't a failure.
class Cancelled extends Error {}

// Asks before doing something that can't be undone, unless --yes was passed.
class Consent {
    readonly #terminal: Terminal;
    readonly #yes: boolean;

    constructor(terminal: Terminal, yes: boolean) {
        this.#terminal = terminal;
        this.#yes = yes;
    }

    // Returns when it's fine to go ahead, and cancels the command otherwise. The answer starts on
    // no, unless yes is the usual answer, like restarting something that's stuck.
    async confirm(
        question: string,
        options: ConfirmOptionsDefault = {}
    ): Promise<void> {
        if (this.#yes) {
            return;
        }
        const answer = await this.#terminal.answer(
            this.#terminal.prompts.confirm({
                initialValue: options.default ?? false,
                message: question,
            })
        );
        if (!answer) {
            throw new Cancelled();
        }
    }
}

// The person at the terminal, if there is one: whether they can answer prompts, the prompts
// themselves, and what to say when they can't. Prompts draw on stderr, so a command's results can
// be piped while it still asks questions.
class Terminal {
    readonly interactive: boolean;
    readonly prompts: Prompts;
    readonly promptWidth: number;
    readonly stdoutIsTerminal: boolean;
    readonly width: number | undefined;

    constructor(options: TerminalOptions) {
        this.interactive = options.interactive;
        this.prompts = options.prompts;
        this.promptWidth = options.promptWidth ?? 80;
        this.stdoutIsTerminal = options.stdoutIsTerminal;
        this.width = options.width;
    }

    // The terminal this process runs in.
    static connect(): Terminal {
        const stdoutIsTerminal = process.stdout.isTTY === true;
        return new Terminal({
            interactive:
                process.stdin.isTTY === true && process.stderr.isTTY === true,
            prompts: clackPrompts(process.stderr),
            promptWidth: process.stderr.columns,
            stdoutIsTerminal,
            width: stdoutIsTerminal ? process.stdout.columns : undefined,
        });
    }

    // The answer to a prompt, cancelling the command on Escape.
    async answer<T>(prompt: Promise<T>): Promise<Exclude<T, symbol>> {
        const answer = await prompt;
        if (this.prompts.isCancel(answer)) {
            throw new Cancelled();
        }
        return answer as Exclude<T, symbol>;
    }

    // Checks now that a destructive step can go ahead later: with --yes, or someone to ask.
    // alternative is another way out, like "or --dry-run to only list".
    consent(yes: boolean, action: string, alternative?: string): Consent {
        if (!yes && !this.interactive) {
            throw new UserError(
                `Pass --yes to ${action} without an interactive terminal${alternative == null ? "" : `, ${alternative}`}`
            );
        }
        return new Consent(this, yes);
    }

    // The answer to a prompt, or null on Escape, for prompts where Escape means "done" rather
    // than "stop".
    async optional<T>(prompt: Promise<T>): Promise<Exclude<T, symbol> | null> {
        const answer = await prompt;
        return this.prompts.isCancel(answer)
            ? null
            : (answer as Exclude<T, symbol>);
    }

    // For something that's picked or typed in when it's missing, like the worktree to remove.
    requireArgument(what: string): void {
        if (!this.interactive) {
            throw new UserError(
                `Give ${what} when there's no interactive terminal`
            );
        }
    }

    // For a command or flag that only works interactively. instead is what to use otherwise.
    requireInteractive(instead?: string, what = "This command"): void {
        if (!this.interactive) {
            throw new UserError(
                `${what} needs an interactive terminal${instead == null ? "" : `; ${instead}`}`
            );
        }
    }

    // A spinner that shows while someone's watching, and does nothing otherwise.
    spinner(): Spinner {
        return this.interactive ? this.prompts.spinner() : SILENT_SPINNER;
    }
}

const SILENT_SPINNER: Spinner = {
    clear: () => {},
    error: () => {},
    message: () => {},
    start: () => {},
    stop: () => {},
};

// clack's prompts and messages, drawing on output.
function clackPrompts(output: Writable): Prompts {
    return {
        autocomplete: (options) => clack.autocomplete({ output, ...options }),
        autocompleteMultiselect: (options) =>
            clack.autocompleteMultiselect({ output, ...options }),
        cancel: (message) => clack.cancel(message, { output }),
        confirm: (options) => clack.confirm({ output, ...options }),
        groupMultiselect: (options) =>
            clack.groupMultiselect({ output, ...options }),
        intro: (title) => clack.intro(title, { output }),
        isCancel: (answer) => clack.isCancel(answer),
        log: {
            error: (message) => clack.log.error(message, { output }),
            info: (message) => clack.log.info(message, { output }),
            message: (message) => clack.log.message(message, { output }),
            success: (message) => clack.log.success(message, { output }),
            warn: (message) => clack.log.warn(message, { output }),
        },
        multiline: (options) => clack.multiline({ output, ...options }),
        multiselect: (options) => clack.multiselect({ output, ...options }),
        outro: (message) => clack.outro(message, { output }),
        password: (options) => clack.password({ output, ...options }),
        select: (options) => clack.select({ output, ...options }),
        spinner: () => clack.spinner({ output }),
        text: (options) => clack.text({ output, ...options }),
    };
}

export type { PromptLog, Prompts, Spinner };
export { Cancelled, Consent, Terminal };
