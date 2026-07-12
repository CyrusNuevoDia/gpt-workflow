# GPT Workflow Runtime Plan

Stable goal: [`goal.md`](goal.md)

Canonical verifier: [`../../VERIFY.md`](../../VERIFY.md)

Only one phase may be in progress. Update this file after steering, material new
evidence, a failed verification, or a completed milestone.

## Phase 1: Bootstrap the executable verifier and workflow mirror

Status: complete

Implementation

- [x] Add the `check`, `verify:offline`, `verify:live`, and `verify` Bun command
  contract without hiding failed subprocesses.
- [x] Build the mechanical `.claude/workflows/` to `.codex/workflows/` mirror.
- [x] Map `haiku` to `gpt-5.6-luna`, `sonnet` to `gpt-5.6-terra`, and Claude
  workflow paths to Codex workflow paths.
- [x] Add a drift checker that discovers workflow files rather than hard-coding
  their count.
- [x] Establish ignored, secret-safe locations for verification reports and
  append-only event artifacts.

Verification

- [x] Run the R2 mirror checker against the real suite and record its discovered
  and compared totals.
- [x] Run negative controls for a missing mirror and stale Claude model.
- [x] Run `bun run check` and `git diff --check`.

Exit criteria

- [x] R1's command surface exists and fails honestly for unimplemented live
  behavior.
- [x] R2 passes, including `parity-12-resume` and all companion probes.
- [x] The next phase can run without manually editing generated workflow copies.

Evidence

- `bun run check`: exit 0; TypeScript clean; 3 tests passed, 0 failed, 11
  assertions; mirror discovered=13, target=13, compared=13, no drift.
- `bun run verify:offline`: exit 0 with the same complete mirror evidence.
- `bun run verify:live`: expected exit 1 with the explicit App Server
  not-implemented message.
- `bun run verify`: expected exit 1 only when it reaches `verify:live`.
- Forbidden-string sweep over `.codex/workflows`: no Claude model or workflow
  path matches.
- Luna/xhigh delegate session: `019f557d-9cfc-7c01-b91e-790a8441e499`;
  parent reviewed the full diff and materialized the protected mirror.

## Phase 2: Prove the deterministic workflow VM offline

Status: complete

Implementation

- [x] Parse literal `meta` without executing the workflow body.
- [x] Execute plain JavaScript with top-level await/return and the documented
  injected globals.
- [x] Implement deterministic guards and the JSON-compatible sandbox boundary.
- [x] Implement `parallel`, `pipeline`, `phase`, `log`, `args`, and offline
  budget semantics.
- [x] Preserve visible absorbed failures while failing uncaught workflow errors.

Verification

- [x] Run focused tests for every R5 condition.
- [x] Run focused tests for every R6 condition and report test counts.
- [x] Run the malformed-meta, false-suite, and 4097-item negative controls
  available offline without mutating the real fixtures. Final-only-event and
  schema-failure controls require the Phase 3/4 live result and event harness
  and remain assigned to Phase 6's complete R14 sweep.

Exit criteria

- [x] `bun run verify:offline` passes all VM and orchestration checks available
  before live agent integration.
- [x] No trusted repository workflow can access Node/Bun ambient globals
  through the documented execution path. Bun `node:vm` is not a hostile-code
  security boundary.

Evidence

- `bunx tsc --noEmit`, `bun run check`, `bun run verify:offline`, and
  `git diff --check`: exit 0.
- Full suite: 24 tests passed, 0 failed, 69 assertions (21 runtime tests and 3
  mirror tests).
- Corpus/runtime probe: all 13 mirrored workflows parsed; the zero-agent
  `parity-10-runtime-guards` suite returned `passed: true` with no absorbed
  failures.
- Adversarial controls cover computed, malformed, expression-continued,
  missing, and non-first `meta`; false suite results; non-JSON crossings;
  invalid host-call shapes; and 4,097-item `parallel`/`pipeline` inputs.
- Luna/xhigh implementation session:
  `019f5585-9906-7813-b0e5-5cfa47db672d`.
