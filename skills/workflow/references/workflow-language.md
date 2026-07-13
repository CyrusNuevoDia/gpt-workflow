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

`meta.name` and `meta.description` are required. `whenToUse` and literal phase
objects are optional. Metadata cannot execute code.

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
- `args`: caller-provided JSON value.
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
