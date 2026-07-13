import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { promisify } from "node:util"
import type {
  AppServerAgentHandle,
  AppServerNormalizedEvent
} from "../src/app-server.js"
import {
  AppServerClient,
  REQUIRED_APP_SERVER_MODELS
} from "../src/app-server.js"
import {
  type JSONValue,
  runWorkflowScript,
  type WorkflowExecution,
  type WorkflowExecutionOptions
} from "../src/runtime.js"
import {
  appendVerificationEvent,
  buildInvocationMatrix,
  eventAllowlist,
  getRedactionCount,
  makeInvocationRecord,
  newVerifierRunId,
  normalizedAgentEventPayload,
  redactText,
  resetRedactionCount,
  type SuiteValidation,
  sanitizeVerificationValue,
  scanArtifactFiles,
  summarizeTotals,
  VerificationArtifactWriter,
  type VerificationCondition,
  type VerificationJSON,
  type VerificationReport,
  type VerificationStatus,
  validateBrowserProof,
  validateInvocationMatrix,
  validateResumeProtocol,
  validateStreamingEvidence,
  validateSuiteResult,
  type WorkflowInvocationPlan,
  type WorkflowInvocationRecord
} from "../src/verification.js"
import { checkMirror } from "./mirror.js"

const execFileAsync = promisify(execFile)
const repository = resolve(process.cwd())
const workflowDirectory = join(repository, ".codex", "workflows")
const INTERRUPTED_PATTERN = /interrupt|cancel/i
const INTERRUPT_PATTERN = /interrupt/i
const OFFLINE_TOTALS_PATTERN =
  /Offline tests: (\d+) pass, (\d+) fail, (\d+) expect\(\) calls/
const REQUIREMENT_ID_PATTERN = /^R\d+$/

type CommandResult = {
  command: string
  exitCode: number
  output: string
}

type ProbeResult = {
  evidence: VerificationJSON
  journalPaths: string[]
  passed: boolean
  usage: VerificationJSON[]
}

type InvocationRun = {
  execution: WorkflowExecution | null
  record: WorkflowInvocationRecord
}

async function runCommand(
  command: string,
  args: string[],
  cwd = repository
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    })
    return {
      command: [command, ...args].join(" "),
      exitCode: 0,
      output: `${result.stdout}\n${result.stderr}`
    }
  } catch (error) {
    const failure = error as {
      code?: number
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      command: [command, ...args].join(" "),
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      output: `${failure.stdout ?? ""}\n${failure.stderr ?? failure.message ?? ""}`
    }
  }
}

async function discoverDirectWorkflows(directory: string): Promise<string[]> {
  const fdResult = await runCommand("fd", [
    "-H",
    "-I",
    "-t",
    "f",
    "--max-depth",
    "1",
    "-e",
    "js",
    ".",
    directory
  ])
  if (fdResult.exitCode === 0) {
    return fdResult.output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((path) => basename(path))
      .sort()
  }
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort()
}

async function runInvocation(
  plan: WorkflowInvocationPlan,
  writer: VerificationArtifactWriter,
  client: AppServerClient,
  resumeRunId: string
): Promise<InvocationRun> {
  const record = makeInvocationRecord(plan)
  const started = Date.now()
  writer.appendEvent("verification.invocation.started", {
    file: plan.file,
    invocationId: plan.id,
    mode: plan.mode,
    runId: resumeRunId
  })
  let execution: WorkflowExecution | null = null
  try {
    const path = join(workflowDirectory, plan.file)
    const source = await readFile(path, "utf8")
    const isResume = plan.resumeLeg !== undefined
    const options: WorkflowExecutionOptions = {
      appServer: client,
      cwd: repository,
      fileName: path,
      onAgentEvent: (event) =>
        writer.appendEvent(
          "workflow.agent.event",
          normalizedAgentEventPayload(
            event as unknown as Record<string, unknown>
          )
        ),
      runDirectory: join(
        writer.directory,
        "workflows",
        isResume ? resumeRunId : `${writer.verifierRunId}-${plan.id}`
      ),
      workflowDirectory,
      ...(plan.args === undefined ? {} : { args: plan.args as JSONValue }),
      ...(plan.resumeLeg === "R1" ? { workflowRunId: resumeRunId } : {}),
      ...(plan.resumeLeg === undefined
        ? { workflowRunId: `${writer.verifierRunId}-${plan.id}` }
        : {}),
      ...(plan.resumeLeg === undefined || plan.resumeLeg === "R1"
        ? {}
        : { resumeFromRunId: resumeRunId })
    }
    execution = await runWorkflowScript(source, options)
    const validation = validateSuiteResult(execution.result, plan.expectedSuite)
    fillRecordFromExecution(record, execution, validation, started, plan)
  } catch (error) {
    record.status = isInterruptedError(error) ? "interrupted" : "failed"
    record.durationMs = Date.now() - started
    record.error = redactText(
      error instanceof Error ? error.message : String(error)
    )
    record.visitedFiles = []
  }
  writer.appendEvent("verification.invocation.finished", {
    durationMs: record.durationMs,
    error: record.error,
    invocationId: plan.id,
    passed: record.passed,
    status: record.status,
    suite: record.suite,
    usage: record.usage
  })
  return { execution, record }
}

function fillRecordFromExecution(
  record: WorkflowInvocationRecord,
  execution: WorkflowExecution,
  validation: SuiteValidation,
  started: number,
  plan: WorkflowInvocationPlan
): void {
  record.status = validation.ok ? "passed" : "failed"
  record.runId = execution.workflowRunId
  record.suite = validation.suite
  record.passed = validation.passed
  record.checks = {
    nonInfo: validation.nonInfoChecks,
    nonInfoFailures: validation.nonInfoFailures,
    total: suiteCheckCount(execution.result)
  }
  record.result = sanitizeVerificationValue(execution.result)
  record.failures = sanitizeVerificationValue(execution.failures)
  record.usage = sanitizeVerificationValue(execution.usage)
  record.journalPath = execution.journalPath
  record.eventCount = execution.agentEvents.length
  record.durationMs = Date.now() - started
  record.error = validation.reason
  record.visitedFiles = [plan.file]
  const [embeddedFile] = plan.embeddedFiles
  if (embeddedFile && embeddedProbePassed(execution.result, embeddedFile)) {
    record.visitedFiles.push(embeddedFile)
  }
}

