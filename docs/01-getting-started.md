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

`meta.name` becomes a storage directory name. It may contain only letters,
numbers, periods, underscores, and hyphens, and cannot be `.` or `..`.

Workflow source is trusted repository code executed in a `node:vm` semantic
boundary. It is not a security sandbox for hostile JavaScript.

## Run and inspect it

```sh
gpt-workflow models
gpt-workflow run --default-model gpt-5.6-luna \
  --args '{"files":["src/cli.ts","src/runtime.ts"]}' \
  .codex/workflows/summarize-files.js
```

`--default-model` supplies the model for calls that omit `options.model`.
Explicit per-call models still override it. Without either, `agent()` fails.
Live agents use the directory where the CLI was invoked as their default
working directory, so repository-relative prompt paths resolve from there.
Use `agentType: "default"`, `"worker"`, or `"explorer"` for a built-in agent
definition. Project and personal `.codex/agents/*.toml` files can define custom
types; see the [API reference](03-api.md#agent-type-registry).

`--args` supplies the script's `args` global as strict JSON. A plain string
must be quoted JSON (`--args '"triage"'`); anything `JSON.parse` rejects
exits 1 with a usage error on stderr before any record is emitted. Omit the
flag and `args` is `undefined`.

Stdout is ordered NDJSON. Every record includes `schemaVersion`, `sequence`,
`runId`, `scriptPath`, `runDirectory`, `ts` (epoch milliseconds), and `type`.
The opening `run.started` record carries the script's `meta`. Human
diagnostics go to stderr.

`models` streams every model discovered from the authenticated App Server as
NDJSON without spending model tokens. A run requires the package's standard
model set by default; repeat `--required-model <name>` to replace that set.
Transport timing can be tuned with `--request-timeout-ms`,
`--thread-start-timeout-ms`, and `--turn-timeout-ms`.

`SIGINT` and `SIGTERM` cancel queued work, interrupt active agents, emit and
persist `run.failed`, close the App Server, and exit nonzero.

The terminal `run.completed` record contains `result`, `usage`, `failures`, and
`journalPath`. The journal lives at:

```text
$CODEX_HOME/projects/<encoded-project-path>/workflows/<workflow-name>/runs/<runId>/journal.jsonl
```

The same directory collects `events.jsonl`, a filtered copy of the stream
that the two commands below read back — no need to `tee` the run yourself.

## List past runs

`list` scans every workflow under the current project's `CODEX_HOME` storage
and prints one JSON line per run, newest first. It reads only local files and
spends no model tokens:

```sh
gpt-workflow list
```

```json
{"lastEventAt":1783971339402,"name":"summarize-files","runId":"workflow-123","scriptPath":"/repo/.codex/workflows/summarize-files.js","startedAt":1783971328984,"status":"completed","finishedAt":1783971339402,"failureCount":0,"usage":{"agentCount":2,"liveAgentCount":2,"modelUsage":{"gpt-5.6-luna":{"liveAgentCount":2,"replayedAgentCount":0,"subagentTokens":3412}},"peakConcurrentAgents":2,"replayedAgentCount":0,"subagentTokens":3412}}
```

`status` is `"completed"`, `"failed"`, `"incomplete"`, or `"unknown"`;
`finishedAt`, `failureCount`, and `usage` appear once the run ended.

## Check one run

```sh
gpt-workflow status workflow-123
```

Prints one JSON object: the `list` fields plus ordered `phases` (each with
per-phase agent counts and token totals), `agents` (each with `agentId`,
`label`, `phase`, `model`, `status`, and its latest cumulative `tokens`
snapshot), and `result` and `failures` once the run ended. Like `list`, it
spends no model tokens.

A run with no terminal record is `"incomplete"` — an in-flight and an
interrupted run look identical on disk, so the CLI never claims "running";
check `lastEventAt` for staleness. Per-agent `status` comes from each agent's
own terminal event, so an interrupted run still shows which agents completed
or failed. An unknown run ID exits 1 with `run not found` on stderr. A run ID
present under more than one workflow is rejected as ambiguous. Runs recorded
before `events.jsonl` existed report
`{"status":"unknown","journalOnly":true,...}` with journal record counts.

## Resume a run

Reuse the `runId` from the original stream:

```sh
gpt-workflow run --default-model gpt-5.6-luna --resume workflow-123 \
  --args '{"files":["src/cli.ts","src/runtime.ts"]}' \
  .codex/workflows/summarize-files.js
```

Resume reads the same journal and matches completed `agent()` calls from a key
multiset. Matching is order-independent until the first miss; that call and all
later calls run live and append new records to the same journal. Keep `--args`
identical to replay: changed args change prompts, which miss their journal
keys and run live. Resume rejects a missing run ID or a run whose stored
workflow name differs from the current script's `meta.name` before connecting
to Codex.

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