- Sol/high review session: `019f5594-eebf-7240-be31-0c281ab85ce2`. The review
  fixed expression-continuation loading, host-realm function/Promise exposure,
  mutable determinism guards, and missing host-call shape checks.

## Phase 3: Integrate Codex App Server as the agent substrate

Status: complete

Implementation

- [x] Spawn and supervise App Server over stdio.
- [x] Implement JSON-RPC initialization, request correlation, notification
  routing, timeouts, shutdown, and explicit process/protocol failure handling.
- [x] Generate or validate protocol types against the installed Codex binary.
- [x] Discover and validate Luna and Terra through `model/list` before live work.
- [x] Implement text and schema-constrained `agent()` results using authoritative
  completed items.

Verification

- [x] Repeat the persistent initialize and model-list readiness probe through
  the runtime rather than a hand-written pipe.
- [x] Run one Luna text agent and one Terra structured agent.
- [x] Prove malformed JSON-RPC, early EOF, request timeout, and model absence fail
  explicitly.

Exit criteria

- [x] R3, R4, and R8 pass on the real App Server.
- [x] Production runtime search finds no `codex exec`, SDK, or WebSocket path.

Evidence

- Installed protocol: Codex `0.144.0`; `generate-ts --experimental` produced
  671 TypeScript files; persistent stdio initialization succeeded.
- `model/list`: one complete page, `nextCursor: null`; literal
  `gpt-5.6-luna` and `gpt-5.6-terra` both discovered before live turns.
- `bun run check` and `bun run verify:offline`: exit 0; 36 tests passed, 0
  failed, 100 assertions after parent integration review; mirror 13/13.
- Focused fake-process coverage proves initialize ordering, backpressure,
  out-of-order request correlation, malformed JSON/unknown responses, EOF,
  process exit, request and turn timeouts, model pagination/absence,
  authoritative completed-item results, terminal failures, and schema rejection.
- Parent live Phase 3 command: `bun scripts/verify-live.ts --phase3`, exit 0,
  `PHASE_3_VERDICT: PASS`.
- Luna text evidence: thread `019f55b3-fe1a-7181-9276-7c61af105416`, turn
  `019f55b4-04fb-72c3-90f4-8661a3b672a6`, authoritative item
  `msg_0b3482bfce578613016a53614dd6148198aaf1d6c5f8e316df`.
- Terra structured evidence: thread `019f55b4-18b2-7670-bf38-b68473129672`,
  turn `019f55b4-1d2d-7283-9446-8a3c8eb54556`, authoritative item
  `msg_03c1820b2f021a01016a536152b148819bb0594d4e840900e8`.
- The first parent Terra probe exposed App Server's recursive
  `additionalProperties: false` requirement. The runtime now normalizes object
  schemas at the transport boundary while AJV validates results against the
  workflow-authored schema; the next Terra probe and full Phase 3 probe passed.
- Luna/xhigh implementation session: `019f559c-5d03-7350-9e07-fbf3616be763`.

## Phase 4: Stream and control live agents

Status: complete

Implementation

- [x] Normalize App Server lifecycle, delta, plan, reasoning, command, file,
  tool, collaboration, usage, and terminal events.
- [x] Attribute events to workflow run, agent, label, phase, model, thread, turn,
  and item identifiers where applicable.
- [x] Expose orchestrator-facing steering and interruption controls.
- [x] Ensure interrupting one sibling does not cancel unrelated siblings.

Verification

- [x] Capture intermediate events before completion for the R9 live probe.
- [x] Run R10's verifier-generated nonce steer while the child turn is active.
- [x] Run the two-sibling isolated-interruption probe.
- [x] Inspect ordering and attribution in the in-memory event evidence. Durable
  append-only artifacts remain assigned to Phase 5 journaling and Phase 6 reports.

Exit criteria

- [x] R9 and R10 pass with live evidence.
- [x] The runtime never relies on final-response buffering as a substitute for
  progress streaming.

Evidence

- `bun scripts/verify-live.ts --phase4`: exit 0 with
  `PHASE_4_VERDICT: PASS` after the Sol review refinements.
- R9: 38 normalized events; message delta and command/tool progress observed by
  `onAgentEvent` while the workflow promise was unresolved; ordered thread and
  turn starts preceded the authoritative message completion and terminal event.
