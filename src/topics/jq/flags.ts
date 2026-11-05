import { Args, Flags } from "@oclif/core";

// Flags shared by the jq commands, passed on to jq.
const JQ_FLAGS = {
    compact: Flags.boolean({
        char: "c",
        description: "Print each result on one line",
    }),
    raw: Flags.boolean({
        char: "r",
        description: "Print strings without quotes",
    }),
    slurp: Flags.boolean({
        char: "s",
        description:
            "Read every JSON value in the input into one array, like for newline-delimited JSON",
    }),
};

const JQ_FILE_ARG = Args.string({
    description:
        "JSON file to read [default: stdin if piped, otherwise the clipboard]",
    // Input.read handles stdin, as raw bytes rather than oclif's trimmed string.
    ignoreStdin: true,
});

// The first argument of the recipe commands.
const JQ_ARRAY_ARG = Args.string({
    description:
        "Path to the array to work on, like .orders, or . when the input is an array",
    required: true,
});

export { JQ_ARRAY_ARG, JQ_FILE_ARG, JQ_FLAGS };
