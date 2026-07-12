# gpt-workflow documentation

These docs describe the implemented Codex runtime and public npm package.

1. [Getting started](01-getting-started.md) — install, author, run, resume, and
   install the Codex plugin.
2. [Workflow scripts](02-script-format.md) — metadata, deterministic JavaScript,
   inputs, and JSON boundaries.
3. [API reference](03-api.md) — package exports, execution options, and script
   globals.
4. [Runs and journals](04-runtime.md) — run storage, record format, streaming
   parsing, replay, scheduling, and Codex thread persistence.
5. [Patterns](05-patterns.md) — practical orchestration shapes.
6. [Errors and limits](06-errors-and-limits.md) — caps, failure semantics, and
   troubleshooting.
7. [Codex plugin](07-plugin.md) — repository marketplace installation and the
   bundled skill.

The original Claude workflow material used to establish parity is preserved
separately under [`.claude/workflows/docs/`](../.claude/workflows/docs/). It is
reference evidence, not the contract for this package.
