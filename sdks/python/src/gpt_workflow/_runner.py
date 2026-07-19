"""CLI invocation, validation, lifecycle, and semantic error mapping."""

from __future__ import annotations

import json
import math
import re
import signal
import subprocess
import threading
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import NoReturn, cast

from ._decode import Record, records, workflow_status, workflow_summary
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
    WorkflowError,
    WorkflowExecutionError,
    WorkflowInterrupted,
    WorkflowLimitExceededError,
)
from ._types import (
    JSONValue,
    Unset,
    WorkflowResult,
    WorkflowStatus,
    WorkflowSummary,
)
from ._version import VERSION

_RUN_ID = re.compile(r"^[A-Za-z0-9._-]+$")
_CLI = ("bunx", "--bun", f"gpt-workflow@{VERSION}")


def run(
    directory: Path,
    script: Path | str,
    args: JSONValue | Unset,
    *,
    default_model: str | None,
    required_models: Sequence[str] | None,
    resume: str | None,
    request_timeout_ms: int,
    thread_start_timeout_ms: int,
    turn_timeout_ms: int,
) -> WorkflowResult:
    """Validate and execute one workflow through the synchronized CLI."""
    script_path = _script(directory, script)
    command = [*_CLI, "run"]
    if not isinstance(args, Unset):
        _validate_json(args)
        command.extend(
            ["--args", json.dumps(args, allow_nan=False, separators=(",", ":"))]
        )
    if default_model is not None:
        command.extend(["--default-model", _model(default_model, "default_model")])
    command.extend(_required_model_arguments(required_models))
    if resume is not None:
        command.extend(["--resume", _resume(resume)])
    command.extend(
        _timeout(
            "--request-timeout-ms",
            "request_timeout_ms",
            request_timeout_ms,
            default=30_000,
        )
    )
    command.extend(
        _timeout(
            "--thread-start-timeout-ms",
            "thread_start_timeout_ms",
            thread_start_timeout_ms,
            default=120_000,
        )
    )
    command.extend(
        _timeout(
            "--turn-timeout-ms",
            "turn_timeout_ms",
            turn_timeout_ms,
            default=300_000,
        )
    )
    command.append(str(script_path))

    completed = _execute_run(command, directory)
    if completed.returncode != 0 and not completed.stdout.strip():
        raise CLIProtocolError(
            completed.stderr.strip() or "CLI failed without structured output"
        )
    output = records(completed.stdout)
    for record in output:
        schema = record.get("schemaVersion")
        if schema is not None and schema != 1:
            raise CLIProtocolError("unsupported CLI schema version")
    terminals = [
        record
        for record in output
        if record.get("type") in {"run.completed", "run.failed"}
    ]
    if len(terminals) != 1:
        raise CLIProtocolError("CLI run must contain exactly one terminal record")
    terminal = terminals[0]
    run_id = _string(terminal, "runId")
    run_directory = Path(_string(terminal, "runDirectory"))
    persisted = status(directory, run_id)
    if terminal.get("type") == "run.failed":
        if completed.returncode == 0:
            raise CLIProtocolError("run.failed contradicted a successful exit")
        _raise_run_failure(terminal, persisted, run_directory)
    if terminal.get("type") != "run.completed":
        raise CLIProtocolError("unknown terminal record")
    if completed.returncode != 0:
        raise WorkflowExecutionError(
            completed.stderr.strip() or "CLI failed after completing the run",
            run_directory=run_directory,
            status=persisted,
        )
    if "result" not in terminal:
        raise CLIProtocolError("run.completed omitted result")
    return WorkflowResult(
        result=cast(JSONValue, terminal["result"]),
        run_directory=run_directory,
        status=persisted,
    )


def status(directory: Path, run_id: str) -> WorkflowStatus:
    """Read one persisted run status through the synchronized CLI."""
    if not isinstance(run_id, str):
        raise TypeError("run_id must be a string")
    if not _RUN_ID.fullmatch(run_id):
        raise ValueError("run_id contains invalid characters")
    completed = _execute([*_CLI, "status", run_id], directory)
    _require_success(completed)
    output = records(completed.stdout)
    if len(output) != 1:
        raise CLIProtocolError("status must produce exactly one record")
    return workflow_status(output[0])


def runs(directory: Path) -> list[WorkflowSummary]:
    """Read lightweight persisted run summaries."""
    completed = _execute([*_CLI, "list"], directory)
    _require_success(completed)
    return [
        workflow_summary(record)
        for record in records(completed.stdout, allow_empty=True)
    ]


def models(directory: Path) -> list[str]:
    """Discover canonical model names without exposing App Server metadata."""
    completed = _execute([*_CLI, "models"], directory)
    _require_success(completed)
    names: list[str] = []
    for record in records(completed.stdout, allow_empty=True):
        name = _string(record, "model")
        if name not in names:
            names.append(name)
    return names


def _script(directory: Path, value: object) -> Path:
    if not isinstance(value, (Path, str)):
        raise TypeError("script must be a Path or str")
    path = Path(value)
    path = path if path.is_absolute() else directory / path
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def _required_model_arguments(values: object) -> list[str]:
    if values is None:
        return []
    if isinstance(values, (str, bytes)) or not isinstance(values, Sequence):
        raise TypeError("required_models must be a sequence of strings")
    sequence = cast(Sequence[object], values)
    if len(sequence) == 0:
        raise ValueError("required_models must not be empty")
    arguments: list[str] = []
    for value in sequence:
        arguments.extend(["--required-model", _model(value, "required_models")])
    return arguments


