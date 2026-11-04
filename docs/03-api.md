# API reference

## Package exports

The root package exports:

- `runWorkflowScript(source, options)` and `parseWorkflowScript(source,
  fileName?)`.
- `parseWorkflowJournalEntry(line)` for one strict journal record at a time.
- `listRunSummaries(cwd)` and `readRunStatus(cwd, runId)` for run inspection,
  with the `RunSummary`, `RunSummaryStatus`, `RunStatus`, `RunAgent`,
  `RunAgentStatus`, `RunPhase`, `RunTokenTotals`, `JournalRunStatus`, and
  `RunInspectionStatus` types.
- `AppServerClient`, `REQUIRED_APP_SERVER_MODELS`, and the App Server error
  classes.
- Runtime, App Server, JSON, usage, cap, and journal entry TypeScript types.

`parseWorkflowJournalEntry` returns the discriminated union
`WorkflowJournalEntry`, composed of `WorkflowJournalStartedEntry` and
`WorkflowJournalResultEntry`. It throws `SyntaxError` for blank input, malformed
JSON, unknown record types, missing fields, or invalid result values.

## `runWorkflowScript`

Important `WorkflowExecutionOptions` fields:

| Field | Purpose |
| --- | --- |
| `appServer` | Live Codex agent substrate. |
| `agent` | Injected agent implementation for offline tests or custom callers. |
| `args` | JSON-compatible workflow input. |
| `cwd` | Default working directory for live agents. |
| `fileName` | Source name used in errors and event attribution. |
| `workflowDirectory` | Named-child lookup directory; defaults to `.codex/workflows`. |
| `workflowRunId` | Explicit ID for a fresh run. |
| `resumeFromRunId` | Prior ID to resume; takes precedence over `workflowRunId`. |
| `runDirectory` | Journal directory override. |
| `budget` / `caps` | Token accounting source and safety limits. |
| `signal` | Cancels queued and active agent work. |
| `onAgentEvent` | Receives normalized App Server lifecycle events. |
| `onWorkflowEvent` | Receives attributed `phase()` and `log()` events. |

The result includes `result`, `failures`, `usage`, `events`, `agentEvents`,
`workflowRunId`, and `journalPath`.

## Run inspection

`listRunSummaries(cwd)` scans every workflow in the encoded project's
`CODEX_HOME` storage and resolves to `RunSummary[]`, newest first by start time,
reading only the first and last record of each run's `events.jsonl` so cost
stays flat as runs grow. Each
`RunSummary` holds `runId`, `name` (`null` when unknown), `scriptPath`,
`status` (`"completed"`, `"failed"`, `"incomplete"`, or `"unknown"`),
`startedAt`, and `lastEventAt` (epoch milliseconds), plus `finishedAt`,
`failureCount`, and `usage` once the run ended. A run directory with a
journal but no `events.jsonl` — recorded by an older CLI — reports
`status: "unknown"` with `journalOnly: true`. A missing runs directory
resolves to an empty array; other filesystem errors reject.

`readRunStatus(cwd, runId)` reads one run's events file in full and resolves
to `RunStatus`. It keeps the original run's identity and start metadata and
shows the latest invocation's `phases` and `agents`. Each phase has
`{title, detail, agents: {started, completed, failed}, tokens}`. There is one
row per title, in first declaration order, with the detail from the first
declaration. Each agent has `{agentId, label, phase, model, status, tokens}`.
Phase counts and token totals reflect live activity in that invocation.
Replayed calls are reflected in `usage` when the invocation completes.

`RunTokenTotals` contains `inputTokens`, `cachedInputTokens`, `outputTokens`,
`reasoningOutputTokens`, and `totalTokens`. An agent's `tokens` field holds
its latest cumulative App Server usage snapshot. Each agent's status comes
from its own persisted events, so an interrupted invocation still shows
which agents completed or failed.

A completed invocation reports `failures` and `result`. A failed invocation
reports `error: {name, message}` when the events file includes it. Older
failed runs may omit `error`. If the latest invocation has no terminal
record, its status is `"incomplete"` and it omits any earlier invocation's
terminal payload. In-flight and interrupted invocations are indistinguishable
on disk.

A journal-only run resolves to `JournalRunStatus`
(`{runId, status: "unknown", journalOnly: true, journal: {started, results,
unmatched}}`); an unknown or malformed `runId` resolves to `null`.
`RunInspectionStatus` is the union of both shapes.

If the same run ID exists under multiple workflow names, `readRunStatus`
rejects with an ambiguity error rather than choosing one.

Neither function spends model tokens; both read only local run files.

## Script globals

### `agent(prompt, options?)`