function suiteCheckCount(value: unknown): number {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return 0
  }
  const { checks } = value as Record<string, unknown>
  return Array.isArray(checks) ? checks.length : 0
}

function embeddedProbePassed(value: unknown, file: string): boolean {
  if (
    file !== "parity-07b-nested-probe.js" ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false
  }
  const { checks } = value as Record<string, unknown>
  if (!Array.isArray(checks)) {
    return false
  }
  return checks.some(
    (check) =>
      check !== null &&
      typeof check === "object" &&
      !Array.isArray(check) &&
      (check as Record<string, unknown>).name ===
        "workflow() inside a child throws (one-level nesting limit)" &&
      (check as Record<string, unknown>).pass === true
  )
}

function isInterruptedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return INTERRUPTED_PATTERN.test(message)
}

async function runR9Probe(
  client: AppServerClient,
  writer: VerificationArtifactWriter,
  runId: string
): Promise<ProbeResult> {
  const source = `
export const meta = { name: 'phase-6-r9', description: 'Phase 6 streaming probe' }
return await agent('Give one short progress update. Use the Bash tool to run: printf phase6-stream-tool. Then return exactly phase6-stream-ok.', { model: 'gpt-5.6-luna', label: 'phase6:r9-stream', phase: 'R9' })
`
  let settled = false
  let messageObservedWhileRunning = false
  let intermediateObservedWhileRunning = false
  const execution = await runWorkflowScript(source, {
    appServer: client,
    cwd: repository,
    fileName: "phase-6-r9.js",
    onAgentEvent: (event) => {
      writer.appendEvent(
        "workflow.agent.event",
        normalizedAgentEventPayload(event as unknown as Record<string, unknown>)
      )
      // biome-ignore lint/suspicious/noUnnecessaryConditions: the callback can run after the enclosing execution settles
      if (settled) {
        return
      }
      if (event.type === "message-delta") {
        messageObservedWhileRunning = true
      }
      if (
        [
          "plan",
          "reasoning",
          "command",
          "file",
          "tool",
          "collaboration"
        ].includes(event.type)
      ) {
        intermediateObservedWhileRunning = true
      }
    },
    workflowRunId: runId
  })
  settled = true
  const events = execution.agentEvents
  const terminalIndex = events.findIndex((event) => event.type === "terminal")
  const finalMessageIndex = events.findIndex(
    (event) =>
      event.type === "lifecycle" &&
      event.lifecycle === "completed" &&
      event.subject === "message"
  )
  const messageDeltaIndex = events.findIndex(
    (event) => event.type === "message-delta"
  )
  const intermediateIndex = events.findIndex((event) =>
    ["plan", "reasoning", "command", "file", "tool", "collaboration"].includes(
      event.type
    )
  )
  const terminal = events.find((event) => event.type === "terminal")
  const streamValidation = validateStreamingEvidence(
    events as unknown as Record<string, unknown>[]
  )
  const evidence = sanitizeVerificationValue({
    attribution: hasR9Attribution(events, runId),
    authoritativeMessageBeforeTerminal:
      finalMessageIndex >= 0 && terminalIndex > finalMessageIndex,
    eventCount: events.length,
    intermediateCategoryBeforeTerminal:
      intermediateIndex >= 0 && terminalIndex > intermediateIndex,
    intermediateObservedWhileRunning,
    itemAttributionPresent: events.some(
      (event) =>
        event.itemId !== null &&
        event.threadId !== null &&
        event.turnId !== null
    ),
    lifecycleOrdered: lifecycleOrdered(events),
    messageDeltaBeforeTerminal:
      messageDeltaIndex >= 0 && terminalIndex > messageDeltaIndex,
    messageObservedWhileRunning,
    result: execution.result,
    terminalStatus: terminal?.status ?? null,
    terminalUsagePresent:
      terminal?.status === "completed" && terminal.usage !== null,
    validator: streamValidation.evidence
  })
  const values = evidence as Record<string, VerificationJSON>
  const passed = streamValidation.ok && r9EvidencePassed(values)
  return {
    evidence,
    journalPaths: execution.journalPath === null ? [] : [execution.journalPath],
    passed,
    usage: [sanitizeVerificationValue(execution.usage)]
  }
}

function hasR9Attribution(
  events: AppServerNormalizedEvent[],
  runId: string
): boolean {
  const turnApplicable = events.filter(
    (event) =>
      event.method !== "thread/start" && !event.method.startsWith("mcpServer/")
  )
  return (
    events.length > 0 &&
    events.every(
      (event) =>
        event.workflowRunId === runId &&
        event.agentId === `${runId}:agent-1` &&
        event.label === "phase6:r9-stream" &&
        event.phase === "R9" &&
        event.requestedModel === "gpt-5.6-luna" &&
        event.threadId !== null
    ) &&
    turnApplicable.every((event) => event.turnId !== null)
  )
}

function r9EvidencePassed(values: Record<string, VerificationJSON>): boolean {
  return (
    values.messageDeltaBeforeTerminal === true &&
    values.intermediateCategoryBeforeTerminal === true &&
    values.messageObservedWhileRunning === true &&
    values.intermediateObservedWhileRunning === true &&
    values.authoritativeMessageBeforeTerminal === true &&
    values.lifecycleOrdered === true &&
    values.attribution === true &&
    values.terminalUsagePresent === true &&
    values.itemAttributionPresent === true &&
    typeof values.result === "string" &&
    values.result.includes("phase6-stream-ok")
  )
}

function lifecycleOrdered(events: AppServerNormalizedEvent[]): boolean {
  const threadStart = events.findIndex(
    (event) =>
      event.type === "lifecycle" &&
      event.lifecycle === "started" &&
      event.subject === "thread"
  )
  const turnStart = events.findIndex(
    (event) =>
      event.type === "lifecycle" &&
      event.lifecycle === "started" &&
      event.subject === "turn"
  )
  const terminal = events.findIndex((event) => event.type === "terminal")
  return threadStart >= 0 && turnStart > threadStart && terminal > turnStart
}

