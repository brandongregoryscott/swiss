---
name: pre-review
description: Flag Brandon's personal code-organization/style nits against a diff or PR, modeled on his own past review comments
model: sonnet
---

This is a **personal style/organization pass**. It is not a correctness, security or risk
review: it doesn't produce a risk score, doesn't touch a PR description, and doesn't replace
whatever bug-hunting review the project uses. Run both if you want the full picture. Label your
output clearly as a personal-style pass.

Phase 1: Triage (do this yourself)

Determine what to review:

- If the surrounding prompt has already named a PR (e.g. a `PR NUMBER:` line, or an
  owner/repo#number), review that PR's diff: `gh pr diff <number>` (use
  `gh pr diff <number> --repo <owner>/<repo>` when reviewing a PR outside the current checkout).
- Else if there are uncommitted changes (check `git status`), review those: `git diff` (include
  staged and unstaged).
- Else if there's a PR associated with the current branch (check
  `gh pr view --json number -q .number 2>/dev/null`), review the PR diff: `gh pr diff`.
- Otherwise, review the branch diff against the default branch: `git diff main...HEAD` (fall
  back to `master`).

Assess size first: `--stat` for a `git diff` source, `gh pr view --json
additions,deletions,changedFiles` for a PR source.

Phase 2: Load the checklist

Read [style-guide.md](style-guide.md) in this skill's directory in full, not a summary of it.
That document is the source of truth for what counts as "Brandon's style"; this skill applies
it, it doesn't restate it. If the project has its own CLAUDE.md or style rules, they win over
the guide where they conflict.

Phase 3: Apply the checklist

Walk the diff against the categories in the checklist at the end of the style guide. The guide
is the authority on the current list, not this file.

If the diff is **small** (under 200 lines, fewer than 5 files), review it yourself. If it's
**large or complex** (200+ lines, many files), delegate to a subagent with `model: opus`,
handing it the diff and the path to the same style guide to read itself rather than a
paraphrase of it.

Phase 4: Report

For each finding: `path:line`, the category it falls under, a quote or close paraphrase of the
offending code, and a brief explanation phrased the way the style guide's examples are phrased:
name the specific existing helper/type/pattern being duplicated or missed, ask a question rather
than assert a rule where the examples do the same, and keep it to one or two sentences. Where
the fix is small and mechanical, propose it as a ` ```suggestion ` block.

Group findings by category. Don't flag correctness, security, or logic bugs. Don't compute or
mention a risk score. Don't edit any files, and don't post or edit anything on GitHub: this is a
local, read-only report for the human to act on (or not) themselves. If a file has nothing worth
flagging, say so rather than inventing a nit.
