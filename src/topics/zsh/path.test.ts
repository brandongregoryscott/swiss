import {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZshStartup } from "./startup.js";
import { ZshSyntax } from "./syntax.js";

let home: string;

beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-zsh-path-")));
});

afterEach(() => {
    rmSync(home, { force: true, recursive: true });
});

describe("removing directories from PATH", () => {
    it.each([
        [
            "unquoted, keeping ~ expandable",
            "export PATH=~/bin:~/.local/bin:$PATH",
            "~/bin",
            "export PATH=~/.local/bin:$PATH",
        ],
        [
            "quoted as a whole, staying quoted",
            'export PATH="$HOME/a:$HOME/b:$PATH"',
            "~/a",
            'export PATH="$HOME/b:$PATH"',
        ],
        [
            "with a glob, leaving it unquoted",
            "export PATH=/opt/*/bin:$HOME/c:$PATH",
            "~/c",
            "export PATH=/opt/*/bin:$PATH",
        ],
        [
            "with parts quoted on their own",
            'export PATH="$HOME/my dir":$HOME/x:${PATH}',
            "~/x",
            'export PATH="$HOME/my dir":${PATH}',
        ],
        [
            "from a path array",
            "path+=(~/.cargo/bin /opt/*/bin $HOME/x)",
            "~/x",
            "path+=(~/.cargo/bin /opt/*/bin)",
        ],
        [
            "the only one, removing the line",
            "export PATH=$HOME/x:$PATH",
            "~/x",
            "",
        ],
    ])("%s", async (_, line, dir, expected) => {
        write(".zshrc", `${line}\n`);
        const startup = await load();
        const target = startup.resolveDir(dir);

        startup.removePaths(
            startup
                .pathAdditions()
                .filter((addition) => addition.expanded === target)
        );

        expect(zshrc(startup)).toBe(expected === "" ? "" : `${expected}\n`);
    });
});

describe("reading PATH", () => {
    it("uses variables as they are at the PATH line, not later", async () => {
        write(".zshrc", "X=/a\nexport PATH=$X/bin:$PATH\nX=/b\n");
        const startup = await load();

        expect(expanded(startup)).toEqual(["/a/bin"]);
    });

    it("reads sourced files where they're sourced", async () => {
        write(
            ".zshrc",
            [
                "X=/a",
                "source ~/paths.zsh",
                "X=/b",
                "export PATH=$Y/bin:$PATH",
            ].join("\n")
        );
        write("paths.zsh", "export PATH=$X/bin:$PATH\nY=/c\n");
        const startup = await load();

        // paths.zsh runs where it's sourced, while X is /a, and sets Y before .zshrc's last
        // line, so its addition comes first.
        expect(expanded(startup)).toEqual(["/a/bin", "/c/bin"]);
    });

    it("removes the line a directory was added by, read with its own variables", async () => {
        write(
            ".zshrc",
            "X=/a\nexport PATH=$X/bin:$PATH\nX=/b\nexport PATH=$X/bin:$PATH\n"
        );
        const startup = await load();

        startup.removePaths(
            startup
                .pathAdditions()
                .filter((addition) => addition.expanded === "/a/bin")
        );

        expect(zshrc(startup)).toBe("X=/a\nX=/b\nexport PATH=$X/bin:$PATH\n");
    });
});

describe("comparing with the shell's PATH", () => {
    it("marks duplicates and missing directories, and finds what's not in it yet", async () => {
        mkdirSync(path.join(home, "bin"));
        mkdirSync(path.join(home, "new"));
        write(
            ".zshrc",
            [
                "export PATH=$HOME/bin:$PATH",
                "export PATH=$HOME/new:$PATH",
                'export PATH="$(brew --prefix)/bin:$PATH"',
            ].join("\n")
        );
        const startup = await load();
        const bin = path.join(home, "bin");
        const gone = path.join(home, "gone");

        const report = await startup.pathReport(`${bin}:${gone}:${bin}/`);

        expect(
            report.entries.map((entry) => [
                entry.dir,
                entry.problem,
                entry.addedBy.length,
            ])
        ).toEqual([
            [bin, null, 1],
            [gone, "missing", 0],
            [bin, "duplicate", 1],
        ]);
        expect(report.pending.map((addition) => addition.expanded)).toEqual([
            path.join(home, "new"),
        ]);
        expect(report.unknown.map((addition) => addition.dir)).toEqual([
            "$(brew --prefix)/bin",
        ]);
    });
});

function load(): Promise<ZshStartup> {
    return ZshStartup.load({ env: {}, home });
}

function expanded(startup: ZshStartup): Array<null | string> {
    return startup.pathAdditions().map((addition) => addition.expanded);
}

function zshrc(startup: ZshStartup): string {
    return ZshSyntax.serialize(startup.zshrc().doc);
}

function write(file: string, contents: string): void {
    const full = path.join(home, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
}
