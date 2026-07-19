"""Synchronous, typed Python access to the gpt-workflow CLI."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from ._errors import (
    BudgetExceededError,
    BunError,
    CLIProtocolError,
    CodexAppServerError,
    GitError,
    InvalidWorkflowArgumentError,
    InvalidWorkflowError,
    JSONBoundaryError,
    ModelError,
    WorkflowCancelledError,
    WorkflowDirectoryUnset,
    WorkflowError,
    WorkflowExecutionError,
    WorkflowInterrupted,
    WorkflowLimitExceededError,
)
from ._runner import models as _models
from ._runner import run as _run
from ._runner import runs as _runs
from ._runner import status as _status
from ._types import (
    UNSET,
    JSONValue,
    Unset,
    WorkflowAgent,
    WorkflowAgentCounts,
    WorkflowJournalCounts,
    WorkflowPhase,
    WorkflowResult,
    WorkflowStatus,
    WorkflowSummary,
    WorkflowTokenTotals,
)
from ._version import VERSION

__version__ = VERSION

cwd: Path | None = None


def run(
    script: Path | str,
    args: JSONValue | Unset = UNSET,
    *,
    default_model: str | None = None,
    required_models: Sequence[str] | None = None,
    resume: str | None = None,
    request_timeout_ms: int = 30_000,
    thread_start_timeout_ms: int = 120_000,
    turn_timeout_ms: int = 300_000,
) -> WorkflowResult:
    """Run one workflow and return its result with persisted status."""
    return _run(
        _configured_cwd(),
        script,
        args,
        default_model=default_model,
        request_timeout_ms=request_timeout_ms,
        required_models=required_models,
        resume=resume,
        thread_start_timeout_ms=thread_start_timeout_ms,
        turn_timeout_ms=turn_timeout_ms,
    )


def runs() -> list[WorkflowSummary]:
    """List lightweight persisted run summaries, newest first."""
    return _runs(_configured_cwd())


def status(run_id: str) -> WorkflowStatus:
    """Read detailed persisted status for one run."""
    return _status(_configured_cwd(), run_id)


def models() -> list[str]:
    """List unique canonical App Server model names in discovery order."""
    return _models(_configured_cwd())


def _configured_cwd() -> Path:
    if cwd is None:
        raise WorkflowDirectoryUnset("gpt_workflow.cwd must be set to a Path")
    if not isinstance(cwd, Path):
        raise TypeError("gpt_workflow.cwd must be a Path")
    if not cwd.is_dir():
        raise FileNotFoundError(cwd)
    return cwd


__all__ = [
    "UNSET",
    "BudgetExceededError",
    "BunError",
    "CLIProtocolError",
    "CodexAppServerError",
    "GitError",
    "InvalidWorkflowArgumentError",
    "InvalidWorkflowError",
    "JSONBoundaryError",
    "JSONValue",
    "ModelError",
    "Unset",
    "WorkflowAgent",
    "WorkflowAgentCounts",
    "WorkflowCancelledError",
    "WorkflowDirectoryUnset",
    "WorkflowError",
    "WorkflowExecutionError",
    "WorkflowInterrupted",
    "WorkflowJournalCounts",
    "WorkflowLimitExceededError",
    "WorkflowPhase",
    "WorkflowResult",
    "WorkflowStatus",
    "WorkflowSummary",
    "WorkflowTokenTotals",
    "cwd",
    "models",
    "run",
    "runs",
    "status",
]
