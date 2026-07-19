"""Build and adversarially smoke the local Python distribution."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import tomllib
from collections.abc import Mapping
from pathlib import Path

SDK = Path(__file__).resolve().parents[1]
REPOSITORY = SDK.parents[1]
EXPECTED_VERSION = "0.3.3"


def run(
    *command: str,
    cwd: Path = SDK,
    environment: Mapping[str, str] | None = None,
) -> None:
    """Run one verifier command without a shell."""
    subprocess.run(command, check=True, cwd=cwd, env=environment)


def synchronized_version() -> str:
    """Reject drift between every package version source."""
    package = json.loads((REPOSITORY / "package.json").read_text())
    project = tomllib.loads((SDK / "pyproject.toml").read_text())["project"]
    namespace: dict[str, object] = {}
    exec((SDK / "src/gpt_workflow/_version.py").read_text(), namespace)
    versions = {
        "expected": EXPECTED_VERSION,
        "npm": package["version"],
        "python": project["version"],
        "runtime": namespace["VERSION"],
    }
    if len(set(versions.values())) != 1:
        raise RuntimeError(f"package version drift: {versions}")
    return EXPECTED_VERSION


def venv_python(venv: Path) -> Path:
    """Return the Python executable created by uv on this platform."""
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def verify() -> None:
    """Build both artifacts and run import plus installed-runtime smokes."""
    version = synchronized_version()
    with tempfile.TemporaryDirectory(prefix="gpt-workflow-python-") as raw_temp:
        temp = Path(raw_temp)
        dist = temp / "dist"
        venv = temp / "venv"
        consumer = temp / "consumer"
        bun_temp = temp / "bun"
        consumer.mkdir()
        bun_temp.mkdir()

        run("uv", "build", "--out-dir", str(dist))
        artifacts = sorted(
            path for path in dist.iterdir() if not path.name.startswith(".")
        )
        wheels = [path for path in artifacts if path.suffix == ".whl"]
        sdists = [path for path in artifacts if path.name.endswith(".tar.gz")]
        if len(wheels) != 1 or len(sdists) != 1:
            raise RuntimeError(f"expected one wheel and one sdist, got {artifacts}")
        run(sys.executable, "-m", "twine", "check", *(str(path) for path in artifacts))

        run("uv", "venv", "--python", "3.12", str(venv))
        python = venv_python(venv)
        run("uv", "pip", "install", "--python", str(python), str(wheels[0]))

        run(
            str(python),
            "-I",
            "-c",
            (
                "import importlib.resources, gpt_workflow; "
                f"assert gpt_workflow.__version__ == {version!r}; "
                "assert importlib.resources.files(gpt_workflow)"
                ".joinpath('py.typed').is_file()"
            ),
            cwd=consumer,
        )

        (consumer / "workflow.js").write_text(
            "export const meta = { name: 'python-smoke', "
            "description: 'installed Python SDK smoke' }\n"
            "return { answer: 42 }\n"
        )
        (consumer / "smoke.py").write_text(
            "from pathlib import Path\n"
            "import gpt_workflow\n"
            "gpt_workflow.cwd = Path.cwd()\n"
            "execution = gpt_workflow.run('workflow.js')\n"
            "assert execution.result == {'answer': 42}\n"
            "assert execution.status.status == 'completed'\n"
            "assert execution.status.result == {'answer': 42}\n"
            "assert execution.status.run_id == execution.run_directory.name\n"
            "assert execution.run_directory.is_dir()\n"
            "assert execution.run_directory.parent == "
            "Path.cwd() / '.codex' / 'workflows' / 'runs'\n"
        )
        environment = {
            **os.environ,
            "BUN_INSTALL_CACHE_DIR": str(bun_temp / "install-cache"),
            "TEMP": str(bun_temp),
            "TMP": str(bun_temp),
            "TMPDIR": str(bun_temp),
        }
        run(
            str(python),
            "-I",
            "smoke.py",
            cwd=consumer,
            environment=environment,
        )

    print("PYTHON_PACKAGE_VERIFY_SUCCESS")


if __name__ == "__main__":
    verify()
