import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nullIfMissing } from "../../shared/errors.js";

type InstalledProfile = {
    path: string;
    status: "added" | "unchanged" | "updated";
};

class TerminalProfile {
    static readonly ASSET = new URL(
        "../../../assets/terminal/Basic (dark).terminal",
        import.meta.url
    );

    static readonly NAME = "Basic (dark).terminal";

    // The same asset path works from src/ and the installed package's dist/.
    static async install(
        dataDir: string,
        platform: NodeJS.Platform = process.platform
    ): Promise<InstalledProfile | null> {
        if (platform !== "darwin") {
            return null;
        }
        const destination = path.join(
            dataDir,
            "terminal",
            TerminalProfile.NAME
        );
        const bundled = await readFile(TerminalProfile.ASSET);
        const existing = await readFile(destination).catch(nullIfMissing);
        if (existing?.equals(bundled) === true) {
            return { path: destination, status: "unchanged" };
        }
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bundled);
        return {
            path: destination,
            status: existing == null ? "added" : "updated",
        };
    }
}

export { TerminalProfile };
