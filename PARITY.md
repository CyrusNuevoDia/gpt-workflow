# Workflow SDK Parity Suite

An executable spec for the Claude Code **Workflow SDK** — the dynamic multi-agent
orchestration runtime exposed through the `Workflow` tool (`agent()`, `parallel()`,
`pipeline()`, `phase()`, `log()`, `args`, `budget`, `workflow()`, and the `meta`
script format). Thirteen self-asserting workflow scripts live in
[`.claude/workflows/`](.claude/workflows/); each one exercises a cluster of SDK
behaviors, asserts the semantics in plain JS, and returns a uniform result.

**Goal: 100% feature parity.** To validate your own implementation of this SDK,
provide the same script globals, run these exact scripts, and diff the check
results against the reference-run statuses below. All 13 suites passed against
the reference runtime on 2026-07-11.

Full prose documentation of the SDK — mental model, script format, API
reference, runtime semantics, patterns, errors — lives in [`docs/`](docs/);
each documented behavior is annotated with the suite here that pins it.

## Result contract

Every suite returns:

```json
{
  "suite": "parity-NN-name",
  "passed": true,
  "checks": [{ "name": "...", "pass": true, "detail": "observed value or error text" }]
}
```

Checks prefixed `INFO` record observed-but-unpinned behavior (model-dependent
output, open spec points) and always pass; their value is in the `detail`.
`parity-05-args` additionally returns `mode` (`no-args` | `with-args` |
`with-string-args`) and `echoed` (the args it received, verbatim).
`parity-12-resume` additionally returns `salt` and `nonces` (`{a, b, c}`) —
the material the runner diffs across the legs of the resume protocol.

## Running the suite

From Claude Code, invoke each script by path (all agents are pinned to
`haiku`/`sonnet`, ≤5 agents per suite):

```
Workflow({ scriptPath: "<repo>/.claude/workflows/parity-01-core.js" })
```

Caveats found while running:

- **Name-based invocation** (`Workflow({name: "parity-01-core"})` or
  `workflow('name')` in-script) does not see files written mid-session — the
  registry answered `Available: deep-research, code-review`. Use `scriptPath`,
  or start a fresh session to (re)register names.
