"""Strict decoding for the CLI's JSON and NDJSON contracts."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from ._errors import CLIProtocolError
from ._types import (
    UNSET,
    AgentState,
    JSONValue,
    RunState,
    Unset,
    WorkflowAgent,
    WorkflowAgentCounts,
    WorkflowJournalCounts,
    WorkflowPhase,
    WorkflowStatus,
    WorkflowSummary,
    WorkflowTokenTotals,
)

type Record = dict[str, object]


def records(output: str, *, allow_empty: bool = False) -> list[Record]:
    """Decode ordered JSON objects from CLI stdout."""
    decoded: list[Record] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            value: object = json.loads(line)
        except json.JSONDecodeError as error:
            raise CLIProtocolError("CLI stdout contained malformed JSON") from error
        if not isinstance(value, dict):
            raise CLIProtocolError("CLI stdout records must be JSON objects")
        raw = cast(dict[object, object], value)
        if not all(isinstance(key, str) for key in raw):
            raise CLIProtocolError("CLI stdout records must be JSON objects")
        decoded.append(cast(Record, raw))
    if not decoded and not allow_empty:
        raise CLIProtocolError("CLI produced no JSON records")
    return decoded


def workflow_summary(record: Record) -> WorkflowSummary:
    """Decode one lightweight list record."""
    known = {
        "failureCount",
        "finishedAt",
        "journalOnly",
        "lastEventAt",
        "name",
        "runId",
        "scriptPath",
        "startedAt",
        "status",
        "usage",
    }
    return WorkflowSummary(
        extra=_extra(record, known),
        failure_count=_optional_int(record.get("failureCount")),
        finished_at=_optional_int(record.get("finishedAt")),
        journal_only=record.get("journalOnly") is True,
        last_event_at=_optional_int(record.get("lastEventAt")),
        name=_optional_string(record.get("name")),
        run_id=_string(record, "runId"),
        script_path=_optional_path(record.get("scriptPath")),
        started_at=_optional_int(record.get("startedAt")),
        status=_run_state(record.get("status")),
        usage=_json(record.get("usage")),
    )


def workflow_status(record: Record) -> WorkflowStatus:
    """Decode one detailed or journal-only status record."""
    known = {
        "agents",
        "failureCount",
        "failures",
        "finishedAt",
        "journal",
        "journalOnly",
        "lastEventAt",
        "name",
        "phases",
        "result",
        "runId",
        "scriptPath",
        "startedAt",
        "status",
        "usage",
    }
    agent_values = _list(record.get("agents", []), "agents")
    phase_values = _list(record.get("phases", []), "phases")
    return WorkflowStatus(
        agents=tuple(
            _workflow_agent(_record(value, "agent")) for value in agent_values
        ),
        extra=_extra(record, known),
        failure_count=_optional_int(record.get("failureCount")),
        failures=_optional_json_field(record, "failures"),
        finished_at=_optional_int(record.get("finishedAt")),
        journal=_workflow_journal(record.get("journal")),
        journal_only=record.get("journalOnly") is True,
        last_event_at=_optional_int(record.get("lastEventAt")),
        name=_optional_string(record.get("name")),
        phases=tuple(
            _workflow_phase(_record(value, "phase")) for value in phase_values
        ),
        result=_optional_json_field(record, "result"),
        run_id=_string(record, "runId"),
        script_path=_optional_path(record.get("scriptPath")),
        started_at=_optional_int(record.get("startedAt")),
        status=_run_state(record.get("status")),
        usage=_json(record.get("usage")),
    )


def _workflow_agent(record: Record) -> WorkflowAgent:
    known = {"agentId", "label", "model", "phase", "status", "tokens"}
    return WorkflowAgent(
        agent_id=_string(record, "agentId"),
        extra=_extra(record, known),
        label=_optional_string(record.get("label")),
        model=_optional_string(record.get("model")),
        phase=_optional_string(record.get("phase")),
        status=_agent_state(record.get("status")),
        tokens=_json(record.get("tokens")),
    )


def _workflow_phase(record: Record) -> WorkflowPhase:
    known = {"agents", "detail", "title", "tokens"}
    counts = _record(record.get("agents"), "phase agents")
    return WorkflowPhase(
        agents=WorkflowAgentCounts(
            completed=_int(counts, "completed"),
            extra=_extra(counts, {"completed", "failed", "started"}),
            failed=_int(counts, "failed"),
            started=_int(counts, "started"),
        ),
        detail=_optional_string(record.get("detail")),
        extra=_extra(record, known),
        title=_string(record, "title"),
        tokens=_workflow_tokens(_record(record.get("tokens"), "phase tokens")),
    )


def _workflow_tokens(record: Record) -> WorkflowTokenTotals:
    known = {
        "cachedInputTokens",
        "inputTokens",
        "outputTokens",
        "reasoningOutputTokens",
        "totalTokens",
    }
    return WorkflowTokenTotals(
        cached_input_tokens=_int(record, "cachedInputTokens"),
        extra=_extra(record, known),
        input_tokens=_int(record, "inputTokens"),
        output_tokens=_int(record, "outputTokens"),
        reasoning_output_tokens=_int(record, "reasoningOutputTokens"),
        total_tokens=_int(record, "totalTokens"),
    )


def _workflow_journal(value: object) -> WorkflowJournalCounts | None:
    if value is None:
        return None
    record = _record(value, "journal")
    return WorkflowJournalCounts(
        extra=_extra(record, {"results", "started", "unmatched"}),
        results=_int(record, "results"),
        started=_int(record, "started"),
        unmatched=_int(record, "unmatched"),
    )


def _extra(record: Record, known: set[str]) -> dict[str, JSONValue]:
    return {key: _json(value) for key, value in record.items() if key not in known}


def _optional_json_field(record: Record, key: str) -> JSONValue | Unset:
    return _json(record[key]) if key in record else UNSET


def _json(value: object) -> JSONValue:
    return cast(JSONValue, value)


def _record(value: object, label: str) -> Record:
    if not isinstance(value, dict):
        raise CLIProtocolError(f"{label} must be a JSON object")
    raw = cast(dict[object, object], value)
    if not all(isinstance(key, str) for key in raw):
        raise CLIProtocolError(f"{label} must be a JSON object")
    return cast(Record, raw)


def _list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise CLIProtocolError(f"{label} must be a JSON array")
    return cast(list[object], value)


def _string(record: Mapping[str, object], key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str):
        raise CLIProtocolError(f"{key} must be a string")
    return value


def _int(record: Mapping[str, object], key: str) -> int:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise CLIProtocolError(f"{key} must be an integer")
    return value


def _optional_string(value: object) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise CLIProtocolError("optional string field has an invalid value")


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise CLIProtocolError("optional integer field has an invalid value")
    return value


def _optional_path(value: object) -> Path | None:
    return Path(value) if isinstance(value, str) else None


def _run_state(value: object) -> RunState:
    if value not in {"completed", "failed", "incomplete", "unknown"}:
        raise CLIProtocolError("invalid run status")
    return cast(RunState, value)


def _agent_state(value: object) -> AgentState:
    if value not in {"completed", "failed", "incomplete"}:
        raise CLIProtocolError("invalid agent status")
    return cast(AgentState, value)
