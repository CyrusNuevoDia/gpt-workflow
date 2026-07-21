#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  AppServerClient,
  type AppServerModel,
  REQUIRED_APP_SERVER_MODELS
} from "./app-server.js"
import { listRunSummaries, readRunStatus } from "./run-inspection.js"
import {
  type JSONValue,
  type LoadedWorkflowScript,
  parseWorkflowScript,
  runWorkflowScript,
  type WorkflowExecution,
  type WorkflowExecutionOptions
} from "./runtime.js"
import {
  findStoredWorkflowRuns,
  isSafePathSegment,
  workflowRunDirectory
} from "./workflow-storage.js"

const USAGE = `Usage:
  gpt-workflow run [options] <script.js>
  gpt-workflow list
  gpt-workflow models
  gpt-workflow status <runId>

Global options:
  -h, --help                     Show help.
  -V, --version                  Show the installed version.

Run a workflow through Codex App Server. During a run, stdout is NDJSON and
human-readable diagnostics are written to stderr.

Run options:
  --args <json>                  Supply the workflow args global as JSON.
  --default-model <name>         Default model for agent calls.
  --request-timeout-ms <ms>      App Server request timeout (default: 30000).
  --required-model <name>        Required model; repeat to replace defaults.
  --resume <runId>               Resume a previous workflow run.
  --thread-start-timeout-ms <ms> Thread-start timeout (default: 120000).
  --turn-timeout-ms <ms>         Agent-turn timeout (default: 300000).

List and models write one JSON object per line; status writes one JSON object.
`
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_THREAD_START_TIMEOUT_MS = 120_000
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

type CLIConnectOptions = {
  defaultModel?: string
  requestTimeoutMs: number
  requiredModels: readonly string[]
  threadStartTimeoutMs: number
  turnTimeoutMs: number
}

type CLIDependencies = {
  appendFile: (path: string, contents: string) => Promise<void>
  connect: (options: CLIConnectOptions) => Promise<CLIClient>
  cwd: () => string
  listenForTermination: (
    listener: (signal: "SIGINT" | "SIGTERM") => void
  ) => () => void
  listModels: () => Promise<AppServerModel[]>
  listRuns: typeof listRunSummaries
  makeRunId: () => string
  mkdir: (path: string) => Promise<void>
  parseWorkflow: (source: string, fileName: string) => LoadedWorkflowScript
  readRun: typeof readRunStatus
  readSource: (path: string) => Promise<string>
  readVersion: () => Promise<string>
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
  connect: ({
    defaultModel,
    requestTimeoutMs,
    requiredModels,
    threadStartTimeoutMs,
    turnTimeoutMs
  }) =>
    AppServerClient.connect({
      ...(defaultModel === undefined ? {} : { defaultModel }),
      requestTimeoutMs,
      requiredModels,
      threadStartTimeoutMs,
      turnTimeoutMs
    }),
  cwd: () => process.cwd(),
  listenForTermination: (listener) => {
    const onSIGINT = () => listener("SIGINT")
    const onSIGTERM = () => listener("SIGTERM")
    process.once("SIGINT", onSIGINT)
    process.once("SIGTERM", onSIGTERM)
    return () => {
      process.off("SIGINT", onSIGINT)
      process.off("SIGTERM", onSIGTERM)
    }
  },
  listModels: async () => {
    const client = await AppServerClient.connect()
    try {
      return await client.listModels()
    } finally {
      await client.close()
    }
  },
  listRuns: listRunSummaries,
  makeRunId: () => `workflow-${randomUUID()}`,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  parseWorkflow: parseWorkflowScript,
  readRun: readRunStatus,
  readSource: (path) => Bun.file(path).text(),
  readVersion: readPackageVersion,
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
        "request-timeout-ms": { type: "string" },
        "required-model": { multiple: true, type: "string" },
        resume: { type: "string" },
        "thread-start-timeout-ms": { type: "string" },
        "turn-timeout-ms": { type: "string" },
        version: { short: "V", type: "boolean" }
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

  if (parsed.values.version) {
    return runVersion(dependencies)
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
  if (command === "models") {
    if (positionals.length > 0 || hasRunOptions(parsed.values)) {
      return Promise.resolve(
        usageError(dependencies, "expected exactly: gpt-workflow models")
      )
    }
    return runModels(dependencies)
  }
  if (command === "status") {
    const [runId, ...extra] = positionals
    if (
      !runId ||
      extra.length > 0 ||
      hasRunOptions(parsed.values) ||
      !RUN_ID_PATTERN.test(runId) ||
      !isSafePathSegment(runId)
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
      usageError(dependencies, "expected run, list, models, or status")
    )
  }
  const [scriptArgument, ...extra] = positionals
  if (!scriptArgument || extra.length > 0) {
    return Promise.resolve(
      usageError(
        dependencies,
        "expected exactly: gpt-workflow run [options] <script.js>"
      )
    )
  }
  return runWorkflowCommand(scriptArgument, parsed.values, dependencies)
}

async function runVersion(dependencies: CLIDependencies): Promise<number> {
  try {
    dependencies.writeOutput(`${await dependencies.readVersion()}\n`)
    return 0
  } catch (error) {
    dependencies.writeError(`gpt-workflow: ${describe(error)}\n`)
    return 1
  }
}

async function readPackageVersion(): Promise<string> {
  const manifestURLs = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url)
  ]
  const manifests = await Promise.all(
    manifestURLs.map(async (manifestURL) => {
      const file = Bun.file(manifestURL)
      return (await file.exists()) ? file.json() : null
    })
  )
  for (const manifestValue of manifests) {
    const manifest = manifestValue as {
      name?: unknown
      version?: unknown
    } | null
    if (manifest === null) {
      continue
    }
    if (
      manifest.name === "gpt-workflow" &&
      typeof manifest.version === "string"
    ) {
      return manifest.version
    }
  }
  throw new Error("could not read the installed package version")
}