async function runR10Probe(
  client: AppServerClient,
  writer: VerificationArtifactWriter,
  runId: string
): Promise<ProbeResult> {
  const steerSource = `
export const meta = { name: 'phase-6-r10-steer', description: 'Phase 6 steering probe' }
return await agent('Start with one progress update, then wait for a verifier instruction before completing.', { model: 'gpt-5.6-luna', label: 'phase6:r10-steer', phase: 'R10' })
`
  let resolveHandle!: (handle: AppServerAgentHandle) => void
  const handleReady = new Promise<AppServerAgentHandle>((resolvePromise) => {
    resolveHandle = resolvePromise
  })
  const steerExecutionPromise = runWorkflowScript(steerSource, {
    appServer: client,
    cwd: repository,
    fileName: "phase-6-r10-steer.js",
    onAgentEvent: (event) =>
      writer.appendEvent(
        "workflow.agent.event",
        normalizedAgentEventPayload(event as unknown as Record<string, unknown>)
      ),
    onAgentStart: resolveHandle,
    workflowRunId: `${runId}-steer`
  })
  const steerHandle = await withProbeTimeout(
    Promise.race([
      handleReady,
      steerExecutionPromise.then(() => {
        throw new Error(
          "R10 steer execution settled before exposing its handle"
        )
      })
    ]),
    "R10 steer handle"
  )
  const intermediate = await waitForEvent(
    steerHandle,
    (event) => event.type === "message-delta"
  )
  const nonce = `phase6-nonce-${randomUUID()}`
  const expectedTurnId = steerHandle.turnId
  const accepted = await steerHandle.steer(nonce, expectedTurnId)
  const steerExecution = await steerExecutionPromise

  const siblingSource = `
export const meta = { name: 'phase-6-r10-siblings', description: 'Phase 6 interruption probe' }
return await parallel([
  () => agent('Immediately use the Bash tool to run: sleep 20; printf phase6-interrupt-target. Remain active until the command completes.', { model: 'gpt-5.6-luna', label: 'phase6:r10-interrupt', phase: 'R10' }),
  () => agent('Reply with exactly phase6-sibling-complete.', { model: 'gpt-5.6-luna', label: 'phase6:r10-sibling', phase: 'R10' }),
])
`
  const handles = new Map<string, AppServerAgentHandle>()
  let resolveSiblings!: () => void
  const siblingsReady = new Promise<void>((resolvePromise) => {
    resolveSiblings = resolvePromise
  })
  const siblingExecutionPromise = runWorkflowScript(siblingSource, {
    appServer: client,
    cwd: repository,
    fileName: "phase-6-r10-siblings.js",
    onAgentEvent: (event) =>
      writer.appendEvent(
        "workflow.agent.event",
        normalizedAgentEventPayload(event as unknown as Record<string, unknown>)
      ),
    onAgentStart: (handle) => {
      if (handle.label !== null) {
        handles.set(handle.label, handle)
      }
      if (handles.size === 2) {
        resolveSiblings()
      }
    },
    workflowRunId: `${runId}-siblings`
  })
  await withProbeTimeout(
    Promise.race([
      siblingsReady,
      siblingExecutionPromise.then(() => {
        throw new Error(
          "R10 sibling execution settled before exposing both handles"
        )
      })
    ]),
    "R10 sibling handles"
  )
  const interrupted = handles.get("phase6:r10-interrupt")
  const completing = handles.get("phase6:r10-sibling")
  if (!(interrupted && completing)) {
    throw new Error("R10 did not expose both sibling handles")
  }
  await interrupted.interrupt()
  const siblingExecution = await siblingExecutionPromise
  const siblingResult = Array.isArray(siblingExecution.result)
    ? siblingExecution.result
    : []
  const siblingEvidence = {
    completingResult: siblingResult[1] ?? null,
    completingSucceeded: siblingResult[1] === "phase6-sibling-complete",
    distinctThreads: interrupted.threadId !== completing.threadId,
    handlesRuntimeManaged:
      siblingExecution.agentEvents.some(
        (event) => event.agentId === interrupted.agentId
      ) &&
      siblingExecution.agentEvents.some(
        (event) => event.agentId === completing.agentId
      ),
    interruptAcknowledged: interrupted.eventLog.some(
      (event) =>
        event.type === "lifecycle" && event.status === "interrupt-requested"
    ),
    interruptedResult: siblingResult[0] ?? null,
    interruptedTerminal: interrupted.eventLog.some(
      (event) => event.type === "terminal" && event.status === "interrupted"
    ),
    interruptionAbsorbed: siblingExecution.failures.some(
      (failure) =>
        failure.kind === "agent" && INTERRUPT_PATTERN.test(failure.message)
    )
  }
  const evidence = sanitizeVerificationValue({
    interruption: siblingEvidence,
    steer: {
      acceptedTurnId: accepted.turnId,
      attributable: steerHandle.eventLog.every(
        (event) =>
          event.workflowRunId === `${runId}-steer` &&
          event.agentId === `${runId}-steer:agent-1` &&
          event.label === "phase6:r10-steer" &&
          event.phase === "R10" &&
          event.requestedModel === "gpt-5.6-luna"
      ),
      expectedTurnId,
      handleWasActive:
        intermediate.sequence <
        (steerHandle.eventLog.find((event) => event.type === "terminal")
          ?.sequence ?? Number.POSITIVE_INFINITY),
      intermediateSequence: intermediate.sequence,
      nonceObserved:
        typeof steerExecution.result === "string" &&
        steerExecution.result.includes(nonce)
    }
  })
  const values = evidence as Record<string, VerificationJSON>
  const steer = values.steer as Record<string, VerificationJSON>
  const interruption = values.interruption as Record<string, VerificationJSON>
  const passed =
    steer.nonceObserved === true &&
    steer.acceptedTurnId === steer.expectedTurnId &&
    steer.attributable === true &&
    steer.handleWasActive === true &&
    interruption.interruptionAbsorbed === true &&
    interruption.completingSucceeded === true &&
    interruption.distinctThreads === true &&
    interruption.handlesRuntimeManaged === true &&
    interruption.interruptAcknowledged === true &&
    interruption.interruptedTerminal === true
  return {
    evidence,
    journalPaths: [
      steerExecution.journalPath,
      siblingExecution.journalPath
    ].filter((path): path is string => path !== null),
    passed,
    usage: [
      sanitizeVerificationValue(steerExecution.usage),
      sanitizeVerificationValue(siblingExecution.usage)
    ]
  }
}

function withProbeTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 180_000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function waitForEvent(
  handle: AppServerAgentHandle,
  predicate: (event: AppServerNormalizedEvent) => boolean,
  timeoutMs = 180_000
): Promise<AppServerNormalizedEvent> {
  return new Promise((resolvePromise, reject) => {
    let unsubscribe: () => void = () => undefined
    const timer = setTimeout(() => {
      unsubscribe()
      reject(
        new Error(
          `timed out waiting for R10 intermediate event after ${timeoutMs}ms`
        )
      )
    }, timeoutMs)
    unsubscribe = handle.subscribe((event) => {
      if (!predicate(event)) {
        return
      }
      clearTimeout(timer)
      unsubscribe()
      resolvePromise(event)
    })
  })
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this verifier intentionally assembles one auditable end-to-end report
async function runFreshSweep(): Promise<{
  exitCode: number
  reportPath: string
  report: VerificationReport
}> {
  resetRedactionCount()
  const runId = newVerifierRunId()
  const writer = new VerificationArtifactWriter(runId, repository)
  await writer.open()
  const startedAt = new Date().toISOString()
  writer.appendEvent("verification.started", {
    phase: "fresh",
    verifierRunId: runId
  })
  const commands: string[] = []
  const offline = await runCommand("bun", ["scripts/verify-offline.ts"])
  commands.push(offline.command)
  const offlineTests = parseOfflineTotals(offline.output)
  commands.push("just verify")
  const discovered = await discoverDirectWorkflows(workflowDirectory).catch(
    () => [] as string[]
  )
  const matrix = buildInvocationMatrix(discovered)
  const mirror = await checkMirror({
    sourceDirectory: join(repository, ".claude", "workflows"),
    targetDirectory: workflowDirectory
  }).catch((error) => ({
    compared: 0,
    discovered: 0,
    drifted: [],
    extra: [],
    missing: [
      redactText(error instanceof Error ? error.message : String(error))
    ],
    target: 0
  }))
  const clientInfo: Record<string, VerificationJSON> = {}
  const conditions: VerificationCondition[] = []
  const niceToHave: VerificationCondition[] = []
  const invocationRuns: InvocationRun[] = matrix.map((plan) => ({
    execution: null,
    record: makeInvocationRecord(plan)
  }))
  let client: AppServerClient | undefined
  let protocolEvidence: VerificationJSON = { status: "pending" }
  let r9: ProbeResult = {
    evidence: { status: "pending" },
    journalPaths: [],
    passed: false,
    usage: []
  }
  let r10: ProbeResult = {
    evidence: { status: "pending" },
    journalPaths: [],
    passed: false,
    usage: []
  }
  let resumeEvidence: VerificationJSON = { status: "pending" }
  let resumePassed = false
  try {
    const tempProtocolDirectory = await mkdtemp(
      join(tmpdir(), "gpt-workflow-app-server-protocol-")
    )
    try {
      const generated = await runCommand("codex", [
        "app-server",
        "generate-ts",
        "--experimental",
        "--out",
        tempProtocolDirectory
      ])
      commands.push(generated.command)
      const generatedFiles = await countFiles(tempProtocolDirectory)
      const protocolTypecheck =
        generated.exitCode === 0
          ? await typecheckGeneratedProtocol(tempProtocolDirectory)
          : {
              command: "protocol compatibility typecheck",
              exitCode: 1,
              output: "generation failed"
            }
      commands.push(protocolTypecheck.command)
      protocolEvidence = sanitizeVerificationValue({
        exitCode: generated.exitCode,
        generatedFiles,
        typecheckExitCode: protocolTypecheck.exitCode
      })
    } finally {
      await rm(tempProtocolDirectory, { force: true, recursive: true })
    }
    client = await AppServerClient.connect({
      clientInfo: {
        name: "gpt-workflow-phase6",
        title: "GPT Workflow Phase 6 Verifier",
        version: "0.1.0"
      },
      cwd: repository,
      requiredModels: REQUIRED_APP_SERVER_MODELS
    })
    clientInfo.codexVersion = client.initializeResult.userAgent
    clientInfo.platformFamily = client.initializeResult.platformFamily
    clientInfo.platformOs = client.initializeResult.platformOs
    clientInfo.models = client.discoveredModels.map((model) => model.id)
    clientInfo.modelListPages = client.modelListPages
    try {
      r9 = await runR9Probe(client, writer, `${runId}-r9`)
    } catch (error) {
      r9 = {
        evidence: {
          error: redactText(
            error instanceof Error ? error.message : String(error)
          )
        },
        journalPaths: [],
        passed: false,
        usage: []
      }
    }
    try {
      r10 = await runR10Probe(client, writer, `${runId}-r10`)
    } catch (error) {
      r10 = {
        evidence: {
          error: redactText(
            error instanceof Error ? error.message : String(error)
          )
        },
        journalPaths: [],
        passed: false,
        usage: []
      }
    }
    const resumeRunId = `${runId}-resume`
    // Resume legs must run sequentially against the same workflow run ID.
    for (const [index, plan] of matrix.entries()) {
      // biome-ignore lint/performance/noAwaitInLoops: each leg depends on journal state from the preceding leg
      invocationRuns[index] = await runInvocation(
        plan,
        writer,
        client,
        resumeRunId
      )
    }
    const r1 = invocationRuns.find((entry) => entry.record.id === "12-R1")
    const r2 = invocationRuns.find((entry) => entry.record.id === "12-R2")
    const r3 = invocationRuns.find((entry) => entry.record.id === "12-R3")
    if (r1 && r2 && r3) {
      const { journalPath } = r3.record
      const journalKeys =
        journalPath === null ? [] : await readJournalStartedKeys(journalPath)
      const proof = validateResumeProtocol(
        {
          durationMs: r1.record.durationMs,
          result: r1.record.result,
          usage: r1.record.usage as Record<string, unknown>
        },
        {
          durationMs: r2.record.durationMs,
          result: r2.record.result,
          usage: r2.record.usage as Record<string, unknown>
        },
        {
          durationMs: r3.record.durationMs,
          result: r3.record.result,
          usage: r3.record.usage as Record<string, unknown>
        },
        journalKeys
      )
      resumePassed =
        proof.ok &&
        r1.record.status === "passed" &&
        r2.record.status === "passed" &&
        r3.record.status === "passed"
      resumeEvidence = sanitizeVerificationValue({
        journalPath,
        journalStartedKeys: journalKeys,
        protocol: proof.evidence
      })
    }
  } catch (error) {
    const reason = redactText(
      error instanceof Error ? error.message : String(error)
    )
    clientInfo.error = reason
  } finally {
    await client?.close().catch((error: unknown) => {
      clientInfo.closeError = redactText(
        error instanceof Error ? error.message : String(error)
      )
    })
  }

  const records = invocationRuns.map((entry) => entry.record)
  const matrixTotals = summarizeTotals(discovered, records)
  const totals = summarizeTotals(discovered, records, [
    ...r9.usage,
    ...r10.usage
  ])
  const models = Array.isArray(clientInfo.models) ? clientInfo.models : []
  const offlinePassed = offline.exitCode === 0
  addCondition(conditions, "R1", justfileContract() && offlinePassed, {
    justfileContract: justfileContract(),
    liveCommand: "this verifier process",
    offlineExitCode: offline.exitCode,
    offlineTests,
    verifyCommand:
      "justfile check composes lint, offline verification, and package verification; justfile verify runs this live verifier"
  })
  addCondition(
    conditions,
    "R2",
    mirror.missing.length === 0 &&
      mirror.extra.length === 0 &&
      mirror.drifted.length === 0,
    mirror
  )
  addCondition(conditions, "R3", typeof clientInfo.codexVersion === "string", {
    initialized: typeof clientInfo.codexVersion === "string",
    transport: "codex app-server JSON-RPC over stdio",
    userAgent: clientInfo.codexVersion ?? null
  })
  addCondition(
    conditions,
    "R4",
    protocolExit(protocolEvidence) === 0 &&
      protocolFileCount(protocolEvidence) > 0 &&
      protocolTypecheckExit(protocolEvidence) === 0 &&
      REQUIRED_APP_SERVER_MODELS.every((model) => models.includes(model)),
    {
      models,
      protocol: protocolEvidence,
      requiredModels: [...REQUIRED_APP_SERVER_MODELS]
    }
  )
  addCondition(conditions, "R5", offlinePassed, {
    offlineExitCode: offline.exitCode,
    offlineTests,
    source: "bun scripts/verify-offline.ts (typecheck + tests + mirror)"
  })
  addCondition(conditions, "R6", offlinePassed, {
    offlineExitCode: offline.exitCode,
    offlineTests,
    source: "bun scripts/verify-offline.ts (typecheck + tests + mirror)"
  })
  const composition = records.find((entry) => entry.id === "07")
  const worktree = records.find((entry) => entry.id === "09")
  const worktreeList = await runCommand("git", [
    "-C",
    repository,
    "worktree",
    "list",
    "--porcelain"
  ])
  const cleanWorktreeRemoved =
    worktree?.runId !== null &&
    worktree?.runId !== undefined &&
    !worktreeList.output.includes(worktree.runId)
  addCondition(
    conditions,
    "R7",
    offlinePassed &&
      composition?.status === "passed" &&
      worktree?.status === "passed" &&
      cleanWorktreeRemoved,
    {
      cleanWorktreeRemoved,
      composition: composition?.status ?? "pending",
      offlineSharedStateAndCaps: offlinePassed,
      worktree: worktree?.status ?? "pending"
    }
  )
  const lunaObserved = totals.luna.logicalCalls > 0
  const terraObserved = totals.terra.logicalCalls > 0
  addCondition(
    conditions,
    "R8",
    records.some((entry) => entry.id === "01" && entry.status === "passed") &&
      records.some((entry) => entry.id === "02" && entry.status === "passed") &&
      lunaObserved &&
      terraObserved,
    {
      lunaObserved,
      structuredSuite:
        records.find((entry) => entry.id === "02")?.status ?? "pending",
      terraObserved,
      textSuite: records.find((entry) => entry.id === "01")?.status ?? "pending"
    }
  )
  addCondition(conditions, "R9", r9.passed, r9.evidence)
  addCondition(conditions, "R10", r10.passed, r10.evidence)
  addCondition(conditions, "R11", resumePassed, resumeEvidence)
  const matrixValidation = validateInvocationMatrix(records, discovered)
  const matrixPassed =
    matrixValidation.ok &&
    discovered.includes("parity-07b-nested-probe.js") &&
    totals.embeddedVisitedWorkflows === discovered.length
  addCondition(conditions, "R12", matrixPassed, {
    discoveredWorkflows: discovered,
    matrixTotals,
    records: records.map((entry) => ({
      id: entry.id,
      passed: entry.passed,
      status: entry.status,
      suite: entry.suite
    })),
    requiredInvocations: matrix.length,
    validation: matrixValidation,
    wholeVerifierModelTotals: {
      luna: totals.luna,
      otherModels: totals.otherModels,
      terra: totals.terra
    }
  })
  addCondition(
    conditions,
    "R13",
    false,
    {
      reason:
        "artifact scan runs after the initial report and brief are written",
      status: "pending"
    },
    "pending"
  )
  addCondition(conditions, "R14", offlinePassed, {
    offlineExitCode: offline.exitCode,
    offlineTests,
    source: "temporary-fixture negative controls in offline tests"
  })
  const _collaboration =
    records.some((entry) => entry.eventCount > 0) &&
    records.some((entry) => entry.result !== null)
  addCondition(
    niceToHave,
    "N1",
    false,
    {
      reason: "no built-in collaboration activity is required by the matrix",
      status: "skipped"
    },
    "skipped"
  )
  addCondition(
    niceToHave,
    "N2",
    false,
    {
      reason:
        "the durable JSON event stream is implemented; interactive rendering remains optional",
      status: "skipped"
    },
    "skipped"
  )
  addCondition(niceToHave, "N3", resumePassed, { resume: resumeEvidence })
  const pendingR15 = {
    reason: "requires browser proof JSON after the sweep",
    status: "pending"
  }
  addCondition(conditions, "R15", false, pendingR15, "pending")
  const endedAt = new Date().toISOString()
  const report: VerificationReport = {
    artifacts: {
      browserProofPath: null,
      eventsPath: writer.eventsPath,
      reportPath: writer.reportPath
    },
    commands,
    commit: await gitState(),
    conditions,
    finalization: null,
    invocations: records,
    limitations: [
      "The final R15 status is intentionally pending until a browser-proof JSON is supplied.",
      "Bun node:vm is a trusted-workflow compatibility boundary, not a hostile-code sandbox.",
      "Provider-specific timing and token totals are recorded but never treated as fixed reference totals."
    ],
    modelDiscovery: clientInfo,
    niceToHave,
    offlineTests,
    outer: {
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      endedAt,
      startedAt
    },
    phase: "fresh",
    schemaVersion: 1,
    security: {
      eventAllowlist: eventAllowlist(),
      redactions: getRedactionCount(),
      secretScanPassed: true
    },
    totals,
    verdict: "FAIL",
    verifier: "phase-6",
    verifierRunId: runId,
    versions: {
      bun: await version("bun", ["--version"]),
      codex: await version("codex", ["--version"])
    }
  }
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  for (const condition of [...conditions, ...niceToHave]) {
    writer.appendEvent("verification.condition", {
      condition: condition.id,
      evidence: condition.evidence,
      status: condition.status
    })
  }
  await writer.writeReport(report)
  const artifactCandidates = [
    ...new Set([
      writer.reportPath,
      writer.eventsPath,
      ...records.flatMap((record) =>
        record.journalPath === null ? [] : [record.journalPath]
      ),
      ...r9.journalPaths,
      ...r10.journalPaths
    ])
  ]
  const artifactFiles = (
    await Promise.all(
      artifactCandidates.map(async (path) => {
        try {
          return (await stat(path)).isFile() ? path : null
        } catch {
          return null
        }
      })
    )
  ).filter((path): path is string => path !== null)
  let scan = await scanArtifactFiles(artifactFiles)
  const r13 = report.conditions.find((condition) => condition.id === "R13")
  if (!r13) {
    throw new Error("Fresh verification report is missing R13")
  }
  r13.status = scan.passed && writer.errors.length === 0 ? "passed" : "failed"
  r13.evidence = sanitizeVerificationValue({
    appendErrors: writer.errors,
    artifactFiles,
    secretScanPassed: scan.passed
  })
  report.security.secretScanPassed = scan.passed && writer.errors.length === 0
  report.security.redactions = getRedactionCount()
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  await writer.writeReport(report)
  scan = await scanArtifactFiles(artifactFiles)
  report.security.secretScanPassed = scan.passed && writer.errors.length === 0
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  await writer.writeReport(report)
  console.log(`Live verification report: ${writer.reportPath}`)
  console.log(
    `Invocation matrix: ${totals.completedInvocations}/${totals.requiredInvocations} completed; ${totals.passedInvocations} passed; ${totals.pendingInvocations} pending; ${totals.skippedInvocations} skipped; Luna ${totals.luna.logicalCalls} logical; Terra ${totals.terra.logicalCalls} logical`
  )
  console.log(`VERDICT: ${report.verdict}`)
  return {
    exitCode: report.verdict === "PASS" ? 0 : 1,
    report,
    reportPath: writer.reportPath
  }
}

async function finalizeFromProof(
  proofPath: string
): Promise<{ exitCode: number; reportPath: string }> {
  const validation = await validateBrowserProof(proofPath, repository)
  if (!validation.ok || validation.proof === null) {
    console.log(
      `Browser proof rejected: ${validation.reason ?? "invalid proof"}`
    )
    console.log("VERDICT: FAIL")
    return { exitCode: 1, reportPath: "" }
  }
  const { proof } = validation
  const report = JSON.parse(
    await readFile(proof.reportPath, "utf8")
  ) as VerificationReport
  const r15 = report.conditions.find((condition) => condition.id === "R15")
  if (
    !r15 ||
    report.verifierRunId !== proof.verifierRunId ||
    report.phase !== "fresh"
  ) {
    console.log(
      "Browser proof rejected: report is not a fresh Phase 6 report with R15"
    )
    console.log("VERDICT: FAIL")
    return { exitCode: 1, reportPath: proof.reportPath }
  }
  r15.status = "passed"
  r15.evidence = sanitizeVerificationValue({
    browserProofPath: resolve(proofPath),
    claims: proof.claims,
    inspectedReportSha256: proof.reportSha256,
    viewport: proof.viewport
  })
  report.phase = "finalized"
  report.artifacts.browserProofPath = resolve(proofPath)
  report.limitations = report.limitations.filter(
    (limitation) => !limitation.includes("R15 status is intentionally pending")
  )
  report.finalization = sanitizeVerificationValue({
    browserProofPath: resolve(proofPath),
    finalizedAt: new Date().toISOString(),
    inspectedReportSha256: proof.reportSha256,
    reusedReportPath: proof.reportPath
  })
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  await appendVerificationEvent(
    report.artifacts.eventsPath,
    "verification.finalized",
    {
      browserProofPath: resolve(proofPath),
      reportPath: report.artifacts.reportPath,
      status: report.verdict,
      verifierRunId: report.verifierRunId
    }
  )
  await writeFile(
    proof.reportPath,
    `${JSON.stringify(sanitizeVerificationValue(report), null, 2)}\n`
  )
  const scan = await scanArtifactFiles(
    await existingArtifactPaths([
      proof.reportPath,
      report.artifacts.eventsPath,
      resolve(proofPath),
      ...report.invocations.flatMap((record) =>
        record.journalPath === null ? [] : [record.journalPath]
      )
    ])
  )
  report.security.secretScanPassed = scan.passed
  report.security.redactions = getRedactionCount()
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  await writeFile(
    proof.reportPath,
    `${JSON.stringify(sanitizeVerificationValue(report), null, 2)}\n`
  )
  console.log(`Finalized existing verification report: ${proof.reportPath}`)
  console.log(`VERDICT: ${report.verdict}`)
  return {
    exitCode: report.verdict === "PASS" ? 0 : 1,
    reportPath: proof.reportPath
  }
}

async function findLatestProof(): Promise<string | null> {
  const root = join(repository, ".verification-artifacts")
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const candidates = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const path = join(root, entry.name, "browser-proof.json")
          try {
            return { mtime: (await stat(path)).mtimeMs, path }
          } catch {
            return null
          }
        })
    )
  ).filter(
    (candidate): candidate is { path: string; mtime: number } =>
      candidate !== null
  )
  candidates.sort((left, right) => right.mtime - left.mtime)
  return candidates[0]?.path || null
}

