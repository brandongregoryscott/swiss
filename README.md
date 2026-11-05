# swiss

Personal multi-tool CLI built on [oclif](https://oclif.io). Commands live in `src/commands/<topic>/<command>.ts`.

## Setup

```sh
npm install
npm run build
npm install -g . # puts `swiss` and its alias `sws` on your PATH
```

Configure your shell with Swiss:

```sh
swiss config init # creates an editable config, preserving existing sections
swiss configure   # ensures the configured settings are in your zsh startup files
```

`swiss configure` reads the `zsh` section of `~/.config/swiss/config.json`. It adds or updates aliases, exported environment variables and PATH additions directly in your startup files, leaving matching definitions unchanged. No files from the Swiss checkout are sourced. Run it again to apply changes to your config.

The defaults install `showfiles` / `hidefiles` for Finder (plus the `showdotfiles` / `hidedotfiles` and `showhiddenfiles` / `hidehiddenfiles` variants), `reload`, and `gcsquash [--from BRANCH | -f BRANCH] COMMIT MESSAGE...`. No Oh My Zsh plugins are required. Finder aliases require macOS. `gcsquash` requires a clean working tree and an ancestor base, detects `origin/HEAD` then local `main` or `master`, and saves a recovery reference before rewriting history. The alias runs `swiss git squash`; the Git workflow is implemented in TypeScript.

In `zsh`, `aliases` and `env` are objects mapping names to commands or values, `path` is a list of directories to prepend. Omitted settings use defaults; an explicit `aliases` object replaces the default alias selection, including `gcsquash`. Removing a setting from the config does not delete it from your shell; use the `swiss zsh` commands for that. Environment values are never printed during configuration.

For example, keep the default aliases while adding environment variables and PATH entries:

```json
{
    "zsh": {
        "env": { "GOPATH": "$HOME/go", "EDITOR": "code --wait" },
        "path": ["$GOPATH/bin", "/opt/homebrew/opt/libpq/bin"]
    }
}
```

## Commands

See the [command reference](COMMANDS.md) for every command, flag and example. You can also run `swiss --help` or `swiss <command> --help`.

## Development

`npm run readme` regenerates the [command reference](COMMANDS.md) from each command's description, args, flags and examples, so update those rather than editing the generated file. `npm run readme:check` fails when the reference is out of date.
