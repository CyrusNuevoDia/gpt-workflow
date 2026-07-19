from __future__ import annotations

import os
import signal
import threading
from pathlib import Path

import pytest

import gpt_workflow


def test_unset_workflow_directory_fails_before_bun_is_started(tmp_path: Path) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")

    with pytest.raises(
        gpt_workflow.WorkflowDirectoryUnset,
        match=r"gpt_workflow\.cwd",
    ):
        gpt_workflow.run(script)


def test_missing_bun_raises_a_dependency_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")
    gpt_workflow.cwd = tmp_path
    monkeypatch.setenv("PATH", "")

    with pytest.raises(gpt_workflow.BunError, match="bunx"):
        gpt_workflow.run(script)


def test_malformed_cli_output_never_fabricates_run_status(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")
    gpt_workflow.cwd = tmp_path
    _install_executable(tmp_path, monkeypatch, "print('not-json')\n")

    with pytest.raises(gpt_workflow.CLIProtocolError) as raised:
        gpt_workflow.run(script)

    assert not isinstance(raised.value, gpt_workflow.WorkflowError)


def test_cli_failure_without_structured_output_is_a_protocol_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")
    gpt_workflow.cwd = tmp_path
    _install_executable(
        tmp_path,
        monkeypatch,
        "import sys\nprint('usage failure', file=sys.stderr)\nraise SystemExit(1)\n",
    )

    with pytest.raises(gpt_workflow.CLIProtocolError, match="usage failure"):
        gpt_workflow.run(script)


def test_invalid_workflow_error_always_carries_persisted_run_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = "workflow-invalid"
    run_directory = tmp_path / ".codex" / "workflows" / "runs" / run_id
    script = tmp_path / "workflow.js"
    script.write_text("return (\n")
    gpt_workflow.cwd = tmp_path
    _install_failed_run_cli(
        tmp_path,
        monkeypatch,
        error_name="WorkflowLoadError",
        run_id=run_id,
    )

    with pytest.raises(gpt_workflow.InvalidWorkflowError) as raised:
        gpt_workflow.run(script)

    assert isinstance(raised.value, gpt_workflow.WorkflowError)
    assert raised.value.status.run_id == run_id
    assert raised.value.status.status == "failed"
    assert raised.value.run_directory == run_directory


@pytest.mark.parametrize(
    ("javascript_name", "python_error"),
    [
        ("TypeError", "InvalidWorkflowArgumentError"),
        ("WorkflowArgumentError", "InvalidWorkflowArgumentError"),
        ("AppServerModelError", "ModelError"),
        ("AppServerProtocolError", "CodexAppServerError"),
        ("AppServerTimeoutError", "CodexAppServerError"),
        ("AppServerProcessError", "CodexAppServerError"),
        ("AppServerRemoteError", "CodexAppServerError"),
        ("AppServerTurnError", "CodexAppServerError"),
        ("AppServerResultError", "CodexAppServerError"),
        ("WorkflowBudgetExceededError", "BudgetExceededError"),
        ("WorkflowCapError", "WorkflowLimitExceededError"),
        ("WorkflowGitError", "GitError"),
        ("JSONBoundaryError", "JSONBoundaryError"),
        ("Error", "WorkflowExecutionError"),
        ("WorkflowCanceledError", "WorkflowCancelledError"),
    ],
)
def test_structured_javascript_errors_map_without_reading_their_message(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    javascript_name: str,
    python_error: str,
) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")
    gpt_workflow.cwd = tmp_path
    _install_failed_run_cli(
        tmp_path,
        monkeypatch,
        error_name=javascript_name,
        run_id="workflow-mapped",
    )
    expected = getattr(gpt_workflow, python_error)

    with pytest.raises(expected) as raised:
        gpt_workflow.run(script)

    assert type(raised.value).__name__ == python_error
    assert raised.value.status.run_id == "workflow-mapped"
    assert raised.value.run_directory.name == "workflow-mapped"


def test_argument_related_run_errors_remain_value_errors() -> None:
    assert issubclass(gpt_workflow.InvalidWorkflowArgumentError, ValueError)
    assert issubclass(gpt_workflow.ModelError, ValueError)


def test_ctrl_c_after_start_flushes_and_retains_run_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return await agent('wait')\n")
    gpt_workflow.cwd = tmp_path
    _install_interruptible_cli(tmp_path, monkeypatch, started=True)
    interrupt = threading.Timer(0.75, os.kill, args=(os.getpid(), signal.SIGINT))
    interrupt.start()
    try:
        with pytest.raises(gpt_workflow.WorkflowInterrupted) as raised:
            gpt_workflow.run(script)
    finally:
        interrupt.cancel()

    assert isinstance(raised.value, KeyboardInterrupt)
    assert raised.value.status.run_id == "workflow-interrupted"
    assert raised.value.status.status == "failed"
    assert raised.value.run_directory.name == "workflow-interrupted"


def test_ctrl_c_before_start_remains_an_ordinary_keyboard_interrupt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")
    gpt_workflow.cwd = tmp_path
    _install_interruptible_cli(tmp_path, monkeypatch, started=False)
    interrupt = threading.Timer(0.75, os.kill, args=(os.getpid(), signal.SIGINT))
    interrupt.start()
    try:
        with pytest.raises(KeyboardInterrupt) as raised:
            gpt_workflow.run(script)
    finally:
        interrupt.cancel()

    assert type(raised.value) is KeyboardInterrupt


@pytest.mark.parametrize(
    ("call", "error"),
    [
        (
            lambda path: (
                setattr(gpt_workflow, "cwd", str(path)),
                gpt_workflow.models(),
            ),
            TypeError,
        ),
        (lambda path: gpt_workflow.run(path / "missing.js"), FileNotFoundError),
        (lambda _path: gpt_workflow.run(42), TypeError),
        (lambda path: gpt_workflow.run(path / "workflow.js", object()), TypeError),
        (lambda path: gpt_workflow.run(path / "workflow.js", float("nan")), ValueError),
        (
            lambda path: gpt_workflow.run(path / "workflow.js", default_model=""),
            ValueError,
        ),
        (
            lambda path: gpt_workflow.run(path / "workflow.js", required_models=[]),
            ValueError,
        ),
        (
            lambda path: gpt_workflow.run(
                path / "workflow.js", required_models="model"
            ),
            TypeError,
        ),
        (
            lambda path: gpt_workflow.run(path / "workflow.js", resume="bad/id"),
            ValueError,
        ),
        (
            lambda path: gpt_workflow.run(
                path / "workflow.js", request_timeout_ms=True
            ),
            TypeError,
        ),
        (
            lambda path: gpt_workflow.run(path / "workflow.js", turn_timeout_ms=0),
            ValueError,
        ),
    ],
)
def test_invalid_inputs_fail_before_spawning_bun(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    call: object,
    error: type[BaseException],
) -> None:
    script = tmp_path / "workflow.js"
    script.write_text("return true\n")
    gpt_workflow.cwd = tmp_path
    monkeypatch.setenv("PATH", "")

    with pytest.raises(error):
        call(tmp_path)  # type: ignore[operator]


def _install_executable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    body: str,
) -> None:
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    executable = bin_directory / "bunx"
    executable.write_text("#!/usr/bin/env python3\n" + body)
    executable.chmod(0o755)
    monkeypatch.setenv(
        "PATH",
        f"{bin_directory}{os.pathsep}{os.environ.get('PATH', '')}",
    )


