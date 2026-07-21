# Run and inspect workflows

## CLI

```sh
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  .codex/workflows/<name>.js
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  --args '{"key":"value"}' .codex/workflows/<name>.js
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  --resume <runId> .codex/workflows/<name>.js
```

`--args` is strict JSON and becomes the script's `args` global; quote bare
strings (`--args '"triage"'`). Invalid JSON exits 1 with a usage error before
any record is emitted. On resume, keep `--args` identical: changed args change
prompts and miss replay keys, so those calls run live.

Stdout is ordered NDJSON and stderr is human diagnostics. Every event includes
`runId`, `runDirectory`, `scriptPath`, `schemaVersion`, `sequence`, `ts`
(epoch milliseconds), and `type`. `run.started` carries the script's `meta`;
use the terminal `run.completed` record for `result`, `usage`, `failures`, and
`journalPath`.

Default storage is
`$CODEX_HOME/projects/<encoded-project>/workflows/<name>/runs/<runId>/`:
`journal.jsonl` for replay, plus `events.jsonl`, an automatic filtered copy of
the stream (run records, phase/log events, and lifecycle, terminal, usage,
error, warning, and collaboration agent events; streaming deltas dropped).
`CODEX_HOME` defaults to `~/.codex`; the project key is the absolute invocation
directory with separators replaced by dashes. Piping to `tee` is optional.

## Monitor an in-flight run

Keep the original runner process visible. Its first `run.started` record gives
you the `runId` and exact `runDirectory`; use those emitted values instead of
manually encoding the project path.

From another terminal, poll a compact progress snapshot:

```sh
bunx gpt-workflow@latest status <runId>
```

Or follow the persisted event sequence after `events.jsonl` exists:

```sh
tail -f "<runDirectory>/events.jsonl" | jq -c .
```

Both approaches spend no model tokens. Prefer `status` for phase, agent, and
token summaries. Tail `events.jsonl` when ordering or individual lifecycle
events matter; streaming message and reasoning deltas are intentionally absent.
Do not tail `journal.jsonl` as a progress feed: it contains replay records, not
the complete run lifecycle.

While the runner process is alive, `"incomplete"` means the run is in flight.
After that process exits without a terminal record, it means the run was
interrupted; use `lastEventAt` when assessing stale runs. A monitored run is
finished only when `status` reports `"completed"` or `"failed"`.

## Inspect runs

```sh
bunx gpt-workflow@latest list
bunx gpt-workflow@latest status <runId>
```

Both read `events.jsonl` only and spend no model tokens; prefer them over
hand-parsing NDJSON. `list` prints one JSON line per run, newest first:
`runId`, `name`, `scriptPath`, `status` (`completed`, `failed`, `incomplete`,
or `unknown`), `startedAt`, `lastEventAt`, plus `finishedAt`, `failureCount`,
and `usage` after the run ended. `status` prints one JSON object adding
ordered `phases` with agent counts and token totals, per-agent `status` and
latest cumulative `tokens`, and terminal `result` / `failures`.

`"incomplete"` means no terminal record; use the runner process to distinguish
an in-flight run from an interrupted one, and `lastEventAt` to assess staleness.
Per-agent `status` comes from each agent's own terminal event. Unknown run ID:
`run not found` on stderr, exit 1. Duplicate IDs are ambiguous. Resume also
rejects workflow-name mismatches before connecting to Codex. Pre-events runs
report `"unknown"` with `journalOnly: true`.

## Journal records

```json
{"type":"started","key":"v3:...","agentId":"workflow-123:agent-1"}
{"type":"result","key":"v3:...","agentId":"workflow-123:agent-1","result":{"answer":42}}
```

`started` precedes a live call. `result` follows successful JSON-compatible
completion. Replays append nothing. An unmatched `started` record, including a
failed agent that returned `null`, is not cached and is retried on resume. v2
journals never match v3 keys and rerun fully.

## Constant-memory inspection

```js
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { parseWorkflowJournalEntry } from "gpt-workflow"

const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
let lineNumber = 0
for await (const line of lines) {
  lineNumber += 1
  if (line.trim() === "") continue
  try {
    const entry = parseWorkflowJournalEntry(line)
    if (entry.type === "result") console.log(entry.agentId, entry.result)
  } catch (error) {
    throw new Error(`invalid journal line ${lineNumber}`, { cause: error })
  }
}
```

## Replay diagnosis

Resume uses an order-independent multiset of stable prompt-and-authored-options
keys. Auto-injected phases are excluded, and repeated identical calls consume
one result each. Reordering matching calls is safe until the first missing key
or unmatched `started`; that miss makes every later call run live even if a
matching journal result exists. Compare args, prompt bytes, and authored options.

Codex App Server persists full underlying threads separately. Use normalized
agent events and their `threadId` / `turnId` for correlation; do not parse
private Codex session files as workflow journals.
