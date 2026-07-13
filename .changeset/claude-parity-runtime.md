---
"gpt-workflow": minor
---

Claude Workflow parity release.

Runtime semantics now match the Claude Workflow contract: bare `agent()`
resolves `null` on agent-side terminal failures (recorded as
`kind: "agent"` in `execution.failures`, retried on resume), scripts without
a `return` yield `null`, pipeline intermediates flow raw between stages,
`console.*` maps to `log` events, `setTimeout` is available, cancellation
rejects the run even inside fan-out, and host error names survive the VM
boundary.

Replay journals move to the order-independent v3 key format: keys hash the
prompt and authored options, the auto-injected phase is excluded, and replay
matches a key multiset until the first miss. v2 journals no longer replay.

Agents gain a real agent-type registry (`default`, `worker`, `explorer`
built-ins plus project and personal `.codex/agents/*.toml` definitions —
Claude agent-type names such as `general-purpose` and `Explore` are not
aliased; see the migration checklist),
a `defaultModel` client option with a `--default-model` CLI flag, structured
output with up to two corrective turns (strict wire schema, original schema
for local validation), raw-return developer instructions on every turn, and
transport hardening (late responses, server-initiated requests, thread/start
retry, usage races, SIGKILL shutdown).

Budget accounting counts output tokens only and streams usage into the
ceiling while agents run. Worktree isolation moves to
`<repo>/.codex/worktrees/`. The package is now Bun-only (`bun >= 1.3`).
