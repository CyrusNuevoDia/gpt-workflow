# Python SDK execution notes

## Protected worktree state

The user already modified these files before SDK work:

- `skills/workflow/SKILL.md`
- `skills/workflow/references/workflow-language.md`

Do not edit or format them. Their initial combined binary diff SHA-256 is
`6f493a78bb17d3c94e317ca504979169631ca091c809f08b1fdf3fe05ca2b277`.

## TDD contract

Implement vertical slices. For each slice: add one public-behavior test, prove
RED, add only enough code for GREEN, rerun that focused test, and refactor only
while green. Mock only the subprocess boundary by executing controllable fake
programs; do not mock internal package modules.

Ordered behavior slices:

1. A caller sets `cwd`, runs one workflow, and receives `WorkflowResult` with a
   detailed status and run directory.
2. Omitted arguments, explicit null, and every typed CLI option are forwarded
   observably and validated before spawn.
3. `runs`, `status`, and `models` decode their public return values, including
   extras and journal-only state.
4. Pre-run failures preserve idiomatic Python errors and never invent status.
5. Each structured post-start JavaScript error maps to a rich `WorkflowError`
   subclass with required status and directory; add TypeScript names as each
   mapping demands them.
6. Ctrl-C cleans up the child and preserves metadata after `run.started`.
7. Package/version/tooling checks build wheel and sdist and prove an isolated
   no-agent installed-package run.

Do not write a horizontal batch of tests. Keep a brief RED/GREEN record below
as slices execute.

## RED/GREEN log

- RED: public package import was absent for the first successful-run test.
- GREEN: `run()` now crosses a fake `bunx` boundary and returns a typed result,
  hydrated status, and run directory.
- RED: explicit run options were discarded.
- GREEN: every supported option is validated and forwarded; explicit `None`
  becomes `--args null` while the tracer's omitted args emit no `--args`.
- RED: `models()` did not exist.
- GREEN: `models()` returns unique canonical names in CLI order.
- RED: detailed status fields were untyped dictionaries or absent.
- GREEN: detailed status, nested agent/phase/token records, and unknown fields
  decode into frozen typed values.
- RED: `runs()` did not exist.
- GREEN: `runs()` returns lightweight summaries and preserves unknown fields
  without asking for detailed status.
- RED: unset global cwd raised a generic runtime error.
- GREEN: `WorkflowDirectoryUnset` now fails before subprocess creation.
- RED: missing `bunx` leaked `FileNotFoundError` for the dependency.
- GREEN: subprocess startup failures consistently raise `BunError`.
- RED: malformed stdout leaked JSON decoder errors and no protocol type existed.
- GREEN: untrustworthy CLI output raises independent `CLIProtocolError`.
- RED: a spawned CLI that exited without NDJSON was misclassified as a Bun
  startup failure.
- GREEN: only process-start failures raise `BunError`; missing or malformed CLI
  records raise independent `CLIProtocolError` without fabricated run state.
- RED: a structured `WorkflowLoadError` had no semantic Python counterpart.
- GREEN: post-start invalid workflows hydrate status and raise
  `InvalidWorkflowError` with required run metadata.
- RED: JavaScript argument, budget, and Git failures shared ambiguous generic
  names.
- GREEN: named TypeScript errors and name-only Python mapping cover the full
  rich exception taxonomy without message matching.
- RED: post-start SIGINT surfaced as an unstructured interruption.
- GREEN: `run()` observes `run.started`, forwards SIGINT, waits boundedly for
  the child to flush, hydrates status, and raises `WorkflowInterrupted`.
- RED: no installed-artifact verifier proved version synchronization or a real
  no-agent run through the built wheel.
- RED: the first build verifier treated uv's output-directory `.gitignore` as a
  distribution artifact and correctly failed metadata validation.
- RED: the first installed run exposed a corrupted shared `bunx` cache whose
  incomplete `ajv` directory made the pinned CLI unloadable.
- RED: a fresh npm `0.3.3` install rejected redundant default-valued timeout
  flags that were added to the TypeScript CLI after that release.
- GREEN: the package verifier rejects version drift, builds and validates wheel
  plus sdist metadata, installs the wheel into an isolated Python 3.12
  environment, isolates Bun's temporary and install caches, omits redundant
  default flags while preserving explicit overrides, proves typed-package
  metadata, and runs a deterministic no-token workflow through the exact
  pinned CLI.