async function runModels(dependencies: CLIDependencies): Promise<number> {
  try {
    const models = await dependencies.listModels()
    for (const model of models) {
      dependencies.writeOutput(`${JSON.stringify(model)}\n`)
    }
    return 0
  } catch (error) {
    dependencies.writeError(`gpt-workflow: ${describe(error)}\n`)
    return 1
  }
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
    (typeof resumeValue !== "string" ||
      !RUN_ID_PATTERN.test(resumeValue) ||
      !isSafePathSegment(resumeValue))
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
  const clientOptions = parseClientOptions(values)
  if (typeof clientOptions === "string") {
    return usageError(dependencies, clientOptions)
  }
  const invocationDirectory = dependencies.cwd()
  const scriptPath = resolve(invocationDirectory, scriptArgument)

  let source: string
  let loaded: LoadedWorkflowScript
  try {
    source = await dependencies.readSource(scriptPath)
    loaded = dependencies.parseWorkflow(source, scriptPath)
  } catch (error) {
    const failure = failureRecord(error)
    dependencies.writeError(`gpt-workflow: ${failure.message}\n`)
    return 1
  }

  let location: { runDirectory: string; runId: string }
  try {
    location = await resolveCLIRunLocation(
      invocationDirectory,
      loaded.meta.name,
      resumeFromRunId,
      dependencies
    )
  } catch (error) {
    dependencies.writeError(`gpt-workflow: ${describe(error)}\n`)
    return 1
  }
  const { runDirectory, runId } = location

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
      clientPromise ??= dependencies.connect(clientOptions)
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
  const abortController = new AbortController()
  const stopListening = dependencies.listenForTermination((signal) => {
    dependencies.writeError(
      `gpt-workflow: received ${signal}; canceling workflow\n`
    )
    abortController.abort()
  })
  try {
    const execution = await dependencies.runWorkflow(source, {
      appServer,
      cwd: invocationDirectory,
      fileName: scriptPath,
      onAgentEvent: (event) => emit({ event, type: "agent.event" }),
      onWorkflowEvent: (event) => emit({ event, type: "workflow.event" }),
      runDirectory,
      signal: abortController.signal,
      ...(argsValue === undefined ? {} : { args: workflowArgs }),
      ...(resumeFromRunId === undefined
        ? { workflowRunId: runId }
        : { resumeFromRunId })
    })
    stopListening()
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
    stopListening()
    await closeClient().catch(() => undefined)
    const failure = failureRecord(error)
    emit({ error: failure, type: "run.failed" })
    dependencies.writeError(`gpt-workflow: ${failure.message}\n`)
    return finish(1)
  }
}