- R9 terminal: completed Luna turn
  `019f55ce-9aa6-7250-88bd-17278d7eea75` on thread
  `019f55ce-949e-7e10-86a0-7ba68451fd8a`, with complete usage attached.
- R10 steer: App Server accepted verifier nonce
  `phase4-nonce-d5e18035-9b8d-47f8-a0e5-a273dbde83e4` for the exact active turn
  `019f55ce-bb27-72f2-9c25-b416be9fd39e`; the runtime-managed final result
  contained the nonce.
- R10 sibling probe: both runtime-managed handles were exposed; the interrupted
  sibling became a visible absorbed `parallel` failure while the other returned
  exactly `phase4-sibling-complete` on a distinct thread.
- Offline final: 40 tests passed, 0 failed, 130 assertions; TypeScript and
  `git diff --check` passed.
- Luna/xhigh implementation session: `019f55b5-5714-71d1-9047-066607059b56`.
- Sol/high review session: `019f55c7-f393-7db2-b43e-33db4707a9e5`. It found
  and drove fixes for post-completion-only inspection, incomplete pass
  predicates, direct-client control bypass, missing turn attribution on early
  events, and observer exceptions affecting sibling turns.

## Phase 5: Add composition, isolation, caps, and exact-prefix resume

Status: in progress

Implementation

- [ ] Implement child workflow resolution, args/result propagation, shared
  lifecycle accounting, and the one-level nesting boundary.
- [ ] Implement worktree isolation and cleanup without touching the main tree.
- [ ] Enforce concurrency, lifetime, nesting, and boundary caps visibly.
- [ ] Implement append-only journaling with chained keys and longest-prefix
  replay.
- [ ] Allow the same completed run to be resumed repeatedly.

Verification

- [ ] Run all R7 composition, isolation, and cap checks.
- [ ] Run `parity-12-resume` legs R1, R2, and R3 and compare A/B/C nonces,
  tokens, duration, and journal keys.
- [ ] Run the negative control proving a per-`(prompt, opts)` cache fails.

Exit criteria

- [ ] R7 and R11 pass.
- [ ] R3's changed B invalidates C even though C's prompt and options match R1.

## Phase 6: Close the complete live parity sweep

Status: pending

Implementation

- [ ] Run all discovered Codex workflows and every documented invocation mode.
- [ ] Fix runtime defects against concrete suite or event evidence.
- [ ] Produce the complete machine-readable report and secret-safe event or
  transcript artifacts.
- [ ] Create the repository-root `BRIEF.html` from verified final evidence and
  logical git history.
- [ ] Preserve failed-attempt evidence and exact pending/failed/skipped counts
  until they reach zero.

Verification

- [ ] Run `bun run check`.
- [ ] Run `bun run verify:offline` twice from fresh processes.
- [ ] Run `bun run verify:live` without skipped or pending invocations.
- [ ] Render `BRIEF.html` in a browser and inspect a normal desktop viewport.
- [ ] Run `bun run verify` and adversarially evaluate R1 through R15.
- [ ] Inspect report totals, artifacts, usage, failures, and secret redaction.

Exit criteria

- [ ] R1 through R15 all pass.
- [ ] Every discovered workflow and required invocation completed successfully.
- [ ] `VERIFY.md` ends in `VERDICT: PASS` with current evidence.

## Current evidence

- Readiness: Bun `1.3.14`; Codex CLI `0.144.0`; ChatGPT authentication active.
- App Server stdio `initialize` returned successfully.
- Experimental protocol generation produced 671 TypeScript files in a
  temporary directory.
- Persistent `model/list` returned both `gpt-5.6-luna` and
  `gpt-5.6-terra`, with `nextCursor: null`.
- Phases 1-4 are complete: the 13-file mirror, deterministic Bun VM, persistent
  App Server client, authoritative results, real-time normalized progress, and
  runtime-managed steering/interruption all have offline and live proof.

## Next action

Implement Phase 5 composition, shared caps/accounting, isolated worktrees, and
the exact-prefix journal/resume protocol, then run R7 and all three R11 legs.
