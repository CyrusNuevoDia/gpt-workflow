# Goal

Build a GPT-native implementation of the Workflow SDK specified by this
repository, backed by Codex App Server and proven by the adversarial verifier in
[`VERIFY.md`](VERIFY.md).

The standing goal is not "implement the runtime." It is:

> Make every required check in `VERIFY.md` pass with current, inspectable
> evidence, without weakening the verifier to fit the implementation.

## Observable end state

The repository contains a Bun-based workflow runtime that:

- discovers and executes the GPT workflow suite from `.codex/workflows/`;
- injects the documented workflow globals into sandboxed JavaScript;
- uses Codex App Server over its stable stdio transport for GPT agents;
- maps Claude's `haiku` tier to `gpt-5.6-luna` and `sonnet` tier to
  `gpt-5.6-terra` in the Codex workflow copies;
- preserves deterministic orchestration, failure absorption, composition,
  worktree isolation, and exact-prefix resume semantics;
- streams attributable progress and intermediate results while agents run;
- lets the orchestrator send input to and interrupt a running subagent;
- returns authoritative text or schema-validated structured results; and
- produces machine-readable verification evidence from both offline tests and
  live GPT runs;
- records verified implementation milestones as logical git commits; and
- leaves a self-contained `BRIEF.html` that makes the finished architecture,
  proof, limitations, and commit history reviewable without rerunning the goal.

The original `.claude/workflows/` files remain the reference fixtures. The
`.codex/workflows/` files are their GPT-native counterparts, not a second
independently evolving suite.

## Required product boundary

Codex App Server is the agent control plane. The runtime talks to one or more
App Server processes through JSON-RPC over stdio and consumes their thread,
turn, item, tool, usage, and collaboration events.

The TypeScript Codex SDK and one-shot `codex exec` may be useful for experiments,
but they are not the production runtime substrate. Adding both abstractions to
the implementation would create two execution paths with different semantics.

Bun owns the deterministic workflow layer: script loading, sandboxing,
scheduling, composition, caps, failure handling, event normalization, result
collection, journaling, and verification.

## Completion rule

Completion requires a literal run of the verifier in `VERIFY.md`. A summary,
code review, typecheck, mocked agent response, or one successful workflow is not
substitute evidence.

The goal is complete only when the verifier prints:

```text
VERDICT: PASS
```

Every required condition must pass. Nice-to-have conditions may remain open but
must be reported separately.

## Goal integrity

- Read `VERIFY.md` before each plan/do/verify cycle.
- Plan only against currently failing verifier conditions.
- Re-run the verifier after every implementation cycle.
- Do not silently edit `VERIFY.md` to make an implementation pass.
- Change the verifier only when it demonstrably misstates the intended product;
  record the reason in the commit or handoff that changes it.
- Treat absorbed failures, dropped agents, skipped suites, and incomplete live
  runs as failures unless the verifier explicitly says otherwise.
- Preserve unrelated work in the shared worktree.

## Non-goals

- Recreating Claude's progress UI pixel for pixel.
- Using the experimental App Server WebSocket transport.
- Rewriting the Claude reference documentation before runtime parity exists.
- Matching provider-specific transcript wording or token counts byte for byte.
- Backward-compatibility shims for abandoned pre-launch runtime designs.
