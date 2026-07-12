# GPT Workflow Distribution Goal

Companion plan: [`plan.md`](plan.md)

## Outcome

Turn the completed GPT workflow runtime into a clean, public-facing GitHub
repository whose package can be built, packed, installed, imported, and used by
a fresh consumer without relying on files or state from this checkout.

The repository is ready when its npm tarball exposes a deliberate ESM library
API and a `gpt-workflow run <script.js>` executable, a clean temporary project
can install and exercise that tarball, and the same package lifecycle supports
installation from the GitHub repository. Publishing to npm is not required.

## Baseline

- The runtime and its offline/live parity suite are implemented and previously
  passed the complete R1-R15 verifier: 13 discovered workflows, 16 completed
  invocations, zero failed/pending/skipped invocations, and 57 offline tests.
- `package.json` is currently private, has no version, and points `module` at a
  nonexistent root `index.ts`.
- `npm pack --dry-run --json` currently fails with
  `Invalid package, must have name and version`.
- There is no public package entrypoint, build output contract, declaration
  output, `files` allowlist, or package-install smoke test.
- `README.md` incorrectly says the repository contains no implementation.
- Root `GOAL.md`, `VERIFY.md`, and `PARITY.md` are development-era artifacts,
  not the intended public product surface.
- `.verification-artifacts/` is absent and ignored, but the ignore contract and
  package allowlist must prevent future runtime evidence from leaking.
- Two Claude composition fixtures contain checkout-specific absolute paths and
  must become repository-portable without weakening mirror/parity coverage.
- No Git remote is currently configured, so a real remote GitHub install cannot
  be exercised until the repository URL exists locally or is supplied.

## Constraints

- Keep the public command surface to `gpt-workflow run <script.js>` until
  concrete usage requires more commands or flags.
- Export a narrow, intentional public API for workflow execution and App Server
  control. Keep journaling, worktree, verification, and scheduler internals
  private unless a public type requires them.
- Produce Node 24-compatible ESM JavaScript and declarations while preserving
  Bun as the development, test, and workflow runtime.
- Keep the library Node-compatible. The executable may require Bun and should
  use Bun's native argv/file APIs with `parseArgs` rather than a CLI framework.
- Keep repository operations in `justfile`: `just check` is the deterministic
  aggregate gate, `just verify` is the explicit token-spending live suite, and
  `just mirror` regenerates fixtures. Keep `package.json#scripts` limited to npm
  build and prepare lifecycle needs.
- Keep one root TypeScript configuration; do not add a package-build-specific
  `tsconfig` for this single-package repository.
- Make the root TypeScript project cover all source and test TypeScript rather
  than enumerating only the package dependency graph. Keep non-package output
  out of npm through the manifest allowlist, not by hiding code from TypeScript.
- Preserve Codex App Server JSON-RPC over stdio as the only production agent
  substrate. Do not add `@openai/codex-sdk` or a `codex exec` runtime path.
- Preserve the completed runtime semantics and the mechanical Claude-to-Codex
  workflow mirror.
- Use package allowlisting so source, tests, scripts, fixtures, `.codex/`,
  `.claude/`, verification artifacts, and development config do not enter the
  npm tarball unless they are deliberately required at runtime.
- Remove root `GOAL.md`, `VERIFY.md`, and `PARITY.md`; move any lasting user or
  maintainer knowledge into `README.md`, `docs/`, tests, or package scripts.
- Keep `.verification-artifacts/` ignored. All install and pack probes run in
  temporary directories and clean up after themselves.
- Do not add pre-launch compatibility shims or duplicate package surfaces.
- Emit one self-contained NDJSON record per stdout line while a CLI run is
  active. Human diagnostics belong on stderr; terminal success and failure
  must also remain machine-readable on stdout.
- Keep secrets and machine-specific absolute paths out of committed and packed
  artifacts.
- Preserve unrelated work and keep at most one plan phase in progress.
- GPT-5.6 Sol/high delegates are authorized for bounded exploration,
  implementation, and review. Delegates do not commit; the parent owns all
  integration and verification.

## Approval gates

- Building, packing, and installing the local tarball in isolated temporary
  directories are in scope.
- A read-only installation from the configured public GitHub repository is in
  scope once a remote URL is available.
- Creating the public `CyrusNuevoDia/gpt-workflow` repository, pushing this
  checkout, configuring npm trusted publishing, and publishing `gpt-workflow`
  are now explicitly authorized by the user. Do not modify other repositories,
  packages, credentials, or external systems beyond that release path.
- Do not choose a legal license on the user's behalf. If no license is supplied,
  omit an SPDX license claim and report the distribution limitation clearly.

## Non-goals

