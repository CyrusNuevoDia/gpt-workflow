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

`name` and `description` are required strings. Because `name` is also the
workflow's storage directory, it may contain only letters, numbers, periods,
underscores, and hyphens, and cannot be `.` or `..`. `whenToUse` and `phases`
are optional. Metadata cannot call functions, read variables, spread values, or
use computed properties; the runtime parses it without executing the workflow.

## Body and inputs

The body receives these globals: `agent`, `parallel`, `pipeline`, `phase`,
`log`, `workflow`, `args`, `budget`, `console`, `setTimeout`, and
`clearTimeout`. `console.log`, `info`, `warn`, `error`, and `debug` all forward
their joined arguments as `log` events. The VM has no Node.js imports,
`process`, `require`, network globals, intervals, or microtask scheduling. Pass
external data through the JSON-compatible `args` value — the CLI's
`--args <json>` flag or the library's `args` option.

`agent()` can select the built-in `default`, `worker`, or `explorer` definition
with `agentType`. It can also select a custom definition by the `name` field in
a project or personal `.codex/agents/*.toml` file.

The returned value becomes `WorkflowExecution.result` and must be valid JSON.
A top-level `undefined`, including a missing `return`, is coerced to `null`;
side-effect-only parallel slots, final pipeline stages, and child workflows do
the same. Pipeline intermediate values remain raw inside the VM and only each
item's final value crosses the JSON boundary. Agent results, child arguments,
parallel final slots, and final results otherwise reject `undefined`, functions,
symbols, bigint, cycles, sparse arrays, non-finite numbers, accessors, and custom
prototypes.

## Determinism

Resume hashes each agent prompt with its authored options. The VM still rejects
ambient entropy:

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

The shared budget counts output tokens reported during the run. Parent and
child workflows share that per-run pool, but separate sibling workflow
processes do not share a turn-wide pool.
