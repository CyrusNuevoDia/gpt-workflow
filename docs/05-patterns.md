# Orchestration patterns

Workflows earn their cost when the *structure* of the work — not just the work
— is designed. These are the proven shapes. They compose freely, and none of
them is mandatory: invent new harnesses (tournament brackets, staged
escalation, self-repair loops) when the task calls for it.

A miniature composition of several of these runs live in this repo:
`parity-11-patterns` (finder → dedup-vs-seen → 3-lens adversarial verify →
majority vote), at ≤5 agents.

## Pipeline by default

The canonical multi-stage shape. Each dimension's findings go to verification
the moment that dimension finishes — no waiting on the slowest reviewer.

```js
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: 'review:' + d.key, phase: 'Review', schema: FINDINGS }),
  review => parallel(review.findings.map(f => () =>
    agent('Adversarially verify: ' + f.title, { label: 'verify:' + f.file, phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, verdict: v }))
  )),
)
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict && f.verdict.isReal)
```

Reach for a barrier (`parallel` between stages) only when stage N needs
**cross-item context** from all of stage N−1 — the legitimate cases and the
smell test live in the [API reference](03-api.md#when-a-barrier-is-justified--and-when-it-isnt).
The classic legitimate barrier — dedup before expensive verification:

```js
const all = await parallel(DIMENSIONS.map(d => () => agent(d.prompt, { schema: FINDINGS })))
const deduped = dedupeByFileAndLine(all.filter(Boolean).flatMap(r => r.findings))
const verified = await parallel(deduped.map(f => () => agent(verifyPrompt(f), { schema: VERDICT })))
```

## The three loop shapes

**Loop-until-count** — accumulate to a target:

```js
const bugs = []
while (bugs.length < 10) {
  const result = await agent('Find bugs in this codebase.', { schema: BUGS })
  bugs.push(...result.bugs)
  log(bugs.length + '/10 found')
}
```

**Loop-until-budget** — scale depth to the user's `+Nk` directive. Always guard
on `budget.total`: with no target, `remaining()` is `Infinity` and the loop
runs straight into the 1000-agent cap.

```js
while (budget.total && budget.remaining() > 50000) {
  const result = await agent('Find bugs in this codebase.', { schema: BUGS })
  bugs.push(...result.bugs)
  log(bugs.length + ' found, ' + Math.round(budget.remaining() / 1000) + 'k remaining')
}
```

**Loop-until-dry** — for unknown-size discovery, keep spawning finders until K
consecutive rounds surface nothing new. Fixed counts miss the tail; dryness
detects it.

```js
const seen = new Set()
let dry = 0
while (dry < 2) {
  const found = (await parallel(FINDERS.map(f => () =>
    agent(f.prompt, { phase: 'Find', schema: BUGS })))).filter(Boolean).flatMap(r => r.bugs)
  const fresh = found.filter(b => !seen.has(key(b)))
  if (!fresh.length) { dry++; continue }
  dry = 0
  fresh.forEach(b => seen.add(key(b)))
  // ...verify fresh, keep survivors...
}
```

Convergence trap: dedup against **`seen`** (everything ever surfaced), not
against the confirmed list — otherwise judge-rejected findings reappear every
round and the loop never dries.

## Verification patterns

**Adversarial verify.** N independent skeptics per finding, each prompted to
*refute*; kill the finding if a majority succeeds. This is what stops
plausible-but-wrong findings from surviving — a verifier asked "is this right?"
agrees too easily; one asked "prove this wrong" does the work.

```js
const votes = await parallel(Array.from({ length: 3 }, (_, i) => () =>
  agent('Try to refute (skeptic #' + i + '): ' + claim + '. Default to refuted=true if uncertain.',
    { schema: VERDICT, effort: 'low' })))
const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
```

**Perspective-diverse verify.** When a finding can fail in more than one way,
give each verifier a distinct lens (correctness, security, performance,
does-it-reproduce) instead of N identical refuters — diversity catches failure
modes redundancy can't.

**Judge panel.** For wide solution spaces: generate N attempts from genuinely
different angles (MVP-first, risk-first, user-first), score with independent
judges, then synthesize from the winner while grafting the runners-up's best
ideas. Beats one-attempt-iterated when the space is wide; skip it when the
answer is basically determined.

## Coverage patterns

**Multi-modal sweep.** Parallel agents each searching a *different way* —
by container, by content, by entity, by time window. Each is blind to what the
others surface; use when no single search angle finds everything.

**Completeness critic.** A final agent whose only job is "what's missing —
a modality not run, a claim unverified, a source unread?" Its findings become
the next round's work list, not a footnote in the report.

**No silent caps.** Any bound on coverage — top-N, sampling, skip-on-error —
gets a `log()` stating what was dropped. Silent truncation reads as "covered
everything."

## Structural advice

**Scout inline, then orchestrate.** You don't need to know the shape of the
*task* before starting — only the shape of the *orchestration step*. List the
files, scope the diff, find the channels with a couple of cheap inline calls;
then fan a workflow out over the discovered work-list.

**Chain workflows across turns for multi-phase work.** Understand → design →
implement → review runs best as several single-phase workflows with the
orchestrating human/agent reading each result before shaping the next phase —
not as one mega-script that commits to phase 4 before seeing phase 1.

**Scale to the ask.** "Find any bugs" ⇒ a few finders, single-vote verify.
"Thoroughly audit this" ⇒ larger finder pool, 3–5-vote adversarial pass, a
synthesis stage. Lean thorough for research/review/audit; lean brief for quick
checks.

**Pin models per stage.** Mechanical stages (extract, reformat, echo, grep-and
-report) run on the cheapest model at `effort: 'low'`; judgment-heavy verify/
judge/synthesize stages get the stronger model. Omitting `model` inherits the
session model for *every* agent — usually the most expensive option available.

**Return machine-checkable results.** A workflow that returns
`{ passed, checks: [...] }` or `{ confirmed: [...], dropped: n }` can be
consumed by the next workflow, diffed across runs, and asserted in CI. Prose
summaries can't. (This repo's entire parity suite is this pattern.)
