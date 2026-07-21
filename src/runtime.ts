import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { createContext, runInContext, Script } from "node:vm"
import type {
  AppServerAgentHandle,
  AppServerAgentOptions,
  AppServerClient,
  AppServerJSONValue,
  AppServerNormalizedEvent,
  AppServerNormalizedEventListener
} from "./app-server.js"
import {
  AppServerRemoteError,
  AppServerResultError,
  AppServerTimeoutError,
  AppServerTurnError
} from "./app-server.js"
import { WorkflowJournal } from "./workflow-journal.js"
import {
  resolveWorkflowCaps,
  WorkflowCanceledError,
  type WorkflowCapOptions,
  WorkflowRunState,
  type WorkflowUsage
} from "./workflow-state.js"
import {
  findStoredWorkflowRuns,
  isDirectory,
  isSafePathSegment,
  workflowRunDirectory
} from "./workflow-storage.js"
import { createWorkflowWorktree, type WorkflowWorktree } from "./worktree.js"

export type JSONPrimitive = string | number | boolean | null
export type JSONValue = JSONPrimitive | JSONArray | JSONObject
export type JSONArray = JSONValue[]
export type JSONObject = { [key: string]: JSONValue }

export type WorkflowPhase = {
  detail?: string
  model?: string
  title: string
}

export type WorkflowMeta = {
  description: string
  name: string
  phases?: WorkflowPhase[]
  whenToUse?: string
}

export type LoadedWorkflowScript = {
  body: string
  meta: WorkflowMeta
}

export type WorkflowPhaseEvent = {
  detail: string | null
  title: string
  type: "phase"
}

export type WorkflowLogEvent = {
  message: string
  type: "log"
}

export type WorkflowEvent = WorkflowPhaseEvent | WorkflowLogEvent

export type WorkflowEventNotification = {
  depth: number
  event: WorkflowEvent
  fileName: string
}

export type WorkflowEventListener = (
  notification: WorkflowEventNotification
) => void

export type WorkflowFailure = {
  agentId?: string
  index: number
  kind: "agent" | "parallel" | "pipeline"
  message: string
  stage?: number
}

export type WorkflowAgent = (
  prompt: string,
  options?: JSONObject
) => JSONValue | Promise<JSONValue>

export type WorkflowReference = string | { scriptPath: string }

export type WorkflowChild = (
  reference: WorkflowReference,
  args?: JSONValue
) => JSONValue | Promise<JSONValue>

export type OfflineBudgetOptions = {
  spent?: number | (() => number)
  total?: number | null
}

export type WorkflowExecutionOptions = {
  agent?: WorkflowAgent
  appServer?: AppServerClient
  args?: JSONValue
  budget?: OfflineBudgetOptions
  caps?: WorkflowCapOptions
  cwd?: string
  eventTimestamp?: () => number
  fileName?: string
  onAgentEvent?: AppServerNormalizedEventListener
  onAgentStart?: (handle: AppServerAgentHandle) => void
  onWorkflowEvent?: WorkflowEventListener
  resumeFromRunId?: string
  signal?: AbortSignal
  runDirectory?: string
  workflow?: WorkflowChild
  workflowDirectory?: string
  workflowRunId?: string
}

export type WorkflowExecution = {
  agentEvents: AppServerNormalizedEvent[]
  events: WorkflowEvent[]
  failures: WorkflowFailure[]
  journalPath: string | null
  meta: WorkflowMeta
  result: JSONValue
  usage: WorkflowUsage
  workflowRunId: string
}

const DATE_ERROR =
  "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args."
const RANDOM_ERROR =
  "Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt."
const NUMBER_LITERAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
const CONTINUED_LITERAL_PATTERN = /^(?:in|instanceof)\b/
const AGENT_ORDINAL_PATTERN = /:agent-(\d+)$/
const HEX_DIGIT_PATTERN = /^[0-9a-fA-F]$/
const IDENTIFIER_START_PATTERN = /^[A-Za-z_$]$/
const WHITESPACE_PATTERN = /\s/
export class WorkflowLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "WorkflowLoadError"
  }
}

export class JSONBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JSONBoundaryError"
  }
}

class AgentExecutionError extends Error {
  constructor(error: unknown, options: ErrorOptions) {
    super(describeError(error), options)
    this.name = "AgentExecutionError"
  }
}

class LiteralMetaParser {
  private readonly fileName: string
  private index = 0
  private readonly source: string

  constructor(source: string, fileName: string) {
    this.source = source
    this.fileName = fileName
  }

  parse(): LoadedWorkflowScript {
    this.skipTrivia()
    this.expectWord("export")
    this.expectWord("const")
    this.expectWord("meta")
    this.skipTrivia()
    this.expectCharacter("=")

    const value = this.parseLiteral()
    this.validateMeta(value)

    const sawLineBreak = this.skipTrivia()
    if (this.source[this.index] === ";") {
      this.index += 1
    } else if (this.index < this.source.length && !sawLineBreak) {
      this.fail("meta must be the first complete statement")
    } else if (this.canContinueLiteralExpression()) {
      this.fail("meta must end before the workflow body")
    }

    return {
      body: this.source.slice(this.index),
      meta: value as unknown as WorkflowMeta
    }
  }

