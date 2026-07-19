"""Public Python error taxonomy."""

from __future__ import annotations

from pathlib import Path

from ._types import WorkflowStatus


class WorkflowDirectoryUnset(RuntimeError):
    """The required module-global workflow directory was not configured."""


class BunError(RuntimeError):
    """Bun or bunx could not start the synchronized CLI."""


class CLIProtocolError(RuntimeError):
    """The CLI did not produce a trustworthy structured response."""


class WorkflowError(Exception):
    """A failure for a run whose persisted status is available."""

    def __init__(
        self,
        message: str,
        *,
        status: WorkflowStatus,
        run_directory: Path,
    ) -> None:
        """Retain the required persisted metadata for the failed run."""
        super().__init__(message)
        self.status = status
        self.run_directory = run_directory


class InvalidWorkflowError(WorkflowError):
    """The workflow source or literal metadata is invalid."""


class InvalidWorkflowArgumentError(WorkflowError, ValueError):
    """A workflow called its public runtime API with invalid arguments."""


class ModelError(WorkflowError, ValueError):
    """A required or selected model is missing or unavailable."""


class CodexAppServerError(WorkflowError):
    """Codex App Server failed to start, communicate, or complete a turn."""


class WorkflowLimitExceededError(WorkflowError):
    """A workflow lifetime, fan-out, concurrency, or depth limit was reached."""


class BudgetExceededError(WorkflowLimitExceededError):
    """A workflow attempted work after exhausting its token budget."""


class GitError(WorkflowError):
    """Git could not create or manage an isolated workflow worktree."""


class JSONBoundaryError(WorkflowError, TypeError):
    """A workflow value could not cross a JSON boundary."""


class WorkflowExecutionError(WorkflowError):
    """Workflow code raised an otherwise unclassified execution error."""


class WorkflowCancelledError(WorkflowError):
    """A workflow was cancelled outside the local KeyboardInterrupt path."""


class WorkflowInterrupted(KeyboardInterrupt):
    """A locally interrupted run whose persisted status was recovered."""

    def __init__(self, *, status: WorkflowStatus, run_directory: Path) -> None:
        """Retain status while preserving standard KeyboardInterrupt semantics."""
        super().__init__("workflow run was interrupted")
        self.status = status
        self.run_directory = run_directory
