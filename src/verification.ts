import { createHash, randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { workflowRunDirectory } from "./workflow-storage.js"

export type VerificationStatus =
  | "passed"
  | "failed"
  | "pending"
  | "skipped"
  | "interrupted"

export type VerificationJSON =
  | string
  | number
  | boolean
  | null
  | VerificationJSON[]
  | { [key: string]: VerificationJSON }

export type VerificationCondition = {
  durationMs?: number
  endedAt?: string
  evidence: VerificationJSON
  id: string
  startedAt?: string
  status: VerificationStatus
}

export type SuiteCheck = {
  detail?: unknown
  name: string
  pass: boolean
}

export type SuiteResult = {
  checks: SuiteCheck[]
  passed: boolean
  suite: string
  [key: string]: unknown
}

export type SuiteValidation = {
  nonInfoChecks: number
  nonInfoFailures: string[]
  ok: boolean
  passed: boolean | null
  reason: string | null
  suite: string | null
}

export type StreamingValidation = {
  evidence: VerificationJSON
  ok: boolean
  reason: string | null
}

export type MatrixValidation = {
  incomplete: string[]
  interrupted: string[]
  ok: boolean
  pending: string[]
  reason: string | null
  skipped: string[]
  unvisited: string[]
}

export type WorkflowInvocationPlan = {
  args?: VerificationJSON
  embeddedFiles: string[]
  expectedSuite: string
  file: string
  id: string
  mode:
    | "default"
    | "omitted"
    | "object"
    | "json-string"
    | "resume-r1"
    | "resume-r2"
    | "resume-r3"
  required: true
  resumeLeg?: "R1" | "R2" | "R3"
}

export interface WorkflowInvocationRecord extends WorkflowInvocationPlan {
  checks: {
    total: number
    nonInfo: number
    nonInfoFailures: string[]
  }
  durationMs: number
  error: string | null
  eventCount: number
  failures: VerificationJSON
  journalPath: string | null
  passed: boolean | null
  result: VerificationJSON | null
  runId: string | null
  status: VerificationStatus
  suite: string | null
  usage: VerificationJSON
  visitedFiles: string[]
}

export type VerificationTotals = {
  absorbedAgentFailures: number
  completedInvocations: number
  discoveredWorkflows: number
  embeddedVisitedWorkflows: number
  failedInvocations: number
  interruptedInvocations: number
  luna: VerificationModelTotals
  otherModels: VerificationModelTotals
  passedInvocations: number
  pendingInvocations: number
  requiredInvocations: number
  skippedInvocations: number
  terra: VerificationModelTotals
}

export type VerificationModelTotals = {
  liveCalls: number
  logicalCalls: number
  replayedCalls: number
  subagentTokens: number
}

export type BrowserProof = {
  checkedAt: string
  claims: string[]
  reportPath: string
  reportSha256: string
  schemaVersion: 1
  type: "gpt-workflow-browser-proof"
  verdict: "PASS"
  verifierRunId: string
  viewport: { width: number; height: number }
}

export type VerificationReport = {
  artifacts: {
    reportPath: string
    eventsPath: string
    browserProofPath: string | null
  }
  commands: string[]
  commit: Record<string, VerificationJSON>
  conditions: VerificationCondition[]
  finalization: VerificationJSON | null
  invocations: WorkflowInvocationRecord[]
  limitations: string[]
  modelDiscovery: VerificationJSON
  niceToHave: VerificationCondition[]
  offlineTests: {
    passed: number
    failed: number
    assertions: number
    files: number | null
  }
  outer: {
    startedAt: string
    endedAt: string | null
    durationMs: number | null
  }
  phase: "fresh" | "finalized"
  schemaVersion: 1
  security: {
    secretScanPassed: boolean
    redactions: number
    eventAllowlist: string[]
  }
  totals: VerificationTotals
  verdict: "PASS" | "FAIL"
  verifier: "phase-6"
  verifierRunId: string
  versions: Record<string, VerificationJSON>
}

const SENSITIVE_KEY =
  /(?:authorization|api[-_]?key|access[-_]?token|cookie|password|secret|environment|credential)/i
const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|rk)-[a-z0-9_-]{12,}\b/gi,
  /\bghp_[a-z0-9_]{12,}\b/gi,
  /\bgithub_pat_[a-z0-9_]{12,}\b/gi,
  /\bxox[baprs]-[a-z0-9_-]{12,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi,
  /(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]\s*["']?[^\s,"'}]+/gi,
  /(?:OPENAI|ANTHROPIC|CODEX)_[A-Z0-9_]*KEY\s*=\s*[^\s]+/g
]
const BEARER_PREFIX = /^bearer\s/i
const SENSITIVE_EXACT_KEY = /^(?:token|env)$/i
const SECRET_KEY_PREFIX = /^(.*?[:=]\s*)["']?/i
const JAVASCRIPT_EXTENSION = /\.js$/
const PARITY_ID = /^parity-(\d+[a-z]?)-/

const EVENT_FIELDS: Record<string, readonly string[]> = {
  "verification.condition": ["condition", "status", "evidence"],
  "verification.finalized": [
    "verifierRunId",
    "reportPath",
    "browserProofPath",
    "status"
  ],
  "verification.invocation.finished": [
    "invocationId",
    "status",
    "suite",
    "passed",
    "durationMs",
    "usage",
    "error"
  ],
  "verification.invocation.started": ["invocationId", "file", "mode", "runId"],
  "verification.started": ["verifierRunId", "phase"],
  "workflow.agent.event": [
    "type",
    "sequence",
    "timestamp",
    "workflowRunId",
    "agentId",
    "label",
    "phase",
    "requestedModel",
    "resolvedModel",
    "threadId",
    "turnId",
    "itemId",
    "method",
    "lifecycle",
    "subject",
    "status",
    "delta",
    "reasoningKind",
    "commandKind",
    "toolKind",
    "message",
    "error",
    "willRetry",
    "usage"
  ]
}

let redactionCount = 0

export function redactText(value: string): string {
  let result = value
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      redactionCount += 1
      if (BEARER_PREFIX.test(match)) {
        return "Bearer [REDACTED]"
      }
      const keyMatch = SECRET_KEY_PREFIX.exec(match)
      return keyMatch ? `${keyMatch[1]}[REDACTED]` : "[REDACTED]"
    })
  }
  return result.length > 4096 ? `${result.slice(0, 4096)}…[TRUNCATED]` : result
}

