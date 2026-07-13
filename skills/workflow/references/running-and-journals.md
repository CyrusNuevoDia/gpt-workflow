# Run and inspect workflows

## CLI

```sh
gpt-workflow run .codex/workflows/<name>.js
gpt-workflow run --resume <runId> .codex/workflows/<name>.js
```

Stdout is ordered NDJSON and stderr is human diagnostics. Every event includes
`runId`, `runDirectory`, `scriptPath`, `schemaVersion`, `sequence`, and `type`.
Use the terminal `run.completed` record for `result`, `usage`, `failures`, and
`journalPath`.

Default storage is
`.codex/workflows/runs/<runId>/journal.jsonl` relative to process cwd.

## Journal records

```json
{"type":"started","key":"v2:...","agentId":"workflow-123:agent-1"}
{"type":"result","key":"v2:...","agentId":"workflow-123:agent-1","result":{"answer":42}}
```

`started` precedes a live call. `result` follows successful JSON-compatible
completion. Replays append nothing. An unmatched `started` record is not a
cached result.

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

Resume matches completed calls in order using chained prompt-and-option keys.
The first mismatch or missing result invalidates the rest of the prefix. Compare
args, prompt bytes, options, and call order. Do not expect a later matching call
to replay after an earlier miss.

Codex App Server persists full underlying threads separately. Use normalized
agent events and their `threadId` / `turnId` for correlation; do not parse
private Codex session files as workflow journals.
