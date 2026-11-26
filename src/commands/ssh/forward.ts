import { Args, Flags } from "@oclif/core";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { SwissCommand } from "../../shared/command.js";
import { SshForward } from "../../topics/ssh/forward.js";

export default class SshForwardCommand extends SwissCommand {
    static override args = {
        host: Args.string({
            description: "Host to connect to, like a Host from your ssh config",
            required: true,
        }),
        ports: Args.string({
            description:
                "Ports to forward: 3000, a range like 3100-3105, a list like 3000,5432, or 8080:80 for a different port on each side",
            required: true,
        }),
    };

    static override description = `Forward ports between this machine and another over ssh, without remembering -L's argument order.

By default each port on the other machine is reached here: localhost:3100 here talks to localhost:3100 there. --reverse does the opposite, so the other machine reaches ports on this one.

No shell is opened (ssh -N); the forwards stay up until Ctrl+C. ssh is told to fail straight away when a port can't be forwarded, like when it's already in use here, rather than connecting without it. The ssh command is printed before it runs, so you can reuse it; --print prints it without running it.`;

    static override examples = [
        {
            command: "<%= config.bin %> <%= command.id %> work 3100-3105",
            description:
                "Reach ports 3100 to 3105 on work at localhost:3100-3105 here",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> work 3000 5432 8080:80",
            description:
                "Forward several ports, with 8080 here reaching 80 there",
        },
        {
            command: "<%= config.bin %> <%= command.id %> work 3000 --reverse",
            description: "Let work reach port 3000 on this machine",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> bastion 5432 --target db.internal",
            description: "Reach a database that only bastion can see",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> work 3100-3105 --print",
            description: "Print the ssh command without running it",
        },
    ];

    static override flags = {
        print: Flags.boolean({
            description: "Print the ssh command instead of running it",
        }),
        reverse: Flags.boolean({
            char: "R",
            description:
                "Forward ports on the other machine to this one (ssh -R) instead",
        }),
        shell: Flags.boolean({
            description: "Open a shell on the host as well, instead of ssh -N",
        }),
        target: Flags.string({
            default: "localhost",
            description:
                "Where forwarded connections go, resolved on the far side: the host for a normal forward, this machine with --reverse",
        }),
    };

    static override strict = false;

    async run(): Promise<void> {
        const { args, argv, flags } = await this.parse(SshForwardCommand);
        const forwards = SshForward.parsePorts((argv as string[]).slice(1));
        const sshArgs = SshForward.args({
            forwards,
            host: args.host,
            reverse: flags.reverse,
            shell: flags.shell,
            target: flags.target,
        });
        const command = ["ssh", ...sshArgs].join(" ");

        if (flags.print) {
            this.log(command);
            return;
        }

        this.log(this.style("dim", command));
        const ports =
            forwards.length === 1 ? "1 port" : `${forwards.length} ports`;
        this.log(
            flags.reverse
                ? `Letting ${args.host} reach ${ports} on this machine until Ctrl+C`
                : `Forwarding ${ports} from ${args.host} until Ctrl+C`
        );

        let interrupted = false;
        const onInterrupt = (): void => {
            interrupted = true;
        };
        process.on("SIGINT", onInterrupt);
        try {
            const ssh = spawn("ssh", sshArgs, { stdio: "inherit" });
            const [code] = (await once(ssh, "exit")) as [null | number];
            if (!interrupted && code !== 0) {
                this.error(`ssh exited with ${code ?? "a signal"}`);
            }
        } finally {
            process.off("SIGINT", onInterrupt);
        }
        this.log("Stopped forwarding");
    }
}
