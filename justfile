check:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'rm -rf .verification-artifacts' EXIT
    bunx ultracite check
    bun scripts/verify-offline.ts
    rm -rf .verification-artifacts
    bun scripts/verify-package.ts

fmt:
    bunx ultracite fix

mirror:
    bun scripts/mirror.ts sync

verify:
    bun scripts/verify-live.ts
