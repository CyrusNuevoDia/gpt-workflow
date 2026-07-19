from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import gpt_workflow


def test_user_can_run_a_workflow_and_receive_its_persisted_status(
    tmp_path: Path,
    monkeypatch: object,
) -> None:
    run_id = "workflow-python-test"
    run_directory = tmp_path / ".codex" / "workflows" / "runs" / run_id
    _install_fake_bunx(
        tmp_path,
        monkeypatch,
        run_record={"answer": 42},
        run_id=run_id,
    )
    script = tmp_path / "workflow.js"
    script.write_text("return { answer: 42 }\n")
    gpt_workflow.cwd = tmp_path

    execution = gpt_workflow.run(script)

    assert execution.result == {"answer": 42}
    assert execution.run_directory == run_directory
    assert execution.status.run_id == run_id
    assert execution.status.status == "completed"
    assert execution.status.agents == ()
    assert execution.status.phases == ()


def test_user_can_forward_every_supported_run_option(
    tmp_path: Path, monkeypatch: object
) -> None:
    arguments_path = tmp_path / "arguments.json"
    _install_fake_bunx(
        tmp_path,
        monkeypatch,
        arguments_path=arguments_path,
        run_record=None,
        run_id="workflow-options",
    )
    script = tmp_path / "workflow.js"
    script.write_text("return args\n")
    gpt_workflow.cwd = tmp_path

    gpt_workflow.run(
        script,
        None,
        default_model="model-default",
        required_models=["model-one", "model-two"],
        resume="workflow-previous",
        request_timeout_ms=45_000,
        thread_start_timeout_ms=240_000,
        turn_timeout_ms=1_800_000,
    )

    assert json.loads(arguments_path.read_text()) == [
        "--bun",
        "gpt-workflow@0.3.3",
        "run",
        "--args",
        "null",
        "--default-model",
        "model-default",
        "--required-model",
        "model-one",
        "--required-model",
        "model-two",
        "--resume",
        "workflow-previous",
        "--request-timeout-ms",
        "45000",
        "--thread-start-timeout-ms",
        "240000",
        "--turn-timeout-ms",
        "1800000",
        str(script),
    ]


def test_omitted_args_use_exact_pin_without_an_args_flag(
    tmp_path: Path, monkeypatch: object
) -> None:
    arguments_path = tmp_path / "arguments.json"
    _install_fake_bunx(
        tmp_path,
        monkeypatch,
        arguments_path=arguments_path,
        run_record=None,
        run_id="workflow-unset",
    )
    script = tmp_path / "workflow.js"
    script.write_text("return args\n")
    gpt_workflow.cwd = tmp_path

    gpt_workflow.run(script)

    arguments = json.loads(arguments_path.read_text())
    assert arguments == [
        "--bun",
        "gpt-workflow@0.3.3",
        "run",
        str(script),
    ]


def test_normal_run_does_not_print_cli_output(
    tmp_path: Path,
    monkeypatch: object,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _install_fake_bunx(
        tmp_path,
        monkeypatch,
        run_record=True,
        run_id="workflow-quiet",
    )
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")
    gpt_workflow.cwd = tmp_path

    gpt_workflow.run(script)

    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == ""


def _install_fake_bunx(
    tmp_path: Path,
    monkeypatch: object,
    *,
    arguments_path: Path | None = None,
    run_record: object,
    run_id: str,
) -> None:
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    executable = bin_directory / "bunx"
    executable.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, pathlib, sys\n"
        f"arguments_path = {str(arguments_path)!r}\n"
        f"run_id = {run_id!r}\n"
        "runs = pathlib.Path.cwd() / '.codex' / 'workflows' / 'runs'\n"
        "run_directory = runs / run_id\n"
        "base = {'runId': run_id, 'runDirectory': str(run_directory), "
        "'schemaVersion': 1, 'scriptPath': str(pathlib.Path.cwd() / 'workflow.js')}\n"
        "command = sys.argv[3]\n"
        "if command == 'run':\n"
        "    if arguments_path:\n"
        "        pathlib.Path(arguments_path).write_text(json.dumps(sys.argv[1:]))\n"
        "    print(json.dumps({**base, 'type': 'run.started', 'sequence': 0, "
        "'ts': 100, 'meta': {'name': 'python-test', 'description': 'test'}}))\n"
        f"    result = {run_record!r}\n"
        "    print(json.dumps({**base, 'type': 'run.completed', 'sequence': 1, "
        "'ts': 200, 'meta': {'name': 'python-test', 'description': 'test'}, "
        "'result': result, 'failures': [], 'usage': {'agentCount': 0}}))\n"
        "elif command == 'status':\n"
        "    print(json.dumps({'runId': run_id, 'name': 'python-test', "
        "'scriptPath': base['scriptPath'], 'status': 'completed', "
        "'startedAt': 100, 'lastEventAt': 200, 'finishedAt': 200, "
        "'failureCount': 0, 'usage': {'agentCount': 0}, 'agents': [], "
        "'phases': [], 'result': "
        f"{run_record!r}, 'failures': []}}))\n"
    )
    executable.chmod(0o755)
    current_path = os.environ.get("PATH", "")
    monkeypatch.setenv("PATH", f"{bin_directory}{os.pathsep}{current_path}")  # type: ignore[attr-defined]
