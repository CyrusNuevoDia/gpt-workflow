# Workflow scripts

A workflow is one JavaScript file with a literal `meta` declaration followed by
an async body. Top-level `await` and `return` are supported.

## Metadata

The first complete statement must be a static literal:

```js
export const meta = {
  name: "review-change",
  description: "Review a change with independent critics",
  whenToUse: "When one implementation needs adversarial review",
  phases: [
    { title: "Review", detail: "Independent critics", model: "gpt-5.6-luna" }
  ]
}
```

`name` and `description` are required strings. `whenToUse` and `phases` are
optional. Metadata cannot call functions, read variables, spread values, or use
computed properties; the runtime parses it without executing the workflow.

## Body and inputs

The body receives these globals: `agent`, `parallel`, `pipeline`, `phase`,
`log`, `workflow`, `args`, and `budget`. It has no Node.js imports, `process`,
`require`, timers, network globals, or console. Pass external data through the
JSON-compatible `args` option.

The returned value becomes `WorkflowExecution.result` and must be valid JSON.
The same rule applies to agent results, child arguments, parallel slots, and
pipeline stages. `undefined`, functions, symbols, bigint, cycles, sparse arrays,
non-finite numbers, accessors, and custom prototypes are rejected.

## Determinism

Resume hashes every agent prompt and options together with prior call history.
The VM therefore rejects ambient entropy:

- `Date.now()` and argumentless `new Date()` throw.
- `Math.random()` throws.
- `new Date(milliseconds)` remains available for deterministic conversion.

Pass timestamps, seeds, and other changing inputs explicitly through `args`.

## Composition

`workflow("name", childArgs)` resolves another `.js` file by its literal
`meta.name` from `workflowDirectory`, which defaults to `.codex/workflows`.
`workflow({ scriptPath }, childArgs)` resolves an explicit path. Parent and
child share the scheduler, agent counter, budget, events, journal, and replay
chain. Nesting defaults to one child level.