  private parseLiteral(): JSONValue {
    this.skipTrivia()
    const character = this.source[this.index]

    if (character === "{") {
      return this.parseObject()
    }
    if (character === "[") {
      return this.parseArray()
    }
    if (character === "'" || character === '"') {
      return this.parseString()
    }
    if (character === "-" || this.isDigit(character)) {
      return this.parseNumber()
    }

    const word = this.readIdentifier()
    if (word === "true") {
      return true
    }
    if (word === "false") {
      return false
    }
    if (word === "null") {
      return null
    }

    this.fail(
      word
        ? `meta contains non-literal identifier ${JSON.stringify(word)}`
        : "meta value must be a pure object, array, string, number, boolean, or null literal"
    )
  }

  private parseObject(): JSONObject {
    this.expectCharacter("{")
    const result: JSONObject = {}
    this.skipTrivia()

    if (this.source[this.index] === "}") {
      this.index += 1
      return result
    }

    while (this.index < this.source.length) {
      this.skipTrivia()
      if (this.source.startsWith("...", this.index)) {
        this.fail("meta object spreads are not allowed")
      }

      const key = this.parsePropertyKey()
      this.skipTrivia()
      this.expectCharacter(":")
      const value = this.parseLiteral()
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      })

      this.skipTrivia()
      if (this.source[this.index] === "}") {
        this.index += 1
        return result
      }
      this.expectCharacter(",")
      this.skipTrivia()
      if (this.source[this.index] === "}") {
        this.index += 1
        return result
      }
    }

    this.fail("unterminated meta object")
  }

  private parseArray(): JSONArray {
    this.expectCharacter("[")
    const result: JSONArray = []
    this.skipTrivia()

    if (this.source[this.index] === "]") {
      this.index += 1
      return result
    }

    while (this.index < this.source.length) {
      this.skipTrivia()
      if (this.source[this.index] === "," || this.source[this.index] === "]") {
        this.fail("meta arrays cannot contain holes")
      }
      result.push(this.parseLiteral())
      this.skipTrivia()
      if (this.source[this.index] === "]") {
        this.index += 1
        return result
      }
      this.expectCharacter(",")
      this.skipTrivia()
      if (this.source[this.index] === "]") {
        this.index += 1
        return result
      }
    }

    this.fail("unterminated meta array")
  }

  private parsePropertyKey(): string {
    const character = this.source[this.index]
    if (character === "'" || character === '"') {
      return this.parseString()
    }

    if (this.isDigit(character)) {
      const start = this.index
      while (this.isDigit(this.source[this.index])) {
        this.index += 1
      }
      return String(Number(this.source.slice(start, this.index)))
    }

    const key = this.readIdentifier()
    if (!key || this.source[this.index] === "[") {
      this.fail(
        "meta object keys must be static identifiers or string/number literals"
      )
    }
    return key
  }

  private parseString(): string {
    const quote = this.source[this.index]
    this.index += 1
    let result = ""

    while (this.index < this.source.length) {
      const character = this.source[this.index]
      this.index += 1
      if (character === quote) {
        return result
      }
      if (character === "\n" || character === "\r") {
        this.fail("meta strings cannot contain an unescaped line break")
      }
      if (character !== "\\") {
        result += character
        continue
      }

      result += this.parseStringEscape()
    }

    this.fail("unterminated meta string")
  }

  private parseStringEscape(): string {
    if (this.index >= this.source.length) {
      this.fail("unterminated meta string")
    }
    const escapeSeq = this.source[this.index] ?? ""
    this.index += 1
    const escapes: Record<string, string> = {
      "'": "'",
      '"': '"',
      "\\": "\\",
      0: "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v"
    }
    if (escapeSeq in escapes) {
      return escapes[escapeSeq] ?? ""
    }
    if (escapeSeq === "\n") {
      return ""
    }
    if (escapeSeq === "\r") {
      if (this.source[this.index] === "\n") {
        this.index += 1
      }
      return ""
    }
    if (escapeSeq === "x") {
      return String.fromCharCode(this.readHex(2))
    }
    if (escapeSeq === "u") {
      return this.parseUnicodeEscape()
    }
    this.fail(`unsupported escape sequence \\${escapeSeq} in meta string`)
  }

  private parseUnicodeEscape(): string {
    if (this.source[this.index] !== "{") {
      return String.fromCharCode(this.readHex(4))
    }
    this.index += 1
    const start = this.index
    while (this.isHexDigit(this.source[this.index])) {
      this.index += 1
    }
    if (this.source[this.index] !== "}" || start === this.index) {
      this.fail("invalid Unicode escape in meta string")
    }
    const codePoint = Number.parseInt(this.source.slice(start, this.index), 16)
    this.index += 1
    if (!Number.isInteger(codePoint) || codePoint > 0x10_ff_ff) {
      this.fail("invalid Unicode escape in meta string")
    }
    return String.fromCodePoint(codePoint)
  }

  private parseNumber(): number {
    const match = NUMBER_LITERAL_PATTERN.exec(this.source.slice(this.index))
    if (!match) {
      this.fail("invalid numeric literal in meta")
    }
    this.index += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) {
      this.fail("meta numbers must be finite")
    }
    return value
  }

  private validateMeta(value: JSONValue): void {
    if (!isPlainJSONObject(value)) {
      this.fail("meta must be an object literal")
    }
    if (typeof value.name !== "string" || value.name.length === 0) {
      this.fail("meta.name is required and must be a non-empty string")
    }
    if (!isSafePathSegment(value.name)) {
      this.fail(
        "meta.name must contain only letters, numbers, periods, underscores, and hyphens, and must not be . or .."
      )
    }
    if (
      typeof value.description !== "string" ||
      value.description.length === 0
    ) {
      this.fail("meta.description is required and must be a non-empty string")
    }
    if ("whenToUse" in value && typeof value.whenToUse !== "string") {
      this.fail("meta.whenToUse must be a string")
    }
    if ("phases" in value) {
      this.validatePhases(value.phases)
    }
  }

  private validatePhases(phases: JSONValue): void {
    if (!Array.isArray(phases)) {
      this.fail("meta.phases must be an array")
    }
    for (const phase of phases) {
      if (!isPlainJSONObject(phase) || typeof phase.title !== "string") {
        this.fail("each meta.phases entry must have a string title")
      }
      if ("detail" in phase && typeof phase.detail !== "string") {
        this.fail("meta phase detail must be a string")
      }
      if ("model" in phase && typeof phase.model !== "string") {
        this.fail("meta phase model must be a string")
      }
    }
  }

  private readIdentifier(): string {
    const start = this.index
    if (!this.isIdentifierStart(this.source[this.index])) {
      return ""
    }
    this.index += 1
    while (this.isIdentifierPart(this.source[this.index])) {
      this.index += 1
    }
    return this.source.slice(start, this.index)
  }

  private canContinueLiteralExpression(): boolean {
    const character = this.source[this.index]
    if (character !== undefined && ".([`+-*/%<>=!&|^?:,".includes(character)) {
      return true
    }
    return CONTINUED_LITERAL_PATTERN.test(this.source.slice(this.index))
  }

  private expectWord(word: string): void {
    this.skipTrivia()
    if (this.readIdentifier() !== word) {
      this.fail(`expected ${word}`)
    }
  }

  private expectCharacter(character: string): void {
    if (this.source[this.index] !== character) {
      this.fail(`expected ${JSON.stringify(character)}`)
    }
    this.index += 1
  }

  private skipTrivia(): boolean {
    let sawLineBreak = false
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (character !== undefined && WHITESPACE_PATTERN.test(character)) {
        sawLineBreak ||= character === "\n" || character === "\r"
        this.index += 1
        continue
      }
      if (this.source.startsWith("//", this.index)) {
        this.skipLineComment()
        continue
      }
      if (this.source.startsWith("/*", this.index)) {
        sawLineBreak ||= this.skipBlockComment()
        continue
      }
      break
    }
    return sawLineBreak
  }

  private skipLineComment(): void {
    this.index += 2
    while (
      this.index < this.source.length &&
      this.source[this.index] !== "\n"
    ) {
      this.index += 1
    }
  }

  private skipBlockComment(): boolean {
    this.index += 2
    let sawLineBreak = false
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      sawLineBreak ||= character === "\n" || character === "\r"
      if (this.source.startsWith("*/", this.index)) {
        this.index += 2
        return sawLineBreak
      }
      this.index += 1
    }
    this.fail("unterminated comment in meta")
  }

  private readHex(length: number): number {
    const value = this.source.slice(this.index, this.index + length)
    if (
      value.length !== length ||
      [...value].some((character) => !this.isHexDigit(character))
    ) {
      this.fail("invalid hexadecimal escape in meta string")
    }
    this.index += length
    return Number.parseInt(value, 16)
  }

  private fail(message: string): never {
    throw new WorkflowLoadError(`${this.fileName}: ${message}`)
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9"
  }

  private isHexDigit(character: string | undefined): boolean {
    return character !== undefined && HEX_DIGIT_PATTERN.test(character)
  }

  private isIdentifierStart(character: string | undefined): boolean {
    return character !== undefined && IDENTIFIER_START_PATTERN.test(character)
  }

  private isIdentifierPart(character: string | undefined): boolean {
    return this.isIdentifierStart(character) || this.isDigit(character)
  }
}

