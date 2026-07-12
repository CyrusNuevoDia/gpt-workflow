# Errors and limits

## Default caps

| Limit | Default |
| --- | --- |
| Concurrent live agents | `min(16, max(1, CPU count - 2))` |
| Agents reserved during one run | 1000 |
| Items in one `parallel` or `pipeline` call | 4096 |
| Child workflow depth | 1 |

All cap overrides must be positive safe integers. A budget total must be null or
a finite non-negative number.

## Failure boundaries

- Invalid literal metadata throws `WorkflowLoadError` before body execution.
- Non-JSON values crossing the VM boundary throw `JSONBoundaryError`.
- A failed `parallel` slot or `pipeline` stage becomes `null` and appears in
  `execution.failures`.
- Cancellation rejects queued work, interrupts active App Server handles, and
  throws `WorkflowCanceledError` internally.
- Missing or unavailable explicit models produce App Server model errors.
- Worktree isolation fails at run level when git cannot resolve `HEAD`.

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
3. Resume with the same run ID after an interruption. Completed prefix calls
   replay; unmatched `started` records run again.
4. If replay misses unexpectedly, compare prompt text, options, call order, and
   explicit args. Any earlier change invalidates the remaining prefix.
5. Use normalized `agent.event` records and their `threadId` / `turnId` to
   correlate a workflow call with Codex App Server history.
6. Run `just check` for offline, package, and installed-CLI verification. Run
   `just verify` only when live model-backed verification and its token cost are
   intended.