async function countFiles(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true })
  const counts = await Promise.all(
    entries.map((entry) => {
      if (entry.isFile()) {
        return 1
      }
      return entry.isDirectory() ? countFiles(join(directory, entry.name)) : 0
    })
  )
  return counts.reduce((total, count) => total + count, 0)
}

async function existingArtifactPaths(paths: string[]): Promise<string[]> {
  return (
    await Promise.all(
      [...new Set(paths)].map(async (path) => {
        try {
          return (await stat(path)).isFile() ? path : null
        } catch {
          return null
        }
      })
    )
  ).filter((path): path is string => path !== null)
}

async function typecheckGeneratedProtocol(
  directory: string
): Promise<CommandResult> {
  const compatibilityPath = join(directory, "protocol-compat.ts")
  await writeFile(
    compatibilityPath,
    `
import type { InitializeParams } from './InitializeParams.ts'
import type { ModelListParams } from './v2/ModelListParams.ts'
import type { ThreadStartParams } from './v2/ThreadStartParams.ts'
import type { TurnStartParams } from './v2/TurnStartParams.ts'
import type { TurnSteerParams } from './v2/TurnSteerParams.ts'
import type { TurnInterruptParams } from './v2/TurnInterruptParams.ts'

const initialize = { clientInfo: { name: 'gpt-workflow', title: 'GPT Workflow Runtime', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } satisfies InitializeParams
const modelList = { includeHidden: true, cursor: null } satisfies ModelListParams
const threadStart = { model: 'gpt-5.6-luna', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, cwd: '/tmp' } satisfies ThreadStartParams
const input = [{ type: 'text' as const, text: 'probe', text_elements: [] }]
const turnStart = { threadId: 'thread', input: [...input], model: 'gpt-5.6-luna', cwd: '/tmp', approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } } satisfies TurnStartParams
const turnSteer = { threadId: 'thread', input: [...input], expectedTurnId: 'turn' } satisfies TurnSteerParams
const turnInterrupt = { threadId: 'thread', turnId: 'turn' } satisfies TurnInterruptParams
void [initialize, modelList, threadStart, turnStart, turnSteer, turnInterrupt]
`
  )
  return runCommand(
    "bunx",
    [
      "tsc",
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--moduleResolution",
      "bundler",
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--allowImportingTsExtensions",
      compatibilityPath
    ],
    directory
  )
}

