import { Flags } from "@oclif/core";

// Flags shared by the env commands.
const ENV_DIR_FLAG = Flags.string({
    char: "d",
    description:
        "Directory to look for env files in [default: the git repo's root, or the current directory outside a repo]",
});

const ENV_FILE_FLAG = Flags.string({
    char: "f",
    description:
        "Env file to change, relative to the current directory; repeat for several",
    multiple: true,
});

export { ENV_DIR_FLAG, ENV_FILE_FLAG };
