from __future__ import annotations

import os
from pathlib import Path

import pytest
from pytest import MonkeyPatch

import gpt_workflow


@pytest.mark.parametrize(
    "state",
    ["completed", "failed", "incomplete", "unknown"],
)
def test_status_decodes_every_persisted_run_state(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    state: str,
) -> None:
    _install_single_record_cli(
        tmp_path,
        monkeypatch,
        {"runId": "workflow-state", "status": state},
    )
    gpt_workflow.cwd = tmp_path

    assert gpt_workflow.status("workflow-state").status == state


def test_models_returns_unique_canonical_names_in_cli_order(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    _install_models_cli(tmp_path, monkeypatch)
    gpt_workflow.cwd = tmp_path

    assert gpt_workflow.models() == ["model-one", "model-two"]


def test_status_decodes_detailed_typed_state_and_preserves_unknown_fields(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    record = {
        "runId": "workflow-detail",
        "name": "detail",
        "scriptPath": str(tmp_path / "workflow.js"),
        "status": "failed",
        "startedAt": 100,
        "lastEventAt": 300,
        "finishedAt": 300,
        "failureCount": 1,
        "usage": {"agentCount": 1},
        "agents": [
            {
                "agentId": "workflow-detail:agent-1",
                "label": "research",
                "model": "model-one",
                "phase": "Gather",
                "status": "failed",
                "tokens": {"totalTokens": 10},
                "futureAgentField": True,
            }
        ],
        "phases": [
            {
                "title": "Gather",
                "detail": "Collect evidence",
                "agents": {
                    "started": 1,
                    "completed": 0,
                    "failed": 1,
                    "futureCountField": "kept",
                },
                "tokens": {
                    "inputTokens": 5,
                    "cachedInputTokens": 1,
                    "outputTokens": 3,
                    "reasoningOutputTokens": 1,
                    "totalTokens": 10,
                    "futureTokenField": "kept",
                },
                "futurePhaseField": "kept",
            }
        ],
        "result": None,
        "failures": [{"kind": "agent", "message": "failed"}],
        "futureStatusField": {"kept": True},
    }
    _install_single_record_cli(tmp_path, monkeypatch, record)
    gpt_workflow.cwd = tmp_path

    status = gpt_workflow.status("workflow-detail")

    assert status.name == "detail"
    assert status.script_path == tmp_path / "workflow.js"
    assert status.failure_count == 1
    assert status.result is None
    assert status.failures == [{"kind": "agent", "message": "failed"}]
    assert status.agents[0].agent_id == "workflow-detail:agent-1"
    assert status.agents[0].extra == {"futureAgentField": True}
    assert status.phases[0].agents.failed == 1
    assert status.phases[0].agents.extra == {"futureCountField": "kept"}
    assert status.phases[0].tokens.total_tokens == 10
    assert status.phases[0].tokens.extra == {"futureTokenField": "kept"}
    assert status.phases[0].extra == {"futurePhaseField": "kept"}
    assert status.extra == {"futureStatusField": {"kept": True}}


def test_runs_returns_lightweight_summaries_with_unknown_fields(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    records = [
        {
            "runId": "workflow-new",
            "name": "new",
            "scriptPath": str(tmp_path / "new.js"),
            "status": "completed",
            "startedAt": 200,
            "lastEventAt": 300,
            "finishedAt": 300,
            "failureCount": 0,
            "usage": {"agentCount": 1},
            "futureSummaryField": "kept",
        },
        {
            "runId": "workflow-old",
            "name": None,
            "scriptPath": None,
            "status": "unknown",
            "startedAt": None,
            "lastEventAt": None,
            "journalOnly": True,
        },
    ]
    _install_multiple_records_cli(tmp_path, monkeypatch, records)
    gpt_workflow.cwd = tmp_path

    summaries = gpt_workflow.runs()

    assert [summary.run_id for summary in summaries] == [
        "workflow-new",
        "workflow-old",
    ]
    assert summaries[0].script_path == tmp_path / "new.js"
    assert summaries[0].extra == {"futureSummaryField": "kept"}
    assert summaries[1].journal_only is True


def test_status_decodes_journal_only_runs(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    _install_single_record_cli(
        tmp_path,
        monkeypatch,
        {
            "runId": "workflow-journal-only",
            "status": "unknown",
            "journalOnly": True,
            "journal": {
                "started": 3,
                "results": 2,
                "unmatched": 1,
                "futureJournalField": True,
            },
        },
    )
    gpt_workflow.cwd = tmp_path

    status = gpt_workflow.status("workflow-journal-only")

    assert status.status == "unknown"
    assert status.journal_only is True
    assert status.journal == gpt_workflow.WorkflowJournalCounts(
        started=3,
        results=2,
        unmatched=1,
        extra={"futureJournalField": True},
    )
    assert status.result is gpt_workflow.UNSET


def _install_models_cli(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    executable = bin_directory / "bunx"
    executable.write_text(
        "#!/usr/bin/env python3\n"
        "import json\n"
        "for record in [\n"
        "    {'id': 'one', 'model': 'model-one', 'displayName': 'One'},\n"
        "    {'id': 'one-alias', 'model': 'model-one'},\n"
        "    {'id': 'two', 'model': 'model-two', 'hidden': True},\n"
        "]:\n"
        "    print(json.dumps(record))\n"
    )
    executable.chmod(0o755)
    monkeypatch.setenv(
        "PATH",
        f"{bin_directory}{os.pathsep}{os.environ.get('PATH', '')}",
    )


def _install_single_record_cli(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    record: dict[str, object],
) -> None:
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    executable = bin_directory / "bunx"
    executable.write_text(
        f"#!/usr/bin/env python3\nimport json\nprint(json.dumps({record!r}))\n"
    )
    executable.chmod(0o755)
    monkeypatch.setenv(
        "PATH",
        f"{bin_directory}{os.pathsep}{os.environ.get('PATH', '')}",
    )


def _install_multiple_records_cli(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    records: list[dict[str, object]],
) -> None:
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    executable = bin_directory / "bunx"
    executable.write_text(
        "#!/usr/bin/env python3\n"
        "import json, sys\n"
        "assert sys.argv[3] == 'list'\n"
        f"for record in {records!r}:\n"
        "    print(json.dumps(record))\n"
    )
    executable.chmod(0o755)
    monkeypatch.setenv(
        "PATH",
        f"{bin_directory}{os.pathsep}{os.environ.get('PATH', '')}",
    )
