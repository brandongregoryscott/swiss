import { isEmpty, sumBy } from "lodash-es";
import path from "node:path";
import { SwissCommand } from "../../shared/command.js";
import { Text } from "../../shared/text.js";
import { EnvFiles } from "../../topics/env/files.js";
import { ENV_DIR_FLAG } from "../../topics/env/flags.js";

export default class EnvCheck extends SwissCommand {
    static override description = `Check each app's env files against its .env.example, to find the variables you still need to set.

Every .env.example, .env.sample or .env.template under the git repo's root (or --dir) is compared with the files it describes in the same directory. .env.example describes .env and .env.local, and a variable set in either counts. One for a specific environment, like .env.production.example, describes .env.production.

Variables the template lists that aren't set are shown as missing. Variables that are set but aren't in the template are shown as extra, since the template may need them added.

Exits with 1 when anything is missing, so it can run before starting the apps.`;

    static override examples = [
        "<%= config.bin %> <%= command.id %>",
        {
            command: "<%= config.bin %> <%= command.id %> && npm run dev",
            description: "Only start the apps when nothing is missing",
        },
    ];

    static override flags = {
        dir: ENV_DIR_FLAG,
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(EnvCheck);

        const root = await EnvFiles.root(flags.dir);
        const reports = await EnvFiles.checkTemplates(
            root,
            await EnvFiles.find(root)
        );
        if (isEmpty(reports)) {
            this.log(
                `No env templates, like .env.example, under ${Text.displayPath(root)}`
            );
            return;
        }

        for (const [index, report] of reports.entries()) {
            if (index > 0) {
                this.log("");
            }
            const described = isEmpty(report.files)
                ? `${report.names[0]} (doesn't exist)`
                : report.files
                      .map((file) => path.basename(file.path))
                      .join(", ");
            this.log(
                `${this.style("bold", report.template.display)} ${this.style("dim", `→ ${described}`)}`
            );
            if (isEmpty(report.missing) && isEmpty(report.extra)) {
                this.log(this.style("green", "  everything is set"));
                continue;
            }
            for (const key of report.missing) {
                this.log(`  ${this.style("red", "missing")}  ${key}`);
            }
            for (const key of report.extra) {
                this.log(
                    `  ${this.style("yellow", "extra")}    ${key} ${this.style("dim", "(not in the template)")}`
                );
            }
        }

        const missingCount = sumBy(reports, (report) => report.missing.length);
        if (missingCount > 0) {
            this.log(
                this.style(
                    "dim",
                    `\n${Text.pluralize(missingCount, "variable")} missing; set them with \`${this.config.bin} env set\` or \`${this.config.bin} env edit\``
                )
            );
            this.exit(1);
        }
    }
}
