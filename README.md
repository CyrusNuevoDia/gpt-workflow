# gpt-workflow

A deterministic multi-agent workflow runtime powered by Codex App Server.
Workflow scripts keep control flow in JavaScript and delegate judgment to LLM
agents through `agent()`, `parallel()`, `pipeline()`, and `workflow()`.

## Install

The library requires Node.js 24 or newer. The `gpt-workflow` executable requires
Bun. A live agent run also requires an installed, authenticated Codex CLI.

Install the CLI globally with Bun:

```sh
bun add --global gpt-workflow
```

Install the library in a project with Bun:

```sh
bun add gpt-workflow
```

Contributors working from a source checkout can install its dependencies with:

```sh
bun install
```

## Run a workflow

```sh
gpt-workflow run path/to/workflow.js
```

During a run, stdout is strict newline-delimited JSON. Each line is a complete
record with `schemaVersion`, `sequence`, `runId`, `scriptPath`,
`transcriptDirectory`, and `type`. Records arrive in order as the run changes:

```json
{"runId":"workflow-…","schemaVersion":1,"sequence":0,"scriptPath":"/repo/workflow.js","transcriptDirectory":"/repo/.gpt-workflow/runs/workflow-…","type":"run.started"}
{"runId":"workflow-…","schemaVersion":1,"sequence":1,"scriptPath":"/repo/workflow.js","transcriptDirectory":"/repo/.gpt-workflow/runs/workflow-…","event":{"depth":0,"event":{"detail":null,"title":"Research","type":"phase"},"fileName":"/repo/workflow.js"},"type":"workflow.event"}
{"runId":"workflow-…","schemaVersion":1,"sequence":2,"scriptPath":"/repo/workflow.js","transcriptDirectory":"/repo/.gpt-workflow/runs/workflow-…","journalPath":"/repo/.gpt-workflow/runs/workflow-…/journal.jsonl","result":{"answer":42},"type":"run.completed"}
```

Human-readable errors go to stderr, so stdout can be tailed or piped without
breaking the stream:

```sh
gpt-workflow run workflow.js | tee run.jsonl
gpt-workflow run workflow.js | jq -c 'select(.type == "agent.event")'
jq -r 'select(.type == "run.completed") | .journalPath' run.jsonl
```

The journal is persisted under `.gpt-workflow/runs/<runId>/journal.jsonl` and
its path is included in the terminal `run.completed` record. A failed run exits
nonzero after emitting `run.failed` on stdout and a concise diagnostic on
stderr.

## Library API

```js
import { runWorkflowScript } from "gpt-workflow"

const source = `
export const meta = {
  name: "summarize",
  description: "Summarize a topic"
}

return {
  summary: await agent("Summarize " + args.topic, { model: "gpt-5.6-luna" })
}
`

const execution = await runWorkflowScript(source, {
  args: { topic: "deterministic orchestration" },
  agent: async (prompt) => `offline result for: ${prompt}`
})

console.log(execution.result)
```

The injected `agent` makes this example deterministic and offline. For a live
Codex run, use the same source with the App Server client:

```js
import {
  AppServerClient,
  REQUIRED_APP_SERVER_MODELS,
  runWorkflowScript
} from "gpt-workflow"

const client = await AppServerClient.connect({
  requiredModels: REQUIRED_APP_SERVER_MODELS
})

try {
  const execution = await runWorkflowScript(source, {
    appServer: client,
    args: { topic: "deterministic orchestration" }
  })
  console.log(execution.result)
} finally {
  await client.close()
}
```

## Documentation

Start with [Getting started](docs/01-getting-started.md), then use the
[documentation index](docs/README.md) for the script format, public API,
runtime semantics, orchestration patterns, and limits.

The 13 executable reference workflows in [`.claude/workflows/`](.claude/workflows/)
are mirrored into [`.codex/workflows/`](.codex/workflows/) and exercised by the
test suite.

Workflow scripts execute in a `node:vm` semantic sandbox. Treat them as trusted
repository code; this is not a security boundary for hostile JavaScript.

## Verify

```sh
just check
```

`just check` runs formatting checks, the complete offline verifier, and package
verification. Package verification builds the project, checks the exact npm
tarball contents, installs that tarball into a clean consumer project, imports
the package by name, typechecks a strict consumer, and runs both the library and
installed CLI smokes. It leaves no build or verification debris in the
repository.

`just mirror` regenerates the Codex workflow fixtures. `just verify` exercises
the complete live Codex App Server suite and spends model tokens.
