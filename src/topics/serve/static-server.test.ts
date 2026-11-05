import type { Server } from "node:http";
import {
    chmod,
    mkdir,
    mkdtemp,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServeOptions } from "./static-server.js";
import { StaticServer } from "./static-server.js";

describe("StaticServer", () => {
    describe("contentType", () => {
        it("adds a charset to text types", () => {
            expect(StaticServer.contentType("index.HTML")).toBe(
                "text/html; charset=utf-8"
            );
            expect(StaticServer.contentType("data.json")).toBe(
                "application/json; charset=utf-8"
            );
        });

        it("leaves binary types alone", () => {
            expect(StaticServer.contentType("logo.png")).toBe("image/png");
            expect(StaticServer.contentType("app.wasm")).toBe(
                "application/wasm"
            );
        });

        it("falls back to octet-stream", () => {
            expect(StaticServer.contentType("archive.tar")).toBe(
                "application/octet-stream"
            );
            expect(StaticServer.contentType("Makefile")).toBe(
                "application/octet-stream"
            );
        });
    });

    describe("parseRange", () => {
        it("reads start-end ranges, capping the end at the file's size", () => {
            expect(StaticServer.parseRange("bytes=0-99", 1000)).toEqual({
                end: 99,
                start: 0,
            });
            expect(StaticServer.parseRange("bytes=900-2000", 1000)).toEqual({
                end: 999,
                start: 900,
            });
        });

        it("reads open-ended and suffix ranges", () => {
            expect(StaticServer.parseRange("bytes=500-", 1000)).toEqual({
                end: 999,
                start: 500,
            });
            expect(StaticServer.parseRange("bytes=-100", 1000)).toEqual({
                end: 999,
                start: 900,
            });
            expect(StaticServer.parseRange("bytes=-5000", 1000)).toEqual({
                end: 999,
                start: 0,
            });
        });

        it("rejects ranges past the end of the file", () => {
            expect(StaticServer.parseRange("bytes=1000-", 1000)).toBe(
                "unsatisfiable"
            );
            expect(StaticServer.parseRange("bytes=5-2", 1000)).toBe(
                "unsatisfiable"
            );
            expect(StaticServer.parseRange("bytes=-0", 1000)).toBe(
                "unsatisfiable"
            );
        });

        it("ignores missing and unsupported ranges", () => {
            expect(StaticServer.parseRange(undefined, 1000)).toBeNull();
            expect(StaticServer.parseRange("bytes=-", 1000)).toBeNull();
            expect(StaticServer.parseRange("bytes=0-1,5-6", 1000)).toBeNull();
            expect(StaticServer.parseRange("items=0-1", 1000)).toBeNull();
        });
    });

    describe("resolvePath", () => {
        const root = path.resolve("/srv/site");

        it("resolves paths under the root", () => {
            expect(StaticServer.resolvePath(root, "/", false)).toBe(root);
            expect(StaticServer.resolvePath(root, "/css/app.css", false)).toBe(
                path.join(root, "css", "app.css")
            );
        });

        it("refuses to leave the root", () => {
            expect(
                StaticServer.resolvePath(root, "/../etc/passwd", false)
            ).toBeNull();
            expect(
                StaticServer.resolvePath(root, "/a/../../etc", false)
            ).toBeNull();
            expect(
                StaticServer.resolvePath(root, "/..\\etc", false)
            ).toBeNull();
            expect(StaticServer.resolvePath(root, "/a\0b", false)).toBeNull();
        });

        it("hides dotfiles unless they're allowed", () => {
            expect(StaticServer.resolvePath(root, "/.env", false)).toBeNull();
            expect(
                StaticServer.resolvePath(root, "/.git/config", false)
            ).toBeNull();
            expect(StaticServer.resolvePath(root, "/.env", true)).toBe(
                path.join(root, ".env")
            );
        });
    });

    describe("serving", () => {
        let root: string;
        let server: Server;
        let baseUrl: string;

        async function start(options: Partial<ServeOptions> = {}) {
            server = StaticServer.create({
                cors: false,
                dotfiles: false,
                root,
                spa: false,
                ...options,
            });
            const port = await StaticServer.listen(server, "127.0.0.1", 0);
            baseUrl = `http://127.0.0.1:${port}`;
        }

        function get(urlPath: string, init?: RequestInit) {
            return fetch(`${baseUrl}${urlPath}`, {
                redirect: "manual",
                ...init,
            });
        }

        beforeEach(async () => {
            root = await mkdtemp(path.join(tmpdir(), "swiss-serve-"));
            await mkdir(path.join(root, "docs"));
            await mkdir(path.join(root, "app"));
            await writeFile(path.join(root, "index.html"), "<h1>home</h1>");
            await writeFile(path.join(root, "app", "index.html"), "app");
            await writeFile(path.join(root, "docs", "a b.txt"), "0123456789");
            await writeFile(path.join(root, ".env"), "SECRET=1");
        });

        afterEach(async () => {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
            await rm(root, { force: true, recursive: true });
        });

        it("serves files and directory indexes", async () => {
            await start();

            const home = await get("/");
            expect(home.status).toBe(200);
            expect(home.headers.get("content-type")).toBe(
                "text/html; charset=utf-8"
            );
            expect(home.headers.get("cache-control")).toBe("no-store");
            expect(await home.text()).toBe("<h1>home</h1>");

            expect(await (await get("/app/")).text()).toBe("app");
            expect(await (await get("/docs/a%20b.txt")).text()).toBe(
                "0123456789"
            );
        });

        it("redirects directories to their trailing-slash path", async () => {
            await start();

            const response = await get("/app?x=1");
            expect(response.status).toBe(301);
            expect(response.headers.get("location")).toBe("/app/?x=1");
        });

        it("lists directories without an index, hiding dotfiles", async () => {
            await rm(path.join(root, "index.html"));
            await start();

            const html = await (await get("/")).text();
            expect(html).toContain('href="app/"');
            expect(html).toContain('href="docs/"');
            expect(html).not.toContain(".env");
            expect(await (await get("/docs/")).text()).toContain(
                'href="a%20b.txt"'
            );
        });

        it("doesn't serve dotfiles or paths outside the root", async () => {
            await start();

            expect((await get("/.env")).status).toBe(404);
            expect((await get("/docs/..%2f..%2fetc%2fpasswd")).status).toBe(
                404
            );
            expect((await get("/%E0%A4%A")).status).toBe(400);
        });

        it("doesn't follow symlinks out of the root", async () => {
            const outside = await mkdtemp(
                path.join(tmpdir(), "swiss-outside-")
            );
            try {
                await writeFile(path.join(outside, "secret.txt"), "outside");
                await writeFile(path.join(outside, "index.html"), "outside");
                await symlink(
                    path.join(outside, "secret.txt"),
                    path.join(root, "linked.txt")
                );
                await symlink(outside, path.join(root, "linked-dir"));
                await mkdir(path.join(root, "site"));
                await symlink(
                    path.join(outside, "index.html"),
                    path.join(root, "site", "index.html")
                );
                await start();

                expect((await get("/linked.txt")).status).toBe(404);
                expect((await get("/linked-dir/secret.txt")).status).toBe(404);
                expect(await (await get("/site/")).text()).not.toContain(
                    "outside"
                );
            } finally {
                await rm(outside, { force: true, recursive: true });
            }
        });

        it("follows symlinks that stay in the root, unless they lead to a dotfile", async () => {
            await symlink(
                path.join(root, "docs", "a b.txt"),
                path.join(root, "latest.txt")
            );
            await symlink(path.join(root, ".env"), path.join(root, "env.txt"));
            await start();

            expect(await (await get("/latest.txt")).text()).toBe("0123456789");
            expect((await get("/env.txt")).status).toBe(404);
        });

        it.skipIf(process.getuid?.() === 0)(
            "reports errors to whoever's serving, not to the client",
            async () => {
                const errors: unknown[] = [];
                await start({ onError: (error) => errors.push(error) });
                await chmod(path.join(root, "docs"), 0o000);
                try {
                    const response = await get("/docs/");

                    expect(response.status).toBe(500);
                    expect(await response.text()).toBe("Internal server error");
                    expect(errors).toHaveLength(1);
                } finally {
                    await chmod(path.join(root, "docs"), 0o755);
                }
            }
        );

        it("reads a path starting with // as a path, not a host", async () => {
            await mkdir(path.join(root, "x"));
            await writeFile(path.join(root, "y.txt"), "root");
            await writeFile(path.join(root, "x", "y.txt"), "nested");
            await start();

            expect(await (await get("//x/y.txt")).text()).toBe("nested");
        });

        it("serves dotfiles when they're allowed", async () => {
            await start({ dotfiles: true });

            expect(await (await get("/.env")).text()).toBe("SECRET=1");
        });

        it("serves byte ranges", async () => {
            await start();

            const partial = await get("/docs/a%20b.txt", {
                headers: { Range: "bytes=2-4" },
            });
            expect(partial.status).toBe(206);
            expect(partial.headers.get("content-range")).toBe("bytes 2-4/10");
            expect(await partial.text()).toBe("234");

            const unsatisfiable = await get("/docs/a%20b.txt", {
                headers: { Range: "bytes=50-" },
            });
            expect(unsatisfiable.status).toBe(416);
        });

        it("falls back to index.html for single-page apps", async () => {
            await start();
            expect((await get("/users/42")).status).toBe(404);
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));

            await start({ spa: true });
            const response = await get("/users/42");
            expect(response.status).toBe(200);
            expect(await response.text()).toBe("<h1>home</h1>");
        });

        it("adds CORS headers when asked", async () => {
            await start({ cors: true });

            expect(
                (await get("/")).headers.get("access-control-allow-origin")
            ).toBe("*");
            expect((await get("/", { method: "OPTIONS" })).status).toBe(204);
        });

        it("only allows GET and HEAD", async () => {
            await start();

            const head = await get("/docs/a%20b.txt", { method: "HEAD" });
            expect(head.status).toBe(200);
            expect(head.headers.get("content-length")).toBe("10");
            expect((await get("/", { method: "POST" })).status).toBe(405);
        });

        it("reports each request", async () => {
            const requests: string[] = [];
            await start({
                onRequest: ({ method, status, url }) =>
                    requests.push(`${method} ${status} ${url}`),
            });

            await (await get("/missing")).text();
            expect(requests).toEqual(["GET 404 /missing"]);
        });
    });

    describe("listen", () => {
        it("moves on to the next port when one is taken", async () => {
            const first = StaticServer.create({
                cors: false,
                dotfiles: false,
                root: tmpdir(),
                spa: false,
            });
            const second = StaticServer.create({
                cors: false,
                dotfiles: false,
                root: tmpdir(),
                spa: false,
            });
            try {
                const taken = await StaticServer.listen(first, "127.0.0.1", 0);
                await expect(
                    StaticServer.listen(second, "127.0.0.1", taken)
                ).rejects.toMatchObject({ code: "EADDRINUSE" });
                const port = await StaticServer.listen(
                    second,
                    "127.0.0.1",
                    taken,
                    5
                );
                expect(port).toBeGreaterThan(taken);
            } finally {
                first.close();
                second.close();
            }
        });
    });
});
