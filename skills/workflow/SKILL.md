---
name: workflow
description: Author, run, resume, inspect, and debug deterministic multi-agent JavaScript workflows powered by the gpt-workflow package and Codex App Server. Use when Codex should create or change a workflow under `.codex/workflows`, choose between `agent`, `parallel`, `pipeline`, and child workflows, execute `gpt-workflow`, resume a prior run ID, stream a workflow journal, or diagnose workflow replay and runtime failures.
---

# Workflow

Use deterministic JavaScript for orchestration and Codex agents for bounded
judgment.

## Work from project truth

1. Read applicable `AGENTS.md` files and inspect existing `.codex/workflows/`,
   project dependencies, and local conventions.
2. Before running a workflow, verify that `bunx` is available. Run the CLI as
   `bunx gpt-workflow@latest`; do not require or install a global copy of the
   package.
3. Confirm that deterministic multi-agent orchestration is useful. Prefer one
   ordinary Codex task when a single context can solve the work without explicit
   fan-out, staging, voting, or replay. Use an ordinary script for work whose
   correctness can be fully specified without model judgment.
4. Keep new workflow source under `.codex/workflows/<descriptive-name>.js` unless
   the repository establishes another location.

## Load only the reference needed

- Read [workflow-language.md](references/workflow-language.md) before authoring
  or changing workflow source.
- Read [running-and-journals.md](references/running-and-journals.md) before
  executing, resuming, inspecting, or debugging a run.
- Read [public-api.md](references/public-api.md) when using the npm API,
  configuring caps or events, or checking exact exported interfaces.
- Read [migration.md](references/migration.md) when porting a Claude Code
  workflow script.

## Choose the right surface

- Use an ordinary Codex task for one bounded, interactive job that fits one
  context and does not need durable orchestration.
- Use a deterministic script for parsing, preparation, canonicalization,
  validation, hashing, artifact construction, state transitions, or compilation.
- Use a thin workflow for bounded nondeterministic LM orchestration: fan-out,
  sequencing or voting among LM judgments, attribution, and returning raw
  model-owned results.
- Use a runbook when an operation has multiple phases. Let it compose scripts and
  thin workflows, with explicit durable artifacts between phases.

Treat a workflow that reads like an application, compiler, or state machine as a
design warning. JavaScript loops and conditions are available so orchestration can
be deterministic; their availability does not make the workflow the home for all
deterministic logic.

Prefer boundaries such as **manifest in -> workflow out -> script collect**:

1. A script prepares and validates a canonical input manifest, including known
   paths, hashes, IDs, and metadata.
2. The workflow gives agents only the evidence needed for their judgments and
   returns their raw semantic results with stable attribution.
3. A collector script validates and projects only allowed semantic fields,
   canonicalizes them, adds the deterministic envelope, and constructs artifacts
   or applies state transitions.

Do not ask a model to echo known paths, hashes, IDs, or metadata; echoed values can
drift and falsely appear model-verified. Preserve the raw model result for audit,
but derive the canonical artifact deterministically. Make every phase restartable
and idempotent: keep inputs and raw outputs inspectable, avoid hidden mutable
state, and make rerunning collection produce the same result.

## Author the smallest workflow

1. Start with literal `meta` containing a clear `name` and `description`.
2. Put orchestration control flow in JavaScript: bounded loops and conditions
   around agent calls, fan-out, sequencing, aggregation of LM judgments, and stop
   or escalation rules. Keep deterministic data processing and artifact semantics
   in ordinary scripts.
3. Give each `agent()` one bounded task and a stable label when attribution
   matters. Omit `model` to inherit the CLI or client default; use an explicit
   model only for an intentional per-call override. Built-in agent types are
   `default`, `worker`, and `explorer`; custom types come from the `name` field
   in project or personal `.codex/agents/*.toml` definitions.
4. Use `parallel()` for independent thunks and `pipeline()` for the same ordered
   stages across multiple items. Use `workflow()` only for a reusable
   orchestration unit.
5. Pass changing values through `args`; do not use clocks or randomness.
6. Return JSON-compatible values and handle `null` from failed agents,
   parallel slots, or pipeline items. A top-level `undefined` becomes `null`.
7. Keep known envelopes outside LM output. Associate a raw result with its
   manifest item by deterministic position or call-site ID rather than asking the
   agent to repeat that identity.

## Run, inspect, and resume

Run from the repository root:

```sh
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  .codex/workflows/<name>.js
```

Pass workflow input as strict JSON with `--args '{"key":"value"}'`; quote bare
strings (`--args '"triage"'`). Invalid JSON exits 1 before any record is
emitted. Piping to `tee` is optional: every run persists a filtered event
stream to `.codex/workflows/runs/<runId>/events.jsonl` automatically.

Read the terminal NDJSON record and its `journalPath`. Inspect runs without
spending model tokens:

```sh
bunx gpt-workflow@latest list
bunx gpt-workflow@latest status <runId>
```

`list` prints one JSON line per run, newest first. `status` prints one JSON
object with per-phase and per-agent progress and token totals. `"incomplete"`
means no terminal record — in-flight and interrupted runs look identical;
check `lastEventAt`. For a prior run ID:

```sh
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  --resume <runId> .codex/workflows/<name>.js
```

Pass the same `--args` on resume; changed args change prompts and miss replay
keys. For replay debugging, stream journals line by line with
`parseWorkflowJournalEntry`; never require a whole-file read. Treat unmatched
`started` records as interrupted or failed live calls. Journal v3 matches a
prompt-and-authored-options key multiset until the first miss; after that
miss, all later calls run live. Phase injection does not affect keys.

## Verify proportionally

For authoring-only tasks, parse or exercise the narrowest useful offline path.
Run live agents when the user asked to execute the workflow, not merely to check
syntax. Report the run ID, journal path, terminal status, failures, and exact
checks performed.
