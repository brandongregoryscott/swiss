import type { ManifestBump } from "./manifests.js";

function fakeBump(overrides: Partial<ManifestBump> = {}): ManifestBump {
    return {
        current: "^1.2.0",
        currentVersion: "1.2.0",
        next: "^1.4.0",
        path: "package.json",
        section: "dependencies",
        status: "bump",
        ...overrides,
    };
}

function fakeManifest(fields: Record<string, unknown>): string {
    return `${JSON.stringify(fields, null, 2)}\n`;
}

export { fakeBump, fakeManifest };
