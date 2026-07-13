# gpt-workflow

A deterministic multi-agent workflow runtime powered by Codex App Server.
Control flow — loops, branches, retries — is plain JavaScript in your script;
`agent()` delegates bounded judgment to Codex threads, and `parallel()`,
`pipeline()`, and child `workflow()` calls fan that work out.

Compared to driving Codex directly, a workflow adds:

- **Resumability** — long or token-expensive runs replay completed calls from
  a durable journal instead of paying for them again.
- **Validated structured output** — pass a JSON schema to `agent()` and the
  runtime validates the reply and retries invalid ones, instead of you
  policing format in prompt text.
- **Multi-agent verification** — independent critics and judge panels, where
  a failed call resolves to `null` instead of aborting the fan-out.

## Install

Everything requires Bun 1.3 or newer, with the Codex CLI installed and
authenticated for live runs. Node.js is not a supported runtime.

The preferred install is the Codex plugin. It bundles a skill that authors,
runs, and debugs workflows for you, and it runs the published CLI through
`bunx`, so there is no separate package to install:

```sh
codex plugin marketplace add CyrusNuevoDia/gpt-workflow
codex plugin add gpt-workflow@gpt-workflow
```

Restart the ChatGPT desktop app after installing and start a new task so the
bundled skill loads; see
[plugin installation and behavior](docs/07-plugin.md).

To drive the CLI yourself, install globally:

```sh
bun add --global gpt-workflow
```

For library use:

```sh
bun add gpt-workflow
```

## Write a workflow

Store project workflows under `.codex/workflows/`; this example is
`summarize-files.js`:

```js
export const meta = {
  name: "summarize-files",
  description: "Summarize files concurrently and merge the findings"
}

const files = ["src/cli.ts", "src/runtime.ts"]
const summaries = await parallel(
  files.map((file) => () =>
    agent(`Read ${file} and return three factual bullets.`, {
      label: `summarize:${file}`
    })
  )
)

return { summaries: summaries.filter(Boolean) }
```

If an agent's thread ends in an error, times out, returns no final message,
or exhausts its structured-output retries, that call resolves to `null` and is
recorded in the run's failures — the `filter(Boolean)` drops those slots. Script bugs,
setup problems such as missing models or bad option types, cancellation,
worktree-setup failures, and transport failures reject the whole run instead.

Workflow source is trusted repository code; it runs inside `node:vm` as a
semantic boundary, not a security sandbox for hostile JavaScript.

## Run and resume

A live run spends model tokens. Resume replays completed calls from the
journal — their tokens are not spent again — then runs the rest live:

```sh
gpt-workflow run --default-model gpt-5.6-luna \
  .codex/workflows/summarize-files.js | tee run.jsonl
gpt-workflow run --default-model gpt-5.6-luna --resume workflow-123 \
  .codex/workflows/summarize-files.js
```

`--default-model` supplies the model for `agent()` calls that omit
`options.model`; without either, the run rejects with a model error. For `--resume`, substitute
the `runId` reported by your original run's records — real IDs look like
`workflow-<uuid>`; these examples shorten it to `workflow-123`.

Stdout is ordered NDJSON; human diagnostics go to stderr. Every record
includes `schemaVersion`, `sequence`, `runId`, `scriptPath`, `runDirectory`,
and `type`. The final `run.completed` record carries the workflow's `meta`,
`result`, `usage`, `failures`, and `journalPath`:

```json
{"scriptPath":"/repo/.codex/workflows/summarize-files.js","type":"run.started","runDirectory":"/repo/.codex/workflows/runs/workflow-123","runId":"workflow-123","schemaVersion":1,"sequence":0}
{"failures":[],"journalPath":"/repo/.codex/workflows/runs/workflow-123/journal.jsonl","meta":{"name":"summarize-files","description":"Summarize files concurrently and merge the findings"},"result":{"summaries":["…","…"]},"type":"run.completed","usage":{"agentCount":2,"liveAgentCount":2,"modelUsage":{"gpt-5.6-luna":{"liveAgentCount":2,"replayedAgentCount":0,"subagentTokens":3412}},"peakConcurrentAgents":2,"replayedAgentCount":0,"subagentTokens":3412},"runDirectory":"/repo/.codex/workflows/runs/workflow-123","runId":"workflow-123","schemaVersion":1,"scriptPath":"/repo/.codex/workflows/summarize-files.js","sequence":9}
```

If the run fails, the CLI emits a `run.failed` record with the error and
exits non-zero. Agent-side `null` failures don't fail the run: they stay
visible in the `run.completed` record's `failures` and are retried on resume.

The first command above captured the stream to `run.jsonl`; filter it without
spending more tokens:

```sh
jq -c 'select(.type == "agent.event")' run.jsonl
jq -r 'select(.type == "run.completed") | .journalPath' run.jsonl
```

## Durable journals

Live runs persist an append-only replay journal at:

```text
.codex/workflows/runs/<runId>/journal.jsonl
```

Resume reuses that `runId` and directory. Completed `agent()` calls are
matched by their prompt and options, regardless of the order they finished
in; at the first call with no journal match, that call and every later call
runs live and appends to the same journal.

To inspect a journal, parse it one record at a time with
`parseWorkflowJournalEntry` — [Getting started](docs/01-getting-started.md)
shows a streaming loop. The parser throws a `SyntaxError` on blank text,
malformed JSON, or records that are not valid journal entries; it never
returns `null`, so wrap each parse in try/catch when surveying a damaged
journal.

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

Running this example spends model tokens; inject `agent` to drive offline
tests without Codex. `REQUIRED_APP_SERVER_MODELS` is the model set the
runtime depends on — `connect` rejects when the App Server cannot start or is
missing any of them. `runWorkflowScript` accepts `runDirectory` for
caller-owned storage and `resumeFromRunId` for library resume, and splits
failures exactly as [Write a workflow](#write-a-workflow) describes:
agent-side failures resolve to `null` and land in `execution.failures`;
everything else rejects.

## Documentation

Start with [Getting started](docs/01-getting-started.md) or the full
[documentation index](docs/README.md). Structured output schemas, budgets,
agent options, and child workflows are covered in the
[API reference](docs/03-api.md); verification and fan-out shapes in
[Patterns](docs/05-patterns.md).

Migrating Claude Code workflows? See the
[Claude parity ledger](docs/08-claude-parity.md) and the
[migration checklist](skills/workflow/references/migration.md).

Working on this repository itself? See [AGENTS.md](AGENTS.md).
