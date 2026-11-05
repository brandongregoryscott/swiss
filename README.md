# swiss

Personal multi-tool CLI built on [oclif](https://oclif.io). Commands live in `src/commands/<topic>/<command>.ts`.

## Setup

```sh
npm install
npm run build
npm install -g . # puts `swiss` and its alias `sws` on your PATH
```

Run [`swiss configure`](COMMANDS.md#swiss-configure) to configure your machine.

## Commands

See the [command reference](COMMANDS.md) for every command, flag and example. You can also run `swiss --help` or `swiss <command> --help`.

## Development

`npm run readme` regenerates the [command reference](COMMANDS.md) from each command's description, args, flags and examples, so update those rather than editing the generated file. `npm run readme:check` fails when the reference is out of date.
