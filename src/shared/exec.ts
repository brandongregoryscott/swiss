import { compact, isNumber } from "lodash-es";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { UserError } from "./errors.js";

const execFileAsync = promisify(execFile);

class CommandError extends UserError {}

// What a finished command wrote.
type Output = { stderr?: string; stdout?: string };

type RunOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    // Non-zero exit codes that still count as success, like lsof's 1 when it finds nothing.
    okExitCodes?: number[];
    // Return the output as it is, rather than trimming whitespace from its ends.
    raw?: boolean;
    // Return stderr instead of stdout, for tools that report there, like ffmpeg's filters.
    stderr?: boolean;
};

class Exec {
    static interactive(command: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { stdio: "inherit" });
            child.on("error", (error) => {
                reject(new CommandError(describeFailure(command, error)));
            });
            child.on("exit", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(
                        new CommandError(
                            `${[command, ...args].join(" ")} exited with ${code ?? "a signal"}`
                        )
                    );
                }
            });
        });
    }

    static async run(
        command: string,
        args: string[],
        options: RunOptions = {}
    ): Promise<string> {
        try {
            const result = await execFileAsync(command, args, {
                cwd: options.cwd,
                env: { ...process.env, ...options.env },
                maxBuffer: 64 * 1024 * 1024,
            });
            return pickOutput(result, options);
        } catch (error) {
            const { code } = error as { code?: number | string };
            if (
                isNumber(code) &&
                options.okExitCodes?.includes(code) === true
            ) {
                return pickOutput(error as Output, options);
            }
            throw new CommandError(describeFailure(command, error));
        }
    }
}

type PickOutputResult = { stderr?: string; stdout?: string };

function pickOutput(result: PickOutputResult, options: RunOptions): string {
    const output =
        (options.stderr === true ? result.stderr : result.stdout) ?? "";
    return options.raw === true ? output : output.trim();
}

function describeFailure(command: string, error: unknown): string {
    const { code, stderr } = error as {
        code?: number | string;
        stderr?: string;
    };
    if (code === "ENOENT") {
        return `${command} is not installed or not on PATH`;
    }
    const lines = compact(
        (stderr ?? "").split("\n").map((line) => line.trim())
    );
    return (
        lines.find((line) => /^(fatal|error):/.test(line)) ??
        lines[0] ??
        (error as Error).message
    );
}

export { CommandError, Exec };
