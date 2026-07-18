# gpt-workflow

## 0.3.2

### Patch Changes

- [`a40b2f6`](https://github.com/CyrusNuevoDia/gpt-workflow/commit/a40b2f6c8e518368a66be6875784d56844382672) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Add `gpt-workflow run --turn-timeout-ms` for workflows with long-running agent turns.

## 0.3.1

### Patch Changes

- [`912bf7f`](https://github.com/CyrusNuevoDia/gpt-workflow/commit/912bf7f7fcbcc56bb9d698f331aa66fa913d6777) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Publish the launch documentation refresh.

## 0.3.0

### Minor Changes

- [`e74bde8`](https://github.com/CyrusNuevoDia/gpt-workflow/commit/e74bde8dad378e34fbce08a0b4fb5b478111e88a) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Add `list` and `status` commands for inspecting workflow runs, plus JSON `--args` support on `run`. Runs now include timestamps and workflow metadata in their NDJSON stream while persisting a filtered, ordered `events.jsonl` stream for durable status reconstruction.

## 0.2.0

### Minor Changes

- [`9cb3f42`](https://github.com/CyrusNuevoDia/gpt-workflow/commit/9cb3f42ddb0fdd35c86cac81de2e86b87f4a914d) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Claude Workflow parity release.

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

## 0.1.2

### Patch Changes

- [`6da7cae`](https://github.com/CyrusNuevoDia/gpt-workflow/commit/6da7cae14b7cb5edef2fa41c89741e05ead0ae0f) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Rename the installed skill to `workflow`, align its user-facing name to Workflow, and remove source-repository maintenance instructions from the consumer skill.

## 0.1.1

### Patch Changes

- [`53a504f`](https://github.com/CyrusNuevoDia/gpt-workflow/commit/53a504f9ccc4e4534db839d1a4744ab2f18cbafc) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Add Codex-native workflow journals, CLI resume support, streaming journal parsing, project-owned documentation, and the installable Workflow plugin.

- [`44e747c`](https://github.com/CyrusNuevoDia/gpt-workflow/commit/44e747ccc30d98ee5ad79b3e34f9377e929889a1) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Keep Node.js type declarations out of the published dependency surface.
