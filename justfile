check:
    bunx ultracite check
    bun scripts/verify-offline.ts
    bun scripts/verify-package.ts

fmt:
    bunx ultracite fix

mirror:
    bun scripts/mirror.ts sync

verify:
    bun scripts/verify-live.ts
