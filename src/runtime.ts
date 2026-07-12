import * as vm from "node:vm"
import type { AppServerClient } from "./app-server.ts"

export type JSONPrimitive = string | number | boolean | null
export type JSONValue = JSONPrimitive | JSONArray | JSONObject
export type JSONArray = JSONValue[]
export type JSONObject = { [key: string]: JSONValue }

export interface WorkflowPhase {
  title: string
  detail?: string
  model?: string
}

export interface WorkflowMeta {
  name: string
  description: string
  whenToUse?: string
  phases?: WorkflowPhase[]
}

export interface LoadedWorkflowScript {
  meta: WorkflowMeta
  body: string
}

export interface WorkflowPhaseEvent {
  type: "phase"
  title: string
  detail: string | null
}

export interface WorkflowLogEvent {
  type: "log"
  message: string
}

export type WorkflowEvent = WorkflowPhaseEvent | WorkflowLogEvent

export interface WorkflowFailure {
  kind: "parallel" | "pipeline"
  index: number
  stage?: number
  message: string
}

export type WorkflowAgent = (
  prompt: string,
  options?: JSONObject,
) => JSONValue | Promise<JSONValue>

export type WorkflowReference = string | { scriptPath: string }

export type WorkflowChild = (
  reference: WorkflowReference,
  args?: JSONValue,
) => JSONValue | Promise<JSONValue>

export interface OfflineBudgetOptions {
  total?: number | null
  spent?: number | (() => number)
}

export interface WorkflowExecutionOptions {
  args?: JSONValue
  agent?: WorkflowAgent
  appServer?: AppServerClient
  workflow?: WorkflowChild
  budget?: OfflineBudgetOptions
  fileName?: string
}

export interface WorkflowExecution {
  meta: WorkflowMeta
  result: JSONValue
  events: WorkflowEvent[]
  failures: WorkflowFailure[]
}

const MAX_BOUNDARY_ITEMS = 4096
const DATE_ERROR =
  "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args."
const RANDOM_ERROR =
  "Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt."
const CAP_ERROR =
  "exceeds the maximum of 4096 supported across the workflow VM boundary"

export class WorkflowLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkflowLoadError"
  }
}

export class JSONBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JSONBoundaryError"
  }
}

class LiteralMetaParser {
  private index = 0

