import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

// Playback runs separately from the prompt and never reads its keyboard input.
class SamplePlayer {
    readonly #changed: () => void;
    message = "Space to listen";
    #child: ChildProcess | null = null;

    constructor(changed: () => void) {
        this.#changed = changed;
    }

    stop(): void {
        const child = this.#child;
        this.#child = null;
        child?.kill();
        this.message = "Space to listen";
    }

    toggle(file: string): void {
        if (this.#child != null) {
            this.stop();
            return;
        }
        const mac = process.platform === "darwin";
        const command = mac ? "afplay" : "ffplay";
        const child = spawn(
            command,
            mac
                ? [file]
                : ["-nodisp", "-autoexit", "-loglevel", "error", "-i", file],
            { stdio: ["ignore", "ignore", "pipe"] }
        );
        this.#child = child;
        this.message = "Playing · Space to stop";
        let errors = "";
        child.stderr?.on("data", (data: Buffer) => {
            errors = (errors + data.toString()).slice(-2000);
        });
        child.on("error", (error) => {
            if (this.#child !== child) {
                return;
            }
            this.#child = null;
            this.message = `Couldn't play: ${error.message}. ${command} must be installed and on PATH.`;
            this.#changed();
        });
        child.on("close", (code) => {
            if (this.#child !== child) {
                return;
            }
            this.#child = null;
            const reason = errors.trim();
            this.message =
                code === 0
                    ? "Finished · Space to replay"
                    : `Couldn't play: ${reason === "" ? `${command} exited ${String(code)}` : reason}`;
            this.#changed();
        });
    }
}

export { SamplePlayer };
