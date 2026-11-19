import { groupBy, uniqBy } from "lodash-es";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OrgConfig } from "../../shared/config/org-config.js";
import type { Failure } from "../../shared/errors.js";
import type { OrgRepo } from "../../shared/git/github.js";
import type { ChangelogSource } from "./changelog.js";
import type { Lockfile, LockfileUpdater } from "./lockfiles.js";
import type { ManifestBump, ManifestCheck, Target } from "./manifests.js";
import { settle } from "../../shared/errors.js";
import { Git } from "../../shared/git/git.js";
import { GitHub } from "../../shared/git/github.js";
import { OrgClone } from "./clone.js";
import { Lockfiles } from "./lockfiles.js";
import { Manifests } from "./manifests.js";
import { PullRequestBody } from "./pull-request-body.js";

type BumpPlan =
    | {
          branch: string;
          checks: ManifestCheck[];
          defaultBranch: string;
          repoDir: string;
          status: "scanned";
      }
    | { reason: string; status: "skipped" }
    | { status: "missing" }
    | Failure;

type ScannedPlan = Extract<BumpPlan, { status: "scanned" }>;

type BumpOutcome = { status: "opened"; url: string } | Failure;

type BumpOptions = {
    changelog: ChangelogSource;
    config: OrgConfig;
    draft: boolean;
    lockfiles: LockfileUpdater;
    notes: string[];
    target: Target;
};

const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

class PackageBump {
    static async apply(
        repo: OrgRepo,
        plan: ScannedPlan,
        options: BumpOptions
    ): Promise<BumpOutcome> {
        return settle(async () => {
            const { config, target } = options;
            const bumps = PackageBump.bumps(plan);
            const tempDir = await mkdtemp(path.join(tmpdir(), "swiss-bump-"));
            const worktreeDir = path.join(tempDir, repo.name);
            await Git.run(
                plan.repoDir,
                ...NO_HOOKS,
                "worktree",
                "add",
                "--quiet",
                "--detach",
                worktreeDir,
                `origin/${plan.defaultBranch}`
            );
            try {
                await bumpWorktree(worktreeDir, bumps, target, options);
                const title = PackageBump.title(target);
                await Git.run(worktreeDir, "add", "--update");
                await Git.run(
                    worktreeDir,
                    ...NO_HOOKS,
                    "commit",
                    "--quiet",
                    "-m",
                    title
                );
                await Git.run(
                    worktreeDir,
                    ...NO_HOOKS,
                    "push",
                    "--quiet",
                    "origin",
                    `HEAD:refs/heads/${plan.branch}`
                );

                const bodyFile = path.join(tempDir, "body.md");
                await writeFile(
                    bodyFile,
                    PullRequestBody.build({
                        bumps,
                        changelog: await options.changelog(
                            target.pkg,
                            Manifests.oldestVersion(bumps),
                            target.version
                        ),
                        notes: options.notes,
                        target,
                        template: await PullRequestBody.template(worktreeDir),
                    })
                );
                const url = await GitHub.createPullRequest({
                    base: plan.defaultBranch,
                    bodyFile,
                    draft: options.draft,
                    head: plan.branch,
                    repo: {
                        host: config.scmHost,
                        name: repo.name,
                        owner: config.name,
                    },
                    title,
                });
                return { status: "opened", url };
            } finally {
                await Git.run(
                    plan.repoDir,
                    "worktree",
                    "remove",
                    "--force",
                    worktreeDir
                ).catch(() => {});
                await rm(tempDir, { force: true, recursive: true });
            }
        });
    }

    static branch(target: Target): string {
        const name = target.pkg.replace(/^@/, "").replaceAll("/", "-");
        return `bump/${name}-${target.version}`;
    }

    static bumps(plan: ScannedPlan): ManifestBump[] {
        return plan.checks.filter(
            (check): check is ManifestBump => check.status === "bump"
        );
    }

    static async plan(
        repo: OrgRepo,
        target: Target,
        config: OrgConfig
    ): Promise<BumpPlan> {
        return settle(async () => {
            const clone = await OrgClone.open(repo, config);
            if (clone.status !== "ready") {
                return clone.status === "missing"
                    ? { status: "missing" }
                    : clone;
            }

            const ref = `origin/${clone.defaultBranch}`;
            const checks = await Manifests.scan(clone.repoDir, ref, target);
            const branch = PackageBump.branch(target);
            const hasBumps = checks.some((check) => check.status === "bump");
            if (
                hasBumps &&
                (await Git.refExists(
                    clone.repoDir,
                    `refs/remotes/origin/${branch}`
                ))
            ) {
                return {
                    reason: `${branch} is already on origin`,
                    status: "skipped",
                };
            }
            return {
                branch,
                checks,
                defaultBranch: clone.defaultBranch,
                repoDir: clone.repoDir,
                status: "scanned",
            };
        });
    }

    static title(target: Target): string {
        return `chore(deps): bump ${target.pkg} to ${target.version}`;
    }
}

async function bumpWorktree(
    worktreeDir: string,
    bumps: ManifestBump[],
    target: Target,
    options: BumpOptions
): Promise<void> {
    const lockfiles: Lockfile[] = [];
    for (const [file, fileBumps] of Object.entries(
        groupBy(bumps, (bump) => bump.path)
    )) {
        const manifestPath = path.join(worktreeDir, file);
        const text = await readFile(manifestPath, "utf8");
        await writeFile(
            manifestPath,
            Manifests.rewrite(text, target.pkg, fileBumps)
        );
        const lockfile = await Lockfiles.find(
            worktreeDir,
            path.dirname(manifestPath)
        );
        if (lockfile != null) {
            lockfiles.push(lockfile);
        }
    }

    for (const lockfile of uniqBy(lockfiles, (lockfile) => lockfile.dir)) {
        await options.lockfiles.update(lockfile, worktreeDir);
    }
}

export type { BumpOptions, BumpOutcome, BumpPlan, ScannedPlan };
export { PackageBump };
