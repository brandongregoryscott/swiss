import { spawn } from "node:child_process";
import { CommandError, Exec } from "./exec.js";

// The first of these that's installed is used.
const COPY_COMMANDS: Array<[string, string[]]> =
    process.platform === "darwin"
        ? [["pbcopy", []]]
        : [
              ["wl-copy", []],
              ["xclip", ["-selection", "clipboard"]],
          ];

const PASTE_COMMANDS: Array<[string, string[]]> =
    process.platform === "darwin"
        ? [["pbpaste", []]]
        : [
              ["wl-paste", ["--no-newline"]],
              ["xclip", ["-selection", "clipboard", "-out"]],
          ];

class Clipboard {
    static async copy(text: string): Promise<void> {
        for (const [command, args] of COPY_COMMANDS) {
            if (await pipeTo(command, args, text)) {
                return;
            }
        }
        throw new CommandError(
            `Couldn't copy to the clipboard; install ${COPY_COMMANDS.map(([command]) => command).join(" or ")}`
        );
    }

    // The text on the clipboard, exactly as it is.
    static async paste(): Promise<string> {
        for (const [command, args] of PASTE_COMMANDS) {
            try {
                return await Exec.run(command, args, { raw: true });
            } catch (error) {
                if (
                    !(error instanceof CommandError) ||
                    !error.message.startsWith(`${command} is not installed`)
                ) {
                    throw error;
                }
            }
        }
        throw new CommandError(
            `Couldn't read the clipboard; install ${PASTE_COMMANDS.map(([command]) => command).join(" or ")}`
        );
    }
}

// Resolves false when the command isn't installed, so the next one can be tried.
function pipeTo(
    command: string,
    args: string[],
    text: string
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["pipe", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                resolve(false);
            } else {
                reject(new CommandError(`${command} failed: ${error.message}`));
            }
        });
        child.on("close", (code) => {
            if (code === 0) {
                resolve(true);
            } else if (code != null) {
                reject(
                    new CommandError(
                        `${command} failed: ${stderr.trim() === "" ? `exit code ${code}` : stderr.trim()}`
                    )
                );
            }
        });
        child.stdin.end(text);
    });
}

export { Clipboard };
