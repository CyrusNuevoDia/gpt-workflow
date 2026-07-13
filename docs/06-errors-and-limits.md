# Errors and limits

## Default caps

| Limit | Default |
| --- | --- |
| Concurrent live agents | `min(16, max(1, CPU count - 2))` |
| Agents reserved during one run | 1000 |
| Items in one `parallel` or `pipeline` call | 4096 |
| Child workflow depth | 1 |
| App Server `thread/start` timeout | 120,000 ms |

All cap overrides must be positive safe integers. A budget total must be null or
a finite non-negative number.

## Failure boundaries

- Invalid literal metadata throws `WorkflowLoadError` before body execution.
- A top-level `undefined` result is coerced to `null`; other non-JSON values
  crossing a final or fan-out VM boundary throw `JSONBoundaryError`.
- Agent-side terminal failures, missing final messages, exhausted structured
  output retries, and injected-agent throws return `null` and add a
  `kind: "agent"` failure.
- A failed `parallel` slot or `pipeline` stage becomes `null` and appears in
  `execution.failures`.
- Cancellation rejects queued work, interrupts active App Server handles, and
  rejects the run with `WorkflowCanceledError`, including from `parallel` and
  `pipeline`.
- Missing or unavailable models, bad option types, budget caps, worktree setup,
  and transport or protocol failures throw rather than becoming agent failures.
- An unknown `agentType` throws and reports the available built-in and custom
  agent names.
- Worktree isolation fails at run level when git cannot resolve `HEAD`.
- Error names survive the VM boundary, including `WorkflowCapError` and
  `WorkflowCanceledError`.

App Server `thread/start` has its own configurable `threadStartTimeoutMs`, which
defaults to 120,000 ms. A timeout is retried once with the same timeout; a second
timeout throws.

## Structured output correction

For `agent(..., { schema })`, the runtime clones the caller's schema and adds
`additionalProperties: false` to object schemas on the wire to satisfy OpenAI
strict-schema requirements. It validates returned JSON locally against the
caller's original, unmodified schema. Invalid JSON or a schema mismatch gets up
to two corrective turns on the same thread. Exhaustion becomes an agent
failure, so the workflow-level result for that call is `null` and the failure
is recorded.

## Journal parse failures

`parseWorkflowJournalEntry` throws `SyntaxError` for blank text, malformed JSON,
unknown `type`, non-string `key` or `agentId`, a missing `result`, or a result
that is not valid JSON data. Catch per line if inspecting a damaged journal; do
not discard the entire file without reporting the bad line number maintained by
your streaming reader.

## Troubleshooting

1. Read the terminal CLI record. `run.completed` contains result, failures,
   usage, and `journalPath`; `run.failed` contains the top-level error.
2. Stream the journal and inspect completed `result` records before rerunning.
3. Resume with the same run ID after an interruption. Completed matching calls
   replay; unmatched `started` records run again.
4. If replay misses unexpectedly, compare prompt text and authored options.
   Calls match from a key multiset until the first miss; everything later then
   runs live.
5. Use normalized `agent.event` records and their `threadId` / `turnId` to
   correlate a workflow call with Codex App Server history.
6. Run `just check` for offline, package, and installed-CLI verification. Run
   `just verify` only when live model-backed verification and its token cost are
   intended.
