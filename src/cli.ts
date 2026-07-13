#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { AppServerClient, REQUIRED_APP_SERVER_MODELS } from "./app-server.js"
import {
  runWorkflowScript,
  type WorkflowExecution,
  type WorkflowExecutionOptions
} from "./runtime.js"

const USAGE = `Usage: gpt-workflow run [--default-model <name>] [--resume <runId>] <script.js>

Run a workflow through Codex App Server. During a run, stdout is NDJSON and
human-readable diagnostics are written to stderr.
`
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/

type CLIClient = Pick<AppServerClient, "close" | "startAgent">

type CLIDependencies = {
  connect: (options: { defaultModel?: string }) => Promise<CLIClient>
  cwd: () => string
  makeRunId: () => string
  readSource: (path: string) => Promise<string>
  runWorkflow: (
    source: string,
    options: WorkflowExecutionOptions
  ) => Promise<WorkflowExecution>
  writeError: (text: string) => void
  writeOutput: (text: string) => void
}

const defaultDependencies: CLIDependencies = {
  connect: ({ defaultModel }) =>
    AppServerClient.connect({
      requiredModels: REQUIRED_APP_SERVER_MODELS,
      ...(defaultModel === undefined ? {} : { defaultModel })
    }),
  cwd: () => process.cwd(),
  makeRunId: () => `workflow-${randomUUID()}`,
  readSource: (path) => Bun.file(path).text(),
  runWorkflow: runWorkflowScript,
  writeError: (text) => {
    Bun.stderr.write(text)
  },
  writeOutput: (text) => {
    Bun.stdout.write(text)
  }
}

export async function runCLI(
  args: string[],
  dependencies: CLIDependencies = defaultDependencies
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      allowPositionals: true,
      args,
      options: {
        "default-model": { type: "string" },
        help: { short: "h", type: "boolean" },
        resume: { type: "string" }
      },
      strict: true
    })
  } catch (error) {
    dependencies.writeError(`gpt-workflow: ${describe(error)}\n${USAGE}`)
    return 1
  }

  if (parsed.values.help) {
    dependencies.writeOutput(USAGE)
    return 0
  }

  const [command, scriptArgument, ...extra] = parsed.positionals
  if (command !== "run" || !scriptArgument || extra.length > 0) {
    dependencies.writeError(
      `gpt-workflow: expected exactly: gpt-workflow run [--default-model <name>] [--resume <runId>] <script.js>\n${USAGE}`
    )
    return 1
  }

  const resumeValue = parsed.values.resume
  if (
    resumeValue !== undefined &&
    (typeof resumeValue !== "string" || !RUN_ID_PATTERN.test(resumeValue))
  ) {
    dependencies.writeError(
      `gpt-workflow: --resume must contain only letters, numbers, periods, underscores, and hyphens\n${USAGE}`
    )
    return 1
  }
  const resumeFromRunId = resumeValue
  const defaultModelValue = parsed.values["default-model"]
  const defaultModel =
    typeof defaultModelValue === "string" ? defaultModelValue : undefined
  const runId = resumeFromRunId ?? dependencies.makeRunId()
  const invocationDirectory = dependencies.cwd()
  const scriptPath = resolve(invocationDirectory, scriptArgument)
  const runDirectory = join(
    invocationDirectory,
    ".codex",
    "workflows",
    "runs",
    runId
  )
  let sequence = 0
  const emit = (record: Record<string, unknown>): void => {
    const recordSequence = sequence
    sequence += 1
    dependencies.writeOutput(
      `${JSON.stringify({
        ...record,
        runDirectory,
        runId,
        schemaVersion: 1,
        scriptPath,
        sequence: recordSequence
      })}\n`
    )
  }

  emit({
    ...(resumeFromRunId === undefined ? {} : { resumeFromRunId }),
    scriptPath,
    type: "run.started"
  })

  let clientPromise: Promise<CLIClient> | undefined
  const appServer = {
    startAgent: async (
      ...agentArgs: Parameters<AppServerClient["startAgent"]>
    ) => {
      clientPromise ??= dependencies.connect({ defaultModel })
      return (await clientPromise).startAgent(...agentArgs)
    }
  } as AppServerClient
  const closeClient = async (): Promise<void> => {
    if (!clientPromise) {
      return
    }
    const client = await clientPromise.catch(() => undefined)
    await client?.close()
    clientPromise = undefined
  }
  try {
    const source = await dependencies.readSource(scriptPath)
    const execution = await dependencies.runWorkflow(source, {
      appServer,
      cwd: invocationDirectory,
      fileName: scriptPath,
      onAgentEvent: (event) => emit({ event, type: "agent.event" }),
      onWorkflowEvent: (event) => emit({ event, type: "workflow.event" }),
      runDirectory,
      ...(resumeFromRunId === undefined
        ? { workflowRunId: runId }
        : { resumeFromRunId })
    })
    await closeClient().catch((error) => {
      dependencies.writeError(
        `gpt-workflow: App Server close failed after run completion: ${describe(error)}\n`
      )
    })
    emit({
      failures: execution.failures,
      journalPath: execution.journalPath,
      meta: execution.meta,
      result: execution.result,
      type: "run.completed",
      usage: execution.usage
    })
    return 0
  } catch (error) {
    await closeClient().catch(() => undefined)
    const failure = {
      message: describe(error),
      name: error instanceof Error ? error.name : "Error"
    }
    emit({ error: failure, type: "run.failed" })
    dependencies.writeError(`gpt-workflow: ${failure.message}\n`)
    return 1
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  process.exitCode = await runCLI(Bun.argv.slice(2))
}