export function parseWorkflowScript(
  source: string,
  fileName = "workflow.js"
): LoadedWorkflowScript {
  if (typeof source !== "string") {
    throw new WorkflowLoadError(`${fileName}: workflow source must be a string`)
  }
  return new LiteralMetaParser(source, fileName).parse()
}

function isPlainJSONObject(value: unknown): value is JSONObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype === null) {
    return true
  }
  if (Object.getPrototypeOf(prototype) !== null) {
    return false
  }
  const objectConstructor = Object.getOwnPropertyDescriptor(
    prototype,
    "constructor"
  )?.value
  return (
    typeof objectConstructor === "function" &&
    objectConstructor.name === "Object"
  )
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { message } = error as { message?: unknown }
    if (typeof message === "string") {
      return message
    }
  }
  if (typeof error === "string") {
    return error
  }
  return String(error)
}

function isAppServerAgentError(error: unknown): boolean {
  return (
    error instanceof AppServerTurnError ||
    error instanceof AppServerResultError ||
    error instanceof AppServerTimeoutError ||
    error instanceof AppServerRemoteError
  )
}

function cloneJSONValue(
  value: unknown,
  path: string,
  active: WeakSet<object> = new WeakSet()
): JSONValue {
  if (value === null) {
    return null
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return value
    case "number":
      if (!Number.isFinite(value)) {
        throw new JSONBoundaryError(
          `${path}: non-finite numbers are not JSON-compatible`
        )
      }
      return value
    case "undefined":
      throw new JSONBoundaryError(`${path}: undefined is not JSON-compatible`)
    case "function":
      throw new JSONBoundaryError(`${path}: functions are not JSON-compatible`)
    case "symbol":
      throw new JSONBoundaryError(`${path}: symbols are not JSON-compatible`)
    case "bigint":
      throw new JSONBoundaryError(`${path}: bigint is not JSON-compatible`)
    case "object":
      break
    default:
      throw new JSONBoundaryError(`${path}: unsupported JSON value`)
  }

  if (active.has(value)) {
    throw new JSONBoundaryError(
      `${path}: cyclic values are not JSON-compatible`
    )
  }
  active.add(value)

  try {
    if (Array.isArray(value)) {
      return cloneJSONArray(value, path, active)
    }
    return cloneJSONObject(value, path, active)
  } finally {
    active.delete(value)
  }
}

