import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Text } from "../../shared/text.js";
import { ZshError, ZshStartup } from "./startup.js";
import { ZshSyntax } from "./syntax.js";

let home: string;

beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-zsh-")));
});

afterEach(() => {
    rmSync(home, { force: true, recursive: true });
});

describe("ZshStartup", () => {
    describe("load", () => {
        it("follows sources into your own files, skipping tools' and frameworks'", async () => {
            write(".zshenv", "export ZDOTENV=1\n");
            write(
                ".zshrc",
                [
                    'export ZSH="$HOME/.oh-my-zsh"',
                    "source $ZSH/oh-my-zsh.sh",
                    "source ~/dotfiles/aliases.zsh",
                    '[ -f "$HOME/.config/zsh/env.zsh" ] && . "$HOME/.config/zsh/env.zsh"',
                    "source ~/missing.zsh",
                    "source /etc/zshrc_extra",
                ].join("\n")
            );
            write(".oh-my-zsh/oh-my-zsh.sh", "alias omz=1\n");
            write(
                "dotfiles/aliases.zsh",
                "alias gs='git status'\nsource ~/.zshrc\n"
            );
            write(".config/zsh/env.zsh", "export EDITOR=vim\n");

            const { files } = await load();

            expect(files.map((file) => path.relative(home, file.path))).toEqual(
                [
                    ".zshenv",
                    ".zshrc",
                    "dotfiles/aliases.zsh",
                    ".config/zsh/env.zsh",
                ]
            );
        });

        it("reads from $ZDOTDIR when it's set", async () => {
            write("zdot/.zshrc", "alias a=b\n");

            const { files } = await ZshStartup.load({
                env: { ZDOTDIR: path.join(home, "zdot") },
                home,
            });

            expect(files.map((file) => file.path)).toEqual([
                path.join(home, "zdot/.zshrc"),
            ]);
        });
    });

    describe("target", () => {
        it("picks the file with the most of a kind, or the .zshrc", async () => {
            write(".zshrc", "export A=1\nsource ~/aliases.zsh\n");
            write("aliases.zsh", "alias a=1\nalias b=2\n");
            const startup = await load();

            expect(startup.target("alias").path).toBe(
                path.join(home, "aliases.zsh")
            );
            expect(startup.target("path").path).toBe(path.join(home, ".zshrc"));
        });

        it("refuses a file zsh doesn't read", async () => {
            write(".zshrc", "alias a=1\n");
            write("other.zsh", "alias b=2\n");
            const startup = await load();

            expect(startup.target("alias", "~/.zshrc").path).toBe(
                path.join(home, ".zshrc")
            );
            expect(() => startup.target("alias", "~/other.zsh")).toThrow(
                /zsh doesn't read ~\/other.zsh/
            );
        });
    });

    describe("save", () => {
        it("writes nothing until it's called, then only the files that changed", async () => {
            write(".zshrc", "export A=1\nsource ~/aliases.zsh\n");
            write("aliases.zsh", "alias a=1\n");
            const startup = await load();

            startup.setExport("A", "2");
            expect(read(".zshrc")).toBe("export A=1\nsource ~/aliases.zsh\n");
            expect(startup.changed().map((file) => file.path)).toEqual([
                path.join(home, ".zshrc"),
            ]);

            const written = await startup.save();

            expect(written.map((file) => file.path)).toEqual([
                path.join(home, ".zshrc"),
            ]);
            expect(read(".zshrc")).toBe("export A=2\nsource ~/aliases.zsh\n");
            expect(startup.changed()).toEqual([]);
        });

        it("creates the .zshrc when there isn't one", async () => {
            const startup = await load();

            startup.setAlias("gs", "git status");
            await startup.save();

            expect(read(".zshrc")).toBe("alias gs='git status'\n");
        });

        it("puts the file back when the change breaks its syntax", async () => {
            write(".zshrc", "export A=1\n");
            const startup = await load();

            startup.update(startup.zshrc(), ZshSyntax.parse("if true; then\n"));

            await expect(startup.save()).rejects.toThrow(ZshError);
            expect(read(".zshrc")).toBe("export A=1\n");
        });

        it("still writes to a file that was already broken", async () => {
            write(".zshrc", "if true; then\n");
            const startup = await load();

            startup.setAlias("a", "b");
            await startup.save();

            expect(read(".zshrc")).toBe("if true; then\n\nalias a=b\n");
        });
    });

    describe("setAlias", () => {
        it("adds after the last alias, or changes the last one in place", async () => {
            write(".zshrc", "alias a=1\nalias b=2\n\nexport A=1\nalias b=3\n");
            const startup = await load();

            const added = startup.setAlias("c", "ls -la");
            const changed = startup.setAlias("b", "4");

            expect([added.status, added.statement.line]).toEqual(["added", 6]);
            expect([changed.status, changed.statement.line]).toEqual([
                "changed",
                5,
            ]);
            expect(startup.setAlias("b", "4").status).toBe("unchanged");
            expect(contents(startup)).toBe(
                "alias a=1\nalias b=2\n\nexport A=1\nalias b=4\nalias c='ls -la'\n"
            );
        });

        it("refuses names zsh can't alias, or an empty command", async () => {
            const startup = await load();

            expect(() => startup.setAlias("a b", "ls")).toThrow(
                /can't be an alias name/
            );
            expect(() => startup.setAlias("a", "  ")).toThrow(
                /Give the command for a/
            );
        });
    });

    describe("setExport", () => {
        it("changes the last export in place, keeping its comment", async () => {
            write(".zshrc", "export EDITOR=vi\nexport EDITOR=vim  # editor\n");
            const startup = await load();

            const change = startup.setExport("EDITOR", "nvim --clean");

            expect([change.status, change.statement.line]).toEqual([
                "changed",
                2,
            ]);
            expect(contents(startup)).toBe(
                'export EDITOR=vi\nexport EDITOR="nvim --clean"  # editor\n'
            );
        });

        it("refuses to change PATH or a conditional export", async () => {
            write(".zshrc", "if true; then\n  export TOKEN=1\nfi\n");
            const startup = await load();

            expect(() => startup.setExport("TOKEN", "2")).toThrow(
                /inside a function, conditional or loop at .*:2/
            );
            expect(() => startup.setExport("PATH", "/x")).toThrow(
                /zsh path add/
            );
        });
    });

    describe("renameExport", () => {
        it("renames every export of a variable in place, keeping its value and comment", async () => {
            write(
                ".zshrc",
                'export TOKEN=1\nalias a=1\nexport TOKEN="$HOME/x"  # token\n'
            );
            const startup = await load();

            startup.renameExport("TOKEN", "API_TOKEN");

            expect(contents(startup)).toBe(
                'export API_TOKEN=1\nalias a=1\nexport API_TOKEN="$HOME/x"  # token\n'
            );
        });

        it("changes nothing when one of the exports can't be renamed, or the name is taken", async () => {
            write(
                ".zshrc",
                "export TOKEN=1\nexport OTHER=2\nif true; then\n  export TOKEN=3\nfi\n"
            );
            const startup = await load();

            expect(() => startup.renameExport("TOKEN", "NEW")).toThrow(
                /Can't change TOKEN, since it's inside a function/
            );
            expect(() => startup.renameExport("OTHER", "TOKEN")).toThrow(
                /TOKEN is already exported/
            );
            expect(() => startup.renameExport("OTHER", "PATH")).toThrow(
                /zsh path add/
            );
            expect(startup.changed()).toEqual([]);
        });
    });

    describe("removeExport", () => {
        it("removes every export of a variable, so an earlier one doesn't take over", async () => {
            write(".zshrc", "export A=1\nexport B=2\nexport A=3\n");
            const startup = await load();

            startup.removeExport("A");

            expect(contents(startup)).toBe("export B=2\n");
            expect(() => startup.removeExport("A")).toThrow(/A isn't exported/);
        });
    });

    describe("remove", () => {
        it("removes statements, keeping the line numbers of the rest right", async () => {
            write(".zshrc", "alias a=1\nexport A=1\nalias b=2\nalias c=3\n");
            const startup = await load();

            startup.remove(
                startup
                    .aliases()
                    .filter(({ statement }) => statement.name !== "b")
            );

            expect(contents(startup)).toBe("export A=1\nalias b=2\n");
        });
    });

    describe("paths", () => {
        it("lists additions with where they go, expanding variables set earlier", async () => {
            write(
                ".zshrc",
                [
                    'export BUN_INSTALL="$HOME/.bun"',
                    'export PATH="$BUN_INSTALL/bin:$PATH:/opt/after"',
                    "path+=(~/.cargo/bin)",
                    'export PATH="$(brew --prefix)/bin:$PATH"',
                ].join("\n")
            );
            const startup = await load();

            expect(
                startup
                    .pathAdditions()
                    .map(({ expanded, position, statement }) => [
                        statement.line,
                        position,
                        expanded,
                    ])
            ).toEqual([
                [2, "prepend", path.join(home, ".bun/bin")],
                [2, "append", "/opt/after"],
                [3, "append", path.join(home, ".cargo/bin")],
                [4, "prepend", null],
            ]);
        });

        it("works out ${0:A:h} as the directory of the file, without splitting it on its colons", async () => {
            write(".zshrc", "source ~/tool/path.zsh.inc\n");
            write("tool/path.zsh.inc", "export PATH=${0:A:h}/bin:$PATH\n");
            const startup = await load();

            expect(
                startup.pathAdditions().map((addition) => addition.expanded)
            ).toEqual([path.join(home, "tool/bin")]);
        });

        it("takes a directory out of a line, or removes the line when it's the only one", async () => {
            write(
                ".zshrc",
                [
                    'export PATH="$HOME/a:$HOME/b:$PATH"',
                    "path=($HOME/a $path)",
                    'export PATH="$HOME/c:$PATH"',
                ].join("\n")
            );
            const startup = await load();
            const dir = startup.resolveDir("~/a");

            startup.removePaths(
                startup
                    .pathAdditions()
                    .filter((addition) => addition.expanded === dir)
            );

            expect(contents(startup)).toBe(
                'export PATH="$HOME/b:$PATH"\nexport PATH="$HOME/c:$PATH"'
            );
        });

        it("adds directories in home with $HOME, unless they're added already", async () => {
            write(".zshrc", 'export PATH="$HOME/.local/bin:$PATH"\n');
            const startup = await load();

            const existing = startup.addPath(
                startup.resolveDir("~/.local/bin"),
                { append: false }
            );
            const added = startup.addPath("/opt/bin", { append: true });

            expect(existing.status).toBe("unchanged");
            expect([added.status, added.statement.line]).toEqual(["added", 2]);
            expect(contents(startup)).toBe(
                'export PATH="$HOME/.local/bin:$PATH"\nexport PATH="$PATH:/opt/bin"\n'
            );
        });
    });
});

describe("removal plans", () => {
    it("matches an alias and a function by name, and only the function with ()", async () => {
        write(
            ".zshrc",
            [
                "alias gs='git status'",
                "f() { echo f; }",
                "alias f=ls",
                "if true; then",
                "  alias gs=x",
                "fi",
            ].join("\n")
        );
        const startup = await load();

        const plan = startup.planAliasRemoval(["gs", "f()", "nope"]);

        expect(
            plan.items.map(({ statement }) => ZshStartup.label(statement))
        ).toEqual(["gs", "f()"]);
        expect(
            plan.blocked.map(({ item, reason }) => [
                item.statement.line,
                reason,
            ])
        ).toEqual([
            [
                5,
                expect.stringContaining(
                    "inside a function, conditional or loop"
                ),
            ],
        ]);
        expect(plan.missing).toEqual(["nope"]);

        expect(await plan.remove()).toEqual([]);
        expect(read(".zshrc")).toBe(
            "alias f=ls\nif true; then\n  alias gs=x\nfi"
        );
    });

    it("lists directories that matched nothing the way they'd be shown", async () => {
        write(".zshrc", "export PATH=$HOME/bin:$PATH\n");
        const startup = await load();

        const plan = startup.planPathRemoval(["~/bin", "~/gone"]);

        expect(plan.items.map((addition) => addition.dir)).toEqual([
            "$HOME/bin",
        ]);
        // Shown the way the rest of swiss shows paths, relative to the real home directory.
        expect(plan.missing).toEqual([
            Text.displayPath(path.join(home, "gone")),
        ]);
    });

    it("says how to drop what was removed from a running shell", async () => {
        write(
            ".zshrc",
            [
                "alias gs=x",
                "f() { echo f; }",
                "export TOKEN=1",
                "export PATH=$HOME/bin:$PATH",
            ].join("\n")
        );
        const startup = await load();
        const statements = startup.files[0]!.statements.map((statement) => ({
            file: startup.files[0]!,
            statement,
        }));

        expect(ZshStartup.forgetHint(statements.slice(0, 3))).toBe(
            "Run `unalias gs; unfunction f; unset TOKEN` to remove them from this shell too"
        );
        expect(ZshStartup.forgetHint(statements.slice(3))).toBe(
            "Open a new terminal for PATH to leave them out"
        );
        expect(ZshStartup.forgetHint([])).toBeNull();
    });
});

function load(): Promise<ZshStartup> {
    return ZshStartup.load({ env: {}, home });
}

// The .zshrc as it is in memory, with changes that haven't been saved.
function contents(startup: ZshStartup): string {
    return ZshSyntax.serialize(startup.zshrc().doc);
}

function write(file: string, contents: string): void {
    const full = path.join(home, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
}

function read(file: string): string {
    return readFileSync(path.join(home, file), "utf8");
}
