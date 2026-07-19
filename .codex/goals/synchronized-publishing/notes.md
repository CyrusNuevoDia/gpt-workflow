# Synchronized publishing execution notes

## Protected worktree state

The user has uncommitted edits in:

- `skills/workflow/SKILL.md`
- `skills/workflow/references/workflow-language.md`

Do not stage, commit, restore, or format them. Their combined binary diff
SHA-256 at goal creation is
`6f493a78bb17d3c94e317ca504979169631ca091c809f08b1fdf3fe05ca2b277`.

## Secret handling

Never display `.env.ci`, shell-trace a command that sources it, interpolate the
token into a tool call, or include it in Git. Load the named variable silently,
set the GitHub repository secret, then verify only that the secret name exists.

## Live compatibility evidence at goal creation

- npm reports `gpt-workflow@0.3.3` exists.
- PyPI's `gpt-workflow` JSON endpoint returns 404.
- Fresh-cache `bunx --bun gpt-workflow@0.3.3 models` exits 1 with
  `expected run, list, or status`.
- `origin/main` is `763b4bd`; `feat/python` is two commits ahead and contains
  the current `0.3.3` sources.

These facts make `0.3.4`, not Python `0.3.3`, the first honest synchronized
release while preserving the requested `0.3.3` first human push.