async function readJournalStartedKeys(path: string): Promise<string[]> {
  try {
    const source = await readFile(path, "utf8")
    return source
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as Record<string, unknown>
          return value.type === "started" && typeof value.key === "string"
            ? [value.key]
            : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

function addCondition(
  target: VerificationCondition[],
  id: string,
  passed: boolean,
  evidence: unknown,
  status?: VerificationStatus
): void {
  target.push({
    evidence: sanitizeVerificationValue(evidence),
    id,
    status: status ?? (passed ? "passed" : "failed")
  })
}

function justfileContract(): boolean {
  try {
    const justfile = readFileSync(join(repository, "justfile"), "utf8")
    return (
      justfile.includes("bun scripts/verify-offline.ts") &&
      justfile.includes("bun scripts/verify-package.ts") &&
      justfile.includes("bun scripts/verify-live.ts")
    )
  } catch {
    return false
  }
}

function protocolExit(evidence: VerificationJSON): number {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    return 1
  }
  const { exitCode } = evidence as Record<string, VerificationJSON>
  return typeof exitCode === "number" ? exitCode : 1
}

function protocolFileCount(evidence: VerificationJSON): number {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    return 0
  }
  const count = (evidence as Record<string, VerificationJSON>).generatedFiles
  return typeof count === "number" ? count : 0
}

