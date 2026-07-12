# Claude reference script format

A workflow script is one self-contained file with a static `meta` export
followed by a plain-JavaScript body. The runtime parses `meta` statically
(without executing the body), then runs the body in a sandboxed async context.

## The `meta` block

Every script must **begin** with:

```js
export const meta = {
  name: 'find-flaky-tests',                                  // required
  description: 'Find flaky tests and propose fixes',         // required — shown in permission dialogs
  whenToUse: 'When CI shows intermittent failures',          // optional — shown in workflow lists
  phases: [                                                  // optional — pre-declared progress groups
    { title: 'Scan',  detail: 'grep test logs for retries' },
    { title: 'Fix',   detail: 'one agent per flaky test', model: 'haiku' },
  ],
}
```

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Registry identity; also how `workflow('name')` resolves it |
| `description` | yes | One line; surfaces in the permission dialog before a run is approved |
| `whenToUse` | no | Longer guidance shown when workflows are listed |
| `phases` | no | Pre-declares progress groups: `{ title, detail?, model? }` |

**`meta` must be a pure literal.** No variables, function calls, spreads, or
template interpolation — the runtime reads it before any code runs, so anything
computed is a load-time error. Keep names kebab-case and stable; the name is an
identity, not a headline.

**Phase titles are matched exactly.** A `phase('Scan')` call in the body joins
the `meta.phases` entry titled `Scan`; a `phase()` call with no matching meta
entry still works — it just gets its own ad-hoc progress group. The optional
`model` on a phase entry is display metadata ("this phase runs on haiku"); it
does not set the model — `agent()` options do. Pinned by: `parity-08` (meta
carries a `model` annotation; the run passes).

## Language and sandbox

Scripts are **plain JavaScript, not TypeScript**. Type annotations, interfaces,
and generics fail to parse. The body runs in an async context, so top-level
`await` is normal.

What's available and what isn't:

| Available | Not available |
|---|---|
| Standard built-ins: `JSON`, `Math`, `Array`, `Set`, `Map`, `Promise`, string/array methods, `new Date(ms)` *with* an argument | `Date.now()`, `Math.random()`, argless `new Date()` — these **throw** |
| The injected globals: `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `args`, `budget` | Filesystem and Node.js APIs — `typeof require` and `typeof process` are both `undefined` *(observed)* |

Pinned by: `parity-10` (all guard behaviors, including built-ins working and
`new Date(1700000000000).getUTCFullYear() === 2023`).

The banned-API errors carry their own remediation text *(observed)*:

> `Date.now() / new Date() are unavailable in workflow scripts (breaks resume).
> Stamp results after the workflow returns, or pass timestamps via args.`

> `Math.random() is unavailable in workflow scripts (breaks resume). For N
> independent samples, include the index in the agent label or prompt.`

## Determinism rules

The bans exist because of **resume**. A run's `agent()` results are memoized
by a hash of `(prompt, opts)` chained with the call history; resuming a run
replays the longest unchanged prefix from cache (see
[Runtime semantics](04-runtime.md#resume-and-memoization), pinned by
`parity-12`). If
a prompt embedded `Date.now()` or `Math.random()`, the second execution would
compute different prompts, miss the cache, and re-spend every token — so the
runtime removes the temptation at the source.

Practical consequences:

- Need a timestamp in results? Stamp it **after** the workflow returns, or pass
  it in via `args`.
- Need variation across N parallel agents? Vary the prompt or label by index —
  `agent(base + ' (perspective #' + i + ')')` — not by randomness.
- Need one-time IDs? Derive them from `args` or item content, not entropy.

## The body

- **The `return` value is the run's result** — it is JSON-serialized into the
  completion notification and returned to `workflow()` callers. Return plain
  data (objects, arrays, strings); don't return live objects like `Set`.
- **Zero-agent scripts are legal.** A body of pure computation runs and returns
  fine (the reference runtime executed one in 16ms). Pinned by: `parity-10`.
- **Uncaught throws fail the run.** Anything you don't catch — including
  `workflow()` errors and the banned-API throws — surfaces as a failed task.
  The absorbing constructs (`parallel`, `pipeline`) convert *their* failures to
  `null` slots instead; see the [failure model](04-runtime.md#the-failure-model).
- **Helper functions are fine.** Define and use ordinary functions, classes,
  regexes — it's just JavaScript. Only the sandbox and determinism rules above
  constrain you.

A useful convention (used across this repo's parity suite): accumulate
machine-checkable results and return one uniform shape —

```js
const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail })
  log((pass ? 'PASS' : 'FAIL') + ': ' + name)
}
// ... body ...
return { suite: meta.name, passed: checks.every(c => c.pass), checks }
```

One subtlety: `meta` is a static export, and whether the body can read it at
runtime is implementation-defined — the parity suite repeats the name as a
string literal instead of referencing `meta.name`. Prefer the literal.

## Script persistence

Every invocation persists its source under the session directory and reports
the path back. That file is the iteration handle: edit it, then relaunch with
`{ scriptPath }` (optionally `+ resumeFromRunId`) rather than resending source.
Scripts you want to keep belong in the repo (this project keeps its suite in
`.claude/workflows/`).
