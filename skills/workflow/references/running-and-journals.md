# Run and inspect workflows

## CLI

```sh
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  .codex/workflows/<name>.js
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  --resume <runId> .codex/workflows/<name>.js
```

Stdout is ordered NDJSON and stderr is human diagnostics. Every event includes
`runId`, `runDirectory`, `scriptPath`, `schemaVersion`, `sequence`, and `type`.
Use the terminal `run.completed` record for `result`, `usage`, `failures`, and
`journalPath`.

Default storage is
`.codex/workflows/runs/<runId>/journal.jsonl` relative to process cwd.

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
