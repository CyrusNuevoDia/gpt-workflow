"""Typed public values returned by the Python SDK."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

type JSONPrimitive = str | int | float | bool | None
type JSONValue = JSONPrimitive | list[JSONValue] | dict[str, JSONValue]
type RunState = Literal["completed", "failed", "incomplete", "unknown"]
type AgentState = Literal["completed", "failed", "incomplete"]


class Unset:
    """Sentinel type distinguishing omitted args from explicit JSON null."""

    __slots__ = ()

    def __repr__(self) -> str:
        """Return the stable public sentinel representation."""
        return "UNSET"


UNSET = Unset()


def _empty_extra() -> dict[str, JSONValue]:
    return {}


@dataclass(frozen=True, slots=True)
class WorkflowAgentCounts:
    """Agent counts attributed to one workflow phase."""

    started: int
    completed: int
    failed: int
    extra: Mapping[str, JSONValue] = field(default_factory=_empty_extra)


@dataclass(frozen=True, slots=True)
class WorkflowTokenTotals:
    """Normalized token totals attributed to one workflow phase."""

    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    reasoning_output_tokens: int
    total_tokens: int
    extra: Mapping[str, JSONValue] = field(default_factory=_empty_extra)


@dataclass(frozen=True, slots=True)
class WorkflowAgent:
    """Persisted state for one workflow agent."""

    agent_id: str
    label: str | None
    model: str | None
    phase: str | None
    status: AgentState
    tokens: JSONValue
    extra: Mapping[str, JSONValue] = field(default_factory=_empty_extra)


@dataclass(frozen=True, slots=True)
class WorkflowPhase:
    """Persisted state for one declared workflow phase."""

    title: str
    detail: str | None
    agents: WorkflowAgentCounts
    tokens: WorkflowTokenTotals
    extra: Mapping[str, JSONValue] = field(default_factory=_empty_extra)


@dataclass(frozen=True, slots=True)
class WorkflowJournalCounts:
    """Fallback counts for a legacy journal-only run."""

    started: int
    results: int
    unmatched: int
    extra: Mapping[str, JSONValue] = field(default_factory=_empty_extra)


@dataclass(frozen=True, slots=True)
class WorkflowSummary:
    """Lightweight persisted run summary returned by runs()."""

    run_id: str
    status: RunState
    name: str | None
    script_path: Path | None
    started_at: int | None
    last_event_at: int | None
    finished_at: int | None = None
    failure_count: int | None = None
    usage: JSONValue = None
    journal_only: bool = False
    extra: Mapping[str, JSONValue] = field(default_factory=_empty_extra)


@dataclass(frozen=True, slots=True)
class WorkflowStatus:
    """Detailed persisted state for one workflow run."""

    run_id: str
    status: RunState
    name: str | None = None
    script_path: Path | None = None
    started_at: int | None = None
    last_event_at: int | None = None
    finished_at: int | None = None
    failure_count: int | None = None
    usage: JSONValue = None
    agents: tuple[WorkflowAgent, ...] = ()
    phases: tuple[WorkflowPhase, ...] = ()
    result: JSONValue | Unset = UNSET
    failures: JSONValue | Unset = UNSET
    journal_only: bool = False
    journal: WorkflowJournalCounts | None = None
    extra: Mapping[str, JSONValue] = field(default_factory=_empty_extra)


@dataclass(frozen=True, slots=True)
class WorkflowResult:
    """Completed workflow value, detailed status, and durable run directory."""

    result: JSONValue
    status: WorkflowStatus
    run_directory: Path