function cloneJSONArray(
  value: unknown[],
  path: string,
  active: WeakSet<object>
): JSONArray {
  const result: JSONArray = []
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new JSONBoundaryError(
        `${path}[${index}]: array holes are not JSON-compatible`
      )
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!(descriptor?.enumerable && "value" in descriptor)) {
      throw new JSONBoundaryError(
        `${path}[${index}]: accessor or non-enumerable properties are not JSON-compatible`
      )
    }
    result.push(cloneJSONValue(descriptor.value, `${path}[${index}]`, active))
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue
    }
    if (typeof key === "symbol") {
      throw new JSONBoundaryError(
        `${path}: symbol keys are not JSON-compatible`
      )
    }
    const numericIndex = Number(key)
    if (
      !Number.isInteger(numericIndex) ||
      numericIndex < 0 ||
      numericIndex >= value.length ||
      String(numericIndex) !== key
    ) {
      throw new JSONBoundaryError(
        `${path}: array properties must be indexed JSON values`
      )
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!(descriptor?.enumerable && "value" in descriptor)) {
      throw new JSONBoundaryError(
        `${path}[${key}]: accessor or non-enumerable properties are not JSON-compatible`
      )
    }
  }
  return result
}

function cloneJSONObject(
  value: object,
  path: string,
  active: WeakSet<object>
): JSONObject {
  if (!isPlainJSONObject(value)) {
    throw new JSONBoundaryError(
      `${path}: only plain objects are JSON-compatible`
    )
  }
  const result: JSONObject = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new JSONBoundaryError(
        `${path}: symbol keys are not JSON-compatible`
      )
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!(descriptor?.enumerable && "value" in descriptor)) {
      throw new JSONBoundaryError(
        `${path}.${key}: accessor or non-enumerable properties are not JSON-compatible`
      )
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneJSONValue(descriptor.value, `${path}.${key}`, active),
      writable: true
    })
  }
  return result
}

function makeBoundaryError(
  createError: (name: string, message: string) => unknown,
  error: unknown
): never {
  const name =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "Error"
  throw createError(name, describeError(error))
}

function makeSafeHostFunction<T extends (...args: never[]) => unknown>(
  handler: T,
  createError: (name: string, message: string) => unknown
): T {
  const safe = (...args: never[]) => {
    try {
      const result = handler(...args)
      if (result instanceof Promise) {
        return result.catch((error: unknown) =>
          makeBoundaryError(createError, error)
        )
      }
      return result
    } catch (error) {
      return makeBoundaryError(createError, error)
    }
  }
  Object.setPrototypeOf(safe, null)
  return safe as T
}

const VM_SETUP = `
(() => {
  const OriginalDate = Date
  const SafeDate = function (...values) {
    if (values.length === 0) throw new Error(${JSON.stringify(DATE_ERROR)})
    return Reflect.construct(OriginalDate, values, new.target === undefined ? SafeDate : new.target)
  }
  SafeDate.prototype = OriginalDate.prototype
  Object.defineProperty(SafeDate.prototype, 'constructor', {
    configurable: true,
    value: SafeDate,
    writable: true,
  })
  SafeDate.now = function () { throw new Error(${JSON.stringify(DATE_ERROR)}) }
  SafeDate.parse = OriginalDate.parse
  SafeDate.UTC = OriginalDate.UTC
  Object.freeze(SafeDate)
  globalThis.Date = SafeDate

  const OriginalMath = Math
  const SafeMath = Object.create(null)
  for (const key of Object.getOwnPropertyNames(OriginalMath)) {
    if (key !== 'random') Object.defineProperty(SafeMath, key, Object.getOwnPropertyDescriptor(OriginalMath, key))
  }
  Object.defineProperty(SafeMath, 'random', {
    value: function () { throw new Error(${JSON.stringify(RANDOM_ERROR)}) },
  })
  Object.freeze(SafeMath)
  globalThis.Math = SafeMath

  const FunctionPrototype = Function.prototype
  Object.defineProperty(FunctionPrototype, 'constructor', { value: undefined })
  for (const callable of [async function () {}, function* () {}, async function* () {}]) {
    Object.defineProperty(Object.getPrototypeOf(callable), 'constructor', { value: undefined })
  }
  Object.defineProperty(globalThis, 'constructor', { value: undefined })

  for (const name of ['Function', 'eval', 'ShadowRealm', 'process', 'require', 'Bun', 'Deno', 'module', 'exports', '__dirname', '__filename', 'fetch', 'setInterval', 'clearInterval', 'queueMicrotask', 'performance']) {
    delete globalThis[name]
  }
})()
`

