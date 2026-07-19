# Python SDK

The `gpt-workflow` Python package (`sdks/python`) is a synchronous, typed
wrapper around the same CLI. Use it when Python code should run and inspect
workflows; it shells out to `bunx gpt-workflow`, so Bun and the synchronized
CLI remain the substrate. Requires Python 3.12+, Bun 1.3+, and an
authenticated Codex CLI for workflows that call agents.

## Configure and call

Set `gpt_workflow.cwd` once to a `pathlib.Path` for the repository that owns
the workflow; relative script paths and durable run storage resolve from it.
Calls without it raise `WorkflowDirectoryUnset`.

- `run(script, args=UNSET, *, default_model=None, required_models=None,
  resume=None, request_timeout_ms=30_000, thread_start_timeout_ms=120_000,
  turn_timeout_ms=300_000)` blocks until the run ends and returns
  `WorkflowResult` with `result`, detailed `status`, and `run_directory`.
- `runs()` returns lightweight `WorkflowSummary` values, newest first.
- `status(run_id)` returns detailed `WorkflowStatus`: phases, agents, token
  totals, terminal `result` / `failures`, and fallback journal counts for
  journal-only runs.
- `models()` returns unique canonical App Server model names in CLI order.
- `runs()`, `status()`, and `models()` spend no model tokens.

Omitting `args` leaves workflow `args` undefined; passing `None` sends
explicit JSON `null` — the `UNSET` sentinel distinguishes them. Pass a prior
run ID as `resume=` to replay; keep `args` identical or changed prompts miss
replay keys. Status values are frozen dataclasses; unknown compatible JSON
fields are retained in each value's `extra` mapping.

## Errors and interruption

Failures before a trustworthy run exists raise `WorkflowDirectoryUnset`,
`FileNotFoundError`, `TypeError`, `ValueError`, `BunError`, or
`CLIProtocolError`. Once persisted status exists, failures raise
`WorkflowError` subclasses whose `status` and `run_directory` are always set:
`InvalidWorkflowError`, `InvalidWorkflowArgumentError`, `ModelError`,
`CodexAppServerError`, `WorkflowLimitExceededError` (and its subclass
`BudgetExceededError`), `GitError`, `JSONBoundaryError`,
`WorkflowCancelledError`, and `WorkflowExecutionError`.

Ctrl-C before `run.started` is an ordinary `KeyboardInterrupt`. After the run
starts, the wrapper forwards SIGINT, lets the CLI flush persisted failure
state, then raises `WorkflowInterrupted` — a `KeyboardInterrupt` subclass
carrying `status` and `run_directory`.

## Scope

v1 is synchronous only and keeps Bun as a system prerequisite. Authoring
guidance is unchanged: workflow source is still JavaScript under
`.codex/workflows/`, per [workflow-language.md](workflow-language.md).
