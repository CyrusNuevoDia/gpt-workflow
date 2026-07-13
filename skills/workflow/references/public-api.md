# Package API

## Main functions

- `runWorkflowScript(source, options)` executes source and returns result,
  failures, usage, workflow and agent events, `workflowRunId`, and
  `journalPath`.
- `parseWorkflowScript(source, fileName?)` validates literal metadata without
  executing the body.
- `parseWorkflowJournalEntry(line)` parses one strict `started` or `result`
  record and throws `SyntaxError` for invalid input.
- `listRunSummaries(cwd)` scans `<cwd>/.codex/workflows/runs/` and returns
  newest-first `RunSummary` values from each run's `events.jsonl` boundary
  records: `runId`, `name`, `scriptPath`, `status`, `startedAt`,
  `lastEventAt`, plus `finishedAt`, `failureCount`, and `usage` after the run
  ended. A missing runs directory returns an empty array.
- `readRunStatus(cwd, runId)` reads one run's `events.jsonl` in full and
  returns `RunStatus` — the summary plus ordered `phases`, per-agent `status`
  and latest cumulative `tokens`, and terminal `result` / `failures` — or
  `JournalRunStatus` for journal-only runs, or `null` for unknown run IDs. No
  terminal record means `status: "incomplete"`, never "running". Neither
  function spends model tokens.

## Execution options

- `appServer`: live Codex substrate.
- `agent`: injected offline or custom agent.
- `args`: JSON input.
- `cwd`: live-agent default cwd.
- `workflowDirectory`: named children; defaults to `.codex/workflows`.
- `workflowRunId`: explicit fresh ID.
- `resumeFromRunId`: prior ID; takes precedence over a fresh ID.
- `runDirectory`: journal location override.
- `caps`, `budget`, and `signal`: bounds and cancellation.
- `onAgentEvent`, `onAgentStart`, and `onWorkflowEvent`: observation hooks.

Default caps are 1000 lifetime agents, 4096 boundary items, one child-workflow
level, and concurrent agents equal to `min(16, max(1, CPU count - 2))`.

`AppServerClientOptions.defaultModel` supplies the model for `agent()` calls
that omit `options.model`; explicit call options override it. Agent-side
terminal or result failures resolve to `null` and are recorded with
`kind: "agent"`, while setup, model, budget, cancellation, worktree, and
transport/protocol failures throw. Structured output receives up to two
corrective turns on the same thread. Codex receives a strict-schema-normalized
copy while local validation uses the caller's original schema.

`agentType` resolves the built-in `default`, `worker`, or `explorer` definition,
or a custom type named in project or personal `.codex/agents/*.toml`. Explicit
call options override definition values, which override client defaults.

The per-run budget counts output tokens and updates from token-usage events
while agents are active. It is shared with child workflows, not with sibling
workflow processes across the surrounding turn.

For CLI runs, pass the invoking agent's current model with
`--default-model <the model you are running as>`. Per-call `model` options are
then optional and remain overrides. Pass workflow input with `--args <json>`
(strict JSON; quote plain strings).

The root package also exports App Server client/error values, JSON and runtime
types, usage/cap types, `WorkflowJournalEntry` with its started/result member
types, and the run-inspection types `RunSummary`, `RunSummaryStatus`,
`RunStatus`, `RunAgent`, `RunAgentStatus`, `RunPhase`, `RunTokenTotals`,
`JournalRunStatus`, and `RunInspectionStatus`.
