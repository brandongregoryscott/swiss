import { Prompt } from "@clack/core";
import path from "node:path";
import { stripVTControlCharacters, styleText } from "node:util";
import type { Style } from "../../shared/text.js";
import { Text } from "../../shared/text.js";
import { Classification } from "./classify.js";
import { SamplePlayer } from "./player.js";

class ClassifyPrompt extends Prompt<Classification> {
    readonly #player: SamplePlayer;
    readonly session: Classification;
    readonly stream: NodeJS.WriteStream;

    constructor(session: Classification, output: NodeJS.WriteStream) {
        super(
            {
                output,
                render() {
                    return (this as ClassifyPrompt).frame();
                },
            },
            false
        );
        this.session = session;
        this.stream = output;
        this.#player = new SamplePlayer(() => {
            // Clack exposes redraws through the output stream's resize event.
            if (this.state === "active" || this.state === "initial") {
                output.emit("resize");
            }
        });
        this.on("key", (_, key) => {
            switch (session.press(key)) {
                case "autoplay": {
                    this.#player.stop();
                    if (session.autoplay) {
                        this.#player.toggle(session.current.file);
                    }
                    break;
                }
                case "cancel": {
                    this.state = "cancel";
                    break;
                }
                case "move": {
                    this.#player.stop();
                    if (session.autoplay) {
                        this.#player.toggle(session.current.file);
                    }
                    break;
                }
                case "play": {
                    this.#player.toggle(session.current.file);
                    break;
                }
                case "review": {
                    this.value = session;
                    this.state = "submit";
                    break;
                }
            }
        });
    }

    static async edit(
        session: Classification,
        output: NodeJS.WriteStream
    ): Promise<Classification | null> {
        const prompt = new ClassifyPrompt(session, output);
        try {
            const pending = prompt.prompt();
            if (session.autoplay) {
                prompt.#player.toggle(session.current.file);
                output.emit("resize");
            }
            const result = await pending;
            return result instanceof Classification ? result : null;
        } finally {
            prompt.#player.stop();
        }
    }

    protected override _shouldSubmit(): boolean {
        return false;
    }

    frame(): string {
        if (this.state === "submit") {
            return "Review sample renames\n";
        }
        if (this.state === "cancel") {
            return "Classification cancelled\n";
        }
        const { session, stream } = this;
        const width = Math.max(20, (stream.columns ?? 80) - 2);
        const style = (format: Style, text: string): string =>
            styleText(format, text, { stream });
        const clean = (text: string): string =>
            stripVTControlCharacters(text).replace(/[\r\n\t]/g, " ");
        const fit = (text: string): string => Text.truncate(clean(text), width);
        const names = session.samples.map((sample) =>
            clean(path.basename(sample.file))
        );
        const durations = session.samples.map(
            (sample) => `${sample.duration.toFixed(2)}s`
        );
        const durationWidth = Math.max(
            "Length".length,
            ...durations.map((duration) => duration.length)
        );
        const categories = [null, ...session.categories];
        const categoryWidth = categories
            .map((category) => (category ?? "keep").length + 2)
            .reduce((sum, length) => sum + length, categories.length - 1);
        // Reserve room for every category before giving extra space to filenames.
        const nameWidth = Math.max(
            4,
            Math.min(
                32,
                Math.max("Sample".length, ...names.map((name) => name.length)),
                Math.max(12, width - durationWidth - categoryWidth - 6)
            )
        );
        const prefixWidth = nameWidth + durationWidth + 6;
        const choices = wrapCategories(
            categories,
            Math.max(4, width - prefixWidth)
        );
        const count = Math.max(
            1,
            Math.min(9, Math.floor(((stream.rows ?? 24) - 10) / choices.length))
        );
        const start = Math.max(
            0,
            Math.min(
                session.index - Math.floor(count / 2),
                session.samples.length - count
            )
        );
        const lines = session.samples
            .slice(start, start + count)
            .flatMap((sample, offset) => {
                const selected = start + offset === session.index;
                const index = start + offset;
                const name = Text.truncate(names[index]!, nameWidth).padEnd(
                    nameWidth
                );
                const prefix = `${selected ? "❯" : " "} ${name}  ${durations[index]!.padStart(durationWidth)}  `;
                return choices.map((row, line) => {
                    const labels = row
                        .map(({ category, text }) => {
                            if (sample.category === category) {
                                return style(
                                    selected
                                        ? ["bold", "cyan", "inverse"]
                                        : ["bold", "cyan"],
                                    text
                                );
                            }
                            return style("dim", text.replace(/[\[\]]/g, " "));
                        })
                        .join(" ");
                    return `${line === 0 ? (selected ? style("bold", prefix) : prefix) : " ".repeat(prefixWidth)}${labels}`;
                });
            });
        const header = `  ${"Sample".padEnd(nameWidth)}  ${"Length".padStart(durationWidth)}  Category`;
        return (
            [
                style(
                    "bold",
                    `Classify samples · ${session.index + 1}/${session.samples.length}`
                ),
                "",
                style("dim", header),
                style(
                    "dim",
                    "─".repeat(Math.min(width, prefixWidth + categoryWidth))
                ),
                ...lines,
                "",
                fit(`Selected: ${names[session.index]}`),
                fit(
                    `Autoplay: ${session.autoplay ? "ON" : "off"} · A toggle · ${this.#player.message}`
                ),
                style(
                    "dim",
                    fit("↑/↓ sample · ←/→ category · Space play/stop")
                ),
                style(
                    "dim",
                    fit("Backspace keep name · Enter review · Esc cancel")
                ),
            ].join("\n") + "\n"
        );
    }
}

type CategoryPart = { category: null | string; text: string };

// Wrap the choices within the last column so narrow terminals and custom category lists
// still show every option. Keep the same positions regardless of the current selection.
function wrapCategories(
    categories: Array<null | string>,
    width: number
): CategoryPart[][] {
    const rows: CategoryPart[][] = [[]];
    let used = 0;
    for (const category of categories) {
        const label = `[${category ?? "keep"}]`;
        for (let offset = 0; offset < label.length; offset += width) {
            const text = label.slice(offset, offset + width);
            if (used > 0 && used + 1 + text.length > width) {
                rows.push([]);
                used = 0;
            }
            rows.at(-1)!.push({ category, text });
            used += (used === 0 ? 0 : 1) + text.length;
        }
    }
    return rows;
}

export { ClassifyPrompt };
