# Runs and journals

## Run storage

Live CLI and library runs default to:

```text
<process cwd>/.codex/workflows/runs/<runId>/journal.jsonl
```

The CLI calls this directory `runDirectory` in every NDJSON record. The library
returns the exact `journalPath`. `runDirectory` can override the library path;
the CLI intentionally uses the invocation directory so a repository owns its
run history.

Add `.codex/workflows/runs/` to version-control ignores. Journals contain model
outputs and may contain repository-sensitive information.

## Journal wire format

The append-only journal has two record shapes:

```json
{"type":"started","key":"v2:...","agentId":"workflow-123:agent-1"}
{"type":"result","key":"v2:...","agentId":"workflow-123:agent-1","result":{"answer":42}}
```

`started` is appended before live execution. `result` is appended only after a
JSON-compatible result is available. An unmatched `started` record therefore
shows interrupted or failed work. Replayed calls append nothing.

Use `parseWorkflowJournalEntry(line)` on one line at a time. The package does
not export a whole-file parser because journals can grow across repeated
resumes. Blank lines are not records; a streaming caller may skip them.

## Resume semantics

Each key hashes the prompt, options, previous journal key, and format version.
On resume, the runtime replays completed results in call order until the first
key mismatch or missing result. That call and every later call execute live.
This is longest-prefix replay, not an unordered cache.

CLI resume reuses the prior run ID and run directory:

```sh
gpt-workflow run --resume <runId> <script.js>
```

Library resume uses `resumeFromRunId`; pass the same `runDirectory` only if the
original run used a custom location.

## Codex thread persistence

The journal is package-owned replay state. Codex App Server separately persists
each underlying agent thread as a rollout and exposes stored history through its
thread APIs. Those rollouts are the full Codex conversation record; they are not
copied into the workflow run directory and their private on-disk layout is not a
public `gpt-workflow` contract. Normalized `agent.event` records include the
Codex `threadId` and `turnId` for attribution.

## Scheduling and failures

All parent and child workflows share one bounded queue. `parallel` and
`pipeline` convert slot failures to `null` plus `WorkflowFailure`; top-level
load errors, boundary errors, cancellation, worktree setup failures, and direct
runtime errors reject the run. CLI failures emit `run.failed`, write a concise
stderr diagnostic, and exit nonzero.

## Worktree isolation

`agent(..., { isolation: "worktree" })` creates a temporary git worktree for
that call. Clean worktrees are removed; dirty worktrees remain for inspection.
The repository must have a resolvable `HEAD`.
