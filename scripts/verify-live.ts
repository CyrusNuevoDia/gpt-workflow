import { randomUUID } from "node:crypto"
import { AppServerClient, REQUIRED_APP_SERVER_MODELS } from "../src/app-server.ts"
import type { AppServerAgentHandle, AppServerNormalizedEvent } from "../src/app-server.ts"
import { runWorkflowScript } from "../src/runtime.ts"

const phase3Only = process.argv.includes("--phase3")
const phase4Only = process.argv.includes("--phase4")
const lunaOnly = process.argv.includes("--luna-only")
const terraOnly = process.argv.includes("--terra-only")
const TEXT_WORKFLOW = `
export const meta = { name: 'phase-3-text', description: 'App Server text probe' }
return await agent('Reply with exactly this text and nothing else: phase-3-luna-text-ok', {
  model: 'gpt-5.6-luna', label: 'phase3:luna-text', phase: 'Phase 3',
})
`
const STRUCTURED_SCHEMA = {
  type: "object",
  properties: {
    model: { type: "string", enum: ["terra"] },
    count: { type: "integer", minimum: 1, maximum: 3 },
    tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
    nested: {
      type: "object",
      properties: { ready: { type: "boolean" } },
      required: ["ready"],
    },
  },
  required: ["model", "count", "tags", "nested"],
}
const STRUCTURED_WORKFLOW = `
export const meta = { name: 'phase-3-structured', description: 'App Server structured probe' }
return await agent('Return only JSON with model="terra", count=2, tags=["phase3"], nested={ready:true}.', {
  model: 'gpt-5.6-terra', label: 'phase3:terra-structured', phase: 'Phase 3',
  schema: ${JSON.stringify(STRUCTURED_SCHEMA)},
})
`
const STREAM_WORKFLOW = `
export const meta = { name: 'phase-4-stream', description: 'App Server streaming probe' }
return await agent('Emit a brief progress update first. Then use one harmless read-only shell command to print phase4-tool-proof. Finally reply with exactly phase4-stream-ok.', {
  model: 'gpt-5.6-luna', label: 'phase4:r9-stream', phase: 'Phase 4',
})
`
const STEER_WORKFLOW = `
export const meta = { name: 'phase-4-steer', description: 'Runtime steering probe' }
return await agent('Start with one short progress update, then wait for a verifier instruction before completing. You may use a harmless short shell sleep if needed.', {
  model: 'gpt-5.6-luna', label: 'phase4:r10-steer', phase: 'Phase 4',
})
`
const SIBLING_WORKFLOW = `
export const meta = { name: 'phase-4-siblings', description: 'Runtime sibling interruption probe' }
return await parallel([
  () => agent('Start a progress update and remain active for the verifier interruption. Do not finish before receiving it.', {
    model: 'gpt-5.6-luna', label: 'phase4:r10-interrupt', phase: 'Phase 4',
  }),
  () => agent('Reply with exactly phase4-sibling-complete.', {
    model: 'gpt-5.6-luna', label: 'phase4:r10-sibling', phase: 'Phase 4',
  }),
])
`

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function waitForEvent(
  handle: AppServerAgentHandle,
  predicate: (event: AppServerNormalizedEvent) => boolean,
  timeoutMs = 30_000,
): Promise<AppServerNormalizedEvent> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out after ${timeoutMs}ms waiting for a Phase 4 event`))
    }, timeoutMs)
    unsubscribe = handle.subscribe((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
  })
}

async function runPhase4(): Promise<void> {
  let client: AppServerClient | undefined
  try {
    client = await AppServerClient.connect({
      requiredModels: REQUIRED_APP_SERVER_MODELS,
      clientInfo: { name: "gpt-workflow-phase4", title: "GPT Workflow Phase 4", version: "0.1.0" },
    })
    const readiness = {
      codexVersion: client.initializeResult.userAgent,
      models: client.discoveredModels.map((model) => model.id),
      modelListPages: client.modelListPages,
    }

    const streamRunId = `phase4-r9-${randomUUID()}`
    let streamSettled = false
    let messageObservedWhileRunning = false
    let intermediateObservedWhileRunning = false
    const streamPromise = runWorkflowScript(STREAM_WORKFLOW, {
      appServer: client,
      workflowRunId: streamRunId,
      fileName: "phase-4-stream.js",
      onAgentEvent: (event) => {
        if (streamSettled) return
        if (event.type === "message-delta") messageObservedWhileRunning = true
        if (["plan", "reasoning", "command", "file", "tool", "collaboration"].includes(event.type)) intermediateObservedWhileRunning = true
      },
    })
    const streamExecution = await streamPromise.finally(() => { streamSettled = true })
    const streamEvents = streamExecution.agentEvents
    const streamIntermediate = streamEvents.some((event) => event.type === "message-delta")
    const streamTool = streamEvents.some((event) => ["plan", "reasoning", "command", "file", "tool", "collaboration"].includes(event.type))
    const streamTerminalIndex = streamEvents.findIndex((event) => event.type === "terminal")
    const streamFinalIndex = streamEvents.findIndex((event) => event.type === "lifecycle" && event.lifecycle === "completed" && event.subject === "message")
    const streamThreadStartIndex = streamEvents.findIndex((event) => event.type === "lifecycle" && event.lifecycle === "started" && event.subject === "thread")
    const streamTurnStartIndex = streamEvents.findIndex((event) => event.type === "lifecycle" && event.lifecycle === "started" && event.subject === "turn")
    const turnScopedEvents = streamEvents.filter((event) => ["message-delta", "plan", "reasoning", "command", "file", "collaboration", "terminal"].includes(event.type) || event.type === "tool" && event.method !== "mcpServer/startupStatus/updated")
    const expectedStreamAgentId = `${streamRunId}:agent-1`
    const streamAttribution = streamEvents.length > 0
      && streamEvents.every((event) => event.workflowRunId === streamRunId && event.agentId === expectedStreamAgentId && event.label === "phase4:r9-stream" && event.phase === "Phase 4" && event.requestedModel === "gpt-5.6-luna" && event.resolvedModel === "gpt-5.6-luna" && event.threadId !== null)
      && turnScopedEvents.every((event) => event.turnId !== null)
    const terminal = streamEvents.find((event) => event.type === "terminal")
    const streamProof = {
      result: streamExecution.result,
      eventCount: streamEvents.length,
      firstEventSequence: streamEvents[0]?.sequence ?? null,
      lastEventSequence: streamEvents[streamEvents.length - 1]?.sequence ?? null,
      messageDeltaBeforeTerminal: streamIntermediate && streamEvents.findIndex((event) => event.type === "message-delta") < streamTerminalIndex,
      intermediateCategoryBeforeTerminal: streamTool && streamEvents.findIndex((event) => ["plan", "reasoning", "command", "file", "tool", "collaboration"].includes(event.type)) < streamTerminalIndex,
      messageObservedWhileWorkflowRunning: messageObservedWhileRunning,
      intermediateObservedWhileWorkflowRunning: intermediateObservedWhileRunning,
      authoritativeMessageBeforeTerminal: streamFinalIndex >= 0 && streamFinalIndex < streamTerminalIndex,
      lifecycleOrdered: streamThreadStartIndex >= 0 && streamTurnStartIndex > streamThreadStartIndex && streamTerminalIndex > streamTurnStartIndex,
      attribution: streamAttribution,
      turnScopedEventsMissingTurnId: turnScopedEvents.filter((event) => event.turnId === null).map((event) => event.method),
      terminal: terminal ?? null,
      terminalCompletedWithUsage: terminal?.status === "completed" && terminal.usage !== null,
    }

    const steerRunId = `phase4-r10-steer-${randomUUID()}`
    let resolveSteerHandle!: (handle: AppServerAgentHandle) => void
    const steerHandleReady = new Promise<AppServerAgentHandle>((resolve) => { resolveSteerHandle = resolve })
    const steerExecutionPromise = runWorkflowScript(STEER_WORKFLOW, {
      appServer: client,
      workflowRunId: steerRunId,
      fileName: "phase-4-steer.js",
      onAgentStart: resolveSteerHandle,
    })
    const steerHandle = await steerHandleReady
    const intermediate = await waitForEvent(steerHandle, (event) => event.type === "message-delta")
    const nonce = `phase4-nonce-${randomUUID()}`
    const expectedTurnId = steerHandle.turnId
    const accepted = await steerHandle.steer(nonce, expectedTurnId)
    const steerExecution = await steerExecutionPromise
    const steerEvents = steerHandle.eventLog
    const expectedSteerAgentId = `${steerRunId}:agent-1`
    const steerProof = {
      intermediateSequence: intermediate.sequence,
      acceptedTurnId: accepted.turnId,
      expectedTurnId,
      result: steerExecution.result,
      nonceObserved: typeof steerExecution.result === "string" && steerExecution.result.includes(nonce),
      attributable: steerEvents.every((event) => event.workflowRunId === steerRunId && event.agentId === expectedSteerAgentId && event.label === "phase4:r10-steer" && event.phase === "Phase 4" && event.requestedModel === "gpt-5.6-luna"),
      runtimeManagedHandle: steerExecution.agentEvents.length === steerEvents.length,
    }

    const siblingRunId = `phase4-r10-siblings-${randomUUID()}`
    const siblingHandles = new Map<string, AppServerAgentHandle>()
    let resolveSiblingHandles!: () => void
    const siblingHandlesReady = new Promise<void>((resolve) => { resolveSiblingHandles = resolve })
    const siblingExecutionPromise = runWorkflowScript(SIBLING_WORKFLOW, {
      appServer: client,
      workflowRunId: siblingRunId,
      fileName: "phase-4-siblings.js",
      onAgentStart: (handle) => {
        if (handle.label !== null) siblingHandles.set(handle.label, handle)
        if (siblingHandles.size === 2) resolveSiblingHandles()
      },
    })
    await siblingHandlesReady
    const interruptedHandle = siblingHandles.get("phase4:r10-interrupt")
    const completingHandle = siblingHandles.get("phase4:r10-sibling")
    if (!interruptedHandle || !completingHandle) throw new Error("runtime did not expose both sibling handles")
    await interruptedHandle.interrupt()
    const siblingExecution = await siblingExecutionPromise
    const siblingResult = Array.isArray(siblingExecution.result) ? siblingExecution.result : []
    const siblingProof = {
      interruptedResult: siblingResult[0] ?? null,
      completing: siblingResult[1] ?? null,
      interruptionAbsorbedByParallel: siblingExecution.failures.some((failure) => failure.kind === "parallel" && failure.index === 0 && failure.message.includes("interrupted")),
      completingSucceeded: siblingResult[1] === "phase4-sibling-complete",
      distinctThreads: interruptedHandle.threadId !== completingHandle.threadId,
      runtimeManagedHandles: siblingExecution.agentEvents.some((event) => event.agentId === interruptedHandle.agentId) && siblingExecution.agentEvents.some((event) => event.agentId === completingHandle.agentId),
    }

    const passed = streamProof.messageDeltaBeforeTerminal && streamProof.intermediateCategoryBeforeTerminal && streamProof.messageObservedWhileWorkflowRunning && streamProof.intermediateObservedWhileWorkflowRunning && streamProof.authoritativeMessageBeforeTerminal && streamProof.lifecycleOrdered && streamProof.attribution && streamProof.terminalCompletedWithUsage && steerProof.nonceObserved && steerProof.acceptedTurnId === steerProof.expectedTurnId && steerProof.attributable && steerProof.runtimeManagedHandle && siblingProof.interruptionAbsorbedByParallel && siblingProof.completingSucceeded && siblingProof.distinctThreads && siblingProof.runtimeManagedHandles
    console.log(json({ phase: "4", readiness, probes: { r9Streaming: streamProof, r10Steering: steerProof, r10SiblingInterruption: siblingProof }, laterPhases: "R11-R15 remain intentionally incomplete; the default full verifier must still fail." }))
    console.log(`PHASE_4_VERDICT: ${passed ? "PASS" : "FAIL"}`)
    if (!passed) process.exitCode = 1
  } catch (error) {
    console.error(`Phase 4 live verification failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    await client?.close().catch((error: unknown) => {
      console.error(`Phase 4 App Server shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
  }
}

async function main(): Promise<void> {
  if (phase4Only) {
    await runPhase4()
    return
  }
  let client: AppServerClient | undefined
  try {
    client = await AppServerClient.connect({
      requiredModels: REQUIRED_APP_SERVER_MODELS,
      clientInfo: { name: "gpt-workflow-phase3", title: "GPT Workflow Phase 3", version: "0.1.0" },
    })
    const readiness = {
      codexVersion: client.initializeResult.userAgent,
      platformFamily: client.initializeResult.platformFamily,
      platformOs: client.initializeResult.platformOs,
      modelListPages: client.modelListPages,
      models: client.discoveredModels.map((model) => model.id),
      requiredModels: [...REQUIRED_APP_SERVER_MODELS],
    }
    console.log(`PHASE_3_READINESS: ${json(readiness)}`)

    let textProbe: Record<string, unknown> = { skipped: terraOnly, reason: terraOnly ? "--terra-only" : null }
    if (!terraOnly) {
      try {
        const execution = await runWorkflowScript(TEXT_WORKFLOW, { appServer: client, fileName: "phase-3-text.js" })
        const evidence = client.lastAgentCallEvidence
        if (typeof execution.result !== "string" || !execution.result.toLowerCase().includes("phase-3-luna-text-ok") || evidence === null) {
          throw new Error(`Luna text probe returned an unexpected result: ${json(execution.result)}`)
        }
        textProbe = { result: execution.result, evidence }
      } catch (error) {
        textProbe = { error: error instanceof Error ? error.message : String(error), evidence: client.lastAgentAttemptEvidence }
      }
    }

    let structuredProbe: Record<string, unknown> = { skipped: lunaOnly, reason: lunaOnly ? "--luna-only" : null }
    if (!lunaOnly) {
      try {
        const execution = await runWorkflowScript(STRUCTURED_WORKFLOW, { appServer: client, fileName: "phase-3-structured.js" })
        const evidence = client.lastAgentCallEvidence
        if (evidence === null || execution.result === null || typeof execution.result !== "object" || Array.isArray(execution.result)) {
          throw new Error(`Terra structured probe returned an unexpected result: ${json(execution.result)}`)
        }
        structuredProbe = { result: execution.result, evidence }
      } catch (error) {
        structuredProbe = { error: error instanceof Error ? error.message : String(error), evidence: client.lastAgentAttemptEvidence }
      }
    }

    const passed = !lunaOnly && !terraOnly && "result" in textProbe && "result" in structuredProbe

    console.log(json({
      phase: "3",
      readiness,
      probes: { lunaText: textProbe, terraStructured: structuredProbe },
      laterPhases: "R9-R15 remain unimplemented; this is not the full verifier.",
    }))
    console.log(`PHASE_3_VERDICT: ${passed ? "PASS" : "FAIL"}`)
    if (!passed || !phase3Only) {
      console.error("verify:live remains incomplete until the R9-R15 verifier exists; rerun with --phase3 for a successful Phase 3 probe.")
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`Phase 3 live verification failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    await client?.close().catch((error: unknown) => {
      console.error(`Phase 3 App Server shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
  }
}

await main()
