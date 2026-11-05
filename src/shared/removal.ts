// An item that wasn't, or couldn't be, removed, and why.
type Unremoved<T> = {
    item: T;
    reason: string;
};

// What removing the things a remove command was given would do. Nothing changes until remove().
type RemovalPlan<T> = {
    // What can't be removed, like a line zsh runs inside a function, and why.
    blocked: Array<Unremoved<T>>;
    // What will be removed.
    items: T[];
    // The names given that matched nothing.
    missing: string[];
    // Removes items, returning the ones that failed, like a worktree whose directory couldn't be
    // deleted.
    remove(): Promise<Array<Unremoved<T>>>;
};

// One of the things to pick from when no names are given. value is a name the plan understands.
type RemovalChoice = {
    hint?: string;
    label: string;
    value: string;
};

// How a remove command finds, shows and removes its things, for SwissCommand.removeItems.
type RemovalSpec<T> = {
    // What else happens, shown before asking, like checking a branch out once its worktree is
    // removed.
    afterwards?(items: T[]): null | string;
    // What to pick from when no names are given.
    choices(): Promise<RemovalChoice[]>;
    // The table's header; row gives a row for each item.
    columns: string[];
    // How an item is named in messages, like OLD_TOKEN in ~/.zshrc:12.
    describe(item: T): string;
    // Said after removing, like how to drop them from the shell that's already running.
    hint?(removed: T[]): null | string;
    // Given on the command line. Empty means pick them from a list.
    names: string[];
    // What to say about names that matched nothing, like "X isn't exported".
    notFound(names: string[]): string;
    // What's removed, singular and plural, like ["export", "exports"].
    noun: [string, string];
    plan(names: string[]): Promise<RemovalPlan<T>>;
    row(item: T): string[];
    // Remove without asking.
    yes: boolean;
};

export type { RemovalChoice, RemovalPlan, RemovalSpec, Unremoved };
