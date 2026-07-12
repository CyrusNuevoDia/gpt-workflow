import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  buildInvocationMatrix,
  makeInvocationRecord,
  scanForSecrets,
  sha256File,
  VerificationArtifactWriter,
  validateBrowserProof,
  validateInvocationMatrix,
  validateResumeProtocol,
  validateStreamingEvidence,
  validateSuiteResult
} from "../src/verification.ts"

const WORKFLOWS = [
  "parity-01-core.js",
  "parity-02-structured-output.js",
  "parity-03-parallel.js",
  "parity-04-pipeline.js",
  "parity-05-args.js",
  "parity-06-budget.js",
  "parity-07-composition.js",
  "parity-07b-nested-probe.js",
  "parity-08-agent-options.js",
  "parity-09-worktree.js",
  "parity-10-runtime-guards.js",
  "parity-11-patterns.js",
  "parity-12-resume.js"
]

test("builds the exact dynamic 16-invocation matrix and embeds 07b in 07", () => {
  const matrix = buildInvocationMatrix(WORKFLOWS)
  expect(matrix).toHaveLength(16)
  expect(matrix.map((entry) => entry.id)).toEqual([
    "01",
    "02",
    "03",
    "04",
    "05-omitted",
    "05-object",
    "05-json-string",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "12-R1",
    "12-R2",
    "12-R3"
  ])
  expect(matrix.find((entry) => entry.id === "07")).toMatchObject({
    embeddedFiles: ["parity-07b-nested-probe.js"]
  })
  expect(
    matrix
      .filter((entry) => entry.file === "parity-05-args.js")
      .map((entry) => entry.mode)
  ).toEqual(["omitted", "object", "json-string"])
  expect(
    matrix.filter((entry) => entry.resumeLeg).map((entry) => entry.resumeLeg)
  ).toEqual(["R1", "R2", "R3"])
})

test("derives ordinary invocation entries from discovery instead of a fixed fixture list", () => {
  const matrix = buildInvocationMatrix([...WORKFLOWS, "parity-13-future.js"])
  expect(matrix).toHaveLength(17)
  expect(matrix.at(-1)).toMatchObject({
    expectedSuite: "parity-13-future",
    file: "parity-13-future.js",
    id: "13",
    mode: "default"
  })
})

test("rejects passed:false and non-INFO failed checks even when the shape is otherwise valid", () => {
  expect(
    validateSuiteResult(
      { checks: [{ name: "real", pass: true }], passed: false, suite: "suite" },
      "suite"
    ).ok
  ).toBe(false)
  const failedCheck = validateSuiteResult(
    {
      checks: [
        { name: "real", pass: false },
        { name: "INFO observed", pass: false }
      ],
      passed: true,
      suite: "suite"
    },
    "suite"
  )
  expect(failedCheck.ok).toBe(false)
  expect(failedCheck.nonInfoFailures).toEqual(["real"])
  expect(
    validateSuiteResult({ checks: [], passed: true, suite: "other" }, "suite")
      .ok
  ).toBe(false)
})

test("rejects final-only event streams", () => {
  const finalOnly = validateStreamingEvidence([
    { lifecycle: "completed", subject: "message", type: "lifecycle" },
    { status: "completed", type: "terminal" }
  ])
  expect(finalOnly.ok).toBe(false)
  expect(finalOnly.evidence).toMatchObject({ finalOnlyStream: true })

  const complete = validateStreamingEvidence([
    { lifecycle: "started", subject: "thread", type: "lifecycle" },
    { lifecycle: "started", subject: "turn", type: "lifecycle" },
    { type: "message-delta" },
    { type: "command" },
    { lifecycle: "completed", subject: "message", type: "lifecycle" },
    { status: "completed", type: "terminal" }
  ])
  expect(complete.ok).toBe(true)
})

test("rejects a per-prompt resume cache that incorrectly reuses C after B changes", () => {
  const execution = (
    nonces: { a: string; b: string; c: string },
    usage: Record<string, unknown>
  ) => ({
    result: { nonces, passed: true, suite: "parity-12-resume" },
    usage
  })
  const r1 = execution(
    { a: "aaaaaaaaaaaaaaaa", b: "bbbbbbbbbbbbbbbb", c: "cccccccccccccccc" },
    {
      agentCount: 3,
      liveAgentCount: 3,
      replayedAgentCount: 0,
      subagentTokens: 30
    }
  )
  const r2 = execution(
    { a: "aaaaaaaaaaaaaaaa", b: "bbbbbbbbbbbbbbbb", c: "cccccccccccccccc" },
    {
      agentCount: 3,
      liveAgentCount: 0,
      replayedAgentCount: 3,
      subagentTokens: 0
    }
  )
  const badR3 = execution(
    { a: "aaaaaaaaaaaaaaaa", b: "dddddddddddddddd", c: "cccccccccccccccc" },
    {
      agentCount: 3,
      liveAgentCount: 2,
      replayedAgentCount: 1,
      subagentTokens: 20
    }
  )
  const proof = validateResumeProtocol(r1, r2, badR3, [
    "k1",
    "k2",
    "k3",
    "k4",
    "k5"
  ])
  expect(proof.ok).toBe(false)
  expect(proof.evidence).toMatchObject({ changedCIsFreshAfterMiss: false })
})

