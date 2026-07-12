# GPT Workflow Distribution Plan

Stable goal: [`goal.md`](goal.md)

Primary verifier: `just check`

Only one phase may be in progress. Update this file after steering, material new
evidence, a failed verification, or a completed milestone.

## Phase 1: Bootstrap the executable verifier and workflow mirror

Status: complete

Implementation

- [x] Add the `check`, `verify:offline`, `verify:live`, and `verify` Bun command
  contract without hiding failed subprocesses.
- [x] Build the mechanical `.claude/workflows/` to `.codex/workflows/` mirror.
- [x] Map `haiku` to `gpt-5.6-luna`, `sonnet` to `gpt-5.6-terra`, and Claude
  workflow paths to Codex workflow paths.
- [x] Add a drift checker that discovers workflow files rather than hard-coding
  their count.
- [x] Establish ignored, secret-safe locations for verification reports and
  append-only event artifacts.

Verification

- [x] Run the R2 mirror checker against the real suite and record its discovered
  and compared totals.
- [x] Run negative controls for a missing mirror and stale Claude model.
- [x] Run `bun run check` and `git diff --check`.

Exit criteria

- [x] R1's command surface exists and fails honestly for unimplemented live
  behavior.
- [x] R2 passes, including `parity-12-resume` and all companion probes.
- [x] The next phase can run without manually editing generated workflow copies.

Evidence

- `bun run check`: exit 0; TypeScript clean; 3 tests passed, 0 failed, 11
  assertions; mirror discovered=13, target=13, compared=13, no drift.
- `bun run verify:offline`: exit 0 with the same complete mirror evidence.
- `bun run verify:live`: expected exit 1 with the explicit App Server
  not-implemented message.
- `bun run verify`: expected exit 1 only when it reaches `verify:live`.
- Forbidden-string sweep over `.codex/workflows`: no Claude model or workflow
  path matches.
- Luna/xhigh delegate session: `019f557d-9cfc-7c01-b91e-790a8441e499`;
  parent reviewed the full diff and materialized the protected mirror.

## Phase 2: Prove the deterministic workflow VM offline

Status: complete

Implementation

- [x] Parse literal `meta` without executing the workflow body.
- [x] Execute plain JavaScript with top-level await/return and the documented
  injected globals.
- [x] Implement deterministic guards and the JSON-compatible sandbox boundary.
- [x] Implement `parallel`, `pipeline`, `phase`, `log`, `args`, and offline
  budget semantics.
- [x] Preserve visible absorbed failures while failing uncaught workflow errors.

Verification

- [x] Run focused tests for every R5 condition.
- [x] Run focused tests for every R6 condition and report test counts.
- [x] Run the malformed-meta, false-suite, and 4097-item negative controls
  available offline without mutating the real fixtures. Final-only-event and
  schema-failure controls require the Phase 3/4 live result and event harness
  and remain assigned to Phase 6's complete R14 sweep.

Exit criteria

- [x] `bun run verify:offline` passes all VM and orchestration checks available
  before live agent integration.
- [x] No trusted repository workflow can access Node/Bun ambient globals
  through the documented execution path. Bun `node:vm` is not a hostile-code
  security boundary.

Evidence

- `bunx tsc --noEmit`, `bun run check`, `bun run verify:offline`, and
  `git diff --check`: exit 0.
- Full suite: 24 tests passed, 0 failed, 69 assertions (21 runtime tests and 3
  mirror tests).
- Corpus/runtime probe: all 13 mirrored workflows parsed; the zero-agent
  `parity-10-runtime-guards` suite returned `passed: true` with no absorbed
  failures.
- Adversarial controls cover computed, malformed, expression-continued,
  missing, and non-first `meta`; false suite results; non-JSON crossings;
  invalid host-call shapes; and 4,097-item `parallel`/`pipeline` inputs.
- Luna/xhigh implementation session:
  `019f5585-9906-7813-b0e5-5cfa47db672d`.
