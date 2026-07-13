# gpt-workflow

A deterministic multi-agent workflow runtime powered by Codex App Server.
Workflow scripts keep control flow in JavaScript and delegate judgment through
`agent()`, `parallel()`, `pipeline()`, and `workflow()`.

## Install

Use Bun 1.3 or newer and an installed authenticated Codex CLI for live runs.
Node.js is not a supported runtime.

```sh
bun add --global gpt-workflow
```

For library use:

```sh
bun add gpt-workflow
```

## Run and resume

```sh
gpt-workflow run --default-model gpt-5.6-luna .codex/workflows/my-workflow.js
gpt-workflow run --default-model gpt-5.6-luna --resume workflow-123 \
  .codex/workflows/my-workflow.js
```

Stdout is ordered NDJSON; human diagnostics go to stderr. Every record includes
`schemaVersion`, `sequence`, `runId`, `scriptPath`, `runDirectory`, and `type`.
A completed run includes its result, usage, failures, and journal path:

```json
{"runId":"workflow-123","schemaVersion":1,"sequence":0,"scriptPath":"/repo/.codex/workflows/my-workflow.js","runDirectory":"/repo/.codex/workflows/runs/workflow-123","type":"run.started"}
{"runId":"workflow-123","schemaVersion":1,"sequence":1,"scriptPath":"/repo/.codex/workflows/my-workflow.js","runDirectory":"/repo/.codex/workflows/runs/workflow-123","journalPath":"/repo/.codex/workflows/runs/workflow-123/journal.jsonl","result":{"answer":42},"type":"run.completed"}
```

Capture or filter the stream without breaking it:

```sh
gpt-workflow run --default-model gpt-5.6-luna \
  .codex/workflows/my-workflow.js | tee run.jsonl
gpt-workflow run --default-model gpt-5.6-luna \
  .codex/workflows/my-workflow.js | jq -c 'select(.type == "agent.event")'
jq -r 'select(.type == "run.completed") | .journalPath' run.jsonl
```

Agent-side terminal and result failures resolve to `null`, remain visible in
the run's failures, and are retried on resume. Programmer, setup, cancellation,
worktree, and transport failures still reject the run.

## Durable journals

Live runs persist an append-only replay journal at:

```text
.codex/workflows/runs/<runId>/journal.jsonl
```

Resume reuses that run ID and directory. Journal v3 matches completed calls by
an order-independent prompt-and-options key multiset until the first miss, then
executes that call and every later call live.

Parse large journals one record at a time:

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
  if (entry.type === "result") console.log(entry.result)
}
```

The journal is workflow replay state. Codex separately persists full agent
thread rollouts and exposes them through App Server thread APIs; their private
on-disk layout is not a `gpt-workflow` contract.

## Library API

```js
import {
  AppServerClient,
  REQUIRED_APP_SERVER_MODELS,
  runWorkflowScript
} from "gpt-workflow"

const source = `
export const meta = {
  name: "summarize",
  description: "Summarize a topic"
}

return await agent("Summarize " + args.topic)
`

const client = await AppServerClient.connect({
  defaultModel: "gpt-5.6-luna",
  requiredModels: REQUIRED_APP_SERVER_MODELS
})

try {
  const execution = await runWorkflowScript(source, {
    appServer: client,
    args: { topic: "deterministic orchestration" }
  })
  console.log(execution.result, execution.journalPath)
} finally {
  await client.close()
}
```

`runWorkflowScript` accepts `runDirectory` for caller-owned storage and
`resumeFromRunId` for library resume. An injected `agent` can drive offline
tests without Codex.

## Codex plugin

This repository is itself an installable Codex plugin with an author/run/debug
skill:

```sh
codex plugin marketplace add CyrusNuevoDia/gpt-workflow
codex plugin add gpt-workflow@gpt-workflow
```

See [plugin installation and behavior](docs/07-plugin.md).

## Documentation

Start with [Getting started](docs/01-getting-started.md) or use the full
[documentation index](docs/README.md). The Claude material used as parity
reference is preserved under
[`.claude/workflows/docs/`](.claude/workflows/docs/) and is not presented as
the Codex package contract.

The executable reference workflows in [`.claude/workflows/`](.claude/workflows/)
are mechanically mirrored into [`.codex/workflows/`](.codex/workflows/) for the
test suite.

Workflow scripts execute in a `node:vm` semantic boundary. Treat them as trusted
repository code; this is not a hostile-code security sandbox.

## Verify

```sh
just check
```

`just check` runs formatting checks, offline verification, package packing and
installation, strict consumer typechecking, and installed CLI smokes. It does
not spend model tokens. `just mirror` regenerates the Codex fixtures;
`just verify` runs the live App Server suite and does spend model tokens.
