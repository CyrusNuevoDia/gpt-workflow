check:
    bunx ultracite check
    bun scripts/sync-python-version.ts check
    bun scripts/verify-offline.ts
    bun scripts/verify-package.ts
    cd sdks/python && uv sync --frozen
    cd sdks/python && uv run ruff format --check .
    cd sdks/python && uv run ruff check .
    cd sdks/python && uv run pyright
    cd sdks/python && uv run pytest
    cd sdks/python && uv run python scripts/verify-package.py

fmt:
    bunx ultracite fix
    cd sdks/python && uv run ruff check --fix .
    cd sdks/python && uv run ruff format .

mirror:
    bun scripts/mirror.ts sync

verify:
    bun scripts/verify-live.ts
