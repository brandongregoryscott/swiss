import type { Dirent, Stats } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { flatten } from "lodash-es";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

type ServeOptions = {
    // Allow requests from any origin.
    cors: boolean;
    // Serve files and directories whose names start with a dot, which are otherwise hidden.
    dotfiles: boolean;
    // A request that failed unexpectedly. The client only sees a 500, without the details.
    onError?: (error: unknown) => void;
    onRequest?: (request: ServedRequest) => void;
    // An absolute path to the directory to serve.
    root: string;
    // Serve the root index.html for paths that don't exist, for single-page apps with client-side routing.
    spa: boolean;
};

type ServedRequest = {
    durationMs: number;
    method: string;
    status: number;
    url: string;
};

// An inclusive byte range of a file.
type ByteRange = { end: number; start: number };

const CONTENT_TYPES: Record<string, string> = {
    ".avif": "image/avif",
    ".css": "text/css",
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".htm": "text/html",
    ".html": "text/html",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".map": "application/json",
    // text/markdown and text/yaml make browsers download the file instead of showing it.
    ".md": "text/plain",
    ".mjs": "text/javascript",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".otf": "font/otf",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".wasm": "application/wasm",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webmanifest": "application/manifest+json",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml",
    ".yaml": "text/plain",
    ".yml": "text/plain",
};

// Text types that get an explicit charset, so non-ASCII text isn't garbled.
const UTF8_TYPES = new Set([
    "application/json",
    "application/manifest+json",
    "application/xml",
    "image/svg+xml",
]);

class StaticServer {
    static contentType(file: string): string {
        const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
        if (type == null) {
            return "application/octet-stream";
        }
        return type.startsWith("text/") || UTF8_TYPES.has(type)
            ? `${type}; charset=utf-8`
            : type;
    }

    static create(options: ServeOptions): Server {
        // Where the root really is, like /private/tmp for /tmp, for keeping symlinks inside it.
        const realRoot = realpath(options.root).catch(() => options.root);
        return createServer((request, response) => {
            const started = performance.now();
            response.on("finish", () => {
                options.onRequest?.({
                    durationMs: performance.now() - started,
                    method: request.method ?? "",
                    status: response.statusCode,
                    url: request.url ?? "",
                });
            });
            realRoot
                .then((root) => handle(request, response, options, root))
                .catch((error: unknown) => {
                    options.onError?.(error);
                    if (response.headersSent) {
                        response.destroy();
                    } else {
                        sendText(response, 500, "Internal server error");
                    }
                });
        });
    }

    // Listens on port, or when it's in use and tries is more than 1, on the next free port after
    // it. Resolves to the port it's listening on.
    static async listen(
        server: Server,
        host: string,
        port: number,
        tries = 1
    ): Promise<number> {
        for (let attempt = 0; ; attempt++) {
            try {
                await listenOnce(server, host, port + attempt);
                const address = server.address();
                return typeof address === "object" && address != null
                    ? address.port
                    : port + attempt;
            } catch (error) {
                if (
                    (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
                    attempt >= tries - 1 ||
                    port + attempt >= 65535
                ) {
                    throw error;
                }
            }
        }
    }

    // Reads a Range header for a file of the given size. Null means there's no range, or one that
    // isn't supported (like several ranges), so the whole file should be sent.
    static parseRange(
        header: string | undefined,
        size: number
    ): "unsatisfiable" | ByteRange | null {
        const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
        if (match == null || (match[1] === "" && match[2] === "")) {
            return null;
        }
        if (match[1] === "") {
            // A suffix range, like bytes=-500 for the last 500 bytes.
            const length = Number(match[2]);
            if (length === 0 || size === 0) {
                return "unsatisfiable";
            }
            return { end: size - 1, start: Math.max(size - length, 0) };
        }
        const start = Number(match[1]);
        const end =
            match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
        return start >= size || start > end ? "unsatisfiable" : { end, start };
    }

    // The file a decoded URL path points to under root, or null when it's outside root or, unless
    // dotfiles is set, inside a hidden file or directory.
    static resolvePath(
        root: string,
        urlPath: string,
        dotfiles: boolean
    ): null | string {
        if (urlPath.includes("\0")) {
            return null;
        }
        const segments = urlPath
            .split(/[/\\]/)
            .filter((segment) => segment !== "");
        if (segments.includes("..")) {
            return null;
        }
        if (!dotfiles && segments.some((segment) => segment.startsWith("."))) {
            return null;
        }
        const file = path.join(root, ...segments);
        const relative = path.relative(root, file);
        return relative.startsWith("..") || path.isAbsolute(relative)
            ? null
            : file;
    }

    // The URLs the server can be reached at. Servers on every interface get one per network
    // address, after localhost.
    static urls(host: string, port: number): string[] {
        if (host !== "0.0.0.0" && host !== "::") {
            return [`http://${formatHost(host)}:${port}`];
        }
        const addresses = flatten(Object.values(networkInterfaces()))
            .filter(
                (info) =>
                    info != null &&
                    !info.internal &&
                    // Servers on 0.0.0.0 only accept IPv4.
                    (info.family === "IPv4" || host === "::")
            )
            .map((info) => info!.address);
        return [
            `http://localhost:${port}`,
            ...addresses.map(
                (address) => `http://${formatHost(address)}:${port}`
            ),
        ];
    }
}

async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: ServeOptions,
    realRoot: string
): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    if (options.cors) {
        response.setHeader("Access-Control-Allow-Origin", "*");
    }
    if (request.method === "OPTIONS" && options.cors) {
        response.setHeader("Access-Control-Allow-Headers", "*");
        response.setHeader(
            "Access-Control-Allow-Methods",
            "GET, HEAD, OPTIONS"
        );
        response.writeHead(204).end();
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendText(response, 405, "Method not allowed");
        return;
    }

    // Read as a path, so one starting with //, like //x/y, isn't taken as a host and a path.
    const url = new URL(`http://localhost${request.url ?? "/"}`);
    let urlPath: string;
    try {
        urlPath = decodeURIComponent(url.pathname);
    } catch {
        sendText(response, 400, "Bad request");
        return;
    }

    const requested = StaticServer.resolvePath(
        options.root,
        urlPath,
        options.dotfiles
    );
    const file =
        requested == null
            ? null
            : await contained(realRoot, requested, options.dotfiles);
    const stats = file == null ? null : await statOrNull(file);

    if (file != null && stats?.isDirectory() === true) {
        // Without the trailing slash, relative links in the page would resolve against the parent.
        if (!url.pathname.endsWith("/")) {
            response
                .writeHead(301, { Location: `${url.pathname}/${url.search}` })
                .end();
            return;
        }
        const index = await contained(
            realRoot,
            path.join(file, "index.html"),
            options.dotfiles
        );
        const indexStats = index == null ? null : await statOrNull(index);
        if (index != null && indexStats?.isFile() === true) {
            sendFile(request, response, index, indexStats);
            return;
        }
        const entries = await readdir(file, { withFileTypes: true });
        sendHtml(
            request,
            response,
            renderListing(urlPath, entries, options.dotfiles)
        );
        return;
    }
    if (file != null && stats?.isFile() === true) {
        sendFile(request, response, file, stats);
        return;
    }

    if (options.spa) {
        const index = await contained(
            realRoot,
            path.join(options.root, "index.html"),
            options.dotfiles
        );
        const indexStats = index == null ? null : await statOrNull(index);
        if (index != null && indexStats?.isFile() === true) {
            sendFile(request, response, index, indexStats);
            return;
        }
    }
    sendText(response, 404, "Not found");
}