type WorkflowRunContext = {
  readonly agentEvents: AppServerNormalizedEvent[]
  readonly journal: WorkflowJournal | null
  readonly onAgentEvent: AppServerNormalizedEventListener
  replayMissed: boolean
  readonly resumeEnabled: boolean
  readonly rootOptions: WorkflowExecutionOptions
  readonly state: WorkflowRunState
  readonly workflowDirectory: string
}

type InternalWorkflowExecution = {
  events: WorkflowEvent[]
  failures: WorkflowFailure[]
  meta: WorkflowMeta
  result: JSONValue
}

const NESTING_ERROR =
  "workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly."

export async function runWorkflowScript(
  source: string,
  options: WorkflowExecutionOptions = {}
): Promise<WorkflowExecution> {
  const fileName = options.fileName ?? "workflow.js"
  const loaded = parseWorkflowScript(source, fileName)
  const workflowRunId =
    options.resumeFromRunId ??
    options.workflowRunId ??
    `workflow-${randomUUID()}`
  const budgetTotal = options.budget?.total ?? null
  if (
    budgetTotal !== null &&
    (!Number.isFinite(budgetTotal) || budgetTotal < 0)
  ) {
    throw new TypeError(
      "budget.total must be null or a finite non-negative number"
    )
  }
  const state = new WorkflowRunState({
    budgetTotal,
    caps: resolveWorkflowCaps(options.caps),
    signal: options.signal,
    spentSource: options.budget?.spent ?? 0,
    workflowRunId
  })
  const projectDirectory = options.cwd ?? process.cwd()
  const runDirectory = await resolveRunDirectory(
    loaded.meta.name,
    workflowRunId,
    projectDirectory,
    options
  )
  const journal =
    runDirectory === null ? null : await WorkflowJournal.open(runDirectory)
  const agentEvents: AppServerNormalizedEvent[] = []
  const context: WorkflowRunContext = {
    agentEvents,
    journal,
    onAgentEvent: (event) => {
      agentEvents.push(event)
      options.onAgentEvent?.(event)
    },
    replayMissed: false,
    resumeEnabled: options.resumeFromRunId !== undefined,
    rootOptions: options,
    state,
    workflowDirectory:
      options.workflowDirectory ?? resolve(process.cwd(), ".codex", "workflows")
  }
  const execution = await executeWorkflow(
    loaded,
    options.args,
    fileName,
    0,
    context
  )
  return {
    ...execution,
    agentEvents,
    journalPath: journal?.path ?? null,
    usage: state.usage,
    workflowRunId
  }
}

async function resolveRunDirectory(
  workflowName: string,
  workflowRunId: string,
  projectDirectory: string,
  options: WorkflowExecutionOptions
): Promise<string | null> {
  if (options.runDirectory !== undefined) {
    if (
      options.resumeFromRunId !== undefined &&
      !(await isDirectory(options.runDirectory))
    ) {
      throw new Error(`run not found: ${options.resumeFromRunId}`)
    }
    return options.runDirectory
  }
  if (
    options.appServer === undefined &&
    options.resumeFromRunId === undefined
  ) {
    return null
  }
  if (options.resumeFromRunId === undefined) {
    return workflowRunDirectory(projectDirectory, workflowName, workflowRunId)
  }
  const matches = await findStoredWorkflowRuns(
    projectDirectory,
    options.resumeFromRunId
  )
  if (matches.length === 0) {
    throw new Error(`run not found: ${options.resumeFromRunId}`)
  }
  if (matches.length > 1) {
    throw new Error(`run ID is ambiguous: ${options.resumeFromRunId}`)
  }
  const [match] = matches
  if (match?.workflowName !== workflowName) {
    throw new Error(
      `run ${options.resumeFromRunId} belongs to workflow ${match?.workflowName}, not ${workflowName}`
    )
  }
  return match.directory
}

