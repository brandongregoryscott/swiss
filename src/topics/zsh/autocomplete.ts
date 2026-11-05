import { isEmpty, last } from "lodash-es";
import path from "node:path";
import type { ZshDocument } from "./syntax.js";

type AutocompleteBin = {
    aliases: string[];
    bin: string;
    cacheDir: string;
};

type ZshSetupChange = {
    doc: ZshDocument;
    line: number;
    outcome: "added" | "unchanged" | "updated";
};

class Autocomplete {
    static zshSetup(doc: ZshDocument, cli: AutocompleteBin): ZshSetupChange {
        const marker = `# ${cli.bin} autocomplete setup`;
        const wanted = Autocomplete.zshSetupLine(cli);
        const existing = doc.lines.flatMap((text, index) =>
            text.includes(marker) ? [index] : []
        );
        if (isEmpty(existing)) {
            const lines = [...doc.lines];
            if (!isEmpty(lines) && last(lines)!.trim() !== "") {
                lines.push("");
            }
            lines.push(wanted);
            return {
                doc: { ...doc, lines, trailingNewline: true },
                line: lines.length,
                outcome: "added",
            };
        }

        const first = existing[0]!;
        if (existing.length === 1 && doc.lines[first] === wanted) {
            return { doc, line: first + 1, outcome: "unchanged" };
        }
        const lines = doc.lines.filter(
            (_text, index) => index === first || !existing.includes(index)
        );
        lines[first] = wanted;
        return { doc: { ...doc, lines }, line: first + 1, outcome: "updated" };
    }

    static zshSetupLine(cli: AutocompleteBin): string {
        const variable = `${cli.bin.toUpperCase().replaceAll("-", "_")}_AC_ZSH_SETUP_PATH`;
        const setup = path.join(cli.cacheDir, "autocomplete", "zsh_setup");
        const compdef = isEmpty(cli.aliases)
            ? ""
            : ` && compdef _${cli.bin} ${cli.aliases.join(" ")}`;
        return `${variable}=${setup} && test -f $${variable} && source $${variable}${compdef}; # ${cli.bin} autocomplete setup`;
    }
}

export type { AutocompleteBin, ZshSetupChange };
export { Autocomplete };