function sendFile(
    request: IncomingMessage,
    response: ServerResponse,
    file: string,
    stats: Stats
): void {
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", StaticServer.contentType(file));
    response.setHeader("Last-Modified", stats.mtime.toUTCString());

    const range = StaticServer.parseRange(request.headers.range, stats.size);
    if (range === "unsatisfiable") {
        response
            .writeHead(416, { "Content-Range": `bytes */${stats.size}` })
            .end();
        return;
    }
    if (range == null) {
        response.writeHead(200, { "Content-Length": stats.size });
    } else {
        response.writeHead(206, {
            "Content-Length": range.end - range.start + 1,
            "Content-Range": `bytes ${range.start}-${range.end}/${stats.size}`,
        });
    }
    if (request.method === "HEAD") {
        response.end();
        return;
    }
    createReadStream(file, range ?? {})
        .on("error", () => response.destroy())
        .pipe(response);
}

function sendHtml(
    request: IncomingMessage,
    response: ServerResponse,
    html: string
): void {
    response.writeHead(200, {
        "Content-Length": Buffer.byteLength(html),
        "Content-Type": "text/html; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : html);
}

function sendText(
    response: ServerResponse,
    status: number,
    text: string
): void {
    response.writeHead(status, {
        "Content-Length": Buffer.byteLength(text),
        "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(text);
}

function renderListing(
    urlPath: string,
    entries: Dirent[],
    dotfiles: boolean
): string {
    const visible = entries
        .filter((entry) => dotfiles || !entry.name.startsWith("."))
        .sort((a, b) =>
            a.isDirectory() === b.isDirectory()
                ? a.name.localeCompare(b.name)
                : a.isDirectory()
                  ? -1
                  : 1
        );
    const links = [
        ...(urlPath === "/" ? [] : [`<li><a href="../">../</a></li>`]),
        ...visible.map((entry) => {
            const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
            return `<li><a href="${escapeHtml(encodeURIComponent(entry.name))}${entry.isDirectory() ? "/" : ""}">${escapeHtml(name)}</a></li>`;
        }),
    ];
    const title = escapeHtml(urlPath);
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; }
ul { list-style: none; padding: 0; }
a { text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>${title}</h1>
<ul>
${links.join("\n")}
</ul>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function formatHost(host: string): string {
    return host.includes(":") ? `[${host}]` : host;
}

function listenOnce(server: Server, host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
        });
    });
}

// Where file really is once symlinks are followed, when that's inside root and, unless dotfiles
// is set, isn't a dotfile or inside a hidden directory. Null otherwise, or when it doesn't exist,
// so a symlink can't serve something the root doesn't hold.
async function contained(
    realRoot: string,
    file: string,
    dotfiles: boolean
): Promise<null | string> {
    const real = await realpath(file).catch(() => null);
    if (real == null) {
        return null;
    }
    const relative = path.relative(realRoot, real);
    const segments = relative === "" ? [] : relative.split(path.sep);
    if (segments[0] === ".." || path.isAbsolute(relative)) {
        return null;
    }
    if (!dotfiles && segments.some((segment) => segment.startsWith("."))) {
        return null;
    }
    return real;
}

async function statOrNull(file: string): Promise<null | Stats> {
    try {
        return await stat(file);
    } catch {
        return null;
    }
}

export type { ByteRange, ServedRequest, ServeOptions };
export { StaticServer };