async function executeWorkflow(
  loaded: LoadedWorkflowScript,
  input: JSONValue | undefined,
  fileName: string,
  depth: number,
  runContext: WorkflowRunContext
): Promise<InternalWorkflowExecution> {
  const events: WorkflowEvent[] = []
  const failures: WorkflowFailure[] = []
  let currentPhase: string | null = null
  const options = runContext.rootOptions
  const { state } = runContext

  const contextInput =
    input === undefined
      ? undefined
      : JSON.stringify(cloneJSONValue(input, "args"))
  const context = createContext({ __workflowInputJSON: contextInput })
  runInContext(VM_SETUP, context, { filename: `${fileName}:setup` })
  const createError = runInContext(
    "(name, message) => { const error = new Error(message); error.name = name; return error }",
    context
  ) as (name: string, message: string) => unknown

  const marshal = (boundaryValue: JSONValue, path: string): JSONValue => {
    const safeValue = cloneJSONValue(boundaryValue, path)
    const contextRecord = context as unknown as Record<string, unknown>
    contextRecord.__workflowBoundaryJSON = JSON.stringify(safeValue)
    try {
      return runInContext(
        "JSON.parse(__workflowBoundaryJSON)",
        context
      ) as JSONValue
    } finally {
      contextRecord.__workflowBoundaryJSON = undefined
    }
  }

  const contextRecord = context as unknown as Record<string, unknown>
  contextRecord.args =
    input === undefined
      ? undefined
      : runInContext("JSON.parse(__workflowInputJSON)", context)
  contextRecord.__workflowInputJSON = undefined

  const budgetSpent = makeSafeHostFunction(
    () => state.budget.spent(),
    createError
  )
  const budgetRemaining = makeSafeHostFunction(
    () => state.budget.remaining(),
    createError
  )
  const budget = Object.freeze(
    Object.assign(Object.create(null), {
      remaining: budgetRemaining,
      spent: budgetSpent,
      total: state.budget.total
    })
  )

  const runInjectedAgent = async (
    prompt: string,
    callOptions: JSONObject
  ): Promise<JSONValue> => {
    try {
      const result = await waitForCancellation(
        Promise.resolve(options.agent?.(prompt, callOptions)),
        state.signal
      )
      return result === undefined ? null : result
    } catch (error) {
      if (error instanceof WorkflowCanceledError) {
        throw error
      }
      throw new AgentExecutionError(error, { cause: error })
    }
  }

  const runAppServerAgent = async (
    prompt: string,
    callOptions: JSONObject,
    agentId: string,
    requestedModel: string
  ): Promise<JSONValue> => {
    if (!options.appServer) {
      throw new Error("agent() is unavailable in the offline workflow runtime")
    }
    let handle: AppServerAgentHandle
    try {
      handle = await options.appServer.startAgent(prompt, {
        ...(callOptions as unknown as AppServerAgentOptions),
        agentId,
        eventSink: (event) => {
          runContext.onAgentEvent(event)
          if (event.agentId === agentId && event.type === "usage") {
            state.budget.recordAgentUsage(
              agentId,
              extractOutputTokens(event.usage),
              requestedModel
            )
          }
        },
        eventTimestamp: options.eventTimestamp,
        workflowRunId: state.workflowRunId
      })
    } catch (error) {
      if (isAppServerAgentError(error)) {
        throw new AgentExecutionError(error, { cause: error })
      }
      throw error
    }
    const unregister = state.registerHandle(handle)
    try {
      options.onAgentStart?.(handle)
      let call: Awaited<ReturnType<AppServerAgentHandle["result"]>>
      try {
        call = await waitForCancellation(handle.result(), state.signal)
      } catch (error) {
        if (isAppServerAgentError(error)) {
          throw new AgentExecutionError(error, { cause: error })
        }
        throw error
      }
      state.budget.recordAgentUsage(
        agentId,
        extractOutputTokens(call.evidence.usage),
        requestedModel
      )
      return call.result
    } finally {
      unregister()
    }
  }

  const runLiveAgent = async (
    prompt: string,
    agentOptions: JSONObject | undefined,
    agentId: string
  ): Promise<JSONValue> => {
    state.budget.assertAvailable()
    const requestedCwd =
      typeof agentOptions?.cwd === "string"
        ? agentOptions.cwd
        : (options.cwd ?? process.cwd())
    const isolation = agentOptions?.isolation === "worktree"
    let worktree: WorkflowWorktree | null = null
    try {
      if (isolation) {
        worktree = await createWorkflowWorktree(
          requestedCwd,
          state.workflowRunId,
          state.nextWorktreeNumber()
        )
      }
      const callOptions = {
        ...(agentOptions ?? {}),
        ...(isolation ? { sandbox: "workspace-write" } : {}),
        ...(worktree === null && options.cwd === undefined
          ? {}
          : { cwd: worktree?.path ?? requestedCwd })
      } satisfies JSONObject
      const requestedModel =
        typeof (callOptions as JSONObject).model === "string"
          ? ((callOptions as JSONObject).model as string)
          : "unknown"
      state.markLiveAgent(requestedModel)
      if (options.agent) {
        return await runInjectedAgent(prompt, callOptions)
      }
      return await runAppServerAgent(
        prompt,
        callOptions,
        agentId,
        requestedModel
      )
    } finally {
      await worktree?.cleanup()
    }
  }

  const runAgent = (
    prompt: string,
    journalOptions: JSONObject | undefined,
    callOptions: JSONObject | undefined
  ): JSONValue | Promise<JSONValue> => {
    const agentId = state.reserveAgent()
    const key = runContext.journal?.keyFor(prompt, journalOptions) ?? null
    const replay =
      runContext.resumeEnabled && !runContext.replayMissed && key !== null
        ? (runContext.journal?.replay(key) ?? null)
        : null
    if (replay !== null) {
      state.markReplayedAgent(
        typeof callOptions?.model === "string" ? callOptions.model : "unknown"
      )
      return cloneJSONValue(replay.result, "replayed agent result")
    }
    if (runContext.resumeEnabled && key !== null) {
      runContext.replayMissed = true
    }
    const started =
      key === null || runContext.journal === null
        ? Promise.resolve()
        : runContext.journal.appendStarted({ agentId, key })
    return state.scheduleAgent(async () => {
      await started
      let result: JSONValue
      try {
        result = await runLiveAgent(prompt, callOptions, agentId)
      } catch (error) {
        if (!(error instanceof AgentExecutionError)) {
          throw error
        }
        failures.push({
          agentId,
          index: Number.parseInt(
            agentId.match(AGENT_ORDINAL_PATTERN)?.[1] ?? "0",
            10
          ),
          kind: "agent",
          message: error.message
        })
        return null
      }
      if (key !== null && runContext.journal !== null) {
        await runContext.journal.appendResult({
          agentId,
          key,
          result: cloneJSONValue(result, "agent result")
        })
      }
      return result
    })
  }

  const agent = makeSafeHostFunction(
    async (prompt: unknown, rawOptions?: unknown) => {
      if (typeof prompt !== "string") {
        throw new TypeError("agent() prompt must be a string")
      }
      let agentOptions: JSONObject | undefined
      if (rawOptions !== undefined) {
        if (!isPlainJSONObject(rawOptions)) {
          throw new TypeError("agent() options must be a plain object")
        }
        agentOptions = cloneJSONValue(rawOptions, "agent options") as JSONObject
      }
      const journalOptions = agentOptions
      let callOptions = agentOptions
      if (callOptions === undefined && currentPhase !== null) {
        callOptions = { phase: currentPhase }
      } else if (
        callOptions !== undefined &&
        callOptions.phase === undefined &&
        currentPhase !== null
      ) {
        callOptions = { ...callOptions, phase: currentPhase }
      }
      const result = await runAgent(prompt, journalOptions, callOptions)
      return marshal(result, "agent result")
    },
    createError
  )

  const runWorkflow = async (
    reference: WorkflowReference,
    childArgs: JSONValue | undefined
  ): Promise<JSONValue> => {
    if (depth >= state.caps.maxWorkflowDepth) {
      throw new Error(NESTING_ERROR)
    }
    if (options.workflow) {
      return options.workflow(reference, childArgs)
    }
    const child = await loadReferencedWorkflow(
      reference,
      fileName,
      runContext.workflowDirectory
    )
    const childExecution = await executeWorkflow(
      child.loaded,
      childArgs,
      child.fileName,
      depth + 1,
      runContext
    )
    failures.push(...childExecution.failures)
    return childExecution.result
  }
  const workflow = makeSafeHostFunction(
    async (rawReference: unknown, rawArgs?: unknown) => {
      if (
        typeof rawReference !== "string" &&
        !isPlainJSONObject(rawReference)
      ) {
        throw new TypeError(
          "workflow() reference must be a name or { scriptPath } object"
        )
      }
      if (
        isPlainJSONObject(rawReference) &&
        typeof rawReference.scriptPath !== "string"
      ) {
        throw new TypeError("workflow() reference.scriptPath must be a string")
      }
      const reference = cloneJSONValue(
        rawReference,
        "workflow reference"
      ) as WorkflowReference
      const childArgs =
        rawArgs === undefined
          ? undefined
          : cloneJSONValue(rawArgs, "workflow args")
      const result = await runWorkflow(reference, childArgs)
      return marshal(result === undefined ? null : result, "workflow result")
    },
    createError
  )

  const phase = makeSafeHostFunction((title: unknown) => {
    if (typeof title !== "string") {
      throw new TypeError("phase() title must be a string")
    }
    currentPhase = title
    const configured = loaded.meta.phases?.find(
      (entry) => entry.title === title
    )
    const event = {
      detail: configured?.detail ?? null,
      title,
      type: "phase" as const
    }
    events.push(event)
    options.onWorkflowEvent?.({ depth, event, fileName })
  }, createError)

  const log = makeSafeHostFunction((message: unknown) => {
    if (typeof message !== "string") {
      throw new TypeError("log() message must be a string")
    }
    const event = { message, type: "log" as const }
    events.push(event)
    options.onWorkflowEvent?.({ depth, event, fileName })
  }, createError)

  const consoleLog = makeSafeHostFunction((...values: unknown[]) => {
    const message = values
      .map((entry) => {
        if (typeof entry === "string") {
          return entry
        }
        if (entry !== null && typeof entry === "object") {
          try {
            return JSON.stringify(entry)
          } catch {
            return String(entry)
          }
        }
        return String(entry)
      })
      .join(" ")
    const event = { message, type: "log" as const }
    events.push(event)
    options.onWorkflowEvent?.({ depth, event, fileName })
  }, createError)

  const assertCollection = (
    name: string,
    collection: unknown
  ): collection is unknown[] => {
    if (!Array.isArray(collection)) {
      throw new TypeError(`${name}() requires an array`)
    }
    if (collection.length > state.caps.maxBoundaryItems) {
      throw new RangeError(
        `array length ${collection.length} exceeds the maximum of ${state.caps.maxBoundaryItems} supported across the workflow VM boundary`
      )
    }
    return true
  }

  const parallel = makeSafeHostFunction((thunks: unknown) => {
    assertCollection("parallel", thunks)
    const slots = (thunks as unknown[]).map((thunk, index) =>
      Promise.resolve()
        .then(() => {
          if (typeof thunk !== "function") {
            throw new TypeError("parallel() entries must be thunks")
          }
          return (thunk as () => unknown)()
        })
        .then((slotValue) =>
          marshal(
            slotValue === undefined ? null : (slotValue as JSONValue),
            `parallel[${index}]`
          )
        )
        .catch((error: unknown) => {
          if (
            typeof error === "object" &&
            error !== null &&
            (error as { name?: unknown }).name === "WorkflowCanceledError"
          ) {
            throw error
          }
          failures.push({
            index,
            kind: "parallel",
            message: describeError(error)
          })
          return null
        })
    )
    return Promise.all(slots).then((results) =>
      marshal(results, "parallel result")
    )
  }, createError)

  const pipeline = makeSafeHostFunction(
    (items: unknown, ...stages: unknown[]) => {
      assertCollection("pipeline", items)
      const itemList = items as unknown[]
      const runStages = async (
        original: unknown,
        index: number,
        previous: unknown,
        stage: number
      ): Promise<JSONValue> => {
        if (stage >= stages.length) {
          return marshal(
            previous === undefined ? null : (previous as JSONValue),
            `pipeline[${index}]`
          )
        }
        try {
          const callback = stages[stage]
          if (typeof callback !== "function") {
            throw new TypeError("pipeline() stages must be functions")
          }
          const next = await (
            callback as (
              previous: unknown,
              original: unknown,
              index: number
            ) => unknown
          )(previous, original, index)
          return runStages(original, index, next, stage + 1)
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            (error as { name?: unknown }).name === "WorkflowCanceledError"
          ) {
            throw error
          }
          failures.push({
            index,
            kind: "pipeline",
            message: describeError(error),
            stage
          })
          return null
        }
      }
      const results = itemList.map((item, index) =>
        runStages(item, index, item, 0)
      )
      return Promise.all(results).then((values) =>
        marshal(values, "pipeline result")
      )
    },
    createError
  )

  contextRecord.__workflowBindings = {
    agent,
    budget,
    clearTimeout,
    consoleLog,
    log,
    parallel,
    phase,
    pipeline,
    setTimeout,
    workflow
  }
  runInContext(
    `
    (() => {
      const host = __workflowBindings
      globalThis.agent = async (...values) => host.agent(...values)
      globalThis.parallel = async (...values) => host.parallel(...values)
      globalThis.pipeline = async (...values) => host.pipeline(...values)
      globalThis.phase = (...values) => host.phase(...values)
      globalThis.log = (...values) => host.log(...values)
      const consoleMethod = (...values) => host.consoleLog(...values)
      globalThis.console = Object.freeze(Object.assign(Object.create(null), {
        log: consoleMethod,
        info: consoleMethod,
        warn: consoleMethod,
        error: consoleMethod,
        debug: consoleMethod,
      }))
      globalThis.setTimeout = (...values) => host.setTimeout(...values)
      globalThis.clearTimeout = (...values) => host.clearTimeout(...values)
      globalThis.workflow = async (...values) => host.workflow(...values)
      globalThis.budget = Object.freeze(Object.assign(Object.create(null), {
        total: host.budget.total,
        spent: () => host.budget.spent(),
        remaining: () => host.budget.remaining(),
      }))
      delete globalThis.__workflowBindings
    })()
  `,
    context,
    { filename: `${fileName}:bindings` }
  )
  contextRecord.__workflowBindings = undefined

  let script: Script
  try {
    script = new Script(
      `(async function __workflowBody() {\n"use strict";\n${loaded.body}\n})()`,
      { filename: fileName }
    )
  } catch (error) {
    throw new WorkflowLoadError(`${fileName}: ${describeError(error)}`, {
      cause: error
    })
  }

  const value = await script.runInContext(context)
  return {
    events,
    failures,
    meta: loaded.meta,
    result: cloneJSONValue(
      value === undefined ? null : value,
      "workflow result"
    )
  }
}

