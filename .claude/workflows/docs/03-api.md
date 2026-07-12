# Claude reference API

Eight globals are injected into every workflow script. Two spawn and
coordinate work (`agent`, `workflow`), two shape concurrency (`parallel`,
`pipeline`), two narrate progress (`phase`, `log`), and two are ambient state
(`args`, `budget`).

---

## `agent(prompt, opts?) → Promise<string | object | null>`

Spawn one subagent. The subagent is a real agent with tool access (Bash, file
reads, search; MCP tools loadable via ToolSearch) running against the session's
working directory.

### Return value

| Situation | Returns |
|---|---|
| No `schema` | The agent's **final text, as a string** — raw data, not a wrapped message. Subagents are told their final text *is* the return value, so they answer with the payload (`"pong"`, not `"The answer is pong."`). Pinned by: `parity-01`. |
| With `schema` | The **validated object**. The subagent is forced to call a StructuredOutput tool; validation happens at the tool-call layer, and mismatches make the agent retry. The script never parses. Pinned by: `parity-02`. |
| User skipped the agent mid-run, or terminal API error after retries | `null`. Always `.filter(Boolean)` collections that may contain agent results. |

### Options

| Option | Type | Default | Semantics |
|---|---|---|---|
| `label` | string | derived from prompt | Display name in the progress tree (`summarize:src/a.ts`) |
| `phase` | string | current `phase()` | Explicit progress group. Use inside `parallel`/`pipeline` stages — concurrent stages race the global `phase()` state; the option doesn't. Same string ⇒ same group box. |
| `schema` | JSON Schema object | — | Forces structured output (see above). Constraints like `enum`, `minItems`/`maxItems` are enforced by the validator, so encode invariants here rather than in prose. Pinned by: `parity-02`. |
| `model` | `'sonnet' \| 'opus' \| 'haiku' \| 'fable'` | inherits the session model | Per-call override. **Cost note:** inheriting means every agent runs on the (possibly expensive) main-loop model — pin cheap models explicitly for mechanical stages. Pinned by: `parity-08`. |
| `effort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | inherits session effort | Reasoning-effort override. `'low'` for mechanical stages; high tiers for the hardest verify/judge stages. Pinned by: `parity-08`. |
| `isolation` | `'worktree'` | none | Runs the agent in a fresh git worktree — an isolated copy of the repo. Expensive (~200–500ms setup + disk per agent); use **only** when agents mutate files in parallel and would collide. The worktree is auto-removed if left unchanged. Requires a resolvable HEAD — see [errors](06-errors-and-limits.md). Pinned by: `parity-09`. |
| `agentType` | string | the default workflow subagent | Use a custom subagent type from the same registry as the Agent tool (`'general-purpose'`, `'Explore'`, project-defined types). Composes with `schema` — the custom agent's system prompt gets the StructuredOutput instruction appended. Pinned by: `parity-08`. |

### Prompt contract

Prompts must be **self-contained**: the subagent sees the prompt and the
filesystem, not your script, your variables, or sibling agents' work. Inline
everything it needs (paths, code snippets, prior-stage output) and state the
return format explicitly.

### Examples

```js
// Text out
const status = await agent('Run `git status --porcelain` via Bash and return only the output.',
  { model: 'haiku', label: 'git-status' })

// Structured out — invariants live in the schema, not the prose
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}
const verdict = await agent('Try to refute this claim: ' + claim, {
  model: 'haiku', effort: 'low', schema: VERDICT, label: 'refute:' + i, phase: 'Verify',
})