  constructor(
    private readonly source: string,
    private readonly fileName: string,
  ) {}

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
      this.index++
    } else if (this.index < this.source.length && !sawLineBreak) {
      this.fail("meta must be the first complete statement")
    } else if (this.canContinueLiteralExpression()) {
      this.fail("meta must end before the workflow body")
    }

    return {
      meta: value as unknown as WorkflowMeta,
      body: this.source.slice(this.index),
    }
  }

  private parseLiteral(): JSONValue {
    this.skipTrivia()
    const character = this.source[this.index]

    if (character === "{") return this.parseObject()
    if (character === "[") return this.parseArray()
    if (character === "'" || character === '"') return this.parseString()
    if (character === "-" || this.isDigit(character)) return this.parseNumber()

    const word = this.readIdentifier()
    if (word === "true") return true
    if (word === "false") return false
    if (word === "null") return null

    this.fail(
      word
        ? `meta contains non-literal identifier ${JSON.stringify(word)}`
        : "meta value must be a pure object, array, string, number, boolean, or null literal",
    )
  }

  private parseObject(): JSONObject {
    this.expectCharacter("{")
    const result: JSONObject = {}
    this.skipTrivia()

    if (this.source[this.index] === "}") {
      this.index++
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
        writable: true,
      })

      this.skipTrivia()
      if (this.source[this.index] === "}") {
        this.index++
        return result
      }
      this.expectCharacter(",")
      this.skipTrivia()
      if (this.source[this.index] === "}") {
        this.index++
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
      this.index++
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
        this.index++
        return result
      }
      this.expectCharacter(",")
      this.skipTrivia()
      if (this.source[this.index] === "]") {
        this.index++
        return result
      }
    }

    this.fail("unterminated meta array")
  }

  private parsePropertyKey(): string {
    const character = this.source[this.index]
    if (character === "'" || character === '"') return this.parseString()

    if (this.isDigit(character)) {
      const start = this.index
      while (this.isDigit(this.source[this.index])) this.index++
      return String(Number(this.source.slice(start, this.index)))
    }

    const key = this.readIdentifier()
    if (!key || this.source[this.index] === "[") {
      this.fail("meta object keys must be static identifiers or string/number literals")
    }
    return key
  }

  private parseString(): string {
    const quote = this.source[this.index]
    this.index++
    let result = ""

    while (this.index < this.source.length) {
      const character = this.source[this.index++]
      if (character === quote) return result
      if (character === "\n" || character === "\r") {
        this.fail("meta strings cannot contain an unescaped line break")
      }
      if (character !== "\\") {
        result += character
        continue
      }

      if (this.index >= this.source.length) this.fail("unterminated meta string")
      const escape = this.source[this.index++] ?? ""
      const escapes: Record<string, string> = {
        '"': '"',
        "'": "'",
        "\\": "\\",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        0: "\0",
      }
      if (escape in escapes) {
        result += escapes[escape]
        continue
      }
      if (escape === "\n") continue
      if (escape === "\r") {
        if (this.source[this.index] === "\n") this.index++
        continue
      }
      if (escape === "x") {
        result += String.fromCharCode(this.readHex(2))
        continue
      }
      if (escape === "u") {
        if (this.source[this.index] === "{") {
          this.index++
          const start = this.index
          while (this.isHexDigit(this.source[this.index])) this.index++
          if (this.source[this.index] !== "}" || start === this.index) {
            this.fail("invalid Unicode escape in meta string")
          }
          const codePoint = Number.parseInt(this.source.slice(start, this.index), 16)
          this.index++
          if (!Number.isInteger(codePoint) || codePoint > 0x10ffff) {
            this.fail("invalid Unicode escape in meta string")
          }
          result += String.fromCodePoint(codePoint)
          continue
        }
        result += String.fromCharCode(this.readHex(4))
        continue
      }
      this.fail(`unsupported escape sequence \\${escape} in meta string`)
    }

    this.fail("unterminated meta string")
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index),
    )
    if (!match) this.fail("invalid numeric literal in meta")
    this.index += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) this.fail("meta numbers must be finite")
    return value
  }

  private validateMeta(value: JSONValue): void {
    if (!isPlainJSONObject(value)) this.fail("meta must be an object literal")
    if (typeof value.name !== "string" || value.name.length === 0) {
      this.fail("meta.name is required and must be a non-empty string")
    }
    if (typeof value.description !== "string" || value.description.length === 0) {
      this.fail("meta.description is required and must be a non-empty string")
    }
    if ("whenToUse" in value && typeof value.whenToUse !== "string") {
      this.fail("meta.whenToUse must be a string")
    }
    if ("phases" in value) {
      if (!Array.isArray(value.phases)) this.fail("meta.phases must be an array")
      for (const phase of value.phases) {
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
  }

  private readIdentifier(): string {
    const start = this.index
    if (!this.isIdentifierStart(this.source[this.index])) return ""
    this.index++
    while (this.isIdentifierPart(this.source[this.index])) this.index++
    return this.source.slice(start, this.index)
  }

  private canContinueLiteralExpression(): boolean {
    const character = this.source[this.index]
    if (character !== undefined && ".([`+-*/%<>=!&|^?:,".includes(character)) {
      return true
    }
    return /^(?:in|instanceof)\b/.test(this.source.slice(this.index))
  }

  private expectWord(word: string): void {
    this.skipTrivia()
    if (this.readIdentifier() !== word) this.fail(`expected ${word}`)
  }

  private expectCharacter(character: string): void {
    if (this.source[this.index] !== character) {
      this.fail(`expected ${JSON.stringify(character)}`)
    }
    this.index++
  }

  private skipTrivia(): boolean {
    let sawLineBreak = false
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (character !== undefined && /\s/.test(character)) {
        if (character === "\n" || character === "\r") sawLineBreak = true
        this.index++
        continue
      }
      if (this.source.startsWith("//", this.index)) {
        this.index += 2
        while (this.index < this.source.length && this.source[this.index] !== "\n") {
          this.index++
        }
        continue
      }
      if (this.source.startsWith("/*", this.index)) {
        this.index += 2
        let closed = false
        while (this.index < this.source.length) {
          if (this.source[this.index] === "\n" || this.source[this.index] === "\r") {
            sawLineBreak = true
          }
          if (this.source.startsWith("*/", this.index)) {
            this.index += 2
            closed = true
            break
          }
          this.index++
        }
        if (!closed) this.fail("unterminated comment in meta")
        continue
      }
      break
    }
    return sawLineBreak
  }

  private readHex(length: number): number {
    const value = this.source.slice(this.index, this.index + length)
    if (value.length !== length || [...value].some((character) => !this.isHexDigit(character))) {
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
    return character !== undefined && /^[0-9a-fA-F]$/.test(character)
  }

  private isIdentifierStart(character: string | undefined): boolean {
    return character !== undefined && /^[A-Za-z_$]$/.test(character)
  }

  private isIdentifierPart(character: string | undefined): boolean {
    return this.isIdentifierStart(character) || this.isDigit(character)
  }
}

export function parseWorkflowScript(
  source: string,
  fileName = "workflow.js",
): LoadedWorkflowScript {
  if (typeof source !== "string") {
    throw new WorkflowLoadError(`${fileName}: workflow source must be a string`)
  }
  return new LiteralMetaParser(source, fileName).parse()
}

function isPlainJSONObject(value: unknown): value is JSONObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype === null) return true
  if (Object.getPrototypeOf(prototype) !== null) return false
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value
  return typeof constructor === "function" && constructor.name === "Object"
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  if (typeof error === "string") return error
  return String(error)
}

