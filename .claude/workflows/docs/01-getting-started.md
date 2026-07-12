# Getting started with the Claude reference workflow

## The mental model

A workflow is a JavaScript script that orchestrates LLM subagents. The split of
responsibilities is the whole idea:

- **Control flow lives in code.** Loops, conditionals, fan-out, dedup, majority
  votes, early exits — deterministic JavaScript you can read, test, and resume.
- **Judgment lives in agents.** Each `agent()` call spawns a real subagent (with
  tool access — Bash, file reads, search) that does one well-scoped piece of
  thinking and returns data.

Compare the alternatives. A single agent given a big task makes its own plan and
you get whatever it decided to do. A workflow inverts that: *you* decide there
will be one finder, three adversarial verifiers, and a majority vote — the model
only fills in the judgment inside each box. That structure is what makes
multi-agent work **comprehensive** (decompose and cover in parallel),
**confident** (independent perspectives before committing), and **scalable**
(work no single context window can hold).

Reach for a workflow when the orchestration itself should be deterministic.
Stay with a single agent call when one context can hold the task.

## Your first workflow

A script has two parts: a `meta` block (static description) and a body (plain
JavaScript, running in an async context — top-level `await` works).

```js
export const meta = {
  name: 'summarize-and-merge',
  description: 'Summarize three files in parallel, then merge into one brief',
  phases: [
    { title: 'Summarize', detail: 'one agent per file' },
    { title: 'Merge', detail: 'combine into one brief' },
  ],
}

const files = ['src/parser.ts', 'src/emitter.ts', 'src/cache.ts']

phase('Summarize')
const summaries = await parallel(files.map(f => () =>
  agent(
    'Read ' + f + ' and summarize what it does in 3 bullets. Return only the bullets.',
    { model: 'haiku', label: 'summarize:' + f, phase: 'Summarize' },
  )
))

phase('Merge')
const brief = await agent(
  'Merge these file summaries into one short architecture brief:\n\n' +
  summaries.filter(Boolean).join('\n\n'),
  { model: 'sonnet', label: 'merge', phase: 'Merge' },
)

return { brief, filesCovered: summaries.filter(Boolean).length }
```

Everything characteristic is already here:

- `meta` names the workflow and pre-declares progress phases (pure literal —
  no computed values; see [Script format](02-script-format.md)).
- `parallel()` takes **thunks** (`() => promise`), runs them concurrently, and
  waits for all of them — a barrier.
- Each `agent()` call pins a `model`, a display `label`, and a `phase` group.
- A failed agent yields `null`, so `.filter(Boolean)` before consuming results.
- The script's `return` value **is** the run's result.

## Running a workflow

Put the workflow above in a string named `source`. Connect one App Server
client, pass it to each run, and close it when the application is done:

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
    args: { files: ["src/parser.ts", "src/emitter.ts", "src/cache.ts"] },
    onAgentEvent: (event) => console.log(event)
  })
  console.log(execution.result)
} finally {
  await client.close()
}
```

`runWorkflowScript()` resolves when the run finishes. `onAgentEvent` receives
attributable progress while agents are active. To load a workflow from disk,
read the JavaScript source and pass it to the same function; `fileName` can
preserve the source name in load errors.

## Reading the result

When the returned promise resolves, `WorkflowExecution` contains:

- **`result`** — whatever the script returned, JSON-serialized.
- **`failures`** — one line per failed slot, e.g.
  `parallel[2] failed: intentional thunk failure`. Failures that the script
  absorbed (null slots) do **not** fail the run. Pinned by: `parity-03`.
- **`usage`** — agent counts and model token usage.
- **`events`** and **`agentEvents`** — script and App Server lifecycle evidence.
- **`workflowRunId`** and **`journalPath`** — identifiers for replay and
  inspection.

If the result looks empty or wrong, read `journal.jsonl` in the transcript
directory **before** re-running — it records each agent's actual return value
(see [Runtime semantics](04-runtime.md#transcripts-and-the-journal)).

## Iterating on a workflow

The edit loop the runtime is designed around:

1. Run the source and keep `execution.workflowRunId`.
2. Edit the source.
3. Run it again with `resumeFromRunId: execution.workflowRunId` and the same
   transcript location.

Resume replays the longest unchanged **prefix** of `agent()` calls from cache —
same prompt and options ⇒ cached result, instantly and for free; the first
edited call and everything after runs live, *even calls that are themselves
unchanged*. An unchanged script resumed in full is a 100% cache hit: the
reference runtime replayed a 3-agent workflow in 5ms with 0 subagent tokens.
Pinned by: `parity-12`.

This is also why scripts ban wall clocks and randomness — see
[Script format](02-script-format.md#determinism-rules).

## Parameterizing with `args`

The `args` input surfaces in the script as a global, **verbatim**:

```js
const execution = await runWorkflowScript(source, {
  appServer: client,
  args: { repo: "web", files: ["a.ts", "b.ts"] }
})
```

Inside the workflow source, `args` is the same JSON-compatible value:

```js
const targets = args.files.map(f => args.repo + '/' + f)   // real array — .map works
```

Two sharp edges, both verified live (Pinned by: `parity-05`):

- Omit `args` and the global is `undefined` — branch on that for defaults.
- **Verbatim cuts both ways.** Args passed from *inside* a script
  (`workflow(ref, args)`) arrive as real objects. Args crossing a tool-call
  boundary may arrive as a JSON-encoded **string** if the caller's encoding
  stringifies them — the runtime never parses. Defensive pattern:

```js
const input = typeof args === 'string' ? JSON.parse(args) : (args || {})
```

## Controlling launch authority

The library does not decide who may start a workflow. Applications should gate
multi-agent execution explicitly: workflows can spawn dozens of agents and
spend model tokens, so the user should opt into that scale.

## Where to next

- The full contract for every global: [API reference](03-api.md).
- How runs execute, cache, and fail: [Runtime semantics](04-runtime.md).
- Ready-made orchestration shapes: [Patterns](05-patterns.md).