export function sanitizeVerificationValue(
  value: unknown,
  key = ""
): VerificationJSON {
  if (
    key !== "secretScanPassed" &&
    (SENSITIVE_KEY.test(key) || SENSITIVE_EXACT_KEY.test(key))
  ) {
    redactionCount += 1
    return "[REDACTED]"
  }
  if (value === null) {
    return null
  }
  if (typeof value === "string") {
    return redactText(value)
  }
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeVerificationValue(entry))
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeVerificationValue(child, childKey)
      ])
    )
  }
  return redactText(String(value))
}

export function resetRedactionCount(): void {
  redactionCount = 0
}

export function getRedactionCount(): number {
  return redactionCount
}

export function scanForSecrets(value: string): string[] {
  const findings: string[] = []
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(value)) {
      findings.push(pattern.source)
    }
  }
  return findings
}

export function validateSuiteResult(
  value: unknown,
  expectedSuite: string
): SuiteValidation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      nonInfoChecks: 0,
      nonInfoFailures: [],
      ok: false,
      passed: null,
      reason: "suite result is not an object",
      suite: null
    }
  }
  const result = value as Record<string, unknown>
  const suite = typeof result.suite === "string" ? result.suite : null
  const passed = typeof result.passed === "boolean" ? result.passed : null
  if (suite !== expectedSuite) {
    return {
      nonInfoChecks: 0,
      nonInfoFailures: [],
      ok: false,
      passed,
      reason: `suite name ${JSON.stringify(suite)} did not match ${JSON.stringify(expectedSuite)}`,
      suite
    }
  }
  if (passed !== true) {
    return {
      nonInfoChecks: 0,
      nonInfoFailures: [],
      ok: false,
      passed,
      reason: "suite returned passed:false or omitted passed",
      suite
    }
  }
  if (!Array.isArray(result.checks)) {
    return {
      nonInfoChecks: 0,
      nonInfoFailures: [],
      ok: false,
      passed,
      reason: "suite checks is not an array",
      suite
    }
  }
  const nonInfoFailures: string[] = []
  let nonInfoChecks = 0
  for (const rawCheck of result.checks) {
    if (
      rawCheck === null ||
      typeof rawCheck !== "object" ||
      Array.isArray(rawCheck)
    ) {
      nonInfoChecks += 1
      nonInfoFailures.push("malformed check")
      continue
    }
    const check = rawCheck as Record<string, unknown>
    const name = typeof check.name === "string" ? check.name : "unnamed check"
    const isInfo = name.startsWith("INFO")
    if (!isInfo) {
      nonInfoChecks += 1
      if (check.pass !== true) {
        nonInfoFailures.push(name)
      }
    }
  }
  return {
    nonInfoChecks,
    nonInfoFailures,
    ok: passed === true && nonInfoFailures.length === 0,
    passed,
    reason:
      nonInfoFailures.length === 0
        ? null
        : `non-INFO checks failed: ${nonInfoFailures.join(", ")}`,
    suite
  }
}