def _install_failed_run_cli(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    error_name: str,
    run_id: str,
) -> None:
    body = (
        "import json, pathlib, sys\n"
        f"run_id = {run_id!r}\n"
        "runs = pathlib.Path.cwd() / '.codex' / 'workflows' / 'runs'\n"
        "run_directory = runs / run_id\n"
        "if sys.argv[3] == 'run':\n"
        "    print(json.dumps({'type': 'run.started', 'runId': run_id, "
        "'runDirectory': str(run_directory), 'scriptPath': sys.argv[-1], "
        "'schemaVersion': 1, 'sequence': 0, 'ts': 100, "
        "'meta': {'name': 'invalid', 'description': 'invalid'}}))\n"
        f"    print(json.dumps({{'type': 'run.failed', 'runId': run_id, "
        "'runDirectory': str(run_directory), 'scriptPath': sys.argv[-1], "
        "'schemaVersion': 1, 'sequence': 1, 'ts': 200, "
        f"'error': {{'name': {error_name!r}, 'message': 'structured failure'}}}}))\n"
        "    raise SystemExit(1)\n"
        "print(json.dumps({'runId': run_id, 'name': 'invalid', "
        "'scriptPath': str(pathlib.Path.cwd() / 'workflow.js'), "
        "'status': 'failed', 'startedAt': 100, 'lastEventAt': 200, "
        "'finishedAt': 200, 'failureCount': 1, 'agents': [], 'phases': []}))\n"
    )
    _install_executable(tmp_path, monkeypatch, body)


def _install_interruptible_cli(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    started: bool,
) -> None:
    body = (
        "import json, pathlib, signal, sys, time\n"
        "run_id = 'workflow-interrupted'\n"
        "runs = pathlib.Path.cwd() / '.codex' / 'workflows' / 'runs'\n"
        "run_directory = runs / run_id\n"
        "if sys.argv[3] == 'status':\n"
        "    print(json.dumps({'runId': run_id, 'name': 'interrupted', "
        "'scriptPath': str(pathlib.Path.cwd() / 'workflow.js'), 'status': 'failed', "
        "'startedAt': 100, 'lastEventAt': 200, 'finishedAt': 200, "
        "'failureCount': 1, 'agents': [], 'phases': []}))\n"
        "    raise SystemExit(0)\n"
        f"started = {started!r}\n"
        "if started:\n"
        "    print(json.dumps({'type': 'run.started', 'runId': run_id, "
        "'runDirectory': str(run_directory), 'scriptPath': sys.argv[-1], "
        "'schemaVersion': 1, 'sequence': 0, 'ts': 100, "
        "'meta': {'name': 'interrupted', 'description': 'test'}}), flush=True)\n"
        "def stop(_signal, _frame):\n"
        "    print(json.dumps({'type': 'run.failed', 'runId': run_id, "
        "'runDirectory': str(run_directory), 'scriptPath': sys.argv[-1], "
        "'schemaVersion': 1, 'sequence': 1, 'ts': 200, "
        "'error': {'name': 'WorkflowCanceledError', "
        "'message': 'workflow run was cancelled'}}), flush=True)\n"
        "    raise SystemExit(1)\n"
        "signal.signal(signal.SIGINT, stop)\n"
        "time.sleep(30)\n"
    )
    _install_executable(tmp_path, monkeypatch, body)
