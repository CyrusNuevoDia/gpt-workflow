# Getting started

`gpt-workflow` runs deterministic JavaScript orchestration on top of Codex App
Server. Your script owns control flow; `agent()` delegates bounded judgment to
Codex threads.

## Requirements and installation

Use Bun 1.3 or newer and an installed authenticated Codex CLI for live runs.
Node.js is not a supported runtime.

```sh
bun add --global gpt-workflow
```

For library use:

```sh
bun add gpt-workflow
```

## Write a workflow

Store project workflows under `.codex/workflows/`:

```js
export const meta = {
  name: "summarize-files",
  description: "Summarize files concurrently and merge the findings"
}

const files = args.files
const summaries = await parallel(
  files.map((file) => () =>
    agent(`Read ${file} and return three factual bullets.`, {
      label: `summarize:${file}`
    })
  )
)

return { summaries: summaries.filter(Boolean) }
```

Workflow source is trusted repository code executed in a `node:vm` semantic
boundary. It is not a security sandbox for hostile JavaScript.

## Run and inspect it

```sh
gpt-workflow run --default-model gpt-5.6-luna \
  .codex/workflows/summarize-files.js
```

`--default-model` supplies the model for calls that omit `options.model`.
Explicit per-call models still override it. Without either, `agent()` fails.
Live agents use the directory where the CLI was invoked as their default
working directory, so repository-relative prompt paths resolve from there.
Use `agentType: "default"`, `"worker"`, or `"explorer"` for a built-in agent
definition. Project and personal `.codex/agents/*.toml` files can define custom
types; see the [API reference](03-api.md#agent-type-registry).

Stdout is ordered NDJSON. Every record includes `schemaVersion`, `sequence`,
`runId`, `scriptPath`, `runDirectory`, and `type`. Human diagnostics go to
stderr.

The terminal `run.completed` record contains `result`, `usage`, `failures`, and
`journalPath`. The journal lives at:

```text
.codex/workflows/runs/<runId>/journal.jsonl
```

Capture the stream without corrupting it:

```sh
gpt-workflow run --default-model gpt-5.6-luna \
  .codex/workflows/summarize-files.js | tee run.jsonl
jq -r 'select(.type == "run.completed") | .journalPath' run.jsonl
```

## Resume a run

Reuse the `runId` from the original stream:

```sh
gpt-workflow run --default-model gpt-5.6-luna --resume workflow-123 \
  .codex/workflows/summarize-files.js
```

Resume reads the same journal and matches completed `agent()` calls from a key
multiset. Matching is order-independent until the first miss; that call and all
later calls run live and append new records to the same journal.

## Parse large journals

`parseWorkflowJournalEntry` parses exactly one JSONL record. Pair it with a
streaming line reader so memory use stays independent of journal size:

```js
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { parseWorkflowJournalEntry } from "gpt-workflow"

const lines = createInterface({
  input: createReadStream(journalPath),
  crlfDelay: Infinity
})

for await (const line of lines) {
  if (line.trim() === "") continue
  const entry = parseWorkflowJournalEntry(line)
  if (entry.type === "result") console.log(entry.agentId, entry.result)
}
```

## Use the library

```js
import {
  AppServerClient,
  REQUIRED_APP_SERVER_MODELS,
  runWorkflowScript
} from "gpt-workflow"

const client = await AppServerClient.connect({
  defaultModel: "gpt-5.6-luna",
  requiredModels: REQUIRED_APP_SERVER_MODELS
})

try {
  const execution = await runWorkflowScript(source, {
    appServer: client,
    args: { files: ["src/a.ts", "src/b.ts"] }
  })
  console.log(execution.result, execution.journalPath)
} finally {
  await client.close()
}
```

Live library runs use the same default run path. Override `runDirectory` only
when the caller owns a different storage layout.

## Install the Codex plugin

This repository is also a Codex plugin. Add its marketplace, install
`gpt-workflow`, restart the ChatGPT desktop app, and start a new task so the
bundled skill is loaded. See [Codex plugin](07-plugin.md) for the exact commands.
