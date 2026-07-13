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
   fan-out, staging, voting, or replay.
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

## Author the smallest workflow

1. Start with literal `meta` containing a clear `name` and `description`.
2. Put loops, conditions, fan-out, aggregation, and stop rules in JavaScript.
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

## Run, inspect, and resume

Run from the repository root:

```sh
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  .codex/workflows/<name>.js | tee run.jsonl
```

Read the terminal NDJSON record and its `journalPath`. Inspect journal entries
before rerunning. For a prior run ID:

```sh
bunx gpt-workflow@latest run --default-model <the model you are running as> \
  --resume <runId> .codex/workflows/<name>.js
```

Stream journals line by line with `parseWorkflowJournalEntry`; never require a
whole-file read. Treat unmatched `started` records as interrupted or failed
live calls. Journal v3 matches a prompt-and-authored-options key multiset until
the first miss; after that miss, all later calls run live. Phase injection does
not affect keys.

## Verify proportionally

For authoring-only tasks, parse or exercise the narrowest useful offline path.
Run live agents when the user asked to execute the workflow, not merely to check
syntax. Report the run ID, journal path, terminal status, failures, and exact
checks performed.
