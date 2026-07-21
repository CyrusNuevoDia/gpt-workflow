# Audience

This page states who `gpt-workflow` serves, when it is the wrong tool, and
what every other page in these docs is allowed to assume about its reader.

## Who this serves

`gpt-workflow` is built for Codex power users who want orchestration where
control flow is deterministic JavaScript and only judgment is delegated to
model calls. The docs serve that person in two roles:

- **Plugin users** who install the Codex plugin and let the bundled skill
  author, run, and debug workflows for them.
- **Workflow authors** writing `.codex/workflows/*.js` and running them
  through the CLI.

Readers migrating existing Claude Code workflows are a supported secondary
audience, not the primary one.

## Good fit

Reach for `gpt-workflow` when the task needs:

- fan-out over a known or discoverable work list, with loops, branches, and
  retries decided in code rather than by a model;
- resumability — long or token-expensive runs that must survive interruption
  and replay completed calls from the journal instead of re-spending;
- validated structured output, with corrective retries handled at the
  runtime boundary instead of in prompt text;
- multi-agent verification shapes (independent critics, judge panels) where
  positional results and absorbed `null` failures matter.

## Not a fit

- A single conversational task. Run Codex directly; a workflow adds journal
  and scheduling machinery without adding control.
- Node.js runtimes. Bun 1.3 or newer is required and there is no Node
  fallback.
- Hostile or untrusted script sources. The `node:vm` boundary is semantic,
  not a security sandbox; workflow scripts are trusted repository code.
- Budget pooling across separate workflow processes. A budget spans one run
  and its child workflows, nothing wider.

## What every page may assume

Readers:

- are fluent in modern JavaScript and `async`/`await`; pages never teach
  language features;
- use Codex daily and already have an authenticated Codex CLI; pages name
  that requirement but never cover Codex onboarding;
- run Bun 1.3 or newer; pages never show Node or npm alternatives;
- can stream and filter NDJSON with `jq` or a line reader;
- probably know Claude Code's Workflow tool, but no page may require that
  knowledge. Every parity or divergence statement spells out the concrete
  behavior on both sides rather than naming a Claude feature and moving on.

## Rules for writing these docs

- "Journal" always means the replay journal at
  `$CODEX_HOME/projects/<project>/workflows/<workflow>/runs/<runId>/journal.jsonl`.
  Codex thread rollouts are
  never called journals, and their private on-disk layout is never
  documented as a contract.
- "Events file" always means the CLI-written inspection copy at
  `$CODEX_HOME/projects/<project>/workflows/<workflow>/runs/<runId>/events.jsonl`.
  It is never called a journal
  and never described as a replay input.
- Examples must be copy-runnable after substituting only model names and
  file paths.
- A page that introduces an API states its failure semantics in the same
  section: what resolves to `null` and lands in failures, and what rejects
  the run.
- Commands that spend model tokens are always labeled as such; `just check`
  never spends, `just verify` does.