- Sol/high review session: `019f5594-eebf-7240-be31-0c281ab85ce2`. The review
  fixed expression-continuation loading, host-realm function/Promise exposure,
  mutable determinism guards, and missing host-call shape checks.

## Phase 3: Integrate Codex App Server as the agent substrate

Status: complete

Implementation

- [x] Spawn and supervise App Server over stdio.
- [x] Implement JSON-RPC initialization, request correlation, notification
  routing, timeouts, shutdown, and explicit process/protocol failure handling.
- [x] Generate or validate protocol types against the installed Codex binary.
- [x] Discover and validate Luna and Terra through `model/list` before live work.
- [x] Implement text and schema-constrained `agent()` results using authoritative
  completed items.

Verification

- [x] Repeat the persistent initialize and model-list readiness probe through
  the runtime rather than a hand-written pipe.
- [x] Run one Luna text agent and one Terra structured agent.
- [x] Prove malformed JSON-RPC, early EOF, request timeout, and model absence fail
  explicitly.

Exit criteria

- [x] R3, R4, and R8 pass on the real App Server.
- [x] Production runtime search finds no `codex exec`, SDK, or WebSocket path.

Evidence

- Installed protocol: Codex `0.144.0`; `generate-ts --experimental` produced
  671 TypeScript files; persistent stdio initialization succeeded.
- `model/list`: one complete page, `nextCursor: null`; literal
  `gpt-5.6-luna` and `gpt-5.6-terra` both discovered before live turns.
- `bun run check` and `bun run verify:offline`: exit 0; 36 tests passed, 0
  failed, 100 assertions after parent integration review; mirror 13/13.
- Focused fake-process coverage proves initialize ordering, backpressure,
  out-of-order request correlation, malformed JSON/unknown responses, EOF,
  process exit, request and turn timeouts, model pagination/absence,
  authoritative completed-item results, terminal failures, and schema rejection.
- Parent live Phase 3 command: `bun scripts/verify-live.ts --phase3`, exit 0,
  `PHASE_3_VERDICT: PASS`.
- Luna text evidence: thread `019f55b3-fe1a-7181-9276-7c61af105416`, turn
  `019f55b4-04fb-72c3-90f4-8661a3b672a6`, authoritative item
  `msg_0b3482bfce578613016a53614dd6148198aaf1d6c5f8e316df`.
- Terra structured evidence: thread `019f55b4-18b2-7670-bf38-b68473129672`,
  turn `019f55b4-1d2d-7283-9446-8a3c8eb54556`, authoritative item
  `msg_03c1820b2f021a01016a536152b148819bb0594d4e840900e8`.
- The first parent Terra probe exposed App Server's recursive
  `additionalProperties: false` requirement. The runtime now normalizes object
  schemas at the transport boundary while AJV validates results against the
  workflow-authored schema; the next Terra probe and full Phase 3 probe passed.
- Luna/xhigh implementation session: `019f559c-5d03-7350-9e07-fbf3616be763`.

## Phase 4: Stream and control live agents

Status: complete

Implementation

- [x] Normalize App Server lifecycle, delta, plan, reasoning, command, file,
  tool, collaboration, usage, and terminal events.
- [x] Attribute events to workflow run, agent, label, phase, model, thread, turn,
  and item identifiers where applicable.
- [x] Expose orchestrator-facing steering and interruption controls.
- [x] Ensure interrupting one sibling does not cancel unrelated siblings.

Verification

- [x] Capture intermediate events before completion for the R9 live probe.
- [x] Run R10's verifier-generated nonce steer while the child turn is active.
- [x] Run the two-sibling isolated-interruption probe.
- [x] Inspect ordering and attribution in the in-memory event evidence. Durable
  append-only artifacts remain assigned to Phase 5 journaling and Phase 6 reports.

Exit criteria

- [x] R9 and R10 pass with live evidence.
- [x] The runtime never relies on final-response buffering as a substitute for
  progress streaming.

