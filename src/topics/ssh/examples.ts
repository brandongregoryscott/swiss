import { compact } from "lodash-es";

type SshExample = {
    command: string;
    description: string;
};

const EXAMPLES: SshExample[] = [
    {
        command: "ssh -N -L 3000:localhost:3000 host",
        description:
            "Forward a port: localhost:3000 here reaches localhost:3000 on host (swiss ssh forward host 3000)",
    },
    {
        command: "ssh -N -L 5432:db.internal:5432 bastion",
        description:
            "Forward a port to a machine only bastion can see (swiss ssh forward bastion 5432 --target db.internal)",
    },
    {
        command: "ssh -N -R 9000:localhost:3000 host",
        description:
            "Reverse forward a port: localhost:9000 on host reaches port 3000 here (swiss ssh forward host 3000:9000 -R)",
    },
    {
        command: "ssh -N -D 1080 host",
        description:
            "SOCKS proxy on port 1080 that sends traffic out through host, like to browse from its network",
    },
    {
        command: "ssh -N host",
        description:
            "-N: connect without running a command or opening a shell, for forwards",
    },
    {
        command: "ssh -f -N -L 3000:localhost:3000 host",
        description:
            "-f: go to the background once connected, so the forward outlives the terminal",
    },
    {
        command: "ssh -J bastion host",
        description:
            "Jump: connect to host through bastion (ProxyJump bastion in config)",
    },
    {
        command: "ssh -A host",
        description:
            "Forward your ssh agent, so git on host can use your keys (only to hosts you trust)",
    },
    {
        command: "ssh -t host 'tmux new -A -s main'",
        description:
            "Run an interactive command, like attaching to a tmux session that survives disconnects",
    },
    {
        command: "ssh -v host",
        description:
            "Debug a connection: shows which config, keys and auth methods are tried (-vvv for more)",
    },
    {
        command: "ssh -G host",
        description:
            "Print the config ssh would use for host after applying every matching block",
    },
    {
        command: "~.",
        description:
            "Escape: kill a frozen session (Enter first, then ~ then .); ~? lists the others",
    },
    {
        command: "ssh-copy-id host",
        description:
            "Copy your public key to host's authorized_keys, so it stops asking for a password",
    },
    {
        command: "ssh-keygen -t ed25519 -C you@example.com",
        description: "Make a new key pair",
    },
    {
        command: "ssh-keygen -R host",
        description:
            "Forget host's key in known_hosts, after it's rebuilt and the host key warning appears",
    },
    {
        command: "ssh-keygen -y -f ~/.ssh/id_ed25519",
        description: "Print the public key for a private key",
    },
    {
        command: "ssh-add --apple-use-keychain ~/.ssh/id_ed25519",
        description:
            "Add a key to the agent and store its passphrase in the macOS keychain",
    },
    {
        command: "ssh-add -l",
        description: "List the keys loaded in your ssh agent",
    },
    {
        command: "scp file.txt host:/tmp/",
        description: "Copy a file to host (host:/path to copy from it instead)",
    },
    {
        command: "rsync -avz --progress dir/ host:dir/",
        description: "Sync a directory to host, sending only what changed",
    },
    {
        command: "ssh -M -S ~/.ssh/cm-%C host",
        description:
            "Share one connection, so later sessions to host open instantly; ControlMaster auto, ControlPath and ControlPersist 10m in config do it every time",
    },
    {
        command: "ssh -O exit host",
        description:
            "Close a shared ControlMaster connection, like a stuck one",
    },
];

class SshExamples {
    static readonly EXAMPLES = EXAMPLES;

    static search(search: string | undefined): SshExample[] {
        const words = compact((search ?? "").toLowerCase().split(/\s+/));
        return EXAMPLES.filter((example) => {
            const text =
                `${example.command} ${example.description}`.toLowerCase();
            return words.every((word) => text.includes(word));
        });
    }
}

export type { SshExample };
export { SshExamples };
