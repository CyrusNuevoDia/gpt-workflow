# Show HN post

**Title:**

Show HN: gpt-workflow – Claude Code's Workflow tool, for Codex

**Body:**

Multi-agent workflows — judge panels, N-critic verification, migration sweeps over hundreds of files — are the highest-leverage way to spend model tokens, and gpt-5.6 is the best place to spend them. So I ported Claude Code's Workflow tool to Codex.

The orchestration model is unchanged, deliberately: a workflow is plain JavaScript — loops, branches, and fan-out decided in code — and `agent()` is the only place a model enters, spawning a Codex thread for the parts that need judgment. Pass a JSON schema and the runtime validates the reply and retries invalid ones. None of these shapes are unique to Codex; Claude Workflows run them too. What changes is the unit economics: a 50-agent sweep that's real money in metered Claude tokens barely dents a Codex plan, on the latest OpenAI models. Workflows you used to ration, you just run.

It's also more usable standalone than Claude Workflows, which live inside a Claude Code session. gpt-workflow is a CLI: `gpt-workflow run` streams ordered NDJSON to stdout (every record carries `sequence` and `runId`), so you can tee a run, post-process with `jq`, and wire it into scripts or CI. There's a library API for embedding, with an injectable `agent` for offline tests.

For existing Claude workflows: the surface is nearly-equivalent — `meta`, `agent()`, `parallel()`, `pipeline()`, child `workflow()`, `args`, `budget` — with better error-handling semantics. Most scripts port with a model-name swap; there's a parity ledger and migration checklist in the docs.

Install as a Codex plugin (bundles a skill that authors, runs, and debugs workflows for you), or `bun add --global gpt-workflow`. Requires Bun 1.3+.

Repo: https://github.com/CyrusNuevoDia/gpt-workflow