export function validateStreamingEvidence(
  events: readonly Record<string, unknown>[]
): StreamingValidation {
  const hasMessageDelta = events.some((event) => event.type === "message-delta")
  const hasIntermediate = events.some((event) =>
    ["plan", "reasoning", "command", "file", "tool", "collaboration"].includes(
      String(event.type)
    )
  )
  const terminalIndex = events.findIndex((event) => event.type === "terminal")
  const messageIndex = events.findIndex(
    (event) => event.type === "message-delta"
  )
  const intermediateIndex = events.findIndex((event) =>
    ["plan", "reasoning", "command", "file", "tool", "collaboration"].includes(
      String(event.type)
    )
  )
  const evidence = sanitizeVerificationValue({
    finalOnlyStream: !(hasMessageDelta && hasIntermediate),
    hasIntermediate,
    hasMessageDelta,
    hasTerminal: terminalIndex >= 0,
    intermediateBeforeTerminal:
      intermediateIndex >= 0 && terminalIndex > intermediateIndex,
    messageBeforeTerminal: messageIndex >= 0 && terminalIndex > messageIndex
  })
  const values = evidence as Record<string, VerificationJSON>
  const ok =
    values.hasMessageDelta === true &&
    values.hasIntermediate === true &&
    values.messageBeforeTerminal === true &&
    values.intermediateBeforeTerminal === true &&
    values.hasTerminal === true
  return {
    evidence,
    ok,
    reason: ok
      ? null
      : "event stream did not contain attributable intermediate progress before terminal completion"
  }
}

export function validateInvocationMatrix(
  records: readonly WorkflowInvocationRecord[],
  discoveredFiles: readonly string[]
): MatrixValidation {
  const expected = buildInvocationMatrix([...discoveredFiles])
  const pending = records
    .filter((record) => record.status === "pending")
    .map((record) => record.id)
  const skipped = records
    .filter((record) => record.status === "skipped")
    .map((record) => record.id)
  const interrupted = records
    .filter((record) => record.status === "interrupted")
    .map((record) => record.id)
  const visited = new Set(records.flatMap((record) => record.visitedFiles))
  const unvisited = discoveredFiles.filter((file) => !visited.has(file))
  const incomplete = expected
    .filter((planValue) => {
      const record = records.find((entry) => entry.id === planValue.id)
      return (
        record === undefined ||
        record.status !== "passed" ||
        record.suite !== planValue.expectedSuite ||
        record.passed !== true
      )
    })
    .map((planValue) => planValue.id)
  const reasons = [
    records.length === expected.length
      ? null
      : `expected ${expected.length} invocations, got ${records.length}`,
    pending.length > 0 ? `pending: ${pending.join(", ")}` : null,
    skipped.length > 0 ? `skipped: ${skipped.join(", ")}` : null,
    interrupted.length > 0 ? `interrupted: ${interrupted.join(", ")}` : null,
    unvisited.length > 0 ? `unvisited: ${unvisited.join(", ")}` : null,
    incomplete.length > 0 ? `incomplete: ${incomplete.join(", ")}` : null
  ].filter((reason): reason is string => reason !== null)
  return {
    incomplete,
    interrupted,
    ok: reasons.length === 0,
    pending,
    reason: reasons.length === 0 ? null : reasons.join("; "),
    skipped,
    unvisited
  }
}

