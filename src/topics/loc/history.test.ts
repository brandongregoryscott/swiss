import { sumBy } from "lodash-es";
import { execFileSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { LocBucket } from "./history.js";
import { LocHistory } from "./history.js";
import { Loc } from "./loc.js";

let root: string;

beforeAll(() => {
    const gitConfigDir = mkdtempSync(path.join(tmpdir(), "swiss-gitconfig-"));
    const gitConfig = path.join(gitConfigDir, "gitconfig");
    writeFileSync(gitConfig, "");
    vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfig);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterAll(() => {
    vi.unstubAllEnvs();
});

beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "swiss-loc-")));
    git("init", "-q", "-b", "main");
});

afterEach(() => {
    rmSync(root, { force: true, recursive: true });
});

describe("LocHistory", () => {
    describe("points", () => {
        it("keeps a running total along first parents that matches the current count", async () => {
            write("a.ts", "1\n2\n3\n");
            write("package-lock.json", "lots\nof\nlines\n");
            commit("2024-01-01T12:00:00", "Ada", "ada@example.com");
            git("checkout", "-q", "-b", "feature");
            write("b.ts", "1\n2\n");
            commit("2024-01-10T12:00:00", "Ada", "ada@example.com");
            git("checkout", "-q", "main");
            write("a.ts", "1\n");
            commit("2024-01-05T12:00:00", "Ada", "ada@example.com");
            git("merge", "-q", "--no-ff", "-m", "merge", "feature");
            write("logo.png", "\0binary");
            commit("2024-02-01T12:00:00", "Ada", "ada@example.com");

            const points = await LocHistory.points(root);

            expect(points.map((point) => point.lines)).toEqual([3, 1, 3, 3]);
            const files = await Loc.count(root);
            expect(sumBy(files, "lines")).toBe(3);
        });

        it("counts files that turn binary or back to text from their contents", async () => {
            write("data.txt", "1\n2\n3\n");
            commit("2024-01-01T12:00:00", "Ada", "ada@example.com");
            write("data.txt", "\0binary\n");
            commit("2024-01-02T12:00:00", "Ada", "ada@example.com");
            write("data.txt", "1\n2\n3\n4\n5\n");
            commit("2024-01-03T12:00:00", "Ada", "ada@example.com");
            write("data.txt", "1\n2\n");
            commit("2024-01-04T12:00:00", "Ada", "ada@example.com");

            const points = await LocHistory.points(root);

            expect(points.map((point) => point.lines)).toEqual([3, 0, 5, 2]);
        });
    });

    describe("bucket", () => {
        it("carries the count through intervals without commits", () => {
            const points = [
                { date: new Date(2024, 0, 5), lines: 10, sha: "a" },
                { date: new Date(2024, 0, 20), lines: 15, sha: "b" },
                { date: new Date(2024, 2, 3), lines: 12, sha: "c" },
            ];

            expect(
                LocHistory.bucket(points, "month").map(
                    ({ change, label, lines }) => [label, lines, change]
                )
            ).toEqual([
                ["2024-01", 15, 15],
                ["2024-02", 15, 0],
                ["2024-03", 12, -3],
            ]);
        });

        it("starts weeks on Monday", () => {
            const points = [
                { date: new Date(2024, 0, 7), lines: 1, sha: "a" },
                { date: new Date(2024, 0, 8), lines: 2, sha: "b" },
            ];

            expect(
                LocHistory.bucket(points, "week").map((bucket) => bucket.label)
            ).toEqual(["2024-01-01", "2024-01-08"]);
        });
    });

    describe("chart", () => {
        const buckets: LocBucket[] = [
            {
                change: 1200,
                label: "2024",
                lines: 1200,
                start: new Date(2024, 0),
            },
            {
                change: -200,
                label: "2025",
                lines: 1000,
                start: new Date(2025, 0),
            },
            { change: 0, label: "2026", lines: 1000, start: new Date(2026, 0) },
        ];

        it("lines the columns and bars up, filling the width the columns leave with the biggest bar", () => {
            const lines = LocHistory.chart(buckets, "year", {
                style: (_, text) => text,
                width: 40,
            });

            expect(lines).toEqual([
                "YEAR  LINES  CHANGE",
                "2024  1,200  +1,200  ██████████████████",
                "2025  1,000  -200    ███████████████",
                "2026  1,000  0       ███████████████",
            ]);
        });

        it("colors the changes, but not the padding after them", () => {
            const [, gain, loss, same] = LocHistory.chart(buckets, "year", {
                style: (style, text) => `<${String(style)}>${text}</>`,
                width: 40,
            });

            expect(gain).toContain("<green>+1,200</>  ");
            expect(loss).toContain("<red>-200</>    ");
            expect(same).toContain("  0       <cyan>");
        });

        it("keeps bars at least 10 wide in a narrow terminal", () => {
            const [, row] = LocHistory.chart(buckets, "year", {
                style: (_, text) => text,
                width: 10,
            });

            expect(row).toMatch(/█{10}$/);
        });
    });

    describe("autoInterval", () => {
        it("picks the smallest interval that fits in 60 rows", () => {
            const start = new Date(2020, 0, 1);
            expect(LocHistory.autoInterval(start, new Date(2020, 1, 1))).toBe(
                "day"
            );
            expect(LocHistory.autoInterval(start, new Date(2020, 9, 1))).toBe(
                "week"
            );
            expect(LocHistory.autoInterval(start, new Date(2024, 0, 1))).toBe(
                "month"
            );
            expect(LocHistory.autoInterval(start, new Date(2030, 0, 1))).toBe(
                "year"
            );
        });
    });
});

function write(file: string, contents: string): void {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
}

function commit(date: string, name: string, email: string): void {
    git("add", "-A");
    execFileSync("git", ["commit", "-q", "-m", date], {
        cwd: root,
        env: {
            ...process.env,
            GIT_AUTHOR_DATE: date,
            GIT_AUTHOR_EMAIL: email,
            GIT_AUTHOR_NAME: name,
            GIT_COMMITTER_DATE: date,
            GIT_COMMITTER_EMAIL: email,
            GIT_COMMITTER_NAME: name,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
}

function git(...args: string[]): string {
    return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: {
            ...process.env,
            GIT_AUTHOR_DATE: "2024-03-01T12:00:00",
            GIT_AUTHOR_EMAIL: "ada@example.com",
            GIT_AUTHOR_NAME: "Ada",
            GIT_COMMITTER_DATE: "2024-03-01T12:00:00",
            GIT_COMMITTER_EMAIL: "ada@example.com",
            GIT_COMMITTER_NAME: "Ada",
        },
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}