function cloneJSONValue(
  value: unknown,
  path: string,
  active: WeakSet<object> = new WeakSet(),
): JSONValue {
  if (value === null) return null
  switch (typeof value) {
    case "string":
    case "boolean":
      return value
    case "number":
      if (!Number.isFinite(value)) {
        throw new JSONBoundaryError(`${path}: non-finite numbers are not JSON-compatible`)
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
  }

  if (active.has(value)) {
    throw new JSONBoundaryError(`${path}: cyclic values are not JSON-compatible`)
  }
  active.add(value)

  try {
    if (Array.isArray(value)) {
      const result: JSONArray = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new JSONBoundaryError(`${path}[${index}]: array holes are not JSON-compatible`)
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new JSONBoundaryError(`${path}[${index}]: accessor or non-enumerable properties are not JSON-compatible`)
        }
        result.push(cloneJSONValue(descriptor.value, `${path}[${index}]`, active))
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue
        if (typeof key === "symbol") {
          throw new JSONBoundaryError(`${path}: symbol keys are not JSON-compatible`)
        }
        const numericIndex = Number(key)
        if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex >= value.length || String(numericIndex) !== key) {
          throw new JSONBoundaryError(`${path}: array properties must be indexed JSON values`)
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new JSONBoundaryError(`${path}[${key}]: accessor or non-enumerable properties are not JSON-compatible`)
        }
      }
      return result
    }

    if (!isPlainJSONObject(value)) {
      throw new JSONBoundaryError(`${path}: only plain objects are JSON-compatible`)
    }
    const result: JSONObject = {}
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        throw new JSONBoundaryError(`${path}: symbol keys are not JSON-compatible`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new JSONBoundaryError(`${path}.${key}: accessor or non-enumerable properties are not JSON-compatible`)
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: cloneJSONValue(descriptor.value, `${path}.${key}`, active),
        writable: true,
      })
    }
    return result
  } finally {
    active.delete(value)
  }
}

function makeBoundaryError(createError: (message: string) => unknown, error: unknown): never {
  throw createError(describeError(error))
}

