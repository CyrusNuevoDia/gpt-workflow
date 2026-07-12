---
name: gpt-workflow
description: Author, run, resume, inspect, and debug deterministic multi-agent JavaScript workflows powered by the gpt-workflow package and Codex App Server. Use when Codex should create or change a workflow under `.codex/workflows`, choose between `agent`, `parallel`, `pipeline`, and child workflows, execute `gpt-workflow run`, resume a prior run ID, stream a workflow journal, or diagnose workflow replay and runtime failures.
---

# GPT Workflow

Use deterministic JavaScript for orchestration and Codex agents for bounded
judgment.

## Work from repository truth

1. Read applicable `AGENTS.md` files and inspect the existing workflow, package
   version, scripts, and local conventions.
2. Confirm that deterministic multi-agent orchestration is useful. Prefer one
   ordinary Codex task when a single context can solve the work without explicit
   fan-out, staging, voting, or replay.
3. Keep new workflow source under `.codex/workflows/<descriptive-name>.js` unless
   the repository establishes another location.

## Load only the reference needed

- Read [workflow-language.md](references/workflow-language.md) before authoring
  or changing workflow source.
- Read [running-and-journals.md](references/running-and-journals.md) before
  executing, resuming, inspecting, or debugging a run.
- Read [public-api.md](references/public-api.md) when using the npm API,
  configuring caps or events, or checking exact exported interfaces.

## Author the smallest workflow

1. Start with literal `meta` containing a clear `name` and `description`.
2. Put loops, conditions, fan-out, aggregation, and stop rules in JavaScript.
3. Give each `agent()` one bounded task, an explicit supported model, and a
   stable label when attribution matters.
4. Use `parallel()` for independent thunks and `pipeline()` for the same ordered
   stages across multiple items. Use `workflow()` only for a reusable
   orchestration unit.
5. Pass changing values through `args`; do not use clocks or randomness.
6. Return only JSON-compatible values and handle `null` slots from failed
   parallel or pipeline work.

## Run, inspect, and resume

Run from the repository root:

```sh
gpt-workflow run .codex/workflows/<name>.js | tee run.jsonl
```

Read the terminal NDJSON record and its `journalPath`. Inspect journal entries
before rerunning. For a prior run ID:

```sh
gpt-workflow run --resume <runId> .codex/workflows/<name>.js
```

Stream journals line by line with `parseWorkflowJournalEntry`; never require a
whole-file read. Treat unmatched `started` records as interrupted or failed
live calls. Expect longest-prefix replay: after the first changed or missing
call, all later calls run live.

## Verify proportionally

For source-only workflow changes, parse and exercise the narrowest useful path.
For package changes, run repository checks and installed-package smokes. Do not
run live model verification or spend tokens unless the task requires it or the
user approves it. Report run ID, journal path, terminal status, failures, and
the exact checks performed.

In the `gpt-workflow` source repository, `.codex/workflows/parity-*` files are
generated mirrors. Change their `.claude/workflows/` source and run `just mirror`
when the task intentionally changes parity fixtures.
