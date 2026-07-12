import { AppServerClient, REQUIRED_APP_SERVER_MODELS } from "../src/app-server.ts"
import { runWorkflowScript } from "../src/runtime.ts"

const phase3Only = process.argv.includes("--phase3")
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

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

async function main(): Promise<void> {
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
