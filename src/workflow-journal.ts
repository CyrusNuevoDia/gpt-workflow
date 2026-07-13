import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { JSONObject, JSONValue } from "./runtime.js"

type ReplayEntry = {
  agentId: string
  key: string
  result: JSONValue
}

export type WorkflowJournalStartedEntry = {
  agentId: string
  key: string
  type: "started"
}

export type WorkflowJournalResultEntry = {
  agentId: string
  key: string
  result: JSONValue
  type: "result"
}

export type WorkflowJournalEntry =
  | WorkflowJournalStartedEntry
  | WorkflowJournalResultEntry

export class WorkflowJournal {
  readonly directory: string
  readonly path: string
  private readonly replayEntries: Map<string, ReplayEntry[]>
  private writeTail: Promise<void> = Promise.resolve()

  private constructor(
    directory: string,
    replayEntries: Map<string, ReplayEntry[]>
  ) {
    this.directory = directory
    this.path = join(directory, "journal.jsonl")
    this.replayEntries = replayEntries
  }

  static async open(directory: string): Promise<WorkflowJournal> {
    await mkdir(directory, { recursive: true })
    const path = join(directory, "journal.jsonl")
    let source = ""
    try {
      source = await readFile(path, "utf8")
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error
      }
    }
    await appendFile(path, "")
    return new WorkflowJournal(directory, parseReplayEntries(source))
  }

  keyFor(prompt: string, options: JSONObject | undefined): string {
    const input = stableStringify({
      options: options ?? null,
      prompt
    })
    return `v3:${createHash("sha256").update(input).digest("hex")}`
  }

  replay(key: string): ReplayEntry | null {
    return this.replayEntries.get(key)?.shift() ?? null
  }

  appendStarted(
    entry: Omit<WorkflowJournalStartedEntry, "type">
  ): Promise<void> {
    return this.append({ type: "started", ...entry })
  }

  appendResult(entry: Omit<WorkflowJournalResultEntry, "type">): Promise<void> {
    return this.append({ type: "result", ...entry })
  }

  private append(line: WorkflowJournalEntry): Promise<void> {
    this.writeTail = this.writeTail.then(() =>
      appendFile(this.path, `${JSON.stringify(line)}\n`)
    )
    return this.writeTail
  }
}

export function parseWorkflowJournalEntry(
  source: string
): WorkflowJournalEntry {
  if (source.trim().length === 0) {
    throw new SyntaxError("workflow journal entry must not be blank")
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new SyntaxError("workflow journal entry must be valid JSON", {
      cause: error
    })
  }
  if (!isJournalEntry(value)) {
    throw new SyntaxError(
      "workflow journal entry must be a valid started or result record"
    )
  }
  return value
}

function parseReplayEntries(source: string): Map<string, ReplayEntry[]> {
  const results = new Map<string, WorkflowJournalResultEntry[]>()
  const lines = parseJournalLines(source)
  if (!lines) {
    return new Map()
  }
  for (const value of lines) {
    if (value.type === "result") {
      const entries = results.get(value.key) ?? []
      entries.push(value)
      results.set(value.key, entries)
    }
  }

  const replay = new Map<string, ReplayEntry[]>()
  for (const value of lines) {
    if (value.type !== "started") {
      continue
    }
    const started = value
    const matching =
      results
        .get(started.key)
        ?.findIndex((r) => r.agentId === started.agentId) ?? -1
    if (matching < 0) {
      continue
    }
    const result = results.get(started.key)?.splice(matching, 1)[0]
    if (!result) {
      throw new Error("UNEXPECTED EMPTY WORKFLOW JOURNAL RESULT")
    }
    const entries = replay.get(started.key) ?? []
    entries.push({
      agentId: started.agentId,
      key: started.key,
      result: result.result
    })
    replay.set(started.key, entries)
  }
  return replay
}

function parseJournalLines(source: string): WorkflowJournalEntry[] | null {
  const lines: WorkflowJournalEntry[] = []
  for (const line of source.split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    try {
      lines.push(parseWorkflowJournalEntry(line))
    } catch {
      return null
    }
  }
  return lines
}

function isJournalEntry(value: unknown): value is WorkflowJournalEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  if (record.type !== "started" && record.type !== "result") {
    return false
  }
  if (typeof record.key !== "string" || typeof record.agentId !== "string") {
    return false
  }
  return record.type === "started" || isJSONValue(record.result)
}

function isJSONValue(value: unknown): value is JSONValue {
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
  if (typeof value !== "object") {
    return false
  }
  return Object.values(value).every(isJSONValue)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