Evidence

- `bun scripts/verify-live.ts --phase4`: exit 0 with
  `PHASE_4_VERDICT: PASS` after the Sol review refinements.
- R9: 38 normalized events; message delta and command/tool progress observed by
  `onAgentEvent` while the workflow promise was unresolved; ordered thread and
  turn starts preceded the authoritative message completion and terminal event.
- R9 terminal: completed Luna turn
  `019f55ce-9aa6-7250-88bd-17278d7eea75` on thread
  `019f55ce-949e-7e10-86a0-7ba68451fd8a`, with complete usage attached.
- R10 steer: App Server accepted verifier nonce
  `phase4-nonce-d5e18035-9b8d-47f8-a0e5-a273dbde83e4` for the exact active turn
  `019f55ce-bb27-72f2-9c25-b416be9fd39e`; the runtime-managed final result
  contained the nonce.
- R10 sibling probe: both runtime-managed handles were exposed; the interrupted
  sibling became a visible absorbed `parallel` failure while the other returned
  exactly `phase4-sibling-complete` on a distinct thread.
- Offline final: 40 tests passed, 0 failed, 130 assertions; TypeScript and
  `git diff --check` passed.
- Luna/xhigh implementation session: `019f55b5-5714-71d1-9047-066607059b56`.
- Sol/high review session: `019f55c7-f393-7db2-b43e-33db4707a9e5`. It found
  and drove fixes for post-completion-only inspection, incomplete pass
  predicates, direct-client control bypass, missing turn attribution on early
  events, and observer exceptions affecting sibling turns.

## Phase 5: Add composition, isolation, caps, and exact-prefix resume

Status: complete

Implementation

- [x] Implement child workflow resolution, args/result propagation, shared
  lifecycle accounting, and the one-level nesting boundary.
- [x] Implement worktree isolation and cleanup without touching the main tree.
- [x] Enforce concurrency, lifetime, nesting, and boundary caps visibly.
- [x] Implement append-only journaling with chained keys and longest-prefix
  replay.
- [x] Allow the same completed run to be resumed repeatedly.

Verification

- [x] Run all R7 composition, isolation, and cap checks.
- [x] Run `parity-12-resume` legs R1, R2, and R3 and compare A/B/C nonces,
  tokens, duration, and journal keys.
- [x] Run the negative control proving a per-`(prompt, opts)` cache fails.

Exit criteria

- [x] R7 and R11 pass.
- [x] R3's changed B invalidates C even though C's prompt and options match R1.

Evidence

- `bun scripts/verify-live.ts --phase5`: exit 0 with
  `PHASE_5_VERDICT: PASS`.
- Composition: `parity-07-composition` passed 6/6, including verbatim child
  args/result, name and path resolution, catchable unknown names, and the exact
  one-level nesting error; parent and child shared run state and agent IDs.
- Isolation: `parity-09-worktree` passed 4/4. The isolated writer ran under a
  distinct `.verification-artifacts/worktrees/...` git toplevel with a writable
  sandbox; the main checkout never saw its marker; the clean worktree was absent
  from `git worktree list` after completion.
- Resume R1 (`s1`): 3 live agents, nonces A/B/C =
  `a80de2fe5b92a134` / `a47aec9fb367d565` / `03a9caab48dfdabf`.
- Resume R2 (`s1` from R1): byte-identical result, the same three nonces,
  3 replayed agents, 0 live agents, and 0 subagent tokens.
- Resume R3 (`s2` from R1): A replayed unchanged; B and C were fresh
  (`1468ef75c74adbd8` / `5950debe177baac6`), proving the miss invalidated the
  remaining prefix. The append-only journal held five distinct chained start
  keys and supported both resumes of the completed R1 run.
- Offline final: 47 tests passed, 0 failed, 162 assertions after parent live
  fixes; TypeScript, mirror 13/13, and `git diff --check` passed.
