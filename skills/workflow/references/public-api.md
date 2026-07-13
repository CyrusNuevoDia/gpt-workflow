# Package API

## Main functions

- `runWorkflowScript(source, options)` executes source and returns result,
  failures, usage, workflow and agent events, `workflowRunId`, and
  `journalPath`.
- `parseWorkflowScript(source, fileName?)` validates literal metadata without
  executing the body.
- `parseWorkflowJournalEntry(line)` parses one strict `started` or `result`
  record and throws `SyntaxError` for invalid input.

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

The root package also exports App Server client/error values, JSON and runtime
types, usage/cap types, and `WorkflowJournalEntry` with its started/result member
types.