- Publishing versions beyond the explicitly requested first release.
- Additional CLI commands, speculative flags, or a human-oriented progress
  renderer.
- Re-running the expensive full live GPT parity sweep unless package or runtime
  changes invalidate the prior proof or a cheaper check exposes a regression.
- Shipping verifier reports, goal state, parity research, browser proofs, or
  generated verification artifacts in the npm package.
- Compatibility scaffolding for the pre-package repository layout.

## Primary verifier

Run the repository-owned aggregate verification command from the repository
root:

```sh
just check
```

It must exit zero and prove all of the following from isolated temporary
directories:

1. the production package builds from source with declaration output;
2. `npm pack --dry-run --json` succeeds and its complete file list matches the
   deliberate package contract;
3. an actual tarball is created outside the repository;
4. a fresh consumer installs the tarball without reaching the network for this
   package, imports the public API under Node, parses a workflow, and completes
   an offline injected-agent execution; and
5. the repository remains free of generated tarballs, `dist/`, install projects,
   and verification artifacts after the command finishes.

When a Git remote is available, the completion proof additionally installs the
repository at an immutable commit into a second clean consumer and runs the same
Node import/execution smoke, proving the `prepare` lifecycle works for GitHub
dependencies.

## Supporting checks

```sh
just check
just mirror
just verify # explicit live, token-spending suite
npm pack --dry-run --json
git diff --check
git status --short
```

Search the complete tracked tree and packed file list for removed root documents,
machine-specific absolute paths, leaked verification artifacts, and stale
spec-only README claims.

## Iteration loop

1. Re-read this file and `plan.md`.
2. Run the cheapest check that exercises the current distribution milestone.
3. Make one coherent change against observed package, install, portability, or
   documentation evidence.
4. Re-run the phase check and record exact evidence in `plan.md`.
5. Have a fresh delegate review risky package-boundary or public-API changes.
6. Run the full package verifier only after build and pack inspection pass.
7. Repeat until every completion condition holds.

## Anti-cheating rules

- Do not make the smoke import an internal source path or the repository root;
  it must import the installed package by package name.
- Do not test only `npm pack --dry-run`; install the actual tarball.
- Do not hide unexpected tarball entries by checking only a few required files;
  inspect the complete pageless file list returned by npm.
- Do not publish `src/` as a substitute for producing runnable JavaScript and
  declarations.
- Do not remove parity fixtures or tests merely to make the package smaller;
  exclude development surfaces with the package allowlist.
- Do not weaken runtime tests, mirror checks, or offline parity to fit build
  changes.
- Do not claim GitHub installability without either exercising an immutable
  remote commit or recording the missing remote as the sole unverified edge.
- Do not claim the repository is clean while ignored debris remains; inspect the
  filesystem as well as `git status`.

## Blocker standard

A blocker is a true external condition after local package work and all
available checks are complete, such as the absence of any GitHub remote needed
for the final remote-install proof or a missing user decision on licensing that
prevents the requested distribution state. Package errors, test failures,
build configuration, documentation drift, and repository debris are not
blockers.

Record the exact failed command, observed output, attempted alternatives, and
smallest external action required to unblock progress.

## Completion proof

Before marking the goal complete, all of the following must be true:

- Every phase in `plan.md` is complete with current evidence.
- `just check` exits zero, including formatting, offline, package, installed
  library, installed CLI, and cleanup checks.
- `npm pack --dry-run --json` succeeds; every returned file is reviewed; the
  packed surface contains only deliberate runtime files plus npm-mandatory
  metadata.
- A clean temporary Node consumer installs the actual tarball and passes the
  public import, parse, and injected-agent execution smoke.
- The installed `gpt-workflow run <script.js>` bin emits only ordered NDJSON on
  stdout during a run, persists its journal, returns a terminal record, and
  exits nonzero with a machine-readable failure record when execution fails.
- A clean temporary consumer installs an immutable GitHub commit and passes the
  same smoke, or the goal records the absent remote as the only external
  completion blocker after all local work is finished.
- Root `GOAL.md`, `VERIFY.md`, and `PARITY.md` are absent, with no stale links to
  them in public documentation or package metadata.
- `README.md` accurately describes the implementation, requirements,
  installation paths, public API, trusted-workflow sandbox limitation, and
  Codex CLI/App Server dependency.
- Committed fixtures contain no checkout-specific absolute paths, and the
  Claude-to-Codex mirror still passes.
- `.verification-artifacts/`, `dist/`, `*.tgz`, temporary consumers, and other
  generated outputs are absent from the repository after verification and are
  ignored or package-excluded as appropriate.
- A fresh delegate review finds no accidental public exports, missing runtime
  files, stale spec-only claims, or package/install bypasses.
- `git diff --check` passes and the final tracked/untracked tree is inspected.
