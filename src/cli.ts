#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { AppServerClient, REQUIRED_APP_SERVER_MODELS } from "./app-server.js"
import { listRunSummaries, readRunStatus } from "./run-inspection.js"
import {
  type JSONValue,
  type LoadedWorkflowScript,
  parseWorkflowScript,
  runWorkflowScript,
  type WorkflowExecution,
  type WorkflowExecutionOptions
} from "./runtime.js"

const USAGE = `Usage:
  gpt-workflow run [--default-model <name>] [--turn-timeout-ms <ms>] [--resume <runId>] [--args <json>] <script.js>
  gpt-workflow list
  gpt-workflow status <runId>

Run a workflow through Codex App Server. During a run, stdout is NDJSON and
human-readable diagnostics are written to stderr. List writes one JSON object
per run; status writes one JSON object.
`
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const DEFAULT_TURN_TIMEOUT_MS = 300_000
const PERSISTED_AGENT_EVENT_TYPES = new Set([
  "collaboration",
  "error",
  "lifecycle",
  "terminal",
  "usage",
  "warning"
])

type CLIClient = Pick<AppServerClient, "close" | "startAgent">

type CLIDependencies = {
  appendFile: (path: string, contents: string) => Promise<void>
  connect: (options: {
    defaultModel?: string
    turnTimeoutMs: number
  }) => Promise<CLIClient>
  cwd: () => string
  listRuns: typeof listRunSummaries
  makeRunId: () => string
  mkdir: (path: string) => Promise<void>
  parseWorkflow: (source: string, fileName: string) => LoadedWorkflowScript
  readRun: typeof readRunStatus
  readSource: (path: string) => Promise<string>
  runWorkflow: (
    source: string,
    options: WorkflowExecutionOptions
  ) => Promise<WorkflowExecution>
  writeError: (text: string) => void
  writeOutput: (text: string) => void
}

const defaultDependencies: CLIDependencies = {
  appendFile: async (path, contents) => {
    await appendFile(path, contents)
  },
  connect: ({ defaultModel, turnTimeoutMs }) =>
    AppServerClient.connect({
      requiredModels: REQUIRED_APP_SERVER_MODELS,
      ...(defaultModel === undefined ? {} : { defaultModel }),
      turnTimeoutMs
    }),
  cwd: () => process.cwd(),
  listRuns: listRunSummaries,
  makeRunId: () => `workflow-${randomUUID()}`,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  parseWorkflow: parseWorkflowScript,
  readRun: readRunStatus,
  readSource: (path) => Bun.file(path).text(),
  runWorkflow: runWorkflowScript,
  writeError: (text) => {
    Bun.stderr.write(text)
  },
  writeOutput: (text) => {
    Bun.stdout.write(text)
  }
}

export function runCLI(
  args: string[],
  overrides: Partial<CLIDependencies> = {}
): Promise<number> {
  const dependencies = { ...defaultDependencies, ...overrides }
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      allowPositionals: true,
      args,
      options: {
        args: { type: "string" },
        "default-model": { type: "string" },
        help: { short: "h", type: "boolean" },
        resume: { type: "string" },
        "turn-timeout-ms": { type: "string" }
      },
      strict: true
    })
  } catch (error) {
    dependencies.writeError(`gpt-workflow: ${describe(error)}\n${USAGE}`)
    return Promise.resolve(1)
  }

  if (parsed.values.help) {
    dependencies.writeOutput(USAGE)
    return Promise.resolve(0)
  }

  const [command, ...positionals] = parsed.positionals
  if (command === "list") {
    if (positionals.length > 0 || hasRunOptions(parsed.values)) {
      return Promise.resolve(
        usageError(dependencies, "expected exactly: gpt-workflow list")
      )
    }
    return runList(dependencies)
  }
  if (command === "status") {
    const [runId, ...extra] = positionals
    if (
      !runId ||
      extra.length > 0 ||
      hasRunOptions(parsed.values) ||
      !RUN_ID_PATTERN.test(runId)
    ) {
      return Promise.resolve(
        usageError(
          dependencies,
          "expected exactly: gpt-workflow status <runId>"
        )
      )
    }
    return runStatus(runId, dependencies)
  }
  if (command !== "run") {
    return Promise.resolve(
      usageError(dependencies, "expected run, list, or status")
    )
  }
  const [scriptArgument, ...extra] = positionals
  if (!scriptArgument || extra.length > 0) {
    return Promise.resolve(
      usageError(
        dependencies,
        "expected exactly: gpt-workflow run [--default-model <name>] [--turn-timeout-ms <ms>] [--resume <runId>] [--args <json>] <script.js>"
      )
    )
  }
  return runWorkflowCommand(scriptArgument, parsed.values, dependencies)
}

async function runList(dependencies: CLIDependencies): Promise<number> {
  try {
    const summaries = await dependencies.listRuns(dependencies.cwd())
    for (const summary of summaries) {
      dependencies.writeOutput(`${JSON.stringify(summary)}\n`)
    }
    return 0
  } catch (error) {
    dependencies.writeError(`gpt-workflow: ${describe(error)}\n`)
    return 1
  }
}

async function runStatus(
  runId: string,
  dependencies: CLIDependencies
): Promise<number> {
  try {
    const status = await dependencies.readRun(dependencies.cwd(), runId)
    if (status === null) {
      dependencies.writeError(`gpt-workflow: run not found: ${runId}\n`)
      return 1
    }
    dependencies.writeOutput(`${JSON.stringify(status)}\n`)
    return 0
  } catch (error) {
    dependencies.writeError(`gpt-workflow: ${describe(error)}\n`)
    return 1
  }
}