export function validateResumeProtocol(
  r1: { result: unknown; usage: Record<string, unknown>; durationMs?: number },
  r2: { result: unknown; usage: Record<string, unknown>; durationMs?: number },
  r3: { result: unknown; usage: Record<string, unknown>; durationMs?: number },
  journalStartedKeys: string[]
): { ok: boolean; evidence: VerificationJSON; reason: string | null } {
  const resultOf = (execution: {
    result: unknown
  }): Record<string, unknown> | null => {
    if (
      execution.result === null ||
      typeof execution.result !== "object" ||
      Array.isArray(execution.result)
    ) {
      return null
    }
    return execution.result as Record<string, unknown>
  }
  const first = resultOf(r1)
  const replay = resultOf(r2)
  const changed = resultOf(r3)
  const firstNonces = nonces(first)
  const replayNonces = nonces(replay)
  const changedNonces = nonces(changed)
  const firstLive = numberValue(r1.usage.liveAgentCount)
  const replayed = numberValue(r2.usage.replayedAgentCount)
  const expectedReplayCount = numberValue(r1.usage.agentCount)
  const evidence = sanitizeVerificationValue({
    changedBIsFresh:
      changedNonces.b !== null && changedNonces.b !== firstNonces.b,
    changedCIsFreshAfterMiss:
      changedNonces.c !== null && changedNonces.c !== firstNonces.c,
    journalKeysCoverLiveCalls:
      journalStartedKeys.length ===
      firstLive + numberValue(r3.usage.liveAgentCount),
    journalKeysV3: journalStartedKeys.every((key) => key.startsWith("v3:")),
    nonces: { r1: firstNonces, r2: replayNonces, r3: changedNonces },
    replayByteIdentical: JSON.stringify(first) === JSON.stringify(replay),
    replayScaleDuration:
      typeof r1.durationMs !== "number" || typeof r2.durationMs !== "number"
        ? true
        : r2.durationMs <= Math.max(1500, r1.durationMs * 0.5),
    replayUsesNoLiveAgents:
      numberValue(r2.usage.liveAgentCount) === 0 &&
      numberValue(r2.usage.subagentTokens) === 0 &&
      replayed === expectedReplayCount,
    suitesPassed:
      first?.suite === "parity-12-resume" &&
      first.passed === true &&
      replay?.suite === "parity-12-resume" &&
      replay.passed === true &&
      changed?.suite === "parity-12-resume" &&
      changed.passed === true,
    unchangedAReplayed:
      changedNonces.a !== null && changedNonces.a === firstNonces.a
  })
  const checks = evidence as Record<string, VerificationJSON>
  const ok = Object.entries(checks).every(
    ([key, value]) => key === "nonces" || value === true
  )
  return {
    evidence,
    ok,
    reason: ok ? null : "resume protocol did not prove exact-prefix memoization"
  }
}

