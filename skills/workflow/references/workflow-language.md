# Author workflow scripts

## File shape

The first complete statement is literal metadata:

```js
export const meta = {
  name: "review-change",
  description: "Review one change with independent critics",
  phases: [{ title: "Review", detail: "Independent checks" }]
}

const reviews = await parallel(
  args.files.map((file) => () =>
    agent(`Review ${file}`, {
      label: `review:${file}`
    })
  )
)

return { reviews: reviews.filter(Boolean) }
```

`meta.name` and `meta.description` are required. `meta.name` may contain only
letters, numbers, periods, underscores, and hyphens, and cannot be `.` or `..`.
`whenToUse` and literal phase objects are optional. Metadata cannot execute
code.

Per-call `model` is optional when the CLI or App Server client supplies a
default. An explicit `model` remains a per-call override.

Built-in `agentType` values are `default`, `worker`, and `explorer`. Custom
types resolve by `name` from project or personal `.codex/agents/*.toml` files.

## Globals

- `agent(prompt, options?)`: one JSON-returning agent call.
- `parallel(thunks)`: concurrent independent thunks; failed slots become
  `null` and are recorded in `failures`.
- `pipeline(items, ...stages)`: ordered stages per item, concurrent across
  items; failed items become `null`.
- `phase(title)` and `log(message)`: attributed workflow events.
- `workflow(nameOrPath, childArgs?)`: one-level child composition by default.
- `args`: caller-provided JSON value (`--args <json>` on the CLI).
- `budget`: per-run output-token `total`, `spent()`, and `remaining()`.
- `console`: `log`, `info`, `warn`, `error`, and `debug`, all forwarded as log
  events.
- `setTimeout` and `clearTimeout`: deterministic timer scheduling.

## Boundaries

Top-level `await` and `return` are valid. Node imports, `process`, network
globals, intervals, and microtask scheduling are unavailable. Top-level
`undefined` returns become `null`; other final return values, args, options, and
agent results must be plain JSON data. Pipeline intermediate values remain raw
until each item's final boundary. `Date.now()`, argumentless `new Date()`, and
`Math.random()` throw because they break deterministic replay.

Parent and child workflows share the scheduler, caps, budget, agent counter,
journal, and replay chain.

## Keep application logic outside the workflow

Use JavaScript here to decide which bounded LM calls run, in what order, and when
judgment is sufficient. Do not turn the workflow into a parser, canonicalizer,
validator, artifact builder, compiler, or persistent state machine.

Anti-pattern: ask an agent to return known file metadata alongside its judgment,
then have the workflow validate, normalize, hash, and compile the final artifact.
That makes deterministic correctness depend on model output and hides several
restart boundaries inside one run.

Instead, compose three explicit phases in a runbook:

```text
prepare-manifest script -> review workflow -> collect-results script
```

The preparation script owns canonical paths, hashes, IDs, and input validation.
The workflow receives that manifest and asks only for model-owned semantics:

```js
export const meta = {
  name: "review-manifest",
  description: "Review prepared manifest items independently"
}

const results = await parallel(
  args.items.map((item) => () =>
    agent(`Review this content and return only findings and rationale:\n${item.content}`, {
      label: `review:${item.id}`,
      schema: {
        type: "object",
        properties: {
          findings: { type: "array", items: { type: "string" } },
          rationale: { type: "string" }
        },
        required: ["findings", "rationale"],
        additionalProperties: false
      }
    })
  )
)

return results
```

Persist this raw workflow result. The collector script associates each position
with the manifest item, projects only `findings` and `rationale`, rejects invalid
values, adds the canonical deterministic envelope, and writes the final artifact
atomically. This preserves what the model actually said without trusting it to
reproduce facts the system already knows.

Workflow-side conditions remain appropriate when they control LM orchestration,
such as escalating a low-confidence judgment, stopping after consensus, or
skipping later agent stages after `null`. If the condition implements a domain
state transition or compilation rule, put it in the surrounding script instead.
