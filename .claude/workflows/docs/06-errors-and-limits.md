# Claude reference errors and limits

Every error the runtime throws, with exact reference-runtime message text where
observed, plus the caps table and the recovery playbook. An independent
implementation should match the *semantics* exactly; matching the message text
is optional but makes the parity suite's `detail` fields diff clean.

## Error reference

### Determinism guards

Thrown at the call site, catchable. Pinned by: `parity-10`.

| Call | Message *(observed)* |
|---|---|
| `Date.now()`, argless `new Date()` | `Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.` |
| `Math.random()` | `Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt.` |

`new Date(ms)` **with an argument** is allowed and correct
(`new Date(1700000000000).getUTCFullYear() === 2023`).

Fix: timestamps come in via `args` or get stamped after the run returns;
variation across agents comes from the index in the prompt/label, not entropy.

### VM boundary cap

Thrown synchronously by `parallel()`/`pipeline()`, catchable. Pinned by:
`parity-10`.

> `array length 4097 exceeds the maximum of 4096 supported across the workflow
> VM boundary`

Fix: chunk the item list and loop over chunks.

### Composition errors

Thrown by `workflow()`, catchable — including *inside the child script* for
the nesting case. Pinned by: `parity-07`, `parity-07b`.

| Cause | Message *(observed)* |
|---|---|
| Unknown name | `workflow('X'): no workflow with that name. Available: deep-research, code-review` |
| Nested call (child → grandchild) | `workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly.` |
| Unreadable `scriptPath` / child syntax error | throws; catch to handle gracefully |

Registry caveat *(observed)*: name resolution does not see workflow files
written mid-session. Use `{scriptPath}` for same-session children, or restart
the session to register names.

### Worktree setup failure

**Run-level** — the whole workflow fails; this is not a `null` agent result.
Observed in a zero-commit repository:

> `Failed to resolve base branch "HEAD": git rev-parse failed`

Fix: `isolation: 'worktree'` requires a git repository with at least one
commit (a resolvable HEAD to base the worktree on).

### Budget ceiling

With a `+Nk` token target set, the target is a hard ceiling: once
`budget.spent() ≥ budget.total`, further `agent()` calls **throw**. Guard
loops on `budget.total` and check `remaining()` before expensive stages.
(Contract pinned by `parity-06`; the throw itself requires a budgeted run.)

### Load-time errors

Before the body runs: TypeScript syntax (scripts are plain JS), a missing or
computed (non-literal) `meta` block, and malformed scripts are rejected at
parse/validation time — the run never starts.

## Failure absorption (not errors)

These produce `null`, not throws — by design, so fan-out work degrades
gracefully. Pinned by: `parity-03`, `parity-04`.

| Event | Result |
|---|---|
| `parallel` thunk throws, or its agent errors | `null` at that slot; the call never rejects; a `failures` line in the completion notification |
| `pipeline` stage throws | `null` for that item; the item's remaining stages are skipped |
| Agent skipped by the user mid-run / terminal API error after retries | that `agent()` call returns `null` |

Consequence: **always `.filter(Boolean)`** before consuming agent-result
collections, and count what was dropped if coverage matters (`log()` it —
no silent caps).

## Limits table

| Limit | Value |
|---|---|
| Concurrent agents per workflow | `min(16, cpu cores − 2)`; excess queue and complete |
| Agents per run (lifetime backstop) | 1000 |
| Items per `parallel()`/`pipeline()` call | 4096 |
| `workflow()` nesting depth | 1 level |
| Script size (inline `script` param) | 512 KiB |
| Budget | hard ceiling when set; unlimited (`remaining() === Infinity`) when not |

## Recovery playbook

1. **Result empty or weird?** Read `journal.jsonl` in the run's transcript
   directory first — it records every agent's actual return value. Do not
   assume cached or completed agents returned anything non-empty.
2. **Script bug found?** Edit the persisted script file, relaunch with
   `Workflow({ scriptPath, resumeFromRunId })`. The unchanged prefix of
   `agent()` calls replays free from cache; only the edited call onward
   re-runs. Stop a still-running prior run (`TaskStop`) before resuming.
3. **Run died mid-flight?** Same resume path — completed agents are journaled
   even if the run failed later.
4. **No usable journal?** Per-agent `agent-<id>.jsonl` transcripts survive;
   hand-author a continuation script seeded with what they show.
5. **Repeated agent failures on one item?** Don't retry in a tight loop —
   restructure so the item degrades to `null`, ship the rest, and report the
   drop.
