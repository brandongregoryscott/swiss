import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ZshStatement } from "./syntax.js";
import { ZshEdit } from "./files.js";
import { ZshSyntax } from "./syntax.js";

describe("ZshSyntax", () => {
    describe("statements", () => {
        it("reads aliases, exports, path arrays and sources", () => {
            expect(
                summarize(
                    [
                        "alias gs='git status'  # status",
                        'alias ll="ls -la"',
                        "export EDITOR=vim",
                        'export BUN_INSTALL="$HOME/.bun"',
                        "PATH=$HOME/bin:$PATH",
                        "LOCAL=1",
                        "FOO=1 some-command",
                        "path+=(/opt/bin $HOME/.cargo/bin)",
                        "source ~/.aliases",
                        '[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"',
                    ].join("\n")
                )
            ).toEqual([
                "1 alias gs=git status editable",
                "2 alias ll=ls -la editable",
                "3 variable EDITOR=vim editable",
                "4 variable BUN_INSTALL=$HOME/.bun editable",
                "5 variable PATH=$HOME/bin:$PATH editable",
                "6 variable LOCAL=1 editable",
                "8 path-array /opt/bin,$HOME/.cargo/bin editable",
                "9 source ~/.aliases",
                "10 source $NVM_DIR/nvm.sh",
            ]);
        });

        it("marks statements in functions, conditionals and loops as nested", () => {
            expect(
                summarize(
                    [
                        "if [[ -n $WORK ]]; then",
                        "  export TOKEN=abc",
                        "fi",
                        "work() {",
                        "  alias deploy=make",
                        "  for x in a b; do",
                        "    export LOOP=$x",
                        "  done",
                        "}",
                        "case $OSTYPE in",
                        "  darwin*) export MAC=1 ;;",
                        "esac",
                        "export AFTER=1",
                        "if true; then export ONE_LINE=1; fi",
                        "export LAST=1",
                    ].join("\n")
                )
            ).toEqual([
                "2 variable TOKEN=abc nested",
                "4 function work=alias deploy=make; for x in a b; do export LOOP=$x; done editable",
                "5 alias deploy=make nested",
                "7 variable LOOP=$x nested",
                "11 variable MAC=1 nested",
                "13 variable AFTER=1 editable",
                "14 variable ONE_LINE=1 nested",
                "15 variable LAST=1 editable",
            ]);
        });

        it("doesn't edit statements that share a line or span several", () => {
            expect(
                summarize(
                    [
                        "alias a=1 b=2",
                        "export A=1; export B=2",
                        "export LONG='one",
                        "two'",
                        "path=(",
                        "  /opt/bin",
                        "  $path",
                        ")",
                        "export CONTINUED=a\\",
                        "b",
                        "export NEXT=1",
                    ].join("\n")
                )
            ).toEqual([
                "1 alias a=1 read-only",
                "1 alias b=2 read-only",
                "2 variable A=1 read-only",
                "2 variable B=2 read-only",
                "3 variable LONG=one\ntwo read-only",
                "5 path-array /opt/bin,$path read-only",
                "9 variable CONTINUED=a read-only",
                "11 variable NEXT=1 editable",
            ]);
        });

        it("reads functions, with their body on one line", () => {
            expect(
                summarize(
                    [
                        "# Jump into a worktree",
                        "gwtcd() {",
                        "  local dir",
                        "  dir=$(git worktree list --porcelain \\",
                        "        | awk '/^worktree /{print $2}' \\",
                        '        | fzf) && cd "$dir"',
                        "}",
                        'function mkcd { mkdir -p "$1" && cd "$1"; }',
                        "function up() {",
                        "  cd ..",
                        '  psql -c "SELECT 1',
                        '    FROM dual"',
                        "}",
                        "if true; then",
                        "  inner() { echo hi; }",
                        "fi",
                        "echo before; late() {",
                        "  echo late",
                        "}",
                        "export AFTER=1",
                    ].join("\n")
                )
            ).toEqual([
                `2 function gwtcd=local dir; dir=$(git worktree list --porcelain | awk '/^worktree /{print $2}' | fzf) && cd "$dir" editable`,
                "4 variable dir=$(git worktree list --porcelain \\\n        | awk '/^worktree /{print $2}' \\\n        | fzf) nested",
                '8 function mkcd=mkdir -p "$1" && cd "$1"; editable',
                '9 function up=cd ..; psql -c "SELECT 1 FROM dual" editable',
                "15 function inner=echo hi; nested",
                "17 function late=echo late read-only",
                "20 variable AFTER=1 editable",
            ]);
        });

        it("removes a whole function", () => {
            const doc = ZshSyntax.parse(
                ["alias a=1", "f() {", "  echo f", "}", "alias b=2", ""].join(
                    "\n"
                )
            );
            const statement = ZshSyntax.statements(doc).find(
                (found) => found.kind === "function"
            )!;

            const result = ZshSyntax.serialize(ZshEdit.remove(doc, statement));

            expect(result).toBe("alias a=1\nalias b=2\n");
        });

        it("keeps reading past zsh-only syntax", () => {
            expect(
                summarize(
                    [
                        "every() {",
                        "  [[ $1 == <-> ]] && interval=$1 && shift",
                        '  print -P "%F{244}Every ${interval}s%f"',
                        "}",
                        'lines=(${(f)"$(cat ~/.aliases)"})',
                        "source ${0:A:h}/more.zsh",
                        "alias -g G='| grep'",
                        "typeset -A map=(a 1 b 2)",
                        "files=(*.ts(N.om[1,3]))",
                        "alias after=1",
                    ].join("\n")
                )
            ).toEqual([
                '1 function every=[[ $1 == <-> ]] && interval=$1 && shift; print -P "%F{244}Every ${interval}s%f" editable',
                "2 variable interval=$1 nested",
                "6 source ${0:A:h}/more.zsh",
                "7 alias G=| grep read-only",
                "10 alias after=1 editable",
            ]);
        });

        it("ignores quotes and keywords in comments", () => {
            expect(
                summarize(
                    [
                        "# don't if this were code",
                        "export A=1 # it's fine",
                        "export B=2",
                    ].join("\n")
                )
            ).toEqual(["2 variable A=1 editable", "3 variable B=2 editable"]);
        });
    });

    describe("quoting", () => {
        it.each([
            "git status",
            "echo it's $HOME | wc -l",
            `say "hi" \\ there`,
            "plain",
        ])("round-trips %j through zsh as an alias", (value) => {
            const output = execFileSync(
                "zsh",
                [
                    "-fc",
                    `alias x=${ZshSyntax.quoteLiteral(value)}; print -r -- "\${aliases[x]}"`,
                ],
                { encoding: "utf8" }
            );
            expect(output).toBe(`${value}\n`);
        });

        it("keeps $VARIABLES expandable in exported values", () => {
            const output = execFileSync(
                "zsh",
                [
                    "-fc",
                    `HOME=/home/ada; export X=${ZshSyntax.quoteExpandable('$HOME/a "b"')}; print -r -- "$X"`,
                ],
                { encoding: "utf8" }
            );
            expect(output).toBe('/home/ada/a "b"\n');
        });
    });
});

function summarize(text: string): string[] {
    return ZshSyntax.statements(ZshSyntax.parse(text)).map(
        (statement: ZshStatement) => {
            const state = statement.nested
                ? "nested"
                : statement.editable
                  ? "editable"
                  : "read-only";
            switch (statement.kind) {
                case "alias":
                case "function":
                case "variable": {
                    return `${statement.line} ${statement.kind} ${statement.name}=${statement.value} ${state}`;
                }
                case "path-array": {
                    return `${statement.line} path-array ${statement.words.join(",")} ${state}`;
                }
                case "source": {
                    return `${statement.line} source ${statement.target}`;
                }
            }
        }
    );
}
