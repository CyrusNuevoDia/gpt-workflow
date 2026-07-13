# Migrating a Claude Code workflow script

Follow this checklist from top to bottom:

1. Replace Claude model names with Codex models: `haiku` becomes
   `gpt-5.6-luna`, `sonnet` becomes `gpt-5.6-terra`, and `opus` or `fable`
   becomes `gpt-5.6-sol`. Alternatively, remove per-call models and pass
   `--default-model` when running the workflow.
2. Keep `effort` values as written; they pass through verbatim. Codex tiers are
   `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`, with
   availability depending on the selected model.
3. Rename `agentType` values to Codex agent names — nothing is aliased, and an
   unknown name throws:
   - `general-purpose` becomes `default` (general-purpose fallback, no
     overrides).
   - `Explore` becomes `explorer` (read-only exploration).
   - `Plan` and other Claude agent types have no built-in equivalent: pick the
     closest of `default`, `worker` (execution-focused, workspace-write), or
     `explorer`, or define the agent as a project or personal
     `.codex/agents/*.toml` file with `name`, `description`, and
     `developer_instructions`.
4. Treat `budget.total`, `spent()`, and `remaining()` as output-token accounting
   for this workflow run, including child workflows, not the whole turn or its
   sibling workflow processes.
5. Expect `isolation: "worktree"` calls under
   `<repo>/.codex/worktrees/<runId>-<n>`.
6. Keep `.filter(Boolean)` after fan-out when failed agents should be omitted;
   failed calls occupy their slot as `null`.
7. Expect a script with no return value to produce `null`.
8. Keep `console.log` calls when useful; they become workflow `log` events.
