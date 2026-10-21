---
"gpt-workflow": patch
---

Python SDK: `gpt_workflow.cwd` defaults to the resolved process working directory when unset (removing `WorkflowDirectoryUnset`), and `WorkflowResult` gains read-only `failures` and `failure_count` properties forwarded from its status.