Runs one agent and resolves to its JSON-compatible result. Live App Server calls
resolve model, effort, and sandbox options from the explicit call, then its
agent definition, then the client default where one exists. The call throws a
model error when no model resolves or the selected model is unavailable.
Accepted options are `model`, `effort`, `schema`, `label`, `phase`, `agentType`,
`cwd`, `sandbox`, and `isolation: "worktree"`. Unknown keys are ignored.

Agent-side terminal failures resolve to `null` and add a failure with
`kind: "agent"`: failed, interrupted, or timed-out turns; a completed turn with
no final message; structured output still invalid after retries; and injected
agent throws. Setup and programmer errors still reject, including invalid or
unavailable models, bad option types, budget caps, cancellation, worktree setup,
and transport or protocol failures.

With `schema`, invalid JSON or schema violations receive up to two corrective
turns on the same thread before the call becomes an agent failure. The schema
sent to Codex is normalized for OpenAI strict-schema rules by adding
`additionalProperties: false` to object schemas. Local validation still uses
the caller's original schema. Every turn also tells the agent that its final
message is a raw return value consumed by a program.

#### Agent type registry

`agentType` resolves an agent definition. The built-ins are:

- `default`: general-purpose, with no model, effort, or sandbox override.
- `worker`: execution-focused, with `workspace-write` sandboxing.
- `explorer`: read-only repository exploration.

Names match exactly and are not aliased. Claude agent-type names such as
`general-purpose` or `Explore` must be migrated; see the
[migration checklist](../skills/workflow/references/migration.md).

Custom definitions are TOML files loaded first from
`<cwd>/.codex/agents/*.toml`, then from `~/.codex/agents/*.toml`. Resolution
uses the TOML `name` field, not the filename. A project definition wins over a
personal definition, and either can shadow a built-in with the same name.

Required fields are `name`, `description`, and `developer_instructions`.
Optional honored fields are `model`, `model_reasoning_effort` (mapped to
`effort`), and `sandbox_mode` (mapped to `sandbox`). `nickname_candidates`,
`mcp_servers`, and `skills.config` are ignored. Bun's built-in TOML parser reads
the files; malformed or incomplete definitions are skipped.

At the call site, an explicit `agent()` option wins over the resolved
definition, which wins over the client default. An unknown `agentType` throws
and lists all available built-in and custom names.

### `parallel(thunks)`

Starts each zero-argument thunk and waits for all slots. A rejected slot becomes
`null` and adds a `WorkflowFailure` with `kind: "parallel"`.

### `pipeline(items, ...stages)`

Runs each item through its stages in order while different items proceed
concurrently. A failed stage makes that item `null` and records the item and
stage indexes. Intermediate stage values remain raw in the VM; only the final
value for each item must cross the JSON boundary.

### `phase(title)` and `log(message)`

Emit workflow events. The current phase is inherited by later `agent()` calls
that do not set their own phase.

### `workflow(reference, childArgs?)`

Executes a child workflow in the same run context. References are a metadata
name or `{ scriptPath }`.

### `budget`

Exposes `budget.total`, `budget.spent()`, and `budget.remaining()`. With no total,
`total` is `null` and `remaining()` is `Infinity`. `spent()` counts output
tokens, including reasoning output tokens, and updates as token-usage
notifications arrive rather than only after an agent finishes. The pool belongs
to one workflow run, including its child workflows; sibling workflow processes
do not contribute to a turn-wide shared pool.

## CLI

`gpt-workflow run --default-model <name> <script.js>` supplies the App Server
default for calls without `options.model`. `--resume <runId>` accepts only
letters, numbers, periods, underscores, and hyphens. `--args <json>` supplies
the script's `args` global as strict JSON — pass a plain string as quoted
JSON (`--args '"triage"'`); invalid JSON exits 1 with a usage error on stderr
and emits no records. Live agents default to the CLI invocation directory,
not the script's directory.

The CLI requires `REQUIRED_APP_SERVER_MODELS` by default. Repeating
`--required-model <name>` replaces that default set with the supplied model
names. `--request-timeout-ms`, `--thread-start-timeout-ms`, and
`--turn-timeout-ms` override their corresponding App Server client timeouts;
each accepts only a finite positive integer.

`SIGINT` and `SIGTERM` cancel the workflow through its `AbortSignal`, which
interrupts active App Server turns before the CLI emits and persists
`run.failed`, closes the client, and exits 1.

`gpt-workflow models` streams every model returned by the fully paginated App
Server `model/list` method as NDJSON. `gpt-workflow list` and
`gpt-workflow status <runId>` print the [run inspection](#run-inspection) data
as JSON on stdout — one line per model or run for `models` and `list`, one
object for `status`. None spends model tokens. An unknown run ID makes `status`
exit 1 with `run not found` on stderr.
