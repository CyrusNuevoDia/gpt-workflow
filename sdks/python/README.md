# gpt-workflow for Python

`gpt-workflow` is a synchronous, typed Python wrapper around the deterministic
[`gpt-workflow`](https://www.npmjs.com/package/gpt-workflow) CLI. It blocks
until each command finishes, captures the CLI's NDJSON and diagnostics, and
does not print or retry work automatically.

## Prerequisites

- Python 3.12 or newer
- Bun 1.3 or newer
- an authenticated Codex CLI for workflows that call agents

The Python and npm distributions have synchronized versions.

Install the Python package after it is published:

```sh
python -m pip install gpt-workflow
```

## Run and inspect workflows

Set `gpt_workflow.cwd` once to the repository that owns the workflow. It must
be a `pathlib.Path`; relative script paths and durable run storage are resolved
from it.

```python
from pathlib import Path

import gpt_workflow

gpt_workflow.cwd = Path("/absolute/path/to/repository")

execution = gpt_workflow.run(
    ".codex/workflows/summarize.js",
    {"topic": "deterministic orchestration"},
    default_model="your-codex-model",
)

print(execution.result)
print(execution.status.run_id)
print(execution.run_directory)

for summary in gpt_workflow.runs():
    print(summary.run_id, summary.status)

status = gpt_workflow.status(execution.status.run_id)
available_models = gpt_workflow.models()
```

Omitting the second argument leaves workflow `args` undefined. Passing `None`
sends explicit JSON `null`. `WorkflowResult` contains the JSON result, detailed
`WorkflowStatus`, and durable run directory. `runs()` returns lightweight
summaries; `status()` loads detailed phase, agent, token, failure, and fallback
journal state; `models()` returns unique canonical model names in CLI order.
Unknown compatible JSON fields are retained in each value's `extra` mapping.
The CLI stores runs beneath
`$CODEX_HOME/projects/<encoded-cwd>/workflows/<workflow-name>/runs/`, using
`gpt_workflow.cwd` as the project identity; `CODEX_HOME` defaults to
`~/.codex`.

This no-agent workflow is deterministic and spends no model tokens:

```javascript
export const meta = {
  name: "python-smoke",
  description: "Python SDK smoke test",
};
return { answer: 42 };
```

## Errors and interruption

Configuration and validation fail before work starts with idiomatic exceptions:
`WorkflowDirectoryUnset`, `FileNotFoundError`, `TypeError`, `ValueError`,
`BunError`, or `CLIProtocolError`. Once a trustworthy run exists, failures use
`WorkflowError` subclasses whose `status` and `run_directory` are always set.
These distinguish invalid workflows and arguments, unavailable models, Codex
App Server failures, budgets and limits, Git failures, JSON boundaries,
cancellation, and unclassified workflow execution.

Ctrl-C before `run.started` remains an ordinary `KeyboardInterrupt`. After the
run starts, the wrapper forwards SIGINT, gives the CLI a bounded opportunity to
flush persisted failure state, then raises `WorkflowInterrupted`. That exception
is also a `KeyboardInterrupt` and carries `status` and `run_directory`.

## v1 scope

This release intentionally keeps Bun as a system prerequisite and exposes only
synchronous APIs. CI, PyPI publication, bundled Bun support such as a
`gpt-workflow[bun]` extra, and async APIs are deferred to later work.