- Luna/xhigh implementation session: `019f55d0-3da7-7381-aac5-e4c0e5027181`.

## Phase 6: Close the complete live parity sweep

Status: complete

Implementation

- [x] Run all discovered Codex workflows and every documented invocation mode.
- [x] Fix runtime defects against concrete suite or event evidence.
- [x] Produce the complete machine-readable report and secret-safe event or
  transcript artifacts.
- [x] Create the repository-root `BRIEF.html` from verified final evidence and
  logical git history.
- [x] Preserve failed-attempt evidence and exact pending/failed/skipped counts
  until they reach zero.

Verification

- [x] Run `bun run check`.
- [x] Run `bun run verify:offline` twice from fresh processes.
- [x] Run `bun run verify:live` without skipped or pending invocations.
- [x] Render `BRIEF.html` in a browser and inspect a normal desktop viewport.
- [x] Run `bun run verify` and adversarially evaluate R1 through R15.
- [x] Inspect report totals, artifacts, usage, failures, and secret redaction.

Exit criteria

- [x] R1 through R15 all pass.
- [x] Every discovered workflow and required invocation completed successfully.
- [x] `VERIFY.md` ends in `VERDICT: PASS` with current evidence.

## Current evidence

- Readiness: Bun `1.3.14`; Codex CLI `0.144.0`; ChatGPT authentication active.
- App Server stdio `initialize` returned successfully.
- Experimental protocol generation produced 671 TypeScript files in a
  temporary directory.
- Persistent `model/list` returned both `gpt-5.6-luna` and
  `gpt-5.6-terra`, with `nextCursor: null`.
- Phases 1-4 are complete: the 13-file mirror, deterministic Bun VM, persistent
  App Server client, authoritative results, real-time normalized progress, and
  runtime-managed steering/interruption all have offline and live proof.
- Final run:
  `.verification-artifacts/phase6-20260712111549-4608b91a-8a59-4869-a506-d248fc5e2550/report.json`.
- Required conditions: R1-R15 passed; final report verdict `PASS`; secret scan
  passed with zero redactions.
- Matrix: 13 discovered workflows, 16 required/completed/passed invocations,
  zero failed, pending, skipped, or interrupted invocations, and 2 documented
  absorbed fan-out failures.
- Model usage across the whole verifier: Luna 35 logical calls (31 live, 4
  replayed), Terra 1 logical/live call, and 1,129,489 subagent tokens.
- Resume: R2 replayed all three calls byte-identically with zero live calls and
  zero subagent tokens; R3 replayed A and refreshed B/C after the prefix miss.
- Browser proof: 1440x900 local render, final full-page screenshot
  `brief-desktop-final-pass.png`, exact report/brief hashes in
  `browser-proof.json`, and no overlap or horizontal clipping.
- Stable command contract: `bun run check`, `bun run verify:offline`,
  `bun run verify:live`, and `bun run verify` all exited zero; offline totals
  were 57 tests passed, 0 failed, and 203 assertions.

## Phase 7: Define the installable library boundary

Status: complete

Implementation

- [x] Add a narrow public entrypoint for workflow execution and App Server
  control without exporting verification, journal, worktree, or scheduler
  internals unnecessarily.
- [x] Make the single root `tsconfig.json` cover `src/**/*.ts` and
  `tests/**/*.ts` plus imported repository scripts, while package metadata
  allowlists only the public runtime output. The verified six-file enumeration
  was invalidated by user steering.
- [x] Replace the private/nonexistent-entrypoint manifest with deliberate
  version, description, export, runtime dependency, engine, and package-file
  metadata. Repository metadata remains coupled to Phase 8's remote creation or
  discovery because the proposed GitHub coordinate does not exist.
- [x] Make the committed composition fixtures repository-portable and preserve
  the mechanical Claude-to-Codex mirror.

Verification

- [x] Re-run the production build and import the built entrypoint under Node
  after collapsing to one TypeScript config.
