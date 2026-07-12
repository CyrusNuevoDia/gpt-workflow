# Workflow language

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
      label: `review:${file}`,
      model: "gpt-5.6-luna"
    })
  )
)

return { reviews: reviews.filter(Boolean) }
```

`meta.name` and `meta.description` are required. `whenToUse` and literal phase
objects are optional. Metadata cannot execute code.

## Globals

- `agent(prompt, options?)`: one JSON-returning agent call.
- `parallel(thunks)`: concurrent independent thunks; failed slots become
  `null` and are recorded in `failures`.
- `pipeline(items, ...stages)`: ordered stages per item, concurrent across
  items; failed items become `null`.
- `phase(title)` and `log(message)`: attributed workflow events.
- `workflow(nameOrPath, childArgs?)`: one-level child composition by default.
- `args`: caller-provided JSON value.
- `budget`: `total`, `spent()`, and `remaining()`.

## Boundaries

Top-level `await` and `return` are valid. Node imports, `process`, network
globals, timers, and console are unavailable. Return values, args, options, and
agent results must be plain JSON data. `Date.now()`, argumentless `new Date()`,
and `Math.random()` throw because they break deterministic replay.

Parent and child workflows share the scheduler, caps, budget, agent counter,
journal, and replay chain.
