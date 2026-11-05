import { describe, expect, it } from "vitest";
import { CommandError } from "../exec.js";
import { GitHub } from "./github.js";

describe("GitHub.parseOrgRepos", () => {
    it("maps gh's JSON, flattening the default branch", () => {
        expect(
            GitHub.parseOrgRepos(
                JSON.stringify([
                    {
                        defaultBranchRef: { name: "main" },
                        isArchived: false,
                        isFork: true,
                        name: "widget",
                        sshUrl: "git@github.com:acme/widget.git",
                        url: "https://github.com/acme/widget",
                    },
                    {
                        defaultBranchRef: null,
                        isArchived: true,
                        isFork: false,
                        name: "empty",
                        sshUrl: "git@github.com:acme/empty.git",
                        url: "https://github.com/acme/empty",
                    },
                ])
            )
        ).toEqual([
            {
                defaultBranch: "main",
                isArchived: false,
                isFork: true,
                name: "widget",
                sshUrl: "git@github.com:acme/widget.git",
                url: "https://github.com/acme/widget",
            },
            {
                defaultBranch: null,
                isArchived: true,
                isFork: false,
                name: "empty",
                sshUrl: "git@github.com:acme/empty.git",
                url: "https://github.com/acme/empty",
            },
        ]);
    });

    it("refuses output that isn't a list", () => {
        expect(() => GitHub.parseOrgRepos('{"message":"Not Found"}')).toThrow(
            CommandError
        );
    });
});