// Custom agent type + isolation for parallel file mutation
const patch = await agent('Apply the rename described below, run the tests, report results...\n' + spec, {
  agentType: 'general-purpose', isolation: 'worktree', label: 'migrate:' + file,
})
```

---

## `parallel(thunks) → Promise<any[]>`

Run tasks concurrently and **wait for all of them** — a barrier.

```js
const results = await parallel(items.map(item => () => agent(promptFor(item), opts)))
```

Semantics, all pinned by `parity-03` unless noted:

- Takes an array of **thunks** (`() => Promise`), not promises — the runtime
  controls when each starts (concurrency slots; see
  [Runtime semantics](04-runtime.md#concurrency-and-caps)).
- Results are **positional**: `results[i]` corresponds to `thunks[i]`.
- A thunk that throws — or whose agent errors — resolves to **`null`** in the
  result array. **The call itself never rejects.** `.filter(Boolean)` before
  consuming.
- Non-agent thunks are fine (`() => Promise.resolve(computeThing())`).
- At most **4096 items** per call; more is an explicit, synchronous, catchable
  error (Pinned by: `parity-10`).

### When a barrier is justified — and when it isn't

A barrier is correct only when the next stage needs **cross-item context from
every prior result**:

- Dedup/merge across the full result set before expensive downstream work.
- Early-exit on the total ("0 findings ⇒ skip verification entirely").
- A prompt that references "the other findings" for comparison.

A barrier is **not** justified by "I need to flatten/map/filter first" (do it
inside a pipeline stage), "the stages are conceptually separate" (that's what
`pipeline` models), or "it's cleaner code" (barrier latency is real — if the
slowest of 5 finders takes 3× the fastest, a barrier wastes two-thirds of the
fast finders' wall-clock). Smell test: `parallel → pure transform → parallel`
almost always wants to be a `pipeline` with the transform inside a stage.

---

## `pipeline(items, ...stages) → Promise<any[]>`

Run each item through all stages independently, **with no barrier between
stages** — item A can be in stage 3 while item B is still in stage 1.
Wall-clock cost is the slowest single-item *chain*, not the sum of the slowest
item per stage. **This is the default for multi-stage work.**

```js
const results = await pipeline(
  files,
  (prev, file, i) => agent('Review ' + file + ' for bugs...', { schema: FINDINGS, phase: 'Review' }),
  (review, file, i) => parallel(review.findings.map(f => () =>
    agent('Adversarially verify: ' + f.title, { schema: VERDICT, phase: 'Verify' })
      .then(v => ({ ...f, verdict: v }))
  )),
)
```

Semantics, all pinned by `parity-04`:

- Every stage callback receives `(prevResult, originalItem, index)` — later
  stages label work off `originalItem`/`index` without threading context
  through earlier returns.
- **Stage 1 receives the item itself as `prevResult`** *(observed:
  `prev === item` on the reference runtime — reduce-style seeding)*.
- Stage output is awaited and flows to the next stage.
- A stage that **throws drops that item to `null`** in the results and skips
  the item's remaining stages. Other items are unaffected.
- Results are positional per input item; the 4096-item cap applies.

---

## `phase(title)` and `log(message)`

`phase(title)` starts a progress group; subsequent `agent()` calls join it.
Titles matching a `meta.phases` entry adopt its `detail`. Inside concurrent
callbacks, prefer the per-call `opts.phase` — the global pointer races.

`log(message)` emits a narrator line above the progress tree. Use it for
progress the user cares about ("14/40 migrated, 2 skipped") and for the
**no-silent-caps rule**: whenever a workflow bounds coverage (top-N, sampling,
no-retry), `log()` what was dropped — silent truncation reads as "covered
everything" when it didn't.

Neither returns a value. Pinned by: `parity-01` (both execute; log lines
observed in run output).

---

## `workflow(nameOrRef, args?) → Promise<any>`

Run another workflow inline as a sub-step and return its return value.

```js
const child = await workflow('deep-research', { question })          // by registry name
const child2 = await workflow({ scriptPath: '/abs/path/child.js' }, { files })  // by file
```

Semantics, pinned by `parity-07` / `parity-07b`:

- Resolution: a string resolves from the same registry as `Workflow({name})`;
  `{scriptPath}` runs a file directly. *(observed)* The registry does not see
  files written mid-session — prefer `scriptPath` for same-session children.
- The child **shares** the parent's concurrency cap, agent counter, abort
  signal, and token budget. Its agents render under a `▸ name` group; its
  tokens count toward `budget.spent()`.
- The child's `args` global is the second parameter, verbatim — real objects
  arrive intact.
- **Nesting is one level.** `workflow()` inside a child throws — inside the
  *child's* script, catchably, with:
  `workflow() cannot be called from within a child workflow — nesting is
  limited to one level. Inline the inner script or call its agents directly.`
- Unknown names throw catchably:
  `workflow('X'): no workflow with that name. Available: ...`

---

## `args`

The value passed to the invocation, **verbatim** — `undefined` when omitted.
Real JSON values arrive intact (`.map` works on arrays). Verbatim also means
the runtime never parses: if a caller's tool-call encoding stringifies the
value, the script receives one string. Pinned by: `parity-05` (all three
modes). Defensive intake:

```js
const input = typeof args === 'string' ? JSON.parse(args) : (args || {})
```

---

## `budget`

The turn's token target, from a user directive like `+500k`.

| Member | Meaning |
|---|---|
| `budget.total` | The target in tokens, or `null` if none was set |
| `budget.spent()` | Output tokens spent **this turn across the main loop and all workflows** — one shared pool, not per-workflow *(observed: a fresh workflow's first read was already 45,720)* |
| `budget.remaining()` | `max(0, total − spent())`, or `Infinity` when `total` is `null` |

The target is a **hard ceiling**: once `spent() ≥ total`, further `agent()`
calls throw. Pinned by: `parity-06` (contract and no-target behavior; the
ceiling itself needs a real `+Nk` run).

Static scaling and dynamic loops:

```js
const FLEET = budget.total ? Math.floor(budget.total / 100000) : 5

while (budget.total && budget.remaining() > 50000) {   // guard on total!
  // without the guard, remaining() is Infinity and this loop runs
  // until the 1000-agent cap
}
```
