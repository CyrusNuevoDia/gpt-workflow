# Orchestration patterns

## Parallel research, single synthesis

Use independent thunks for coverage, filter failed slots, then ask one agent to
synthesize only the collected evidence.

```js
const findings = await parallel(
  lanes.map((lane) => () => agent(lane.prompt, lane.options))
)
const usable = findings.filter(Boolean)
return await agent(`Synthesize:\n${JSON.stringify(usable)}`, mergeOptions)
```

## Per-item pipeline

Use `pipeline` when every item follows the same ordered stages:

```js
return await pipeline(
  files,
  (file) => agent(`Inspect ${file}`, inspectOptions),
  (inspection, file) => agent(`Verify ${file}: ${inspection}`, verifyOptions)
)
```

## Adversarial verification

Separate proposal from critique. Give critics the artifact, constraints, and a
specific falsification task; do not tell them the expected verdict. Merge only
after independent results return.

## Deterministic iteration

Keep loop bounds and branch conditions in JavaScript. Include stable indexes or
names in prompts so each agent call has an intentional identity. Pass changing
inputs through `args`, not clocks or randomness.

## Resume-friendly edits

Place stable expensive calls before volatile synthesis calls. Because replay is
prefix-based, editing an early call invalidates everything after it. Do not
reorder calls casually when you intend to reuse a run.

## Child workflows

Extract a child when it is a reusable orchestration unit with its own metadata,
not merely to shorten a file. Children share caps and journal history, so
composition does not create extra concurrency or budget.
