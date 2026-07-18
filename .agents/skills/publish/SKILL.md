---
name: publish
description: This skill should be used when the user asks to "publish gpt-workflow", "release a new version", "git push and verify the deploy", "verify npm publish", or "delete the npm release email".
---

# Publish gpt-workflow

Release `gpt-workflow` through its GitHub Actions workflow, prove that the
published package works for consumers, and optionally remove the corresponding
npm release notice from Gmail.

## Scope and Safety

- Treat a requested new version as a real semver release, not merely a push.
- Read `AGENTS.md` and preserve unrelated worktree changes. Stage only files
  created or edited for the release.
- Use Bun only. Do not substitute Node.js for development commands.
- Never expose tokens or other secrets.
- Treat Gmail deletion as an explicit, recoverable action: move only the exact
  confirmed release notice to Trash, never bulk-delete search results.

## Release Workflow

1. Inspect the release state.

   ```sh
   git status --short --branch
   git log --oneline --decorate -5
   bun changeset status
   sed -n '1,240p' .github/workflows/release-cli.yml
   ```

   Confirm that `.github/workflows/release-cli.yml` releases from pushes to
   `main`, and record the currently published version with:

   ```sh
   bunx --bun npm@latest view gpt-workflow version dist-tags --json
   ```

2. Add a versioned changeset when a new version is requested. Create a concise
   patch, minor, or major entry under `.changeset/` for `gpt-workflow` and
   confirm that `bun changeset status` reports the intended bump.

   Do not use `bun changeset add --empty` to mint a release. An empty
   changeset is consumed by this repository's workflow without changing
   `package.json`, so npm publication is skipped.

3. Validate before publishing.

   ```sh
   just fmt
   just check
   ```

   Stop and report failures. `just check` is the required offline package and
   installed-CLI gate. Run `just verify` only when the change touches live
   agent behavior and an authenticated Codex CLI is available.

4. Commit and push safely. Review the staged diff, commit only the release
   files authored in this task, then synchronize before pushing.

   ```sh
   git diff --cached --check
   git pull --ff-only origin main
   git push origin main
   ```

5. Track the exact release run produced by that push.

   ```sh
   gh run list --workflow release-cli.yml --branch main --limit 1 \
     --json databaseId,status,conclusion,headSha,url
   gh run watch <run-id> --exit-status
   ```

   Require a successful completed run. Do not claim a deployment or publish
   succeeded solely because the push, tag, or GitHub release page exists.

6. Verify the consumer-facing publication independently after CI completes.

   ```sh
   git fetch origin main --tags
   git ls-remote --tags origin 'gpt-workflow@*'
   bunx --bun npm@latest view gpt-workflow version dist-tags --json
   bunx gpt-workflow@<published-version> --help
   git pull --ff-only origin main
   git status --short --branch
   ```

   Require all of the following before reporting success:

   - `latest` resolves to the newly minted version.
   - The matching `gpt-workflow@<version>` tag exists on `origin`.
   - The isolated versioned CLI starts and prints its usage.
   - The local branch is fast-forwarded to CI's version-bump commit and clean.

## Gmail Release Notice

Run this section only after publication verification and only when the user
asked to inspect or delete the notice. Use the Gmail skill and search narrowly
for the exact published version, for example:

```text
from:npm subject:"Successfully published gpt-workflow@<version>" -in:trash
```

Confirm that the message subject, sender, version, and CI run link match the
release. If the user requested deletion, move that one message ID to Trash and
re-search with `in:trash` to confirm the `TRASH` label. If the email has not
arrived, leave the mailbox unchanged and report that publication is proven but
the notice is still pending.

## Completion Report

Report the pushed and release-bump SHAs, version, successful Actions run URL,
npm `latest` result, tag, isolated CLI smoke, and Gmail outcome. State clearly
when any item is pending or not independently verified.
