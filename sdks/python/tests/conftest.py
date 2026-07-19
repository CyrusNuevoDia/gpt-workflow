from __future__ import annotations

from collections.abc import Iterator

import pytest

import gpt_workflow


@pytest.fixture(autouse=True)
def reset_global_cwd() -> Iterator[None]:
    gpt_workflow.cwd = None
    yield
    gpt_workflow.cwd = None
