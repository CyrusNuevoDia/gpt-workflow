# GPT Workflow Runtime Goal

Companion plan: [`plan.md`](plan.md)

Canonical product contract: [`../../GOAL.md`](../../GOAL.md)

Primary verifier: [`../../VERIFY.md`](../../VERIFY.md)

## Outcome

Deliver a Bun-based, GPT-native implementation of the Workflow SDK specified by
this repository. The runtime must execute every `.codex/workflows/` parity
fixture through Codex App Server over stdio and satisfy every required condition
in `VERIFY.md` with current offline and live evidence.

## Baseline

- The Claude reference fixtures and documentation exist.
- The reference suite includes the three-leg `parity-12-resume` protocol for
  chained, exact-prefix memoization.
- `GOAL.md` and `VERIFY.md` define the intended end state and adversarial checks.
- Bun is installed, but `package.json` does not yet expose the required check or
  verification commands.
- `.codex/workflows/` and the GPT runtime do not yet exist.
- Codex App Server readiness has been observed locally:
  - Bun `1.3.14` and Codex CLI `0.144.0` are installed.
  - Codex is authenticated through ChatGPT.
  - JSON-RPC initialization over stdio succeeds.
  - `codex app-server generate-ts --experimental` succeeds.
  - `model/list` exposes `gpt-5.6-luna` and `gpt-5.6-terra`.

Versions are observations, not permanent requirements. The implementation must
discover current capabilities and fail clearly when they are unavailable.

## Constraints

- Codex App Server JSON-RPC over stdio is the only production agent substrate.
- Bun owns workflow loading, sandboxing, orchestration, normalization,
  journaling, and verification.
- Treat Bun's `node:vm` as a semantic compatibility sandbox for trusted
  repository workflows, not as a security mechanism for hostile code. The
  runtime must still control ambient globals and JSON boundary crossings, and
  the final brief must state this limitation explicitly.
- Do not add `@openai/codex-sdk` or route production calls through `codex exec`.
- Treat generated App Server bindings and experimental fields as
  version-sensitive; verify them against the installed binary.
- Preserve `.claude/workflows/` as provider-original reference fixtures.
- Derive `.codex/workflows/` mechanically and detect drift.
- Preserve exact-prefix resume behavior. Do not substitute a per-prompt cache.
- Do not weaken, narrow, skip, mock, or silently reinterpret required checks in
  `VERIFY.md`.
- Keep secrets out of prompts, logs, reports, and committed artifacts.
- Preserve unrelated changes in the shared worktree and stage only authored
  paths.
- Keep at most one phase in `plan.md` in progress.
- Commit each verified phase or coherent milestone as a logical local git
  commit, including the plan evidence that proves it complete.
- Luna/xhigh implementation delegates are authorized for bounded, disjoint
  paths. Delegates do not commit; the parent reviews and integrates every diff.

## Approval gates

- Live GPT calls required by `VERIFY.md` are in scope once this goal is
  activated; record usage and avoid redundant full sweeps while cheaper checks
  are failing.
- Do not publish, push, release, install global software, change authentication,
  expose a network listener, or modify external/shared systems without separate
  user authorization.
- Do not switch from ChatGPT authentication to API-key billing without explicit
  user authorization.

## Non-goals

- Pixel-level reproduction of Claude's progress UI.
- Experimental WebSocket transport.
- Provider-specific transcript wording or identical token counts.
- Compatibility layers for abandoned pre-launch designs.
- Broad documentation rewriting before runtime behavior is proven.
- Safe execution of untrusted or adversarial workflow source.

## Primary verifier

Run, from the repository root:

```sh
bun run verify
```

The command must execute both offline and live verification, write the required
machine-readable evidence, exit zero, and culminate in the exact verifier
verdict:

```text
VERDICT: PASS
```

The authoritative condition list is R1 through R15 in `VERIFY.md`. Nice-to-have
conditions do not block completion.

## Supporting checks

```sh
bun run check
bun run verify:offline
bun run verify:live
git diff --check
```

Supporting checks help choose the next repair, but none substitutes for the
primary verifier.

## Iteration loop

1. Re-read this file, `plan.md`, and `VERIFY.md`.
2. Run the cheapest check that directly exercises the current phase.
3. Make one coherent change against an observed failure.
4. Re-run the phase check and record evidence in `plan.md`.
5. Update phase status and the next action without erasing failed-attempt
   evidence.
6. Commit the verified milestone and its durable plan evidence as one logical
   local commit.
7. Run the full verifier only when its cheaper prerequisites are green.
8. Repeat until all required conditions pass.

## Anti-cheating rules

- Do not edit expected results to match observed bugs.
- Do not convert required live checks to mocks.
- Do not omit discovered workflows, invocation modes, or resume legs.
- Do not report a partial sweep as complete.
- Do not hide absorbed, skipped, pending, interrupted, or failed work.
- Do not mark a phase complete before its verification and exit criteria pass.
- Change the canonical goal or verifier only when new evidence proves it
  misstates user intent, and record the reason explicitly.

## Blocker standard

A blocker is an external condition that prevents meaningful progress after safe
alternatives have been exhausted, such as unavailable authentication, missing
required model entitlement, or an App Server defect with no viable local
workaround. Difficulty, test failures, protocol complexity, and incomplete code
are not blockers.

When blocked, record the exact failing command or protocol exchange, the
observed error, attempted alternatives, preserved artifacts, and the smallest
user or external action that would unblock the next step.

## Completion proof

Before marking the goal complete, all of the following must be true:

- Every phase in `plan.md` is complete with recorded evidence.
- `bun run check`, `bun run verify:offline`, and `bun run verify:live` exit zero.
- `bun run verify` exits zero and its report covers every discovered workflow
  and required invocation with no pending or skipped work.
- The current machine-readable report and append-only event/transcript artifact
  are inspected and contain no secrets.
- The three-leg `parity-12` evidence proves exact-prefix rather than per-key
  caching.
- The live event evidence proves streaming, steering, and isolated
  interruption—not merely final-response collection.
- Root `BRIEF.html` renders cleanly and accurately summarizes the final report,
  evidence, limitations, and logical implementation history.
- An adversarial read of `VERIFY.md` yields `VERDICT: PASS` for R1 through R15.