function nonces(result: Record<string, unknown> | null): {
  a: string | null
  b: string | null
  c: string | null
} {
  const raw = result?.nonces
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { a: null, b: null, c: null }
  }
  const record = raw as Record<string, unknown>
  return {
    a: typeof record.a === "string" ? record.a : null,
    b: typeof record.b === "string" ? record.b : null,
    c: typeof record.c === "string" ? record.c : null
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function buildInvocationMatrix(
  workflowFiles: string[]
): WorkflowInvocationPlan[] {
  return [...workflowFiles].sort().flatMap((file) => {
    const suite = file.replace(JAVASCRIPT_EXTENSION, "")
    const id = PARITY_ID.exec(file)?.[1] ?? file
    if (file === "parity-07b-nested-probe.js") {
      return []
    }
    if (file === "parity-05-args.js") {
      return [
        plan("05-omitted", file, suite, "omitted"),
        plan("05-object", file, suite, "object", {
          count: 2,
          list: ["a", "b"],
          topic: "phase-6"
        }),
        plan(
          "05-json-string",
          file,
          suite,
          "json-string",
          JSON.stringify({ count: 1, list: [], topic: "phase-6-string" })
        )
      ]
    }
    if (file === "parity-12-resume.js") {
      return [
        plan(
          "12-R1",
          file,
          suite,
          "resume-r1",
          { salt: "s1" },
          undefined,
          "R1"
        ),
        plan(
          "12-R2",
          file,
          suite,
          "resume-r2",
          { salt: "s1" },
          undefined,
          "R2"
        ),
        plan("12-R3", file, suite, "resume-r3", { salt: "s2" }, undefined, "R3")
      ]
    }
    return [
      plan(
        id,
        file,
        suite,
        "default",
        undefined,
        file === "parity-07-composition.js"
          ? ["parity-07b-nested-probe.js"]
          : []
      )
    ]
  })
}

function plan(
  id: string,
  file: string,
  expectedSuite: string,
  mode: WorkflowInvocationPlan["mode"],
  args?: VerificationJSON,
  embeddedFiles: string[] = [],
  resumeLeg?: WorkflowInvocationPlan["resumeLeg"]
): WorkflowInvocationPlan {
  return {
    expectedSuite,
    file,
    id,
    mode,
    ...(args === undefined ? {} : { args }),
    ...(resumeLeg === undefined ? {} : { resumeLeg }),
    embeddedFiles,
    required: true
  }
}

export function summarizeTotals(
  workflowFiles: string[],
  invocations: WorkflowInvocationRecord[],
  auxiliaryUsage: VerificationJSON[] = []
): VerificationTotals {
  const totals = {
    absorbedAgentFailures: invocations.reduce(
      (sum, entry) =>
        sum + (Array.isArray(entry.failures) ? entry.failures.length : 0),
      0
    ),
    completedInvocations: invocations.filter(
      (entry) => entry.status === "passed" || entry.status === "failed"
    ).length,
    discoveredWorkflows: workflowFiles.length,
    embeddedVisitedWorkflows: new Set(
      invocations.flatMap((entry) => entry.visitedFiles)
    ).size,
    failedInvocations: invocations.filter((entry) => entry.status === "failed")
      .length,
    interruptedInvocations: invocations.filter(
      (entry) => entry.status === "interrupted"
    ).length,
    luna: emptyModelTotals(),
    otherModels: emptyModelTotals(),
    passedInvocations: invocations.filter((entry) => entry.status === "passed")
      .length,
    pendingInvocations: invocations.filter(
      (entry) => entry.status === "pending"
    ).length,
    requiredInvocations: invocations.filter((entry) => entry.required).length,
    skippedInvocations: invocations.filter(
      (entry) => entry.status === "skipped"
    ).length,
    terra: emptyModelTotals()
  } satisfies VerificationTotals
  for (const usage of [
    ...invocations.map((invocation) => invocation.usage),
    ...auxiliaryUsage
  ]) {
    if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
      continue
    }
    const { modelUsage } = usage
    if (
      modelUsage === null ||
      typeof modelUsage !== "object" ||
      Array.isArray(modelUsage)
    ) {
      continue
    }
    for (const [model, raw] of Object.entries(modelUsage)) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        continue
      }
      const bucket = raw as Record<string, unknown>
      let target = totals.otherModels
      if (model.includes("luna")) {
        target = totals.luna
      } else if (model.includes("terra")) {
        target = totals.terra
      }
      const liveCalls = numberValue(bucket.liveAgentCount)
      const replayedCalls = numberValue(bucket.replayedAgentCount)
      target.liveCalls += liveCalls
      target.replayedCalls += replayedCalls
      target.logicalCalls += liveCalls + replayedCalls
      target.subagentTokens += numberValue(bucket.subagentTokens)
    }
  }
  return totals
}

function emptyModelTotals(): VerificationModelTotals {
  return { liveCalls: 0, logicalCalls: 0, replayedCalls: 0, subagentTokens: 0 }
}

export function makeInvocationRecord(
  planValue: WorkflowInvocationPlan
): WorkflowInvocationRecord {
  return {
    ...planValue,
    checks: { nonInfo: 0, nonInfoFailures: [], total: 0 },
    durationMs: 0,
    error: null,
    eventCount: 0,
    failures: [],
    journalPath: null,
    passed: null,
    result: null,
    runId: null,
    status: "pending",
    suite: null,
    usage: {},
    visitedFiles: []
  }
}

export function eventAllowlist(): string[] {
  return Object.keys(EVENT_FIELDS)
}

