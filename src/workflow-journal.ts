import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { JSONObject, JSONValue } from "./runtime.ts"

export type WorkflowJournalEntry = {
  agentId: string
  key: string
  result: JSONValue
}

type JournalStarted = {
  agentId: string
  key: string
  type: "started"
}

type JournalResult = {
  agentId: string
  key: string
  result: JSONValue
  type: "result"
}

type JournalLine = JournalStarted | JournalResult

export class WorkflowJournal {
  readonly directory: string
  readonly path: string
  private readonly replayEntries: WorkflowJournalEntry[]
  private writeTail: Promise<void> = Promise.resolve()

  private constructor(
    directory: string,
    replayEntries: WorkflowJournalEntry[]
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
    return new WorkflowJournal(directory, parseReplayEntries(source))
  }

  keyFor(
    previousKey: string,
    prompt: string,
    options: JSONObject | undefined
  ): string {
    const input = stableStringify({
      options: options ?? null,
      previousKey,
      prompt
    })
    return `v2:${createHash("sha256").update(input).digest("hex")}`
  }

  replay(index: number, key: string): WorkflowJournalEntry | null {
    const entry = this.replayEntries[index]
    return entry?.key === key ? entry : null
  }

  appendStarted(entry: Omit<JournalStarted, "type">): Promise<void> {
    return this.append({ type: "started", ...entry })
  }

  appendResult(entry: Omit<JournalResult, "type">): Promise<void> {
    return this.append({ type: "result", ...entry })
  }

  private append(line: JournalLine): Promise<void> {
    this.writeTail = this.writeTail.then(() =>
      appendFile(this.path, `${JSON.stringify(line)}\n`)
    )
    return this.writeTail
  }
}

function parseReplayEntries(source: string): WorkflowJournalEntry[] {
  const starts = new Map<string, JournalStarted[]>()
  const results = new Map<string, JournalResult[]>()
  const lines = parseJournalLines(source)
  if (!lines) {
    return []
  }
  for (const value of lines) {
    if (value.type === "started") {
      const entries = starts.get(value.key) ?? []
      entries.push(value)
      starts.set(value.key, entries)
    } else {
      const entries = results.get(value.key) ?? []
      entries.push(value)
      results.set(value.key, entries)
    }
  }

  const replay: WorkflowJournalEntry[] = []
  for (const entries of starts.values()) {
    for (const started of entries) {
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
      replay.push({
        agentId: started.agentId,
        key: started.key,
        result: result.result
      })
    }
  }
  return replay
}

function parseJournalLines(source: string): JournalLine[] | null {
  const lines: JournalLine[] = []
  for (const line of source.split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return null
    }
    if (!isJournalLine(value)) {
      return null
    }
    lines.push(value)
  }
  return lines
}

function isJournalLine(value: unknown): value is JournalLine {
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
