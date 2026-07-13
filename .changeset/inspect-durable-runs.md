---
"gpt-workflow": minor
---

Add `list` and `status` commands for inspecting workflow runs, plus JSON `--args` support on `run`. Runs now include timestamps and workflow metadata in their NDJSON stream while persisting a filtered, ordered `events.jsonl` stream for durable status reconstruction.
