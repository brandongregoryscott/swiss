import { isEmpty, isString } from "lodash-es";
import type { PromptLog, Prompts, Spinner } from "./terminal.js";
import { Terminal } from "./terminal.js";

// What a prompt was shown with, for checking menus and messages in tests.
type ShownPrompt = {
    initialValue?: unknown;
    message: string;
    options?: Array<{ hint?: string; label?: string; value: unknown }>;
    validate?: (input: string) => Error | string | undefined;
};

type ScriptedTerminal = {
    prompts: ScriptedPrompts;
    terminal: Terminal;
};

// Prompts answered from a script instead of by someone typing, for tests. Each prompt takes the
// next answer; one its validate rejects is recorded and the next one is tried, like typing again.
// Messages are recorded as "kind: message".
class ScriptedPrompts implements Prompts {
    // The answer a prompt gives on Escape.
    static readonly CANCEL = Symbol("cancel");

    readonly log: PromptLog = {
        error: (message) => this.#say("error", message),
        info: (message) => this.#say("info", message),
        message: (message) => this.#say("message", message),
        success: (message) => this.#say("success", message),
        warn: (message) => this.#say("warn", message),
    };

    readonly said: string[] = [];
    readonly shown: ShownPrompt[] = [];
    answers: unknown[];

    autocomplete = this.#prompt;

    autocompleteMultiselect = this.#prompt;

    confirm = this.#prompt;
    groupMultiselect = this.#prompt;
    multiline = this.#prompt;
    multiselect = this.#prompt;
    password = this.#prompt;
    select = this.#prompt;
    text = this.#prompt;
    constructor(answers: unknown[] = []) {
        this.answers = answers;
    }
    // A terminal someone is at, answering with this script.
    static terminal(answers: unknown[] = []): ScriptedTerminal {
        const prompts = new ScriptedPrompts(answers);
        return {
            prompts,
            terminal: new Terminal({
                interactive: true,
                prompts,
                stdoutIsTerminal: true,
            }),
        };
    }

    cancel(message: string): void {
        this.#say("cancel", message);
    }

    intro(title: string): void {
        this.#say("intro", title);
    }

    isCancel(answer: unknown): answer is symbol {
        return answer === ScriptedPrompts.CANCEL;
    }

    outro(message: string): void {
        this.#say("outro", message);
    }

    spinner(): Spinner {
        return {
            clear: () => {},
            error: (message) => this.#say("spinner", message ?? ""),
            message: () => {},
            start: (message) => this.#say("spinner", message ?? ""),
            stop: (message) => this.#say("spinner", message ?? ""),
        };
    }

    // Typed loosely, since each prompt's answer type comes from what the test scripted.
    async #prompt(options: any): Promise<any> {
        this.shown.push(options as ShownPrompt);
        for (;;) {
            if (isEmpty(this.answers)) {
                throw new Error(
                    `Ran out of answers at ${JSON.stringify((options as ShownPrompt).message)}`
                );
            }
            const answer = this.answers.shift();
            const invalid = isString(answer)
                ? (options as ShownPrompt).validate?.(answer)
                : undefined;
            if (invalid == null) {
                return answer;
            }
            this.#say(
                "invalid",
                invalid instanceof Error ? invalid.message : invalid
            );
        }
    }

    #say(kind: string, message: string): void {
        this.said.push(`${kind}: ${message}`);
    }
}

export type { ScriptedTerminal, ShownPrompt };
export { ScriptedPrompts };
