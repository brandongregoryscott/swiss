import path from "node:path";

// How an item shows in a list's picker.
type ListChoice = {
    hint: string;
    label: string;
};

// How a list command shows its things, for SwissCommand.listItems: as a picker in a terminal, where
// picking one opens it, or as a table.
type ListSpec<T> = {
    // What picking one does, for the picker's message, like "open in VS Code".
    action: string;
    // How an item shows in the picker.
    choice(item: T): ListChoice;
    // The table's header; row gives a row for each item.
    columns: string[];
    // Items to print dimmed in the table, like definitions a later one overrides.
    dim?(item: T): boolean;
    // What to say when there are none, like "No notes match "acme"".
    empty: string;
    // Cut the table's lines short to fit the terminal. Off for lists whose last column you need
    // in full, like paths.
    fit?: boolean;
    // Said after the table, or at the top of the picker, like the files that don't set a variable.
    footer?: null | string;
    items: T[];
    // What's listed, singular and plural, for saying how many were opened.
    noun: [string, string];
    // Does what picking item does, returning what to say, like "Opened ~/.zshrc:12".
    open(item: T): Promise<string>;
    row(item: T): string[];
    // Print a table even in a terminal.
    table: boolean;
    // The picker's heading, like "Aliases and functions in your zsh startup files".
    title: string;
    // What picking does, in the past tense, like "Opened" or "Copied".
    verb: string;
};

// Whether any of fields matches what a list is filtered by: containing it, ignoring case, or
// matching it as a glob, also ignoring case, when it has * ? or [, like AWS_*. Everything matches
// no filter.
function matchesSearch(search: string | undefined, fields: string[]): boolean {
    if (search == null) {
        return true;
    }
    const needle = search.toLowerCase();
    const isGlob = /[*?[]/.test(needle);
    return fields.some((field) =>
        isGlob
            ? path.matchesGlob(field.toLowerCase(), needle)
            : field.toLowerCase().includes(needle)
    );
}

export type { ListChoice, ListSpec };
export { matchesSearch };