def _model(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{name} must contain strings")
    if not value:
        raise ValueError(f"{name} must not contain empty model names")
    return value


def _resume(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("resume must be a string")
    if not _RUN_ID.fullmatch(value):
        raise ValueError("resume contains invalid characters")
    return value


def _timeout(flag: str, name: str, value: object, *, default: int) -> list[str]:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an int")
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    if value == default:
        return []
    return [flag, str(value)]


def _validate_json(value: object, active: set[int] | None = None) -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("args contains a non-finite number")
        return
    if not isinstance(value, (list, dict)):
        raise TypeError("args must be JSON-compatible")
    seen: set[int] = set() if active is None else active
    collection = cast(list[object] | dict[object, object], value)
    identity = id(collection)
    if identity in seen:
        raise ValueError("args contains a circular reference")
    seen.add(identity)
    try:
        if isinstance(collection, dict):
            if not all(isinstance(key, str) for key in collection):
                raise TypeError("args object keys must be strings")
            children = collection.values()
        else:
            children = collection
        for child in children:
            _validate_json(child, seen)
    finally:
        seen.remove(identity)


def _execute(command: list[str], directory: Path) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command, cwd=directory, check=False, capture_output=True, text=True
        )
    except OSError as error:
        raise BunError(f"could not start bunx: {error}") from error


def _execute_run(
    command: list[str], directory: Path
) -> subprocess.CompletedProcess[str]:
    try:
        process = subprocess.Popen(
            command,
            cwd=directory,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
    except OSError as error:
        raise BunError(f"could not start bunx: {error}") from error
    if process.stdout is None or process.stderr is None:
        process.kill()
        raise CLIProtocolError("could not capture CLI output")

    stdout = process.stdout
    stderr = process.stderr
    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    started = threading.Event()

    def read_stdout() -> None:
        for line in stdout:
            stdout_lines.append(line)
            try:
                record: object = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                raw = cast(dict[object, object], record)
                if raw.get("type") == "run.started":
                    started.set()

    def read_stderr() -> None:
        stderr_lines.extend(stderr.readlines())

    stdout_thread = threading.Thread(target=read_stdout, daemon=True)
    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    try:
        return_code = process.wait()
    except KeyboardInterrupt as interruption:
        _interrupt(process, started.is_set())
        stdout_thread.join(timeout=1)
        stderr_thread.join(timeout=1)
        if not started.is_set():
            raise
        started_record = next(
            (
                item
                for item in records("".join(stdout_lines))
                if item.get("type") == "run.started"
            ),
            None,
        )
        if started_record is None:
            raise CLIProtocolError("interrupted CLI lost run.started") from interruption
        run_id = _string(started_record, "runId")
        run_directory = Path(_string(started_record, "runDirectory"))
        raise WorkflowInterrupted(
            run_directory=run_directory,
            status=status(directory, run_id),
        ) from interruption
    stdout_thread.join(timeout=1)
    stderr_thread.join(timeout=1)
    return subprocess.CompletedProcess(
        command, return_code, "".join(stdout_lines), "".join(stderr_lines)
    )


def _interrupt(process: subprocess.Popen[str], did_start: bool) -> None:
    if process.poll() is None:
        if did_start:
            process.send_signal(signal.SIGINT)
        else:
            process.kill()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def _require_success(completed: subprocess.CompletedProcess[str]) -> None:
    if completed.returncode != 0:
        raise CLIProtocolError(completed.stderr.strip() or "CLI command failed")


def _string(record: Mapping[str, object], key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str):
        raise CLIProtocolError(f"{key} must be a string")
    return value


def _raise_run_failure(
    terminal: Record,
    persisted: WorkflowStatus,
    run_directory: Path,
) -> NoReturn:
    error = terminal.get("error")
    if not isinstance(error, dict):
        raise CLIProtocolError("run.failed omitted its structured error")
    error_record = cast(dict[str, object], error)
    name = _string(error_record, "name")
    message = _string(error_record, "message")
    error_types: dict[str, type[WorkflowError]] = {
        "AppServerModelError": ModelError,
        "AppServerProcessError": CodexAppServerError,
        "AppServerProtocolError": CodexAppServerError,
        "AppServerRemoteError": CodexAppServerError,
        "AppServerResultError": CodexAppServerError,
        "AppServerTimeoutError": CodexAppServerError,
        "AppServerTurnError": CodexAppServerError,
        "JSONBoundaryError": JSONBoundaryError,
        "TypeError": InvalidWorkflowArgumentError,
        "WorkflowArgumentError": InvalidWorkflowArgumentError,
        "WorkflowBudgetExceededError": BudgetExceededError,
        "WorkflowCanceledError": WorkflowCancelledError,
        "WorkflowCapError": WorkflowLimitExceededError,
        "WorkflowGitError": GitError,
        "WorkflowLoadError": InvalidWorkflowError,
    }
    error_type = error_types.get(name, WorkflowExecutionError)
    raise error_type(message, run_directory=run_directory, status=persisted)
