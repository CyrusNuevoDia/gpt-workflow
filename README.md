# gpt-workflow

Reference documentation and an executable parity suite for the **Workflow SDK**
— the deterministic multi-agent orchestration runtime behind Claude Code's
`Workflow` tool. A workflow is a plain JavaScript script that fans work out to
LLM subagents with `agent()`, coordinates them with `parallel()` and
`pipeline()`, and returns a result — control flow lives in code, judgment lives
in the agents.

This repo exists to support building an independent implementation of that
runtime with **100% feature parity**. It contains no implementation — it is the
spec, in two load-bearing forms:

| Piece | What it is |
|---|---|
| [`docs/`](docs/) | Full documentation: getting started, script format, API reference, runtime semantics, orchestration patterns, errors & limits |
| [`PARITY.md`](PARITY.md) | The feature matrix: every SDK behavior mapped to the test that pins it, plus behaviors observed live against the reference runtime |
| [`.claude/workflows/`](.claude/workflows/) | 12 self-asserting parity workflows. Run them against any runtime that provides the same script globals; all checks green ⇒ feature parity |

Start with [docs/01-getting-started.md](docs/01-getting-started.md). Every
factual claim in the docs that the suite verifies is annotated
`Pinned by: parity-NN`, so docs, tests, and observed behavior stay one
coherent spec.
