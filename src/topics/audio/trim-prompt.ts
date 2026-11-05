import { Prompt } from "@clack/core";
import path from "node:path";
import { stripVTControlCharacters, styleText } from "node:util";
import type { TrimPair } from "./trim.js";
import { Text } from "../../shared/text.js";
import { SamplePlayer } from "./player.js";

// Marking only builds a removal plan; this prompt never deletes anything.
class TrimPrompt extends Prompt<TrimPair[]> {
    readonly #marked = new Set<number>();
    readonly #pairs: TrimPair[];
    readonly #player: SamplePlayer;
    readonly #stream: NodeJS.WriteStream;
    #index = 0;
    #version: "original" | "trimmed" = "trimmed";

    constructor(pairs: TrimPair[], output: NodeJS.WriteStream) {
        super(
            {
                output,
                render() {
                    return (this as TrimPrompt).frame();
                },
            },
            false
        );
        this.#pairs = pairs;
        this.#stream = output;
        this.#player = new SamplePlayer(() => {
            if (this.state === "initial" || this.state === "active") {
                output.emit("resize");
            }
        });
        this.on("key", (_, key) => {
            if (key.ctrl === true || key.meta === true) {
                return;
            }
            switch (key.name) {
                case "d": {
                    if (this.#marked.has(this.#index)) {
                        this.#marked.delete(this.#index);
                    } else {
                        this.#marked.add(this.#index);
                    }
                    break;
                }
                case "down":
                case "up": {
                    const next = Math.max(
                        0,
                        Math.min(
                            pairs.length - 1,
                            this.#index + (key.name === "down" ? 1 : -1)
                        )
                    );
                    if (next !== this.#index) {
                        this.#player.stop();
                        this.#index = next;
                    }
                    break;
                }
                case "left":
                case "right": {
                    this.#version =
                        key.name === "left" ? "original" : "trimmed";
                    this.#player.stop();
                    this.#player.toggle(pairs[this.#index]![this.#version]);
                    break;
                }
                case "return": {
                    this.value = pairs.filter((_, index) =>
                        this.#marked.has(index)
                    );
                    this.state = "submit";
                    break;
                }
                case "space": {
                    this.#player.toggle(pairs[this.#index]![this.#version]);
                    break;
                }
            }
        });
    }

    static async review(
        pairs: TrimPair[],
        output: NodeJS.WriteStream
    ): Promise<null | TrimPair[]> {
        const prompt = new TrimPrompt(pairs, output);
        try {
            const result = await prompt.prompt();
            return Array.isArray(result) ? result : null;
        } finally {
            prompt.#player.stop();
        }
    }

    protected override _shouldSubmit(): boolean {
        return false;
    }

    frame(): string {
        if (this.state === "cancel") {
            return "Review closed · originals kept\n";
        }
        if (this.state === "submit") {
            return `${Text.pluralize(this.#marked.size, "original")} marked for replacement\n`;
        }
        const width = Math.max(30, (this.#stream.columns ?? 80) - 2);
        const fit = (text: string): string =>
            Text.truncate(
                stripVTControlCharacters(text).replace(/[\r\n\t]/g, " "),
                width
            );
        const count = Math.max(1, Math.min(9, (this.#stream.rows ?? 24) - 10));
        const start = Math.max(
            0,
            Math.min(
                this.#index - Math.floor(count / 2),
                this.#pairs.length - count
            )
        );
        const current = this.#pairs[this.#index]!;
        const table = Text.table(
            [
                [
                    "",
                    "Original",
                    "Trimmed",
                    "Removed",
                    "Replace original?",
                    "Sample",
                ],
                ...this.#pairs
                    .slice(start, start + count)
                    .map((pair, offset) => [
                        start + offset === this.#index ? "❯" : " ",
                        `${pair.originalDuration.toFixed(2)}s`,
                        `${pair.trimmedDuration.toFixed(2)}s`,
                        `${Math.max(0, pair.originalDuration - pair.trimmedDuration).toFixed(2)}s`,
                        this.#marked.has(start + offset) ? "YES" : "keep",
                        path.basename(pair.original),
                    ]),
            ],
            width
        ).map(fit);
        return (
            [
                styleText(
                    "bold",
                    `Review trims · ${this.#index + 1}/${this.#pairs.length}`,
                    { stream: this.#stream }
                ),
                "",
                ...table,
                "",
                fit(
                    `Listening to: ${this.#version.toUpperCase()} · ${path.basename(current[this.#version])}`
                ),
                fit(this.#player.message),
                fit(
                    "↑/↓ sample · ← original / → trimmed (plays) · Space play/stop"
                ),
                fit(
                    "D mark/unmark replacement · Enter review changes · Esc keep originals"
                ),
            ].join("\n") + "\n"
        );
    }
}

export { TrimPrompt };
