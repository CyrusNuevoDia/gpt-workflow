# Getting started

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

## Launching a run

Three invocation shapes, all through the `Workflow` tool:

```js
Workflow({ script: "export const meta = {...}\n..." })       // inline source
Workflow({ scriptPath: "/abs/path/to/my-workflow.js" })      // from a file
Workflow({ name: "deep-research", args: { question: "..." }})// registered name
```

Notes on each:

- **Inline `script`** is the normal path for one-off workflows. The runtime
  persists the source to a file under the session directory and returns that
  path, so you never resend the source — edit the file and relaunch with
  `scriptPath`.
- **`scriptPath`** takes precedence over `script` and `name`. Use it for files
  you keep in the repo (like this repo's parity suite).
- **`name`** resolves from a registry (built-ins, plugins, `.claude/workflows/`).
  Caveat *(observed)*: the registry does not see files written mid-session —
  a fresh session registers them. Pinned by: `parity-07` (recorded check).

Every run launches **in the background**. The tool returns immediately with:

- a **task ID** (for `TaskOutput`/`TaskStop`),
- a **run ID** (`wf_...`, for resume),
- the persisted **script file path**,
- the **transcript directory** (per-agent transcripts + the journal).

Watch live progress with `/workflows` — you'll see the phase groups, agent
labels, and `log()` lines from the script.

## Reading the result

When the run finishes, a task notification delivers:

- **`result`** — whatever the script returned, JSON-serialized.
- **`failures`** — one line per failed slot, e.g.
  `parallel[2] failed: intentional thunk failure`. Failures that the script
  absorbed (null slots) do **not** fail the run. Pinned by: `parity-03`.
- **`usage`** — agent counts (`done`/`error`/`skipped`/`empty_result`),
  subagent tokens, tool uses, duration.

If the result looks empty or wrong, read `journal.jsonl` in the transcript
directory **before** re-running — it records each agent's actual return value
(see [Runtime semantics](04-runtime.md#transcripts-and-the-journal)).

## Iterating on a workflow

The edit loop the runtime is designed around:

1. Launch once (inline or by path). Note the returned `scriptPath` and `runId`.
2. Edit the script file.
3. Relaunch with `Workflow({ scriptPath, resumeFromRunId: runId })`.

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
Workflow({ scriptPath: ".../triage.js", args: { repo: "web", files: ["a.ts", "b.ts"] } })
```

```js
// inside the script
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

## Who may launch workflows

The reference runtime gates orchestration behind explicit user opt-in: the
`ultracode` keyword or session toggle, the user asking for a workflow /
multi-agent orchestration in their own words, a skill whose instructions call
for it, or a named/saved workflow. A task merely *benefiting* from parallelism
does not qualify. An independent implementation should decide its own policy,
but the default posture — workflows can spawn dozens of agents, so the user
opts into that scale — is worth keeping.

## Where to next

- The full contract for every global: [API reference](03-api.md).
- How runs execute, cache, and fail: [Runtime semantics](04-runtime.md).
- Ready-made orchestration shapes: [Patterns](05-patterns.md).