- [x] Run `bun run check`, `bun run verify:offline`, the mirror checker, and
  `git diff --check`.
- [x] Observable pass: build output and declarations resolve without source-only
  imports, all offline runtime behavior remains green, and fixture search finds
  no checkout-specific absolute paths.

Exit criteria

- [x] The repository has one intentional library entrypoint and a reproducible
  production build ready for packaging.

## Phase 8: Prove tarball and GitHub installation

Status: complete

Implementation

- [x] Add a repository-owned `verify:package` command that builds, inspects the
  complete npm pack list, creates the tarball outside the repository, installs
  it into a temporary consumer, and runs the public Node smoke.
- [x] Keep all generated package/install artifacts outside the repository or
  remove them reliably after failure and success.
- [ ] Exercise the same smoke through an immutable GitHub dependency once a
  remote URL is available.

Verification

- [x] Run `npm pack --dry-run --json` and review every returned path.
- [x] Run `bun run verify:package` from the repository root and from a clean
  checkout-equivalent state.
- [x] Observable pass: only deliberate package files are present, the clean
  consumer imports by package name, and offline workflow execution returns the
  expected result under Node.

Exit criteria

- [x] Local tarball installation is proven and GitHub installation is proven or
  isolated as the sole true external blocker.

## Phase 9: Replace development-era repository surfaces

Status: complete

Implementation

- [x] Rewrite `README.md` and affected docs around the implemented installable
  library, its requirements, public API, limitations, and install paths.
- [x] Remove root `GOAL.md`, `VERIFY.md`, and `PARITY.md`, relocating only
  lasting user or maintainer knowledge into public docs, tests, or commands.
- [x] Confirm `.verification-artifacts/`, build output, tarballs, temporary
  consumers, and other generated evidence are absent and ignored or excluded.

Verification

- [x] Sweep all tracked files and packed paths for stale root-doc links,
  spec-only claims, checkout-specific paths, and verification debris.
- [x] Run `bun run check`, `bun run verify:offline`, `bun run verify:package`,
  `git diff --check`, and inspect the full filesystem plus git status.
- [x] Obtain a fresh Sol/high review of the public package,
  documentation, and install proof.

Exit criteria

- [x] The repository reads as the product, the npm tarball contains only the
  product, and every local completion-proof item in `goal.md` is satisfied;
  immutable GitHub installation remains the recorded external edge.

## Current evidence

- Prior runtime phases 1-6 remain complete; their detailed offline/live proof
  above is preserved as the regression baseline.
- The initial `npm pack --dry-run --json` failure
  (`Invalid package, must have name and version`) is resolved.
- Terra/high packaging audit session:
  `019f577c-2b72-7e13-ad0c-8f269812dccc`.
- Luna/xhigh hygiene audit session:
  `019f577c-2a71-7c00-b076-3cb0b7a8bcd7` (interrupted after it identified the
  stale public docs, tracked private goal history, and absolute fixture paths).
- `.verification-artifacts/` is currently absent and ignored.
- Phase 7 parent verification: `bun run build`, the Node import/execution smoke,
  `bun run check`, `bun run verify:offline`, `bun run mirror:check`, and
  `git diff --check` all passed. Offline totals are 57 tests, 0 failures, and
  197 expectations; mirror totals are 13 discovered/target/compared with no
  drift.
- Phase 7 Terra/high implementation session:
  `019f5782-bfeb-7ac0-b6f7-baf2d5eed3a6`.
- `gh repo view CyrusNuevoDia/gpt-workflow` reports that the repository cannot
  be resolved, and Git has no configured remote. Immutable GitHub-install proof
  is therefore not yet available.
- Parent cleanup removed `dist/`, `.verification-artifacts/`, build info, and
  tarballs after verification.
- User steering invalidated the separate `tsconfig.build.json` approach. Phase
  7 is reopened until the same build/import/check evidence passes using only
  root `tsconfig.json`; the Phase 8 verifier delegate was interrupted before it
  edited any files.
