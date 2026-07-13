# Claude parity

This ledger compares the implemented Codex runtime with the Claude Workflow
contract preserved under `.claude/workflows/docs/`. It records semantic parity
without implying that the two runtimes use the same substrate.

## Matches

- `parallel()` and `pipeline()` preserve positions and turn absorbed failures
  into `null` results.
- Concurrency, agent-count, boundary-item, and child-depth caps match.
- Determinism guards reject clocks and randomness while deterministic built-ins
  remain available.
- Budget accounting uses output tokens, streams usage into the ceiling while
  agents run, and exposes the same `total`, `spent()`, and `remaining()` shape.
- Replay preserves the prefix contract on both runtimes: after the first
  changed or missing call, every later call runs live even when matching
  journal entries exist.
- Literal `meta` fields and phase metadata use the same format.
- Agent-side terminal failures resolve to `null` and remain visible in failures.
- `agentType` resolves registered agent definitions with the same precedence
  behavior (explicit call options beat the definition, custom definitions
  shadow built-ins).
- Structured output uses a strict schema on the wire, validates against the
  script author's original schema, and receives up to two corrective retries.
- Claude's `low`, `medium`, `high`, `xhigh`, and `max` effort tiers all pass
  through to Codex. Codex also accepts `none`, `minimal`, and `ultra` when the
  selected model supports them.
- Top-level and side-effect-only `undefined` results coerce to `null`.
- `console` methods and `log()` produce workflow log events.

## Known divergences

- Agent-type names are not aliased. Claude's built-in agent types are
  `general-purpose`, `Explore`, and `Plan`; Codex's are `default`, `worker`,
  and `explorer`. A Claude script must rename them (see the migration
  checklist) or ship matching `.codex/agents/*.toml` definitions — Codex
  definitions are TOML files, while Claude's are Markdown agent files.
- Claude `budget.spent()` spans the whole turn, including the main loop and
  sibling workflows. `gpt-workflow` accounts only for its own run, including
  child workflows within that run.
- Non-JSON values other than top-level `undefined` are rejected loudly at
  fan-out boundaries; Claude silently JSON-degrades some values, such as a
  `Map` becoming `{}`.
- Worktree semantics are identical, but `gpt-workflow` uses
  `.codex/worktrees/<runId>-<n>` while Claude uses `.claude/worktrees`.
- There is no 512 KiB workflow script size cap.
