# Python SDK specification

## Public surface

```python
from pathlib import Path
from typing import Any, Sequence

import gpt_workflow

gpt_workflow.cwd = Path("/repo")

result = gpt_workflow.run(
    "workflow.js",
    {"topic": "deterministic orchestration"},
    default_model="gpt-5.6-luna",
)

result.result
result.status
result.run_directory

gpt_workflow.runs()
gpt_workflow.status(result.status.run_id)
gpt_workflow.models()
```

The API is synchronous and quiet. It captures the CLI's NDJSON and diagnostics.
It does not expose event streaming, async variants, or arbitrary App Server
keyword forwarding in v1.

## Values

`JSONValue` is the recursive JSON value type. `UNSET` distinguishes omitted
workflow arguments from explicit JSON `null` (`None`). Unknown CLI fields live
in typed dataclasses' `extra` mappings so compatible additions are preserved
without making misspelled attributes succeed.

`runs()` returns lightweight summaries. `status()` returns detailed phase,
agent, failure, usage, and journal-only state. `models()` projects CLI model
records to their canonical `model` strings, preserving first-seen order.

## Runtime

The Python distribution and npm package share version `0.3.3`. The Python
package invokes `bunx --bun gpt-workflow@0.3.3`; it does not use `@latest` or
look for a separately installed `gpt-workflow` executable. Bun remains a system
prerequisite for v1. Global `gpt_workflow.cwd` is the subprocess cwd.

## Errors

Before a trustworthy `run.started`, use independent or built-in errors without
fabricated run metadata. After a run exists, every ordinary rich error derives
from `WorkflowError`, whose `status` and `run_directory` are required.

Local Ctrl-C before a run starts remains ordinary `KeyboardInterrupt`. Once a
run starts, the wrapper asks the CLI to cancel and flush before raising
`WorkflowInterrupted`, which retains Python interrupt semantics and run state.
The wrapper never retries automatically.
