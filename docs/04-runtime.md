# Runs and journals

## Run storage

Live CLI and library runs default to:

```text
<process cwd>/.codex/workflows/runs/<runId>/
```

The CLI calls this directory `runDirectory` in every NDJSON record. The library
returns the exact `journalPath`. `runDirectory` can override the library path;
the CLI intentionally uses the invocation directory so a repository owns its
run history.

The directory holds two files with different jobs:

- `journal.jsonl` — the append-only replay journal. Resume reads it to skip
  completed calls; it is the only replay substrate.
- `events.jsonl` — a CLI-written, filtered copy of the run's stdout NDJSON
  for later inspection. It keeps `run.started`, `run.completed`,
  `run.failed`, every `workflow.event` (phase and log) record, and
  `agent.event` records of types `lifecycle`, `terminal`, `usage`, `error`,
  `warning`, and `collaboration`. High-volume streaming deltas — message,
  reasoning, command-output, and plan events — are dropped. Each persisted
  record carries the stream's `ts` (epoch milliseconds), which
  `gpt-workflow list` and `gpt-workflow status` use to rebuild run state
  without spending model tokens. Library runs through `runWorkflowScript` do
  not write this file; library callers observe the same events through
  `onAgentEvent` and `onWorkflowEvent`.

Add `.codex/workflows/runs/` to version-control ignores. Both files contain
model outputs and may contain repository-sensitive information.

## Journal wire format

The append-only journal has two record shapes:

```json
{"type":"started","key":"v3:...","agentId":"workflow-123:agent-1"}
{"type":"result","key":"v3:...","agentId":"workflow-123:agent-1","result":{"answer":42}}
```

`started` is appended before live execution. `result` is appended only after a
JSON-compatible result is available. Agent-side failures resolve to `null` but
leave the `started` unmatched, so resume retries exactly that failed work.
Replayed calls append nothing. Older v2 journals never match v3 keys and cause
a full live rerun.

Use `parseWorkflowJournalEntry(line)` on one line at a time. The package does
not export a whole-file parser because journals can grow across repeated
resumes. Blank lines are not records; a streaming caller may skip them.

## Resume semantics

Each v3 key is an order-independent stable hash of the prompt and options as
authored. The runtime injects the current `phase()` only after keying, so adding
or moving phase lines above an otherwise unchanged call does not invalidate it.
Completed results form a key multiset: repeated identical calls consume one
matching result each, and calls may reorder while matches remain. At the first
missing key or unmatched `started`, that call and every later call execute live,
even if later journal entries would match. This is key-multiset prefix replay,
not an unrestricted cache.

CLI resume reuses the prior run ID and run directory:

```sh
gpt-workflow run --default-model <name> --turn-timeout-ms <ms> --resume <runId> <script.js>
```

Library resume uses `resumeFromRunId`; pass the same `runDirectory` only if the
original run used a custom location.

Long-running agent turns can override the App Server turn timeout with
`--turn-timeout-ms`. It defaults to `300000` (five minutes) and accepts only a
finite positive integer. For example, use `--turn-timeout-ms 1800000` for a
30-minute timeout.

## Codex thread persistence

The journal is package-owned replay state. Codex App Server separately persists
each underlying agent thread as a rollout and exposes stored history through its
thread APIs. Those rollouts are the full Codex conversation record; they are not
copied into the workflow run directory and their private on-disk layout is not a
public `gpt-workflow` contract. Normalized `agent.event` records include the
Codex `threadId` and `turnId` for attribution.

## Scheduling and failures

All parent and child workflows share one bounded queue. Bare agent-side failures
become `null` plus a `WorkflowFailure` with `kind: "agent"`; `parallel` and
`pipeline` likewise convert their own slot failures to `null`. Cancellation
always rejects the run, including while calls are active inside `parallel` or
`pipeline`. Top-level load and boundary errors, worktree setup failures, and
direct runtime errors also reject. Error names survive the VM boundary, so
callers can distinguish names such as `WorkflowCapError` and
`WorkflowCanceledError`. CLI failures emit `run.failed`, write a concise stderr
diagnostic, and exit nonzero.

After a successful workflow execution, an App Server close failure is only a
stderr diagnostic: the CLI still emits `run.completed` and exits zero.

The run's budget counts output tokens and updates from App Server token-usage
notifications while agents are active. This lets later calls observe concurrent
spending before every active call has completed.

## Worktree isolation

`agent(..., { isolation: "worktree" })` creates a temporary git worktree for
that call under `<repo>/.codex/worktrees/<runId>-<n>`. Clean worktrees are
removed; dirty worktrees remain for inspection. The repository must have a
resolvable `HEAD`.