async function loadReferencedWorkflow(
  reference: WorkflowReference,
  currentFileName: string,
  workflowDirectory: string
): Promise<{ loaded: LoadedWorkflowScript; fileName: string }> {
  if (typeof reference === "string") {
    const names = (
      await readdir(workflowDirectory, { withFileTypes: true }).catch(() => [])
    )
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => entry.name)
      .sort()
    const workflows = await Promise.all(
      names.map(async (name) => {
        const fileName = resolve(workflowDirectory, name)
        return {
          fileName,
          loaded: parseWorkflowScript(
            await readFile(fileName, "utf8"),
            fileName
          )
        }
      })
    )
    const available: string[] = []
    for (const { fileName, loaded } of workflows) {
      available.push(loaded.meta.name)
      if (loaded.meta.name === reference) {
        return { fileName, loaded }
      }
    }
    throw new Error(
      `workflow(${JSON.stringify(reference)}): no workflow with that name. Available: ${available.join(", ")}`
    )
  }
  const fileName = isAbsolute(reference.scriptPath)
    ? reference.scriptPath
    : resolve(dirname(currentFileName), reference.scriptPath)
  return {
    fileName,
    loaded: parseWorkflowScript(await readFile(fileName, "utf8"), fileName)
  }
}

function waitForCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    throw new WorkflowCanceledError()
  }
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = () => reject(new WorkflowCanceledError())
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolvePromise(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

function extractOutputTokens(
  usage: AppServerJSONValue | null | undefined
): number {
  if (usage === null || usage === undefined || typeof usage !== "object") {
    return 0
  }
  if (Array.isArray(usage)) {
    return 0
  }
  const { total } = usage
  const nested =
    total !== null && typeof total === "object" && !Array.isArray(total)
      ? total
      : undefined
  return (
    readUsageTokenField(usage, nested, "outputTokens", "output_tokens") +
    readUsageTokenField(
      usage,
      nested,
      "reasoningOutputTokens",
      "reasoning_output_tokens"
    )
  )
}

function readUsageTokenField(
  usage: Record<string, AppServerJSONValue>,
  nested: Record<string, AppServerJSONValue> | undefined,
  camelCase: string,
  snakeCase: string
): number {
  for (const value of [
    usage[camelCase],
    usage[snakeCase],
    nested?.[camelCase],
    nested?.[snakeCase]
  ]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value
    }
  }
  return 0
}