- **parity-09** needs a repository with at least one commit (see finding 8).
- **parity-05** should be run three ways to cover all modes: with no `args`,
  with object `args` (e.g. `{"topic": "x", "count": 1, "list": []}` — also
  covered via parity-07's child call), and with a stringified-JSON `args`.

### Running the resume protocol (parity-12)

Resume is a cross-invocation behavior, so `parity-12-resume` splits its
checks: in-script checks validate each leg; the cross-run assertions are the
runner's. The script runs three **sequential** agents — A (fixed prompt),
B (prompt salted by `args.salt`), C (fixed prompt, *after* B) — each returning
true entropy from Bash (`openssl rand -hex 8`). A live execution mints a fresh
nonce; a journal replay returns the recorded one byte-for-byte, so nonce
equality across legs is in-band proof of replay (no clock or journal access
needed in-script). Run three legs and diff the echoed `nonces`:

| Leg | Invocation | Expect |
|---|---|---|
| R1 | fresh, `args {"salt":"s1"}` | 3 live agents; record `nonces` and `runId` |
| R2 | `resumeFromRunId: R1`, salt `s1` | all three nonces identical to R1, `subagent_tokens: 0`, ms-scale duration |
| R3 | `resumeFromRunId: R1`, salt `s2` | A identical (unchanged prefix replays); B fresh (changed call runs live); **C fresh ⇒ prefix memoization** — C identical to R1 would mean a per-key cache, a divergence |

The suite tolerates `args` arriving as a JSON-encoded string (finding 4) — the
parse is deterministic, so agent prompts stay stable across legs. Reference
legs: R1 = 3 live agents, 48,104 tokens, 12.1s; R2 = 0 tokens, 5ms; R3
replayed A and re-ran B *and* C live (32,053 tokens). What resume leaves to
manual verification is listed under "Not scriptable" below.

## Suite matrix

| Suite | Covers | Reference run |
|---|---|---|
| `parity-01-core` | meta/phases, `phase()`, `log()`, plain-text `agent()` return, agent Bash tool access, workflow return value | 3/3 ✓ |
| `parity-02-structured-output` | `schema` option: object return, nested objects, arrays, enums, integers, `minItems`/`maxItems` enforcement, no parsing step | 10/10 ✓ |
| `parity-03-parallel` | barrier semantics, positional results, throwing thunk → `null` (call never rejects), non-agent thunks, `.filter(Boolean)` | 6/6 ✓ |
| `parity-04-pipeline` | per-item stage chaining, `(prev, item, index)` callback args, throwing stage → `null` + later stages skipped, output flows stage-to-stage | 7/7 ✓ |
| `parity-05-args` | `args` verbatim passthrough: objects intact, strings stay strings, `undefined` when omitted, parameterizes prompts | all 3 modes ✓ |
| `parity-06-budget` | `budget.total`/`spent()`/`remaining()` contract, `Infinity` remaining with no target, monotonic `spent()`, loop-until-budget guard | 6/6 ✓ |
| `parity-07-composition` | `workflow()` by `{scriptPath}` with args + return value, registry-name resolution (recorded), one-level nesting limit, unknown-name throws catchably | 6/6 ✓ |
| `parity-07b-nested-probe` | companion: calls `workflow()` itself; `nestedThrew=true` when run as a child proves the nesting error is catchable in the child script | ✓ (via 07) |
| `parity-08-agent-options` | `label`, explicit `opts.phase`, `model` override (haiku + sonnet), `effort` override, `agentType` (`general-purpose`, `Explore`), agentType+schema composition | 6/6 ✓ |
| `parity-09-worktree` | `isolation: 'worktree'`: distinct toplevel, main checkout untouched, clean worktree auto-removed | 4/4 ✓ |
| `parity-10-runtime-guards` | zero-agent run; `Date.now()`/`Math.random()`/argless `new Date()` throw; `new Date(ms)` works; built-ins available; no `require()`; >4096-item cap is an explicit error | 8/8 ✓ |
| `parity-11-patterns` | composed patterns at mini scale: schema finder, dedup-vs-seen loop-until-dry skeleton, 3-lens adversarial verify, majority vote in plain script | 5/5 ✓ |
| `parity-12-resume` | `resumeFromRunId` (3-leg runner protocol): full replay byte-identical at 0 tokens, unchanged-prefix reuse, prefix-not-per-key invalidation via the C-probe, chained journal keys | all 3 legs ✓ |

## Observed reference-runtime behaviors

Semantics pinned by running the suite live — the details your implementation
should reproduce (or consciously diverge from):

1. **Journal format.** Each run writes `journal.jsonl` in its transcript dir:
   `{"type":"started","key":"v2:<hash>","agentId":"..."}` then
   `{"type":"result","key":"v2:<hash>","agentId":"...","result":<return value>}`
   per **live** agent execution — replays append nothing, so the journal
   accumulates across resumes of the same run. The `key` is **not** a hash of
   `(prompt, opts)` alone: parity-12's C-probe re-ran a call with identical
   `(prompt, opts)` after an upstream edit and it logged a *new* key
   (`v2:dca9cd5b…` → `v2:8a883e2d…`) — the key chains in the call history,
   which is what makes prefix invalidation mechanical. Each agent also gets
   `agent-<id>.jsonl` (transcript) and `agent-<id>.meta.json`.
2. **Resume is exact-prefix memoization, not a per-key cache.** Pinned by
   `parity-12-resume`: an unchanged resume replayed all 3 agents
   byte-identically in 5ms with `subagent_tokens: 0`; changing only the middle
   agent's prompt replayed the call *before* it and re-ran everything after it
   live — **including a downstream call whose `(prompt, opts)` matched a
   journal entry exactly**. Resume also reuses the prior run's ID and
   transcript dir rather than minting new ones, and a completed run can be
   resumed multiple times (parity-12 legs R2 and R3 both resumed R1).
3. **`pipeline` stage 1 receives the item as `prev`.** Observed
   `prevWasItem: true` — the first stage's `prevResult` is the original item
   itself (reduce-style seeding).
4. **`args` is verbatim in both directions.** Object args passed from inside a
   script (`workflow(ref, args)`) arrive as real values (`.map` works). Args
   that cross the tool-call boundary as a JSON-encoded *string* arrive as one
   string — the runtime never parses. (`typeof args === 'string'`, content
   unmangled.)
5. **Nesting error text:** `workflow() cannot be called from within a child
   workflow — nesting is limited to one level. Inline the inner script or call
   its agents directly.` Thrown inside the child's script and catchable there.
   Unknown names throw: `workflow('X'): no workflow with that name. Available: ...`.
6. **Item-cap error text:** `array length 4097 exceeds the maximum of 4096
   supported across the workflow VM boundary` — thrown synchronously from
   `parallel()`, catchable.
7. **Determinism-guard error texts** carry remediation guidance:
   `Date.now() / new Date() are unavailable in workflow scripts (breaks
   resume). Stamp results after the workflow returns, or pass timestamps via
   args.` and `Math.random() is unavailable ... For N independent samples,
   include the index in the agent label or prompt.` `new Date(ms)` with an
   argument works. `typeof require`/`typeof process` are both `undefined`.
8. **Worktree isolation** creates `<repo>/.claude/worktrees/<runId>-<n>` and
   auto-removes it when left clean (`git worktree list` shows only the main
   checkout afterwards). In a repo with **zero commits** worktree setup fails
   and the *whole run* fails — `Failed to resolve base branch "HEAD": git
   rev-parse failed` — rather than the agent returning `null`.
9. **`budget.spent()` is a shared pool.** The first read inside a fresh
   workflow was already 45,720 (main loop + sibling workflows count toward it).
   One trivial haiku agent added ~1,545 output tokens. With no `+Nk` target:
   `total === null`, `remaining() === Infinity`.
10. **Failure surfacing.** Intentional thunk/stage throws produce `null` slots
    in results *and* `<failures>` lines in the completion notification (e.g.
    `parallel[2] failed: intentional thunk failure`) without failing the run.
11. **Zero-agent workflows are legal.** parity-10 (0 agents) completed in 16ms;
    scripts can return without ever calling `agent()`.
12. **Agents are real Claude Code subagents.** They ran Bash, read files
    (`Explore`), and returned structured output through custom `agentType`s;
    without a schema the agent's final text is returned raw (`"pong"`, not a
    wrapped message).

