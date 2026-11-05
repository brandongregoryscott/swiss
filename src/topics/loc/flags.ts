import { Args, Flags } from "@oclif/core";
import { LOCKFILES } from "./loc.js";

// Args and flags shared by the loc commands.
const LOC_ARGS = {
    dir: Args.string({
        description:
            "Directory in a git repo to count, which limits it to the files under it [default: the root of the current repo]",
    }),
};

const LOC_FLAGS = {
    all: Flags.boolean({
        description:
            "Also count lockfiles and files marked linguist-generated or linguist-vendored",
    }),
    exclude: Flags.string({
        char: "x",
        description:
            "Glob of paths to leave out, relative to the directory, like 'docs/**' or '**/*.snap'. Can be repeated",
        multiple: true,
    }),
    json: Flags.boolean({
        description: "Print JSON, for piping to jq",
    }),
};

const LOC_EXCLUSIONS = `Lockfiles (${LOCKFILES.join(", ")}) aren't counted, and neither are files .gitattributes marks linguist-generated or linguist-vendored, which is how GitHub leaves generated code out of its language stats. --all counts them too, and --exclude leaves out more.`;

export { LOC_ARGS, LOC_EXCLUSIONS, LOC_FLAGS };