- Single-config correction verified: `bun run build`, the Node import/execution
  smoke, `bun run check`, `bun run verify:offline`, and `git diff --check` all
  passed using only root `tsconfig.json`; totals remain 57 tests, 0 failures,
  and 197 expectations. Generated output was removed afterward.
- User steering then replaced the six-file root project with a broader desired
  TypeScript project covering all source and tests. Phase 7 is reopened until
  that broader build passes and the package allowlist still excludes verifier,
  test, and script output.
- Broad-project correction verified: root `tsconfig.json` now includes all
  `scripts/**/*.ts`, `src/**/*.ts`, and `tests/**/*.ts`; local module specifiers
  are Node-compatible; `bunfig.toml` keeps generated `dist/tests` out of Bun
  discovery; package metadata allowlists only the 12 public runtime JS and
  declaration files under `dist/src`. Build, Node import/execution, check,
  offline verification, mirror, and diff checks all pass with 57 tests and 197
  expectations. Generated output was removed afterward.
- Phase 8 Sol/high rewrite session:
  `019f579d-dea8-73b0-ac40-0cc5f2879a91`. It replaced an interrupted
  893-line verifier with a direct 335-line implementation.
- Parent ran `bun run verify:package` twice. Both runs returned the complete
  14-path pack surface (README, package metadata, and 12 allowlisted runtime
  outputs), installed the actual `gpt-workflow-0.1.0.tgz` into a fresh npm
  consumer, passed exact public-export/parse/offline-execution Node smokes, and
  removed dist, build info, tarballs, temp consumers, caches, and artifacts.
- Immutable GitHub install remains explicitly not proven: no remote is
  configured and `CyrusNuevoDia/gpt-workflow` does not currently resolve.
- Phase 9 rewrote the README and getting-started path around the exported
  `AppServerClient` and `runWorkflowScript` lifecycle, removed the three root
  development documents, and cleared all public stale-link and machine-path
  searches.
- The first strict TypeScript consumer smoke caught missing Node ambient types.
  `@types/node` is now an explicit package dependency, and the installed
  tarball passes both its Node runtime smoke and a strict NodeNext typecheck.
- Final local verification: 57 tests passed with 197 expectations; mirror
  discovered/target/compared 13/13/13; offline verification passed; package
  verification passed with the exact 14-path surface and removed all generated
  output.
- Final GPT-5.6 Sol/high review session:
  `019f57aa-d43d-7ba3-8ff9-c59d54142bed`. Verdict: no local findings; only the
  absent remote, absent license, and unexercised registry publication remain.

## Next action

The distribution goal is achieved. Choosing a license remains a separate user
decision.

## Phase 10: Add the streaming workflow CLI

Status: complete

Implementation

- [x] Add `src/cli.ts` with the single command
  `gpt-workflow run <script.js>` using Bun argv/file APIs and `parseArgs`.
- [x] Stream ordered, self-contained NDJSON records for run start, workflow
  events, App Server agent events, completion, and failure; reserve stderr for
  human diagnostics.
- [x] Add the package `bin` contract and include only the built executable in
  the tarball alongside the existing library files.
- [x] Move deterministic checks and mirror operations into `justfile`, name the
  explicit live suite `just verify`, and leave only build/prepare lifecycle
  scripts in `package.json`.
- [x] Update `README.md` with CLI installation, execution, NDJSON, journal, and
  `jq` examples.

Verification

- [x] Test parsing, help/errors, ordering, workflow/agent forwarding, terminal
  records, and nonzero failures without live model calls.
- [x] Extend `verify:package` to execute the installed bin from the clean
  consumer in addition to the library runtime and type smokes.
- [x] Run `just check`, `git diff --check`, and the debris sweep. Keep the
  token-spending `just verify` out of the deterministic regression loop unless
  CLI/runtime changes invalidate prior live proof.

Exit criteria