## Not scriptable — verify manually

Behaviors specified for the reference runtime that a script cannot assert
(no clock, can't force failures); check these by other means:

- **Concurrency slots** — `min(16, cpu cores − 2)` concurrent agents per
  workflow, excess queue; observe in `/workflows`. Timing is unobservable
  in-script (no `Date.now`).
- **1000-agent lifetime cap** per workflow run.
- **Budget hard ceiling** — once `spent() ≥ total`, further `agent()` calls
  throw. Needs a run with a real `+Nk` token directive.
- **Schema retry** — structured-output validation failures retry the subagent
  at the tool-call layer; can't be forced deterministically.
- **`agent()` → `null`** on user-skip or terminal API error after retries.
- **Resume boundaries** — `resumeFromRunId` is same-session only, and a
  still-running prior run must be stopped (`TaskStop`) before resuming.
  parity-12 pins the memoization semantics; these two limits sit at the
  runner layer, outside a script's reach.
- **MCP tool access** — workflow agents can load session MCP tools via
  ToolSearch (absent in headless/cron runs).
- **`meta` purity enforcement** — computed values in `meta` should be rejected
  at load time (negative test: deliberately break a copy of a script).
- **Progress UI** — `log()` narrator lines, `phase()`/`opts.phase` group boxes,
  and `opts.label` display names in `/workflows`.
- **Script persistence** — every invocation writes the script under the session
  directory and returns `scriptPath` + `runId` for edit-and-resume iteration
  (observed in tool results, not assertable in-script).
