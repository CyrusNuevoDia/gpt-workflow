# GPT Workflow Runtime Plan

Stable goal: [`goal.md`](goal.md)

Canonical verifier: [`../../VERIFY.md`](../../VERIFY.md)

Only one phase may be in progress. Update this file after steering, material new
evidence, a failed verification, or a completed milestone.

## Phase 1: Bootstrap the executable verifier and workflow mirror

Status: in progress

Implementation

- [ ] Add the `check`, `verify:offline`, `verify:live`, and `verify` Bun command
  contract without hiding failed subprocesses.
- [ ] Build the mechanical `.claude/workflows/` to `.codex/workflows/` mirror.
- [ ] Map `haiku` to `gpt-5.6-luna`, `sonnet` to `gpt-5.6-terra`, and Claude
  workflow paths to Codex workflow paths.
- [ ] Add a drift checker that discovers workflow files rather than hard-coding
  their count.
- [ ] Establish ignored, secret-safe locations for verification reports and
  append-only event artifacts.

Verification

- [ ] Run the R2 mirror checker against the real suite and record its discovered
  and compared totals.
- [ ] Run negative controls for a missing mirror and stale Claude model.
- [ ] Run `bun run check` and `git diff --check`.

Exit criteria

- [ ] R1's command surface exists and fails honestly for unimplemented live
  behavior.
- [ ] R2 passes, including `parity-12-resume` and all companion probes.
- [ ] The next phase can run without manually editing generated workflow copies.

## Phase 2: Prove the deterministic workflow VM offline

Status: pending

Implementation

- [ ] Parse literal `meta` without executing the workflow body.
- [ ] Execute plain JavaScript with top-level await/return and the documented
  injected globals.
- [ ] Implement deterministic guards and the JSON-compatible sandbox boundary.
- [ ] Implement `parallel`, `pipeline`, `phase`, `log`, `args`, and offline
  budget semantics.
- [ ] Preserve visible absorbed failures while failing uncaught workflow errors.

Verification

- [ ] Run focused tests for every R5 condition.
- [ ] Run focused tests for every R6 condition and report test counts.
- [ ] Run malformed-meta, final-only-event, false-suite, schema-failure, and
  4097-item negative controls that do not mutate the real fixtures.

Exit criteria

- [ ] `bun run verify:offline` passes all VM and orchestration checks available
  before live agent integration.
- [ ] No workflow code can access Node/Bun ambient globals.

## Phase 3: Integrate Codex App Server as the agent substrate

Status: pending

Implementation

- [ ] Spawn and supervise App Server over stdio.
- [ ] Implement JSON-RPC initialization, request correlation, notification
  routing, timeouts, shutdown, and explicit process/protocol failure handling.
- [ ] Generate or validate protocol types against the installed Codex binary.
- [ ] Discover and validate Luna and Terra through `model/list` before live work.
- [ ] Implement text and schema-constrained `agent()` results using authoritative
  completed items.

Verification

- [ ] Repeat the persistent initialize and model-list readiness probe through
  the runtime rather than a hand-written pipe.
- [ ] Run one Luna text agent and one Terra structured agent.
- [ ] Prove malformed JSON-RPC, early EOF, request timeout, and model absence fail
  explicitly.

Exit criteria

- [ ] R3, R4, and R8 pass on the real App Server.
- [ ] Production runtime search finds no `codex exec`, SDK, or WebSocket path.

## Phase 4: Stream and control live agents

Status: pending

Implementation

- [ ] Normalize App Server lifecycle, delta, plan, reasoning, command, file,
  tool, collaboration, usage, and terminal events.
- [ ] Attribute events to workflow run, agent, label, phase, model, thread, turn,
  and item identifiers where applicable.
- [ ] Expose orchestrator-facing steering and interruption controls.
- [ ] Ensure interrupting one sibling does not cancel unrelated siblings.

Verification

- [ ] Capture intermediate events before completion for the R9 live probe.
- [ ] Run R10's verifier-generated nonce steer while the child turn is active.
- [ ] Run the two-sibling isolated-interruption probe.
- [ ] Inspect ordering and attribution in the append-only event artifact.

Exit criteria

- [ ] R9 and R10 pass with live evidence.
- [ ] The runtime never relies on final-response buffering as a substitute for
  progress streaming.

## Phase 5: Add composition, isolation, caps, and exact-prefix resume

Status: pending

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
- Baseline remains incomplete: `package.json` has no scripts and
  `.codex/workflows/` is absent.

## Next action

Activate the goal, then implement the smallest honest R1/R2 slice: the command
surface, mechanical workflow mirror, and drift checker. Commit the verified
milestone together with this plan's evidence.