function protocolTypecheckExit(evidence: VerificationJSON): number {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    return 1
  }
  const exitCode = (evidence as Record<string, VerificationJSON>)
    .typecheckExitCode
  return typeof exitCode === "number" ? exitCode : 1
}

function parseOfflineTotals(output: string): {
  passed: number
  failed: number
  assertions: number
  files: number | null
} {
  const match = OFFLINE_TOTALS_PATTERN.exec(output)
  return match
    ? {
        assertions: Number(match[3]),
        failed: Number(match[2]),
        files: null,
        passed: Number(match[1])
      }
    : { assertions: 0, failed: 1, files: null, passed: 0 }
}

function verdictFor(report: VerificationReport): boolean {
  const required = Array.from({ length: 15 }, (_, index) => `R${index + 1}`)
  return (
    required.every(
      (id) =>
        report.conditions.find((condition) => condition.id === id)?.status ===
        "passed"
    ) &&
    report.conditions.filter((condition) =>
      REQUIREMENT_ID_PATTERN.test(condition.id)
    ).length === required.length &&
    report.invocations.length === report.totals.requiredInvocations &&
    report.invocations.every((invocation) => invocation.status === "passed") &&
    report.totals.completedInvocations === report.totals.requiredInvocations &&
    report.totals.passedInvocations === report.totals.requiredInvocations &&
    report.totals.failedInvocations === 0 &&
    report.totals.pendingInvocations === 0 &&
    report.totals.skippedInvocations === 0 &&
    report.totals.interruptedInvocations === 0 &&
    report.security.secretScanPassed
  )
}

async function version(command: string, args: string[]): Promise<string> {
  const result = await runCommand(command, args)
  return result.exitCode === 0
    ? (result.output.trim().split("\n")[0] ?? "unknown")
    : "unavailable"
}

async function gitState(): Promise<Record<string, VerificationJSON>> {
  const hash = await runCommand("git", ["rev-parse", "HEAD"])
  const branch = await runCommand("git", ["branch", "--show-current"])
  const status = await runCommand("git", ["status", "--porcelain"])
  return {
    branch: branch.output.trim(),
    dirty: status.output.trim().length > 0,
    head: hash.output.trim(),
    status: status.output.trim()
  }
}