- [x] A caller can install the tarball, invoke
  `gpt-workflow run path/to/script.js`, consume every stdout line as JSON, and
  locate the durable journal from the terminal record.

Evidence

- `just check`: exit 0; Ultracite clean; offline verifier 61 tests passed, 0
  failed, 217 expectations; exact mirror 13/13; package verifier passed.
- Packed surface: 15 complete paths—README, package metadata, 12 library JS/d.ts
  files, and `dist/src/cli.js`. The clean consumer passed the Node runtime,
  strict NodeNext type, installed-bin NDJSON, and durable-journal smokes.
- Live CLI smoke: one Luna call returned exactly `cli-live-ok`; stdout contained
  22 individually parseable records with contiguous sequences 0-21 and one
  run ID; the terminal record contained the result, journal path, and usage.
- The CLI starts App Server lazily on the first `agent()` call, so zero-agent
  workflows and the installed package smoke do not require Codex or spend
  tokens.
- `package.json` now contains only `build` and `prepare`; `just check` owns the
  deterministic aggregate, `just mirror` owns fixture generation, and
  `just verify` owns the explicit live suite.
- Final GPT-5.6 Sol/high CLI review session:
  `019f57c3-3c83-7040-9eeb-6de8a8c21091`. Verdict: no findings. Residual risks
  are external live-service availability and unexercised malformed-input,
  abrupt-termination, and high-concurrency edges.

## Phase 11: Publish GitHub and npm release surfaces

Status: complete

Implementation

- [x] Add canonical repository metadata and Node 24/Bun CI.
- [x] Commit the complete local distribution work in logical slices, create the
  public `CyrusNuevoDia/gpt-workflow` repository, and push `main`.
- [x] Publish the unclaimed `gpt-workflow` package, configure npm trusted
  publishing for `.github/workflows/release-cli.yml`, and add the adapted
  Changesets release workflow from `capn-hook`.

Verification

- [x] Require `just check` locally and green GitHub CI on the pushed commit.
- [x] Install the immutable GitHub commit into a clean consumer and run the
  package/CLI smoke.
- [x] Verify npm registry metadata, install `gpt-workflow@0.1.0` into a clean
  consumer, and run the public library and CLI smokes.

Exit criteria

- [x] The public GitHub repository, immutable Git install, npm package, trusted
  publisher, and future release workflow are all proven from live state.

Evidence

- Public repository: `https://github.com/CyrusNuevoDia/gpt-workflow`; visibility
  `PUBLIC`; default branch `main`.
- Product, goal-state, CI, shell-portability, trusted-release, and npm-wrapper
  fixes landed as separate commits. Every push was preceded by an
  `origin/main` fast-forward pull once the remote existed.
- Immutable Git install at
  `288e94b8bb9b371a913e4a3d9f98d42f7ab8372c` passed the public Node import and
  installed `gpt-workflow` CLI NDJSON/journal smokes.
- `gpt-workflow@0.1.0` published publicly with `latest=0.1.0`, 15 packed files,
  `bin.gpt-workflow=dist/src/cli.js`, Node `>=24`, shasum
  `5b13accae6035b9d9e8681bab2847810d025e3b8`, and repository metadata pointing
  at the public GitHub repository.
- A clean registry consumer installed `gpt-workflow@0.1.0`, imported the public
  library, found an executable bin link, and completed the CLI NDJSON/journal
  smoke.
- npm trusted publishing configuration `ed3c953e-406f-446c-8e09-0ff168d2efbe`
  grants publish permission only to
  `CyrusNuevoDia/gpt-workflow:.github/workflows/release-cli.yml`.
- GitHub CI run `29209366279` and release run `29209366294` both passed on
  `c0a014f9d431ca25cd9d1ce428b08f5e267f882d`; the release correctly skipped the
  already-published `0.1.0` rather than duplicating it.
- No SPDX license was selected or claimed; that legal choice remains with the
  user and does not weaken the verified technical install/publish surface.
