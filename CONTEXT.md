# swiss

A personal multi-tool CLI: a set of command topics, like `zsh`, `jq` and `org`, each a group of small commands.

## Language

**Topic**:
A group of commands under one name, like `zsh` or `jq`, with its own code in `src/topics/<topic>`. Code more than one topic uses is shared, in `src/shared`.
_Avoid_: module, feature, area

### Commands

**Interactive**:
Someone can answer prompts: stdin and stderr are terminals. Prompts, menus and spinners draw on stderr, so a command's results on stdout can be piped while it still asks.
_Avoid_: TTY, attended

**Consent**:
Permission to do something that can't be undone: `--yes`, or answering yes to a confirm that starts on no. Without a terminal or `--yes`, a command stops before doing any work.
_Avoid_: confirmation, approval

**List**:
What a list command shows, like `zsh alias`, `env` or `port`. In a terminal it's a picker where picking something opens it (in VS Code, the browser or, for a note, the clipboard), and it stays open until Escape. With `--table`, or when there's no terminal or the output is piped, it's a table. A search argument matches anything containing it, ignoring case, or a glob when it has `*`, `?` or `[`.
_Avoid_: browser, viewer

**Removal plan**:
What a remove command would do with the names it's given: what it removes, what it can't remove and why (a read-only statement, a worktree with changes), and which names match nothing. Every remove command shows it as a table and asks before acting on it. A name that matches nothing doesn't fail the command; something it can't remove does.
_Avoid_: preview, dry run

**Cancelled**:
A command ended by Escape or by answering no. It says what it didn't do, like "Nothing deleted", and exits 0, unless part of it had already failed.
_Avoid_: aborted

### audio

**Trim**:
Remove only leading and trailing silence, retaining padding and interior pauses. `audio trim` writes separate `-trimmed` files and offers playback of both versions. Originals can be marked for replacement during review; with consent, trimmed audio replaces each marked original and takes its filename, removing the `-trimmed` suffix. `--review-only` reopens existing pairs.

**Classification**:
A sample's category, like one-shot, texture, noise, phrase or fx. `audio classify` lets someone listen, see durations and assign categories in a directory. Assignments stay in memory until the rename plan is reviewed and applied; samples without a category keep their names.

**One-sided**:
A stereo file with sound on only one side, like a mono mic recorded onto a stereo track, so it plays in one ear. Its quieter side is more than 20 dB below the louder one; a real stereo mix keeps them within a few dB. `audio stereo` copies the louder side onto both.
_Avoid_: pseudo stereo, fake stereo, dead channel

### org

**Syncable repo**:
One of the org's repos that `skipArchived` and `skipForks` don't leave out. The ignore list is chosen from these.
_Avoid_: eligible repo

**Selected repo**:
A syncable repo that the ignore list doesn't match, so `org sync` and `org branches` work on it.
_Avoid_: managed repo, active repo

**Clone**:
A selected repo's checkout at `<rootDir>/<name>`. It's ready to work in when it's a clone of that repo, its default branch is on origin, and it's just been fetched with deleted remote branches pruned; otherwise it's missing or skipped, with the reason.
_Avoid_: checkout, local repo

**Stale branch**:
A local branch whose work is already on the default branch, or that never had any: merged, landed (squash or rebase merged), gone (its upstream was deleted), or unstarted (never committed to, or with no reflog to tell). `org branches` deletes merged and landed ones, and gone and unstarted ones only when asked.
_Avoid_: old branch, dead branch

### zsh

**Startup files**:
The files zsh reads when an interactive login shell starts (`.zshenv`, `.zprofile`, `.zshrc`, in `$ZDOTDIR` when it's set), plus the files of your own they source. `ZshStartup` is the loaded set of them.
_Avoid_: zsh config, dotfiles, rc files

**Statement**:
One parsed command in a startup file, like an alias, function, export, `path` array change or `source`.
_Avoid_: line, entry

**Read-only statement**:
A statement swiss won't change, because it's nested in a function, conditional or loop, or shares its lines with other commands.
_Avoid_: locked, non-editable

**Path addition**:
A directory a statement adds to `PATH`, with where it goes: prepended, appended or replacing it.
_Avoid_: path entry
