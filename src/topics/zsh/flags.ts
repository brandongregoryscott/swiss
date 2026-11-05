import { Flags } from "@oclif/core";

// --file for the commands that add to the startup files, describing what they add.
function zshFileFlag(things: string) {
    return Flags.string({
        char: "f",
        description: `Startup file to add new ${things} to, which has to be one zsh reads [default: the one with the most ${things} already, or ~/.zshrc]`,
    });
}

export { zshFileFlag };
