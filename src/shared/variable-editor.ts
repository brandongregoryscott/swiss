import type { Prompts, Terminal } from "./terminal.js";
import { EnvFile } from "./env-files.js";
import { UserError } from "./errors.js";

// A variable as the editor lists it.
type EditableVariable = {
    // Where it's set, like ~/.zshrc:3, shown when it's picked.
    location?: string;
    name: string;
    // Why it can't be changed, when it can't.
    readOnly?: string;
    value: string;
};

// Where the variables come from, like an env file or the zsh startup files. Changes are kept until
// save(), and ones that can't be made throw a UserError, which the editor shows before carrying on.
type VariableStore = {
    changed(): boolean;
    // Why name can't be a variable's name, or undefined when it can.
    checkName(name: string): string | undefined;
    // An example name, for the prompt for a new one.
    placeholder: string;
    remove(name: string): void;
    rename(from: string, to: string): void;
    // Writes the changes, returning what to say about it.
    save(): Promise<string>;
    set(name: string, value: string): void;
    // Shown when the editor starts.
    title: string;
    // In the order they're listed.
    variables(): EditableVariable[];
};

type EditorOptions = {
    // Show values in the list instead of hiding them.
    reveal: boolean;
};

// A variable's name, or one of the other choices. Those can't be variable names, so they can't clash.
type MenuChoice = "+add" | "+discard" | "+save" | ({} & string);

type VariableAction = "back" | "remove" | "rename" | "value";

// An interactive menu for adding, changing, renaming and removing variables. Escape at any prompt
// cancels the command without saving.
class VariableEditor {
    readonly #options: EditorOptions;
    readonly #store: VariableStore;
    readonly #terminal: Terminal;

    constructor(
        terminal: Terminal,
        store: VariableStore,
        options: EditorOptions
    ) {
        this.#terminal = terminal;
        this.#store = store;
        this.#options = options;
    }

    static async edit(
        terminal: Terminal,
        store: VariableStore,
        options: EditorOptions
    ): Promise<void> {
        await new VariableEditor(terminal, store, options).#run();
    }

    get #prompts(): Prompts {
        return this.#terminal.prompts;
    }

    async #add(): Promise<void> {
        const name = (
            await this.#terminal.answer(
                this.#prompts.text({
                    message: "Variable name",
                    placeholder: this.#store.placeholder,
                    validate: (input) => {
                        const trimmed = (input ?? "").trim();
                        return (
                            this.#store.checkName(trimmed) ??
                            (this.#find(trimmed) == null
                                ? undefined
                                : `${trimmed} is already set; pick it from the list to change it`)
                        );
                    },
                })
            )
        ).trim();
        await this.#editValue(name, "");
    }

    async #editValue(name: string, current: string): Promise<void> {
        // Values like private keys span several lines, which text can't hold.
        const options = { initialValue: current, message: `Value for ${name}` };
        const value = await this.#terminal.answer(
            current.includes("\n")
                ? this.#prompts.multiline(options)
                : this.#prompts.text(options)
        );
        this.#update(() => this.#store.set(name, value ?? ""));
    }

    async #editVariable(variable: EditableVariable): Promise<void> {
        const { name } = variable;
        if (variable.readOnly != null) {
            this.#prompts.log.warn(
                `Can't change ${name}, since ${variable.readOnly}`
            );
            return;
        }
        const action = await this.#terminal.answer(
            this.#prompts.select<VariableAction>({
                message:
                    variable.location == null
                        ? name
                        : `${name} (${variable.location})`,
                options: [
                    { label: "Change value", value: "value" },
                    { label: "Rename", value: "rename" },
                    { label: "Remove", value: "remove" },
                    { label: "Back", value: "back" },
                ],
            })
        );

        switch (action) {
            case "back": {
                return;
            }

            case "remove": {
                this.#update(() => this.#store.remove(name));
                return;
            }

            case "rename": {
                const renamed = (
                    await this.#terminal.answer(
                        this.#prompts.text({
                            initialValue: name,
                            message: `Rename ${name} to`,
                            validate: (input) => {
                                const trimmed = (input ?? "").trim();
                                return (
                                    this.#store.checkName(trimmed) ??
                                    (trimmed !== name &&
                                    this.#find(trimmed) != null
                                        ? `${trimmed} is already set`
                                        : undefined)
                                );
                            },
                        })
                    )
                ).trim();
                if (renamed !== name) {
                    this.#update(() => this.#store.rename(name, renamed));
                }
                return;
            }

            case "value": {
                await this.#editValue(name, variable.value);
                return;
            }
        }
    }

    #find(name: string): EditableVariable | undefined {
        return this.#store
            .variables()
            .find((variable) => variable.name === name);
    }

    #menuOptions(): Array<{ hint?: string; label: string; value: MenuChoice }> {
        const dirty = this.#store.changed();
        return [
            ...this.#store.variables().map((variable) => ({
                hint:
                    variable.readOnly == null
                        ? EnvFile.formatValue(
                              variable.value,
                              this.#options.reveal
                          )
                        : ["read-only", variable.location]
                              .filter((part) => part != null)
                              .join(", "),
                label: variable.name,
                value: variable.name,
            })),
            { label: "Add a variable", value: "+add" },
            {
                hint: dirty ? "unsaved changes" : undefined,
                label: "Save and exit",
                value: "+save",
            },
            {
                label: dirty ? "Discard changes and exit" : "Exit",
                value: "+discard",
            },
        ];
    }

    async #run(): Promise<void> {
        this.#prompts.intro(this.#store.title);
        for (;;) {
            const choice = await this.#terminal.answer(
                this.#prompts.select<MenuChoice>({
                    maxItems: 15,
                    message: "What do you want to change?",
                    options: this.#menuOptions(),
                })
            );

            switch (choice) {
                case "+add": {
                    await this.#add();
                    break;
                }

                case "+discard": {
                    this.#prompts.outro("Nothing saved");
                    return;
                }

                case "+save": {
                    this.#prompts.outro(await this.#store.save());
                    return;
                }

                default: {
                    await this.#editVariable(this.#find(choice)!);
                    break;
                }
            }
        }
    }

    // Makes a change, explaining instead of leaving when it can't be made, like a value that can't
    // be quoted.
    #update(change: () => void): void {
        try {
            change();
        } catch (error) {
            if (!(error instanceof UserError)) {
                throw error;
            }
            this.#prompts.log.error(error.message);
        }
    }
}

export type { EditableVariable, VariableStore };
export { VariableEditor };