test("matrix validator catches pending, skipped, unvisited, and incomplete work", () => {
  const matrix = buildInvocationMatrix(WORKFLOWS)
  const records = matrix.map((plan) => {
    const record = makeInvocationRecord(plan)
    record.status = "passed"
    record.suite = plan.expectedSuite
    record.passed = true
    record.visitedFiles = [plan.file, ...plan.embeddedFiles]
    return record
  })
  expect(validateInvocationMatrix(records, WORKFLOWS).ok).toBe(true)

  const [pending, skipped, interrupted, unvisited, failed] = records
  if (!(pending && skipped && interrupted && unvisited && failed)) {
    throw new Error("expected the complete invocation matrix")
  }
  pending.status = "pending"
  skipped.status = "skipped"
  interrupted.status = "interrupted"
  unvisited.visitedFiles = []
  failed.passed = false
  const invalid = validateInvocationMatrix(records, WORKFLOWS)
  expect(invalid.ok).toBe(false)
  expect(invalid.pending).toEqual(["01"])
  expect(invalid.skipped).toEqual(["02"])
  expect(invalid.interrupted).toEqual(["03"])
  expect(invalid.unvisited).toContain("parity-04-pipeline.js")
  expect(invalid.incomplete).toContain("05-omitted")
})

test("artifact events use an allowlist and redact credential-shaped text", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-workflow-artifacts-"))
  try {
    const writer = new VerificationArtifactWriter("run", root)
    await writer.open()
    writer.appendEvent("workflow.agent.event", {
      delta: "Bearer sk-test-secret-value",
      method: "item/agentMessage/delta",
      protocolPayload: { authorization: "Bearer sk-test-secret-value" },
      type: "message-delta"
    })
    writer.appendEvent("unknown.raw.protocol", {
      authorization: "Bearer sk-test-secret-value"
    })
    await writer.flush()
    const events = await readFile(writer.eventsPath, "utf8")
    expect(events).toContain("[REDACTED]")
    expect(events).not.toContain("protocolPayload")
    expect(events).not.toContain("sk-test-secret-value")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("secret scanner recognizes major credential families", () => {
  const samples = [
    "ghp_abcdefghijklmnopqrstuvwxyz",
    "github_pat_abcdefghijklmnopqrstuvwxyz012345",
    "AKIAABCDEFGHIJKLMNOP",
    "eyJabcdefghijk.abcdefghijk.abcdefghijk",
    "-----BEGIN PRIVATE KEY-----",
    "cookie=session-value"
  ]
  for (const sample of samples) {
    expect(scanForSecrets(sample)).not.toEqual([])
  }
})

test("browser-proof hash binds R15 to the exact report", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-workflow-browser-proof-"))
  const runId = "phase6-proof"
  const artifactDirectory = join(root, ".verification-artifacts", runId)
  const reportPath = join(artifactDirectory, "report.json")
  const proofPath = join(root, "browser-proof.json")
  try {
    await mkdir(artifactDirectory, { recursive: true })
    await writeFile(reportPath, '{"verifierRunId":"phase6-proof"}\n')
    const proof = {
      checkedAt: "2026-07-12T00:00:00.000Z",
      claims: ["report facts match"],
      reportPath: resolve(reportPath),
      reportSha256: await sha256File(reportPath),
      schemaVersion: 1,
      type: "gpt-workflow-browser-proof",
      verdict: "PASS",
      verifierRunId: runId,
      viewport: { height: 900, width: 1440 }
    }
    await writeFile(proofPath, JSON.stringify(proof))
    await expect(validateBrowserProof(proofPath, root)).resolves.toMatchObject({
      ok: true,
      proof
    })
    await writeFile(reportPath, "changed")
    await expect(validateBrowserProof(proofPath, root)).resolves.toMatchObject({
      ok: false
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