async function runWorkflowCommand(
  scriptArgument: string,
  values: ReturnType<typeof parseArgs>["values"],
  dependencies: CLIDependencies
): Promise<number> {
  const resumeValue = values.resume
  if (
    resumeValue !== undefined &&
    (typeof resumeValue !== "string" || !RUN_ID_PATTERN.test(resumeValue))
  ) {
    return usageError(
      dependencies,
      "--resume must contain only letters, numbers, periods, underscores, and hyphens"
    )
  }

  let workflowArgs: JSONValue | undefined
  const argsValue = typeof values.args === "string" ? values.args : undefined
  if (argsValue !== undefined) {
    try {
      workflowArgs = JSON.parse(argsValue) as JSONValue
    } catch (error) {
      return usageError(
        dependencies,
        `--args must be valid JSON: ${describe(error)}`
      )
    }
  }

  const resumeFromRunId = resumeValue
  const defaultModelValue = values["default-model"]
  const defaultModel =
    typeof defaultModelValue === "string" ? defaultModelValue : undefined
  const turnTimeoutValue = values["turn-timeout-ms"]
  const turnTimeoutMs =
    turnTimeoutValue === undefined
      ? DEFAULT_TURN_TIMEOUT_MS
      : Number(turnTimeoutValue)
  if (
    !(Number.isFinite(turnTimeoutMs) && Number.isInteger(turnTimeoutMs)) ||
    turnTimeoutMs <= 0
  ) {
    return usageError(
      dependencies,
      "--turn-timeout-ms must be a finite positive integer"
    )
  }
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
  const eventsPath = join(runDirectory, "events.jsonl")
  let writeTail = Promise.resolve()
  let sequence = 0
  const emit = (record: Record<string, unknown>): void => {
    const lineRecord = {
      ...record,
      runDirectory,
      runId,
      schemaVersion: 1,
      scriptPath,
      sequence,
      ts: Date.now()
    }
    sequence += 1
    const line = `${JSON.stringify(lineRecord)}\n`
    dependencies.writeOutput(line)
    if (shouldPersistRecord(lineRecord)) {
      writeTail = writeTail.then(() =>
        dependencies.appendFile(eventsPath, line)
      )
    }
  }
  const finish = async (exitCode: number): Promise<number> => {
    try {
      await writeTail
      return exitCode
    } catch (error) {
      dependencies.writeError(
        `gpt-workflow: could not persist run events: ${describe(error)}\n`
      )
      return 1
    }
  }

  try {
    await dependencies.mkdir(runDirectory)
  } catch (error) {
    dependencies.writeError(
      `gpt-workflow: could not create run directory: ${describe(error)}\n`
    )
    return 1
  }

  let source: string
  let loaded: LoadedWorkflowScript
  try {
    source = await dependencies.readSource(scriptPath)
    loaded = dependencies.parseWorkflow(source, scriptPath)
  } catch (error) {
    const failure = failureRecord(error)
    emit({ error: failure, type: "run.failed" })
    dependencies.writeError(`gpt-workflow: ${failure.message}\n`)
    return finish(1)
  }

  emit({
    meta: {
      description: loaded.meta.description,
      name: loaded.meta.name
    },
    ...(resumeFromRunId === undefined ? {} : { resumeFromRunId }),
    type: "run.started"
  })

  let clientPromise: Promise<CLIClient> | undefined
  const appServer = {
    startAgent: async (
      ...agentArgs: Parameters<AppServerClient["startAgent"]>
    ) => {
      clientPromise ??= dependencies.connect({ defaultModel, turnTimeoutMs })
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
    const execution = await dependencies.runWorkflow(source, {
      appServer,
      cwd: invocationDirectory,
      fileName: scriptPath,
      onAgentEvent: (event) => emit({ event, type: "agent.event" }),
      onWorkflowEvent: (event) => emit({ event, type: "workflow.event" }),
      runDirectory,
      ...(argsValue === undefined ? {} : { args: workflowArgs }),
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
    return finish(0)
  } catch (error) {
    await closeClient().catch(() => undefined)
    const failure = failureRecord(error)
    emit({ error: failure, type: "run.failed" })
    dependencies.writeError(`gpt-workflow: ${failure.message}\n`)
    return finish(1)
  }
}

function hasRunOptions(
  values: ReturnType<typeof parseArgs>["values"]
): boolean {
  return (
    values.args !== undefined ||
    values["default-model"] !== undefined ||
    values.resume !== undefined ||
    values["turn-timeout-ms"] !== undefined
  )
}

function shouldPersistRecord(record: Record<string, unknown>): boolean {
  if (
    record.type === "run.started" ||
    record.type === "run.completed" ||
    record.type === "run.failed" ||
    record.type === "workflow.event"
  ) {
    return true
  }
  if (record.type !== "agent.event" || !isRecord(record.event)) {
    return false
  }
  return (
    typeof record.event.type === "string" &&
    PERSISTED_AGENT_EVENT_TYPES.has(record.event.type)
  )
}

function failureRecord(error: unknown): { message: string; name: string } {
  return {
    message: describe(error),
    name: error instanceof Error ? error.name : "Error"
  }
}

function usageError(dependencies: CLIDependencies, message: string): number {
  dependencies.writeError(`gpt-workflow: ${message}\n${USAGE}`)
  return 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  process.exitCode = await runCLI(Bun.argv.slice(2))
}