export async function appendVerificationEvent(
  eventsPath: string,
  type: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const fields = EVENT_FIELDS[type]
  if (!fields) {
    return
  }
  let sequence = 0
  try {
    sequence = (await readFile(eventsPath, "utf8"))
      .split("\n")
      .filter(Boolean).length
  } catch {
    sequence = 0
  }
  const event = {
    at: new Date().toISOString(),
    sequence: sequence + 1,
    type,
    ...Object.fromEntries(
      fields
        .filter((field) => Object.hasOwn(payload, field))
        .map((field) => [
          field,
          sanitizeVerificationValue(payload[field], field)
        ])
    )
  }
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`)
}

export class VerificationArtifactWriter {
  readonly verifierRunId: string
  readonly directory: string
  readonly reportPath: string
  readonly eventsPath: string
  private sequence = 0
  private writeTail: Promise<void> = Promise.resolve()
  private readonly writeErrors: string[] = []

  constructor(verifierRunId: string, repository = process.cwd()) {
    this.verifierRunId = verifierRunId
    this.directory = workflowRunDirectory(
      repository,
      "verification",
      verifierRunId
    )
    this.reportPath = join(this.directory, "report.json")
    this.eventsPath = join(this.directory, "events.jsonl")
  }

  async open(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
  }

  appendEvent(type: string, payload: Record<string, unknown> = {}): void {
    const fields = EVENT_FIELDS[type]
    if (!fields) {
      return
    }
    this.sequence += 1
    const event = {
      at: new Date().toISOString(),
      sequence: this.sequence,
      type,
      ...Object.fromEntries(
        fields
          .filter((field) => Object.hasOwn(payload, field))
          .map((field) => [
            field,
            sanitizeVerificationValue(payload[field], field)
          ])
      )
    }
    this.writeTail = this.writeTail
      .then(() => appendFile(this.eventsPath, `${JSON.stringify(event)}\n`))
      .catch((error: unknown) => {
        this.writeErrors.push(
          redactText(error instanceof Error ? error.message : String(error))
        )
      })
  }

  async flush(): Promise<void> {
    await this.writeTail
  }

  async writeReport(report: VerificationReport): Promise<void> {
    await this.flush()
    const safeReport = sanitizeVerificationValue(report) as VerificationJSON
    await writeFile(this.reportPath, `${JSON.stringify(safeReport, null, 2)}\n`)
  }

  get errors(): readonly string[] {
    return this.writeErrors
  }
}

export function normalizedAgentEventPayload(
  event: Record<string, unknown>
): Record<string, unknown> {
  const allowed = EVENT_FIELDS["workflow.agent.event"] ?? []
  return Object.fromEntries(
    allowed
      .filter((field) => Object.hasOwn(event, field))
      .map((field) => [field, event[field]])
  )
}

export async function readJSONFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
}

export async function validateBrowserProof(
  proofPath: string,
  repository = process.cwd()
): Promise<{ ok: boolean; proof: BrowserProof | null; reason: string | null }> {
  try {
    const proofSource = await readFile(proofPath, "utf8")
    if (scanForSecrets(proofSource).length > 0) {
      return {
        ok: false,
        proof: null,
        reason: "browser proof contains a credential-shaped value"
      }
    }
    const proof = JSON.parse(proofSource) as BrowserProof
    if (
      proof.schemaVersion !== 1 ||
      proof.type !== "gpt-workflow-browser-proof" ||
      proof.verdict !== "PASS"
    ) {
      return {
        ok: false,
        proof: null,
        reason: "browser proof has an unsupported shape or non-PASS verdict"
      }
    }
    if (
      !Array.isArray(proof.claims) ||
      proof.claims.length === 0 ||
      proof.claims.some((claim) => typeof claim !== "string")
    ) {
      return {
        ok: false,
        proof: null,
        reason: "browser proof must list the claims inspected in the browser"
      }
    }
    if (
      !(
        Number.isSafeInteger(proof.viewport.width) &&
        Number.isSafeInteger(proof.viewport.height)
      ) ||
      proof.viewport.width < 800 ||
      proof.viewport.height < 500
    ) {
      return {
        ok: false,
        proof: null,
        reason: "browser proof viewport is below the desktop proof minimum"
      }
    }
    const reportPath = resolve(proof.reportPath)
    const verificationRunRoot = workflowRunDirectory(
      repository,
      "verification",
      proof.verifierRunId
    )
    if (!reportPath.startsWith(`${verificationRunRoot}/`)) {
      return {
        ok: false,
        proof: null,
        reason: "browser proof path does not point to this run's report"
      }
    }
    if ((await sha256File(reportPath)) !== proof.reportSha256) {
      return {
        ok: false,
        proof: null,
        reason: "browser proof hash does not match the inspected report"
      }
    }
    return { ok: true, proof, reason: null }
  } catch (error) {
    return {
      ok: false,
      proof: null,
      reason: redactText(error instanceof Error ? error.message : String(error))
    }
  }
}

export async function scanArtifactFiles(
  paths: string[]
): Promise<{ passed: boolean; findings: string[] }> {
  const findings = (
    await Promise.all(
      paths.map(async (path) => {
        try {
          return scanForSecrets(await readFile(path, "utf8"))
        } catch {
          return [`unreadable:${relative(process.cwd(), path)}`]
        }
      })
    )
  ).flat()
  return { findings: [...new Set(findings)], passed: findings.length === 0 }
}

export function newVerifierRunId(): string {
  return `phase6-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}-${randomUUID()}`
}
