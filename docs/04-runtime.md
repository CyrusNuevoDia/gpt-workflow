# Runtime semantics

How a run actually executes: the two-layer model, concurrency, background
tasks, transcripts, memoization, isolation, and the failure model.

## The two-layer model

A run has two layers with a hard boundary between them:

1. **The orchestrator VM.** Your script runs in a sandboxed JavaScript VM on
   the harness side — no filesystem, no Node APIs, no wall clock, no entropy
   (see [determinism rules](02-script-format.md#determinism-rules)). Values
   crossing the VM boundary are data, and the boundary enforces caps (the
   4096-item error names it explicitly: *"exceeds the maximum of 4096 supported
   across the workflow VM boundary"*).
2. **The subagent fleet.** Each `agent()` call dispatches a real subagent
   process with tool access. Subagents see the working directory and their own
   prompt — never your script's state. Their final text (or structured output)
   is marshaled back across the boundary as the call's return value.

## Lifecycle of a run

1. **Launch.** The `Workflow` tool validates and persists the script, then
   returns immediately: task ID, run ID (`wf_...`), script path, transcript
   directory. The run proceeds in the background.
2. **Execution.** The VM runs the body; `agent()` calls queue into concurrency
   slots; `log()`/`phase()` stream to the progress UI (`/workflows`).
3. **Completion.** A task notification carries the JSON-serialized return
   value, a `<failures>` digest of absorbed errors, and usage counters
   (`agent_count`, `agents_done/error/skipped/empty_result`, `subagent_tokens`,
   `tool_uses`, `duration_ms`).

A real completion, from `parity-03`'s reference run:

```
result:   {"suite":"parity-03-parallel","passed":true,"checks":[...]}
failures: parallel[2] failed: intentional thunk failure
usage:    agent_count=2 agents_done=2 subagent_tokens=30303 duration_ms=5139
```

Note what that shows: an intentional thunk failure surfaced in `failures` and
as a `null` slot — and the run still **completed**, because the script absorbed
it. Pinned by: `parity-03`.

## Concurrency and caps

| Cap | Value | On overflow |
|---|---|---|
| Concurrent agents per workflow | `min(16, cpu cores − 2)` | Excess `agent()` calls queue and run as slots free — all complete, only ~N run at once |
| Agents per run (lifetime) | 1000 | Runaway-loop backstop; further spawns error |
| Items per `parallel()`/`pipeline()` call | 4096 | Explicit synchronous error, catchable. Pinned by: `parity-10` |
| Nesting depth for `workflow()` | 1 level | Catchable throw in the child. Pinned by: `parity-07b` |

Children started with `workflow()` share the parent's slot pool and agent
counter — composition doesn't multiply capacity.

## Transcripts and the journal

Each run's transcript directory contains *(observed layout)*:

```
journal.jsonl                    # the run's memoization record
agent-<id>.jsonl                 # full transcript per agent
agent-<id>.meta.json             # per-agent metadata
```

`journal.jsonl` holds two line types per **live** agent execution — replays
append nothing, so the journal accumulates across resumes of the same run:

```json
{"type":"started","key":"v2:d985155c…","agentId":"aaab4d1e64e942259"}
{"type":"result","key":"v2:d985155c…","agentId":"aaab4d1e64e942259","result":"pong"}
```

The `key` is the memoization key: a hash covering `(prompt, opts)` **and the
call history** — re-running an unchanged call after an upstream edit logs a
new key, which is what makes prefix invalidation mechanical. The `result`
field is the agent's **actual return value**. Pinned by: `parity-12`.

**Debugging rule:** before diagnosing an empty or surprising workflow result,
read the journal. It answers "what did each agent really return" without
re-running anything — and cached results can themselves be empty, so never
assume otherwise.

## Resume and memoization

Relaunching with `Workflow({ scriptPath, resumeFromRunId })` replays completed
`agent()` calls from the journal:

- **Cache rule:** the **longest unchanged prefix** of `agent()` calls replays
  from the journal instantly; the first edited or new call — and everything
  after it — runs live. This is prefix memoization, **not** a per-key cache: a
  downstream call re-runs even when its own `(prompt, opts)` matches a journal
  entry exactly (the chained key guarantees the miss). Pinned by: `parity-12`.
- **Same script + same args ⇒ 100% cache hit.** Reference measurement
  (parity-12, leg R2): a 3-agent run resumed unchanged in **5ms with 0
  subagent tokens**, returning a byte-identical result.
- Resume **reuses the prior run's ID and transcript dir** rather than minting
  new ones, and a completed run can be resumed multiple times.
- A still-running prior run must be interrupted before resuming it. This is a
  runner-level limit that a workflow script cannot observe directly.
- This is why the determinism guards exist: any wall-clock or entropy in a
  prompt would change the hash on re-execution and silently void the cache.

Fallback when no journal is usable: the per-agent `agent-<id>.jsonl`
transcripts still exist — hand-author a continuation script from what they
show.

## Worktree isolation

`agent(..., { isolation: 'worktree' })` gives the agent a private git worktree
*(observed mechanics, pinned by `parity-09`)*:

- Created at `<repo>/.claude/worktrees/<runId>-<n>`; the agent's
  `git rev-parse --show-toplevel` resolves there, not at the main checkout.
- Files created there never appear in the main tree.
- A worktree left **clean** is auto-removed after the agent finishes
  (`git worktree list` shows only the main checkout afterwards). A dirtied
  worktree persists for inspection.
- **Requires a resolvable HEAD.** In a zero-commit repository, worktree setup
  fails and the failure is **run-level** — the whole workflow dies with
  `Failed to resolve base branch "HEAD": git rev-parse failed` — not a `null`
  agent result. Budget ~200–500ms setup plus disk per isolated agent.

## Budget accounting

`budget.spent()` reads one **turn-wide pool**: main-loop output tokens plus
every workflow's subagents, parents and children alike. Evidence from the
reference run: a freshly launched workflow's first `spent()` read was already
45,720 — sibling workflows had been spending. One trivial haiku agent moved it
by ~1,545. With no `+Nk` directive, `total` is `null` and `remaining()` is
`Infinity` — which is why budget-driven loops must guard on `budget.total`.
Pinned by: `parity-06`.

## The failure model

Where each failure surfaces — absorb at the slot level, escalate at the run
level:

| Failure | Surfaces as | Run fails? |
|---|---|---|
| `parallel` thunk throws / agent inside errors | `null` slot + `failures` line | no |
| `pipeline` stage throws | `null` for that item, remaining stages skipped | no |
| Agent skipped by user / terminal API error | that call returns `null` | no |
| `workflow()` unknown name / nested call | catchable throw | only if uncaught |
| \>4096 items in one call | catchable synchronous throw | only if uncaught |
| Banned API (`Date.now()` etc.) | throw at the call site | only if uncaught |
| Budget ceiling reached | subsequent `agent()` calls throw | only if uncaught |
| Worktree setup failure (no HEAD) | run-level error | **yes** |
| Uncaught script exception | run-level error | **yes** |

The design intent: partial failure is normal in fan-out work, so the constructs
that fan out absorb it (`null` + `filter(Boolean)`), while programming errors
and environmental breakage fail loudly.