async function resolveCLIRunLocation(
  projectDirectory: string,
  workflowName: string,
  resumeFromRunId: string | undefined,
  dependencies: CLIDependencies
): Promise<{ runDirectory: string; runId: string }> {
  if (resumeFromRunId === undefined) {
    const runId = dependencies.makeRunId()
    return {
      runDirectory: workflowRunDirectory(projectDirectory, workflowName, runId),
      runId
    }
  }
  const matches = await findStoredWorkflowRuns(
    projectDirectory,
    resumeFromRunId
  )
  if (matches.length === 0) {
    throw new Error(`run not found: ${resumeFromRunId}`)
  }
  if (matches.length > 1) {
    throw new Error(`run ID is ambiguous: ${resumeFromRunId}`)
  }
  const [match] = matches
  if (match?.workflowName !== workflowName) {
    throw new Error(
      `run ${resumeFromRunId} belongs to workflow ${match?.workflowName}, not ${workflowName}`
    )
  }
  return { runDirectory: match.directory, runId: resumeFromRunId }
}

function hasRunOptions(
  values: ReturnType<typeof parseArgs>["values"]
): boolean {
  return (
    values.args !== undefined ||
    values["default-model"] !== undefined ||
    values["request-timeout-ms"] !== undefined ||
    values["required-model"] !== undefined ||
    values.resume !== undefined ||
    values["thread-start-timeout-ms"] !== undefined ||
    values["turn-timeout-ms"] !== undefined
  )
}

function positiveIntegerOption(
  value: unknown,
  fallback: number
): number | null {
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null
}

function parseClientOptions(
  values: ReturnType<typeof parseArgs>["values"]
): CLIConnectOptions | string {
  const timeouts = [
    ["request-timeout-ms", DEFAULT_REQUEST_TIMEOUT_MS],
    ["thread-start-timeout-ms", DEFAULT_THREAD_START_TIMEOUT_MS],
    ["turn-timeout-ms", DEFAULT_TURN_TIMEOUT_MS]
  ] as const
  const parsedTimeouts = new Map<string, number>()
  for (const [name, fallback] of timeouts) {
    const timeout = positiveIntegerOption(values[name], fallback)
    if (timeout === null) {
      return `--${name} must be a finite positive integer`
    }
    parsedTimeouts.set(name, timeout)
  }
  const requiredModelValues = values["required-model"]
  if (
    requiredModelValues !== undefined &&
    !isNonEmptyStringArray(requiredModelValues)
  ) {
    return "--required-model must not be empty"
  }
  const defaultModelValue = values["default-model"]
  return {
    defaultModel:
      typeof defaultModelValue === "string" ? defaultModelValue : undefined,
    requestTimeoutMs:
      parsedTimeouts.get("request-timeout-ms") ?? DEFAULT_REQUEST_TIMEOUT_MS,
    requiredModels:
      requiredModelValues === undefined
        ? REQUIRED_APP_SERVER_MODELS
        : [...new Set(requiredModelValues)],
    threadStartTimeoutMs:
      parsedTimeouts.get("thread-start-timeout-ms") ??
      DEFAULT_THREAD_START_TIMEOUT_MS,
    turnTimeoutMs:
      parsedTimeouts.get("turn-timeout-ms") ?? DEFAULT_TURN_TIMEOUT_MS
  }
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((model) => typeof model === "string" && model.length > 0)
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
