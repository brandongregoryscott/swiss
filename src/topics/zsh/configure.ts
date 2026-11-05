import type { ZshConfig } from "../../shared/config/zsh-config.js";
import type { Change } from "./startup.js";
import { ZshError, ZshStartup } from "./startup.js";

type ConfigureChange = {
    change: Change;
    kind: string;
    name: string;
};

// Plan every change in memory before saving, so invalid settings don't partially apply.
function configureZsh(
    startup: ZshStartup,
    settings: ZshConfig
): ConfigureChange[] {
    const changes: ConfigureChange[] = [];
    for (const [name, command] of Object.entries(settings.aliases)) {
        const functions = startup
            .aliases()
            .filter(
                ({ statement }) =>
                    statement.kind === "function" && statement.name === name
            );
        const blocked = functions.find(({ statement }) => !statement.editable);
        if (blocked != null) {
            throw new ZshError(
                `Can't change ${name}, since ${ZshStartup.readOnlyReason(blocked)}`
            );
        }
        startup.remove(functions);
        changes.push({
            change: startup.setAlias(name, command),
            kind: "alias",
            name,
        });
    }
    for (const [name, value] of Object.entries(settings.env)) {
        changes.push({
            change: startup.setExport(name, value),
            kind: "env",
            name,
        });
    }
    for (const directory of settings.path) {
        const resolved = startup.resolveDir(directory);
        changes.push({
            change: startup.addPath(resolved, { append: false }),
            kind: "path",
            name: directory,
        });
    }
    return changes;
}

export { configureZsh };
