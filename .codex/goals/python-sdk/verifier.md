# Python SDK verifier

Run this verifier adversarially against the current state of
`/Users/knrz/Git/CyrusNuevoDia/gpt-workflow`.

For every numbered requirement, print `PASS` or `FAIL` with command output or
file evidence. Print `OVERALL: PASS` only when every requirement passes.
Otherwise print `OVERALL: FAIL` and the smallest remaining gaps.

## Required

1. `sdks/python` is a locally buildable Python 3.12+ distribution named
   `gpt-workflow`. Importing `gpt_workflow` exposes mutable `cwd: Path` plus
   synchronous `run`, `runs`, `status`, and `models`. There are no async twins
   and no untyped `**kwargs` escape hatch. Calls needing `cwd` raise
   `WorkflowDirectoryUnset` before spawning when it is unset.
2. `run` has the effective typed contract
   `run(script: Path | str, args: JSONValue | Unset = UNSET, *,
   default_model: str | None = None,
   required_models: Sequence[str] | None = None,
   resume: str | None = None,
   request_timeout_ms: int = 30_000,
   thread_start_timeout_ms: int = 120_000,
   turn_timeout_ms: int = 300_000) -> WorkflowResult`.
   Omitted `args` differs from explicit JSON `null`; types, values, and every
   forwarded flag are covered by tests.
3. Frozen typed `WorkflowResult` contains `result`, `status: WorkflowStatus`,
   and `run_directory: Path`, with no `journal_path`. `WorkflowStatus` and its
   agent, phase, and token dataclasses faithfully decode completed, failed,
   incomplete, unknown, and journal-only status payloads using snake_case.
   Unknown JSON fields are retained in explicit `extra` mappings, never as
   dynamic attributes.
4. `runs()` returns lightweight `WorkflowSummary` values without loading full
   event histories. `status(run_id)` returns `WorkflowStatus`. `models()`
   returns canonical model strings, deduplicated in CLI order. Calls are quiet,
   capture CLI output, and never retry automatically. Global `cwd` controls
   subprocess cwd, relative script resolution, and run storage.
5. Python and npm versions are synchronized at `0.3.3`, with an automated drift
   check. Execution uses exactly
   `bunx --bun gpt-workflow@0.3.3`, never `@latest` or a `gpt-workflow`
   executable from `PATH`. Bun 1.3+ is documented. An isolated install of the
   locally built wheel runs a deterministic no-agent/no-token workflow and
   returns the expected result, detailed status, and run directory.
6. Before a trustworthy run exists, errors are:
   `WorkflowDirectoryUnset`; built-in `FileNotFoundError` for a missing script;
   built-in `TypeError` for wrong types or non-JSON-compatible args; built-in
   `ValueError` for invalid values; `BunError` for Bun/bunx startup; and
   `CLIProtocolError` for untrustworthy CLI output. None inherits
   `WorkflowError`.
7. `WorkflowError` means a run exists and always has non-optional
   `status: WorkflowStatus` and `run_directory: Path`. Tested subclasses cover
   `InvalidWorkflowError`, `InvalidWorkflowArgumentError` (also `ValueError`),
   `ModelError` (also `ValueError`), `CodexAppServerError`,
   `BudgetExceededError`, `WorkflowLimitExceededError`, `GitError`,
   `JSONBoundaryError`, `WorkflowExecutionError`, and
   `WorkflowCancelledError`.
8. Error mapping uses structured JavaScript error names and never message
   substring matching. Add minimal named TypeScript errors wherever current
   generic `Error` or `TypeError` prevents deterministic mapping, without
   changing successful behavior.
9. Ctrl-C before `run.started` propagates ordinary `KeyboardInterrupt`. After
   `run.started`, Python forwards `SIGINT`, waits a bounded time for persisted
   `run.failed`, then raises `WorkflowInterrupted` as a `KeyboardInterrupt`
   carrying non-optional status and run directory. No interruption path leaves
   an orphan or retries work.
10. Root mise configuration supplies Python 3.12. The SDK uses uv with a
    committed reproducible lock. Copy-runnable docs cover `cwd`, `run`, `runs`,
    `status`, and `models`; Bun/Codex prerequisites; exact version pinning;
    quiet blocking behavior; and errors/interruption. They explicitly defer CI,
    PyPI publication, bundled Bun, and async APIs.
11. Focused no-token tests cover flag forwarding, `UNSET` versus `None`, status
    extras and journal-only data, model deduplication, quietness, exact pinning,
    cwd behavior, every error mapping, and interruption cleanup. From the root,
    `just fmt` followed by `just check` passes. The check includes Python
    formatting/linting, static typing, tests, version sync, wheel and sdist
    builds, metadata validation, isolated wheel import, and installed no-agent
    smoke. `git diff --check` passes.
12. Preserve the pre-existing changes in `skills/workflow/SKILL.md` and
    `skills/workflow/references/workflow-language.md`. Their combined binary
    diff SHA-256 remains
    `6f493a78bb17d3c94e317ca504979169631ca091c809f08b1fdf3fe05ca2b277`.

## Explicitly out of scope

- CI or GitHub Actions changes.
- Publishing to PyPI or changing any registry state.
- Bundled Bun wheels or `gpt-workflow[bun]`.
- Async APIs.
- Commits, pushes, or releases.
