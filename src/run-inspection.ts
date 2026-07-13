import type { Dirent } from "node:fs"
import { open, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { AppServerJSONValue } from "./app-server.js"
import { parseWorkflowJournalEntry } from "./workflow-journal.js"

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const READ_CHUNK_SIZE = 4096

export type RunSummaryStatus = "completed" | "failed" | "incomplete" | "unknown"

export type RunSummary = {
  failureCount?: number
  finishedAt?: number | null
  journalOnly?: true
  lastEventAt: number | null
  name: string | null
  runId: string
  scriptPath: string | null
  startedAt: number | null
  status: RunSummaryStatus
  usage?: AppServerJSONValue
}

export type RunAgentStatus = "completed" | "failed" | "incomplete"

export type RunAgent = {
  agentId: string
  label: string | null
  model: string | null
  phase: string | null
  status: RunAgentStatus
  tokens: AppServerJSONValue | null
}

export type RunTokenTotals = {
  cachedInputTokens: number
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export type RunPhase = {
  agents: {
    completed: number
    failed: number
    started: number
  }
  detail: string | null
  title: string
  tokens: RunTokenTotals
}

export type RunStatus = RunSummary & {
  agents: RunAgent[]
  failures?: AppServerJSONValue
  phases: RunPhase[]
  result?: AppServerJSONValue
}

export type JournalRunStatus = {
  journal: {
    results: number
    started: number
    unmatched: number
  }
  journalOnly: true
  runId: string
  status: "unknown"
}

export type RunInspectionStatus = RunStatus | JournalRunStatus

type EventRecord = Record<string, unknown>

type MutableAgent = RunAgent & {
  started: boolean
  terminalStatus: "completed" | "failed" | null
}

export async function listRunSummaries(cwd: string): Promise<RunSummary[]> {
  const runsDirectory = join(cwd, ".codex", "workflows", "runs")
  let entries: Dirent<string>[]
  try {
    entries = await readdir(runsDirectory, { withFileTypes: true })
  } catch (error) {
    if (isMissingFile(error)) {
      return []
    }
    throw error
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readRunSummary(join(runsDirectory, entry.name), entry.name)
      )
  )
  return summaries.sort((left, right) => {
    if (left.startedAt === null) {
      return right.startedAt === null
        ? left.runId.localeCompare(right.runId)
        : 1
    }
    if (right.startedAt === null) {
      return -1
    }
    return (
      right.startedAt - left.startedAt || left.runId.localeCompare(right.runId)
    )
  })
}

export async function readRunStatus(
  cwd: string,
  runId: string
): Promise<RunInspectionStatus | null> {
  if (!RUN_ID_PATTERN.test(runId)) {
    return null
  }
  const runDirectory = join(cwd, ".codex", "workflows", "runs", runId)
  if (!(await isDirectory(runDirectory))) {
    return null
  }

  const eventsPath = join(runDirectory, "events.jsonl")
  let source: string
  try {
    source = await readFile(eventsPath, "utf8")
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error
    }
    return readJournalStatus(runDirectory, runId)
  }

  return buildRunStatus(runId, parseEventLines(source))
}

async function readRunSummary(
  runDirectory: string,
  runId: string
): Promise<RunSummary> {
  const eventsPath = join(runDirectory, "events.jsonl")
  try {
    const { first, last } = await readBoundaryRecords(eventsPath)
    return summarizeRecords(runId, first, last)
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error
    }
    return {
      journalOnly: true,
      lastEventAt: null,
      name: null,
      runId,
      scriptPath: null,
      startedAt: null,
      status: "unknown"
    }
  }
}

async function readBoundaryRecords(
  path: string
): Promise<{ first: EventRecord | null; last: EventRecord | null }> {
  const file = await open(path, "r")
  try {
    const { size } = await file.stat()
    return {
      first: await readFirstRecord(file, size),
      last: await readLastRecord(file, size)
    }
  } finally {
    await file.close()
  }
}

async function readFirstRecord(
  file: Awaited<ReturnType<typeof open>>,
  size: number
): Promise<EventRecord | null> {
  let offset = 0
  let pending = ""
  while (offset < size) {
    const length = Math.min(READ_CHUNK_SIZE, size - offset)
    const buffer = Buffer.alloc(length)
    // biome-ignore lint/performance/noAwaitInLoops: Boundary reads must advance sequentially until a complete line is found.
    const { bytesRead } = await file.read(buffer, 0, length, offset)
    if (bytesRead === 0) {
      break
    }
    offset += bytesRead
    pending += buffer.toString("utf8", 0, bytesRead)
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) {
      const record = parseEventLine(line)
      if (record !== null) {
        return record
      }
    }
  }
  return parseEventLine(pending)
}

