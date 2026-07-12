# API reference

## Package exports

The root package exports:

- `runWorkflowScript(source, options)` and `parseWorkflowScript(source,
  fileName?)`.
- `parseWorkflowJournalEntry(line)` for one strict journal record at a time.
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

## Script globals

### `agent(prompt, options?)`

Runs one agent and resolves to its JSON-compatible result. Live App Server calls
require an explicit supported `model`. Useful options include `label`, `phase`,
`cwd`, `sandbox`, and `isolation: "worktree"`; other JSON-compatible values are
forwarded to the App Server adapter.

### `parallel(thunks)`

Starts each zero-argument thunk and waits for all slots. A rejected slot becomes
`null` and adds a `WorkflowFailure` with `kind: "parallel"`.

### `pipeline(items, ...stages)`

Runs each item through its stages in order while different items proceed
concurrently. A failed stage makes that item `null` and records the item and
stage indexes.

### `phase(title)` and `log(message)`

Emit workflow events. The current phase is inherited by later `agent()` calls
that do not set their own phase.

### `workflow(reference, childArgs?)`

Executes a child workflow in the same run context. References are a metadata
name or `{ scriptPath }`.

### `budget`

Exposes `budget.total`, `budget.spent()`, and `budget.remaining()`. With no total,
`total` is `null` and `remaining()` is `Infinity`.
