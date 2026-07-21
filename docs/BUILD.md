# How we used Codex and GPT-5.6

The submission rules ask the README to describe how Codex was used, where it
accelerated the work, and where the human made the key calls. This document is
the long-form record; the README carries the condensed version.

There are two threads of evidence, and they compose into one loop:

1. **Codex built gpt-workflow** — this repo, 87 commits from an empty root on
   Jul 11 to release on Jul 21.
2. **gpt-workflow drove Codex at scale** — the synthesis-bench session in my
   parallel submission orchestrated fleets of GPT-5.6 agents to build and run a real
   medical evidence-synthesis benchmark.

The tool was built with Codex, then immediately used to multiply Codex.

## 1. Building gpt-workflow with Codex (Jul 11 – Jul 21)

### Goal/spec/verifier development

Larger features were handed to Codex as structured goals under
`.codex/goals/<feature>/`: `goal.md` (end state), `spec.md` (agreed product
contract), `verifier.md` (fixed definition of done), `notes.md` (execution
constraints and TDD order). The instruction to Codex was literally "make the
verifier pass." The Python SDK (`sdks/python`, a synchronous typed wrapper
over the CLI) and synchronized npm+PyPI publishing both shipped through this
loop — the goal directories are preserved in-repo as evidence.

### Live verification, not vibes

Every runtime behavior Codex implemented is pinned by an executable parity
suite — twelve workflows (`.codex/workflows/parity-01-core.js` through
`parity-12-resume.js`) covering the full surface: structured output,
parallel/pipeline fan-out, args, budgets, composition, agent options,
worktree isolation, runtime guards, patterns, and journal resume. `just
verify` runs them against the live Codex App Server with real token spend;
`just check` is the offline gate (format, pack, install, strict consumer
typecheck, CLI smokes) for every change. Journals from those runs are kept
under `.codex/workflows/runs/`.

### Timeline receipts (git history)

- **Jul 11** — empty root commit, reference implementation, verification goal
  defined.
- **Jul 12–13** — README rewritten for workflow users; `list`/`status`
  subcommands, `--args`, durable run events; launch copy and product video.
- **Jul 17–18** — Codex plugin packaging; configurable turn timeouts; App
  Server controls exposed in the CLI.
- **Jul 19** — Python SDK; synchronized npm and PyPI publishing.
- **Jul 21** — version flag, runs stored under `CODEX_HOME`, plugin release.

### Who did what

Codex wrote the runtime, the CLI, the SDK, and the parity suite. The human
calls were product and contract decisions: the workflow-script surface
(`agent()` / `parallel()` / `pipeline()` / `workflow()` and the journal-replay
semantics), Bun-only runtime, the plugin-first install path, what the
verifiers demand, and the docs-audience contract (`docs/00-audience.md`) that
governs every user-facing page.

## 2. Using gpt-workflow to drive Codex at scale (Jul 19–21 thread)

One Codex Desktop thread (GPT-5.6, ~2.3 days wall-clock) used gpt-workflow —
installed as a Codex plugin — to run the error analysis of synthesis-bench's
model sweeps. Two workflows were authored and run live in that thread.

### Workflow A — `metapsy-transcript-error-analysis.js`

A sequential loop over benchmark instances; per instance, a `parallel()`
fan-out of one analyst per model/effort trajectory, then one comparative
synthesis. Three live runs:

- **The token-blowup kill.** The first run's analysts were consuming
  0.75M–1.28M input tokens each on raw trajectories. Codex killed it, wrote a
  deterministic loss-aware projection (~31 KB per trajectory, down from
  multi-hundred-KB), and restarted — per-analyst input fell to ~80k–370k
  tokens.
- **The 104-agent Terra run, with a journal resume.** 26 reports × (3
  parallel analysts + 1 synthesis) = 104 planned agent calls. A transient
  "model at capacity" error cost exactly one analyst; the first pass still
  banked 103/104 durable results. Codex then **resumed the same run from its
  journal**: cached calls replayed for free, only the gap re-ran, and the
  terminal record read `failures: [], agentCount: 104, replayedAgentCount:
  56`. Deterministic collect/verify closed the loop: 78 transcript analyses +
  26 syntheses.
- **The 100-agent Luna run** (25 reports × 4), after minimally extending the
  workflow for a new effort level and a newer Harbor output layout.

### Workflow B — `error-analysis.js`, driven through the Python API

A three-stage pipeline (trajectory miners → attempt analysts → per-review
comparative reviewers, plus an audience-safe synthesizer), launched via the
gpt-workflow Python SDK (`gpt_workflow.run()`), fail-closed on any non-valid
sweep snapshot. Before the live run, an adversarial reviewer agent returned
"DO NOT RUN" and caught a fatal attempt-key collision — fixed before a token
was spent. The live runs then surfaced three real runtime limits, and fixing
them hardened the product itself: thread-label length limits, a
thread-start timeout that killed file-heavy agents (aligned to the turn
window), and a ~64 KB result-transport ceiling in the Python SDK (solved by
returning compact labels and rehydrating the full Markdown from the durable
journal). Dogfooding at this scale is where those limits were found.

### Where Codex accelerated, where the human decided

Codex authored both workflows, their deterministic prepare/collect/verify
companions, and every fix above. Cyrus made the design calls: one agent per
transcript (not per report) with per-report parallel fan-out, selector-driven
model/effort args, the report-format output contract, and when to kill, when
to resume, and what to repair.

The full chronological account is in `ctx/trajectory.md`; the cleaned
transcript it was built from is `ctx/codex.jsonl` (produced deterministically
from the raw Codex rollout by `ctx/clean_codex.py`).