function makeSafeHostFunction<T extends (...args: never[]) => unknown>(
  handler: T,
  createError: (message: string) => unknown,
): T {
  const safe = (...args: never[]) => {
    try {
      const result = handler(...args)
      if (result instanceof Promise) {
        return result.catch((error: unknown) => makeBoundaryError(createError, error))
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

  for (const name of ['Function', 'eval', 'ShadowRealm', 'process', 'require', 'Bun', 'Deno', 'module', 'exports', '__dirname', '__filename', 'console', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'performance']) {
    delete globalThis[name]
  }
})()
`

export async function runWorkflowScript(
  source: string,
  options: WorkflowExecutionOptions = {},
): Promise<WorkflowExecution> {
  const fileName = options.fileName ?? "workflow.js"
  const loaded = parseWorkflowScript(source, fileName)
  const events: WorkflowEvent[] = []
  const failures: WorkflowFailure[] = []
  let currentPhase: string | null = null

  const contextInput = options.args === undefined
    ? undefined
    : JSON.stringify(cloneJSONValue(options.args, "args"))
  const context = vm.createContext({ __workflowInputJSON: contextInput })
  vm.runInContext(VM_SETUP, context, { filename: `${fileName}:setup` })
  const createError = vm.runInContext("(message) => new Error(message)", context) as (message: string) => unknown

  const marshal = (value: JSONValue, path: string): JSONValue => {
    const safeValue = cloneJSONValue(value, path)
    const contextRecord = context as unknown as Record<string, unknown>
    contextRecord.__workflowBoundaryJSON = JSON.stringify(safeValue)
    try {
      return vm.runInContext("JSON.parse(__workflowBoundaryJSON)", context) as JSONValue
    } finally {
      delete contextRecord.__workflowBoundaryJSON
    }
  }

  const contextRecord = context as unknown as Record<string, unknown>
  contextRecord.args = options.args === undefined
    ? undefined
    : vm.runInContext("JSON.parse(__workflowInputJSON)", context)
  delete contextRecord.__workflowInputJSON

  const budgetTotal = options.budget?.total ?? null
  if (budgetTotal !== null && (!Number.isFinite(budgetTotal) || budgetTotal < 0)) {
    throw new TypeError("budget.total must be null or a finite non-negative number")
  }
  const spentSource = options.budget?.spent ?? 0
  const readSpent = (): number => {
    const spent = typeof spentSource === "function" ? spentSource() : spentSource
    if (!Number.isFinite(spent) || spent < 0) {
      throw new TypeError("budget.spent() must return a finite non-negative number")
    }
    return spent
  }
  const budgetSpent = makeSafeHostFunction(() => readSpent(), createError)
  const budgetRemaining = makeSafeHostFunction(
    () => budgetTotal === null ? Infinity : Math.max(0, budgetTotal - readSpent()),
    createError,
  )
  const budget = Object.freeze(Object.assign(Object.create(null), {
    total: budgetTotal,
    spent: budgetSpent,
    remaining: budgetRemaining,
  }))

  const runAgent = options.agent ?? options.appServer?.agent.bind(options.appServer) ?? (() => {
    throw new Error("agent() is unavailable in the offline workflow runtime")
  })
  const agent = makeSafeHostFunction(async (prompt: unknown, rawOptions?: unknown) => {
    if (typeof prompt !== "string") throw new TypeError("agent() prompt must be a string")
    let agentOptions: JSONObject | undefined
    if (rawOptions !== undefined) {
      if (!isPlainJSONObject(rawOptions)) {
        throw new TypeError("agent() options must be a plain object")
      }
      agentOptions = cloneJSONValue(rawOptions, "agent options") as JSONObject
    }
    if (agentOptions === undefined && currentPhase !== null) {
      agentOptions = { phase: currentPhase }
    } else if (agentOptions !== undefined && agentOptions.phase === undefined && currentPhase !== null) {
      agentOptions = { ...agentOptions, phase: currentPhase }
    }
    const result = await runAgent(prompt, agentOptions)
    return marshal(result, "agent result")
  }, createError)

  const runWorkflow = options.workflow ?? (() => {
    throw new Error("workflow() is unavailable in the offline workflow runtime")
  })
  const workflow = makeSafeHostFunction(async (rawReference: unknown, rawArgs?: unknown) => {
    if (typeof rawReference !== "string" && !isPlainJSONObject(rawReference)) {
      throw new TypeError("workflow() reference must be a name or { scriptPath } object")
    }
    if (isPlainJSONObject(rawReference) && typeof rawReference.scriptPath !== "string") {
      throw new TypeError("workflow() reference.scriptPath must be a string")
    }
    const reference = cloneJSONValue(rawReference, "workflow reference") as WorkflowReference
    const childArgs = rawArgs === undefined ? undefined : cloneJSONValue(rawArgs, "workflow args")
    const result = await runWorkflow(reference, childArgs)
    return marshal(result, "workflow result")
  }, createError)

  const phase = makeSafeHostFunction((title: unknown) => {
    if (typeof title !== "string") throw new TypeError("phase() title must be a string")
    currentPhase = title
    const configured = loaded.meta.phases?.find((entry) => entry.title === title)
    events.push({ type: "phase", title, detail: configured?.detail ?? null })
  }, createError)

  const log = makeSafeHostFunction((message: unknown) => {
    if (typeof message !== "string") throw new TypeError("log() message must be a string")
    events.push({ type: "log", message })
  }, createError)

  const assertCollection = (name: string, value: unknown): value is unknown[] => {
    if (!Array.isArray(value)) throw new TypeError(`${name}() requires an array`)
    if (value.length > MAX_BOUNDARY_ITEMS) {
      throw new RangeError(`array length ${value.length} ${CAP_ERROR}`)
    }
    return true
  }

  const parallel = makeSafeHostFunction((thunks: unknown) => {
    assertCollection("parallel", thunks)
    const slots = (thunks as unknown[]).map((thunk, index) =>
      Promise.resolve()
        .then(() => {
          if (typeof thunk !== "function") throw new TypeError("parallel() entries must be thunks")
          return (thunk as () => unknown)()
        })
        .then((value) => marshal(value as JSONValue, `parallel[${index}]`))
        .catch((error: unknown) => {
          failures.push({ kind: "parallel", index, message: describeError(error) })
          return null
        }),
    )
    return Promise.all(slots).then((results) => marshal(results, "parallel result"))
  }, createError)

  const pipeline = makeSafeHostFunction((items: unknown, ...stages: unknown[]) => {
    assertCollection("pipeline", items)
    const itemList = items as unknown[]
    const results = itemList.map((item, index) => (async () => {
      let previous: unknown = item
      for (let stage = 0; stage < stages.length; stage++) {
        try {
          const callback = stages[stage]
          if (typeof callback !== "function") throw new TypeError("pipeline() stages must be functions")
          previous = await (callback as (previous: unknown, original: unknown, index: number) => unknown)(previous, item, index)
          previous = marshal(previous as JSONValue, `pipeline[${index}][${stage}]`)
        } catch (error) {
          failures.push({ kind: "pipeline", index, stage, message: describeError(error) })
          return null
        }
      }
      return previous as JSONValue
    })())
    return Promise.all(results).then((values) => marshal(values, "pipeline result"))
  }, createError)

  contextRecord.__workflowBindings = { agent, parallel, pipeline, phase, log, workflow, budget }
  vm.runInContext(`
    (() => {
      const host = __workflowBindings
      globalThis.agent = async (...values) => host.agent(...values)
      globalThis.parallel = async (...values) => host.parallel(...values)
      globalThis.pipeline = async (...values) => host.pipeline(...values)
      globalThis.phase = (...values) => host.phase(...values)
      globalThis.log = (...values) => host.log(...values)
      globalThis.workflow = async (...values) => host.workflow(...values)
      globalThis.budget = Object.freeze(Object.assign(Object.create(null), {
        total: host.budget.total,
        spent: () => host.budget.spent(),
        remaining: () => host.budget.remaining(),
      }))
      delete globalThis.__workflowBindings
    })()
  `, context, { filename: `${fileName}:bindings` })
  delete contextRecord.__workflowBindings

  let script: vm.Script
  try {
    script = new vm.Script(
      `(async function __workflowBody() {\n"use strict";\n${loaded.body}\n})()`,
      { filename: fileName },
    )
  } catch (error) {
    throw new WorkflowLoadError(`${fileName}: ${describeError(error)}`)
  }

  const value = await script.runInContext(context)
  const result = cloneJSONValue(value, "workflow result")
  return { meta: loaded.meta, result, events, failures }
}
