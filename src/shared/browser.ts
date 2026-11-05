import { spawn } from "node:child_process";
import { CommandError } from "./exec.js";

const OPEN_COMMAND = process.platform === "darwin" ? "open" : "xdg-open";

class Browser {
    // Opens url in the default browser without waiting for it.
    static open(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(OPEN_COMMAND, [url], {
                detached: true,
                stdio: "ignore",
            });
            child.on("error", (error: NodeJS.ErrnoException) => {
                reject(
                    new CommandError(
                        error.code === "ENOENT"
                            ? `Couldn't open a browser; ${OPEN_COMMAND} is not installed`
                            : `${OPEN_COMMAND} failed: ${error.message}`
                    )
                );
            });
            child.on("spawn", () => {
                child.unref();
                resolve();
            });
        });
    }
}

export { Browser };