async function readLastRecord(
  file: Awaited<ReturnType<typeof open>>,
  size: number
): Promise<EventRecord | null> {
  let offset = size
  let pending = ""
  while (offset > 0) {
    const start = Math.max(0, offset - READ_CHUNK_SIZE)
    const length = offset - start
    const buffer = Buffer.alloc(length)
    // biome-ignore lint/performance/noAwaitInLoops: Boundary reads must advance sequentially until a complete line is found.
    const { bytesRead } = await file.read(buffer, 0, length, start)
    pending = buffer.toString("utf8", 0, bytesRead) + pending
    offset = start
    const lines = pending.split("\n")
    pending = offset > 0 ? (lines.shift() ?? "") : ""
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const record = parseEventLine(lines[index] ?? "")
      if (record !== null) {
        return record
      }
    }
  }
  return parseEventLine(pending)
}

function parseEventLines(source: string): EventRecord[] {
  const records: EventRecord[] = []
  for (const line of source.split("\n")) {
    const record = parseEventLine(line)
    if (record !== null) {
      records.push(record)
    }
  }
  return records
}

function parseEventLine(source: string): EventRecord | null {
  if (source.trim().length === 0) {
    return null
  }
  try {
    const value: unknown = JSON.parse(source)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function summarizeRecords(
  runId: string,
  first: EventRecord | null,
  last: EventRecord | null
): RunSummary {
  const started = first?.type === "run.started" ? first : null
  const terminal =
    last?.type === "run.completed" || last?.type === "run.failed" ? last : null
  const summary: RunSummary = {
    lastEventAt: numberOrNull(last?.ts),
    name:
      started !== null && isRecord(started.meta)
        ? stringOrNull(started.meta.name)
        : null,
    runId,
    scriptPath: stringOrNull(first?.scriptPath),
    startedAt: numberOrNull(started?.ts),
    status: terminalStatus(terminal)
  }
  if (terminal !== null) {
    summary.finishedAt = numberOrNull(terminal.ts)
    summary.failureCount =
      terminal.type === "run.completed" && Array.isArray(terminal.failures)
        ? terminal.failures.length
        : 1
    if (terminal.type === "run.completed" && Object.hasOwn(terminal, "usage")) {
      summary.usage = terminal.usage as AppServerJSONValue
    }
  }
  return summary
}

function buildRunStatus(runId: string, records: EventRecord[]): RunStatus {
  const { agents, first, last, phases, started } = collectRunRecords(records)
  const summary = summarizeRecords(runId, started ?? first, last)
  rollUpPhases(phases, agents)
  const status: RunStatus = {
    ...summary,
    agents: makeRunAgents(agents),
    phases
  }
  copyTerminalPayload(status, last)
  return status
}

function collectRunRecords(records: EventRecord[]): {
  agents: Map<string, MutableAgent>
  first: EventRecord | null
  last: EventRecord | null
  phases: RunPhase[]
  started: EventRecord | null
} {
  let first: EventRecord | null = null
  let started: EventRecord | null = null
  let last: EventRecord | null = null
  const phases: RunPhase[] = []
  const agents = new Map<string, MutableAgent>()

  for (const record of records) {
    first ??= record
    last = record
    if (started === null && record.type === "run.started") {
      started = record
    }
    if (record.type === "workflow.event") {
      const phase = readPhase(record)
      if (phase !== null) {
        phases.push(phase)
      }
      continue
    }
    if (record.type !== "agent.event" || !isRecord(record.event)) {
      continue
    }
    updateAgent(agents, record.event)
  }
  return { agents, first, last, phases, started }
}

function readPhase(record: EventRecord): RunPhase | null {
  const notification = isRecord(record.event) ? record.event : null
  const event =
    notification !== null && isRecord(notification.event)
      ? notification.event
      : null
  if (event?.type !== "phase" || typeof event.title !== "string") {
    return null
  }
  return {
    agents: { completed: 0, failed: 0, started: 0 },
    detail: stringOrNull(event.detail),
    title: event.title,
    tokens: emptyTokenTotals()
  }
}

function makeRunAgents(agents: Map<string, MutableAgent>): RunAgent[] {
  return [...agents.values()].map(
    (agent): RunAgent => ({
      agentId: agent.agentId,
      label: agent.label,
      model: agent.model,
      phase: agent.phase,
      status: agent.terminalStatus ?? "incomplete",
      tokens: agent.tokens
    })
  )
}

function rollUpPhases(
  phases: RunPhase[],
  agents: Map<string, MutableAgent>
): void {
  for (const phase of phases) {
    for (const agent of agents.values()) {
      if (agent.phase !== phase.title) {
        continue
      }
      if (agent.started) {
        phase.agents.started += 1
      }
      if (agent.terminalStatus === "completed") {
        phase.agents.completed += 1
      } else if (agent.terminalStatus === "failed") {
        phase.agents.failed += 1
      }
      addTokenTotals(phase.tokens, agent.tokens)
    }
  }
}

function copyTerminalPayload(
  status: RunStatus,
  last: EventRecord | null
): void {
  if (last !== null && status.status !== "incomplete") {
    if (Object.hasOwn(last, "failures")) {
      status.failures = last.failures as AppServerJSONValue
    }
    if (Object.hasOwn(last, "result")) {
      status.result = last.result as AppServerJSONValue
    }
  }
}

function terminalStatus(terminal: EventRecord | null): RunSummaryStatus {
  if (terminal?.type === "run.completed") {
    return "completed"
  }
  return terminal?.type === "run.failed" ? "failed" : "incomplete"
}

function updateAgent(
  agents: Map<string, MutableAgent>,
  event: EventRecord
): void {
  if (typeof event.agentId !== "string") {
    return
  }
  const agent = agents.get(event.agentId) ?? {
    agentId: event.agentId,
    label: null,
    model: null,
    phase: null,
    started: false,
    status: "incomplete" as const,
    terminalStatus: null,
    tokens: null
  }
  if (typeof event.label === "string") {
    agent.label = event.label
  }
  if (typeof event.phase === "string") {
    agent.phase = event.phase
  }
  if (typeof event.resolvedModel === "string") {
    agent.model = event.resolvedModel
  } else if (agent.model === null && typeof event.requestedModel === "string") {
    agent.model = event.requestedModel
  }
  if (event.type === "lifecycle" && event.lifecycle === "started") {
    agent.started = true
  }
  if (event.type === "terminal" && typeof event.status === "string") {
    agent.terminalStatus = event.status === "completed" ? "completed" : "failed"
    if (event.usage !== null && isJSONValue(event.usage)) {
      agent.tokens = event.usage
    }
  } else if (event.type === "usage" && isJSONValue(event.usage)) {
    agent.tokens = event.usage
  }
  agents.set(event.agentId, agent)
}

async function readJournalStatus(
  runDirectory: string,
  runId: string
): Promise<JournalRunStatus> {
  let source = ""
  try {
    source = await readFile(join(runDirectory, "journal.jsonl"), "utf8")
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error
    }
  }
  let started = 0
  let results = 0
  let unmatchedResults = 0
  const pending = new Map<string, number>()
  for (const line of source.split("\n")) {
    let entry: ReturnType<typeof parseWorkflowJournalEntry>
    try {
      entry = parseWorkflowJournalEntry(line)
    } catch {
      continue
    }
    const key = `${entry.agentId}\u0000${entry.key}`
    if (entry.type === "started") {
      started += 1
      pending.set(key, (pending.get(key) ?? 0) + 1)
      continue
    }
    results += 1
    const count = pending.get(key) ?? 0
    if (count === 0) {
      unmatchedResults += 1
    } else if (count === 1) {
      pending.delete(key)
    } else {
      pending.set(key, count - 1)
    }
  }
  const unmatchedStarted = [...pending.values()].reduce(
    (total, count) => total + count,
    0
  )
  return {
    journal: {
      results,
      started,
      unmatched: unmatchedStarted + unmatchedResults
    },
    journalOnly: true,
    runId,
    status: "unknown"
  }
}

function addTokenTotals(
  totals: RunTokenTotals,
  usage: AppServerJSONValue | null
): void {
  if (!isRecord(usage)) {
    return
  }
  const cumulative = isRecord(usage.total) ? usage.total : usage
  totals.inputTokens += tokenNumber(cumulative, "inputTokens", "input_tokens")
  totals.cachedInputTokens += tokenNumber(
    cumulative,
    "cachedInputTokens",
    "cached_input_tokens"
  )
  totals.outputTokens += tokenNumber(
    cumulative,
    "outputTokens",
    "output_tokens"
  )
  totals.reasoningOutputTokens += tokenNumber(
    cumulative,
    "reasoningOutputTokens",
    "reasoning_output_tokens"
  )
  totals.totalTokens += tokenNumber(cumulative, "totalTokens", "total_tokens")
}

function emptyTokenTotals(): RunTokenTotals {
  return {
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  }
}

function tokenNumber(
  usage: EventRecord,
  camelCase: string,
  snakeCase: string
): number {
  const value = usage[camelCase] ?? usage[snakeCase]
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isMissingFile(error)) {
      return false
    }
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  )
}

function isRecord(value: unknown): value is EventRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isJSONValue(value: unknown): value is AppServerJSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJSONValue)
  }
  return isRecord(value) && Object.values(value).every(isJSONValue)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
