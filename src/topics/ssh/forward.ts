import { UserError } from "../../shared/errors.js";

type Forward = {
    here: number;
    there: number;
};

type ForwardOptions = {
    forwards: Forward[];
    host: string;
    reverse: boolean;
    shell: boolean;
    target: string;
};

const MAX_PORT = 65_535;

class SshForward {
    static args(options: ForwardOptions): string[] {
        const flag = options.reverse ? "-R" : "-L";
        return [
            ...(options.shell ? [] : ["-N"]),
            "-o",
            "ExitOnForwardFailure=yes",
            ...options.forwards.flatMap(({ here, there }) => [
                flag,
                options.reverse
                    ? `${there}:${options.target}:${here}`
                    : `${here}:${options.target}:${there}`,
            ]),
            options.host,
        ];
    }

    static parsePorts(specs: string[]): Forward[] {
        const forwards = specs
            .flatMap((spec) => spec.split(","))
            .filter((spec) => spec !== "")
            .flatMap((spec) => parseSpec(spec));
        if (forwards.length === 0) {
            throw new UserError("Give at least one port, like 3000");
        }
        const seen = new Set<number>();
        for (const { here } of forwards) {
            if (seen.has(here)) {
                throw new UserError(`Port ${here} is given more than once`);
            }
            seen.add(here);
        }
        return forwards;
    }
}

function parseSpec(spec: string): Forward[] {
    const range = /^(\d+)-(\d+)$/.exec(spec);
    if (range != null) {
        const first = toPort(range[1]!, spec);
        const last = toPort(range[2]!, spec);
        if (last < first) {
            throw new UserError(
                `${spec} isn't a port range; the first port has to come first`
            );
        }
        return Array.from({ length: last - first + 1 }, (_, index) => ({
            here: first + index,
            there: first + index,
        }));
    }
    const pair = /^(\d+)(?::(\d+))?$/.exec(spec);
    if (pair == null) {
        throw new UserError(
            `${spec} isn't a port; use 3000, a range like 3000-3005, or 8080:80 for a different port on each side`
        );
    }
    const here = toPort(pair[1]!, spec);
    return [{ here, there: pair[2] == null ? here : toPort(pair[2], spec) }];
}

function toPort(text: string, spec: string): number {
    const port = Number(text);
    if (port < 1 || port > MAX_PORT) {
        throw new UserError(`${spec} has a port outside 1-${MAX_PORT}`);
    }
    return port;
}

export type { Forward, ForwardOptions };
export { SshForward };