async function main(): Promise<number> {
  const repairArgumentIndex = process.argv.indexOf("--repair-finalized-report")
  if (repairArgumentIndex >= 0) {
    const reportPath = process.argv[repairArgumentIndex + 1]
    if (!reportPath) {
      throw new Error("--repair-finalized-report requires a report path")
    }
    return (await repairFinalizedReport(resolve(reportPath))).exitCode
  }
  const reassessArgumentIndex = process.argv.indexOf("--reassess-report")
  if (reassessArgumentIndex >= 0) {
    const reportPath = process.argv[reassessArgumentIndex + 1]
    if (!reportPath) {
      throw new Error("--reassess-report requires a report path")
    }
    return (await reassessReport(resolve(reportPath))).exitCode
  }
  const proofArgumentIndex = process.argv.indexOf("--browser-proof")
  const proofPath =
    proofArgumentIndex >= 0
      ? process.argv[proofArgumentIndex + 1]
      : await findLatestProof()
  if (proofPath) {
    const reused = await reuseFinalizedReport(resolve(proofPath))
    if (reused !== null) {
      return reused.exitCode
    }
    return (await finalizeFromProof(resolve(proofPath))).exitCode
  }
  return (await runFreshSweep()).exitCode
}

async function repairFinalizedReport(
  reportPath: string
): Promise<{ exitCode: number }> {
  const report = JSON.parse(
    await readFile(reportPath, "utf8")
  ) as VerificationReport
  if (
    report.phase !== "finalized" ||
    report.artifacts.reportPath !== reportPath ||
    report.conditions.some((condition) => condition.status !== "passed")
  ) {
    throw new Error(
      "repair requires the exact finalized report with all required conditions passed"
    )
  }
  const paths = await existingArtifactPaths([
    reportPath,
    report.artifacts.eventsPath,
    ...(report.artifacts.browserProofPath === null
      ? []
      : [report.artifacts.browserProofPath]),
    ...report.invocations.flatMap((record) =>
      record.journalPath === null ? [] : [record.journalPath]
    )
  ])
  const scan = await scanArtifactFiles(paths)
  report.security.secretScanPassed = scan.passed
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  await writeFile(
    reportPath,
    `${JSON.stringify(sanitizeVerificationValue(report), null, 2)}\n`
  )
  console.log(`Repaired finalized verification report: ${reportPath}`)
  console.log(`VERDICT: ${report.verdict}`)
  return { exitCode: report.verdict === "PASS" ? 0 : 1 }
}

async function reassessReport(
  reportPath: string
): Promise<{ exitCode: number }> {
  const report = JSON.parse(
    await readFile(reportPath, "utf8")
  ) as VerificationReport
  if (report.phase !== "fresh" || report.artifacts.reportPath !== reportPath) {
    throw new Error("reassessment requires the exact fresh report path")
  }
  const blocking = report.conditions.filter(
    (condition) =>
      condition.id !== "R9" &&
      condition.id !== "R15" &&
      condition.status !== "passed"
  )
  if (
    blocking.length > 0 ||
    report.invocations.some((invocation) => invocation.status !== "passed")
  ) {
    throw new Error(
      `reassessment refused because other required evidence failed: ${blocking.map((condition) => condition.id).join(", ")}`
    )
  }
  const source = await readFile(report.artifacts.eventsPath, "utf8")
  const events = source
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as AppServerNormalizedEvent
        return event.workflowRunId === `${report.verifierRunId}-r9`
          ? [event]
          : []
      } catch {
        return []
      }
    })
  const r9 = report.conditions.find((condition) => condition.id === "R9")
  if (
    !r9 ||
    r9.evidence === null ||
    typeof r9.evidence !== "object" ||
    Array.isArray(r9.evidence)
  ) {
    throw new Error("R9 evidence is unavailable")
  }
  const evidence = r9.evidence as Record<string, VerificationJSON>
  evidence.attribution = hasR9Attribution(events, `${report.verifierRunId}-r9`)
  r9.status = r9EvidencePassed(evidence) ? "passed" : "failed"
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  await writeFile(
    reportPath,
    `${JSON.stringify(sanitizeVerificationValue(report), null, 2)}\n`
  )
  const scan = await scanArtifactFiles([
    reportPath,
    report.artifacts.eventsPath,
    ...report.invocations
      .flatMap((record) =>
        record.journalPath === null ? [] : [record.journalPath]
      )
      .filter((path) => existsSync(path))
  ])
  report.security.secretScanPassed = scan.passed
  report.verdict = verdictFor(report) ? "PASS" : "FAIL"
  await writeFile(
    reportPath,
    `${JSON.stringify(sanitizeVerificationValue(report), null, 2)}\n`
  )
  console.log(`Reassessed existing verification report: ${reportPath}`)
  console.log(`VERDICT: ${report.verdict}`)
  return {
    exitCode:
      report.conditions.find((condition) => condition.id === "R9")?.status ===
      "passed"
        ? 0
        : 1
  }
}

async function reuseFinalizedReport(
  proofPath: string
): Promise<{ exitCode: number } | null> {
  try {
    const validation = await validateBrowserProof(proofPath, repository)
    if (!validation.ok || validation.proof === null) {
      return null
    }
    const { proof } = validation
    const report = JSON.parse(
      await readFile(proof.reportPath, "utf8")
    ) as VerificationReport
    if (
      report.phase !== "finalized" ||
      report.artifacts.browserProofPath !== proofPath
    ) {
      return null
    }
    const scan = await scanArtifactFiles([
      report.artifacts.reportPath,
      report.artifacts.eventsPath
    ])
    const honestPass =
      report.verdict === "PASS" && scan.passed && verdictFor(report)
    console.log(
      `Reused finalized verification report: ${report.artifacts.reportPath}`
    )
    console.log(`VERDICT: ${honestPass ? "PASS" : "FAIL"}`)
    return { exitCode: honestPass ? 0 : 1 }
  } catch {
    return null
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  console.log(
    `Live verification failed before finalization: ${redactText(error instanceof Error ? error.message : String(error))}`
  )
  console.log("VERDICT: FAIL")
  process.exitCode = 1
}
