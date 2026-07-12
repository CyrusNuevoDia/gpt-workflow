# Claude workflow SDK reference documentation

Read in order the first time; each doc stands alone for reference afterwards.

1. **[Getting started](01-getting-started.md)** — the mental model, your first
   workflow, running it through the installed library, reading results,
   iterating.
2. **[Script format](02-script-format.md)** — anatomy of a workflow script: the
   `meta` block, the language sandbox, determinism rules, return values.
3. **[API reference](03-api.md)** — every global available to a script:
   `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`,
   `args`, `budget`. Signatures, options, failure semantics, examples.
4. **[Runtime semantics](04-runtime.md)** — the execution model: concurrency,
   caps, background tasks, transcripts, the journal, resume/memoization,
   worktree isolation, the failure model.
5. **[Orchestration patterns](05-patterns.md)** — the cookbook: pipeline vs
   barrier, the three loop shapes, adversarial verification, judge panels,
   sweeps, critics, and how to compose them.
6. **[Errors and limits](06-errors-and-limits.md)** — every error the runtime
   throws (exact messages), every cap, and the recovery playbook.

Conventions used throughout:

- **Pinned by: `parity-NN`** marks a behavior asserted by a workflow in
  [`.claude/workflows/`](../) and covered by this runtime's
  mirrored fixtures and tests.
- *(observed)* marks details recorded from live runs that the script-language
  contract leaves open.
- "Orchestrator script" = your JavaScript. "Subagent" = the LLM agent an
  `agent()` call spawns. "Run" = one invocation of a workflow.
