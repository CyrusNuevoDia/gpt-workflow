import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import Ajv, { type AnySchema } from "ajv"

export type AppServerJSONPrimitive = string | number | boolean | null
export type AppServerJSONValue =
  | AppServerJSONPrimitive
  | AppServerJSONArray
  | AppServerJSONObject
export type AppServerJSONArray = AppServerJSONValue[]
export type AppServerJSONObject = { [key: string]: AppServerJSONValue }

export const REQUIRED_APP_SERVER_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const

export interface AppServerClientInfo {
  name: string
  title: string | null
  version: string
  [key: string]: AppServerJSONValue
}

export interface AppServerProcess {
  stdin: AppServerWritable
  stdout: AsyncIterable<string | Uint8Array>
  once(event: "error" | "exit" | "close" | "drain", listener: (...args: unknown[]) => void): unknown
  kill(signal?: string): void
}

export interface AppServerWritable {
  write(chunk: string): boolean | void | Promise<boolean | void>
  end(): void
  once(event: "drain", listener: () => void): unknown
}

export type AppServerSpawner = (options: {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}) => AppServerProcess

export interface AppServerClientOptions {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  clientInfo?: Partial<AppServerClientInfo>
  requestTimeoutMs?: number
  turnTimeoutMs?: number
  shutdownTimeoutMs?: number
  spawn?: AppServerSpawner
  requiredModels?: readonly string[]
  now?: () => number
}

export interface AppServerNotification {
  method: string
  params: unknown
}

export type AppServerNotificationListener = (notification: AppServerNotification) => void

export type AppServerEventLifecycle = "started" | "intermediate" | "completed"
export type AppServerEventSubject =
  | "thread"
  | "turn"
  | "item"
  | "message"
  | "plan"
  | "reasoning"
  | "command"
  | "file"
  | "tool"
  | "collaboration"

export interface AppServerNormalizedEventBase {
  sequence: number
  timestamp: number
  workflowRunId: string
  agentId: string
  label: string | null
  phase: string | null
  requestedModel: string
  resolvedModel: string | null
  threadId: string | null
  turnId: string | null
  itemId: string | null
  method: string
}

export type AppServerNormalizedEvent = AppServerNormalizedEventBase & (
  | {
      type: "lifecycle"
      lifecycle: AppServerEventLifecycle
      subject: AppServerEventSubject
      itemType: string | null
      item: AppServerJSONValue | null
      status: string | null
    }
  | {
      type: "message-delta"
      delta: string
    }
  | {
      type: "plan"
      delta: string | null
      explanation: string | null
      plan: AppServerJSONValue | null
    }
  | {
      type: "reasoning"
      delta: string | null
      index: number | null
      reasoningKind: "summary" | "text" | "summary-part"
    }
  | {
      type: "command"
      commandKind: "output-delta" | "terminal-interaction" | "diff" | "other"
      delta: string | null
      processId: string | null
      stream: string | null
      capReached: boolean | null
      data: AppServerJSONValue | null
    }
  | {
      type: "file"
      fileKind: "output-delta" | "patch-updated" | "diff" | "other"
      delta: string | null
      changes: AppServerJSONValue | null
    }
  | {
      type: "tool"
      toolKind: "mcp-progress" | "mcp-server" | "other"
      message: string | null
      data: AppServerJSONValue | null
    }
  | {
      type: "collaboration"
      lifecycle: AppServerEventLifecycle
      item: AppServerJSONValue | null
    }
  | {
      type: "usage"
      usage: AppServerJSONValue
    }
  | {
      type: "warning"
      message: string
    }
  | {
      type: "error"
      message: string
      willRetry: boolean | null
    }
  | {
      type: "terminal"
      lifecycle: "completed"
      status: string
      error: string | null
      usage: AppServerJSONValue | null
    }
)

export type AppServerNormalizedEventListener = (event: AppServerNormalizedEvent) => void

export interface AppServerTextInput {
  type: "text"
  text: string
  text_elements: AppServerJSONArray
}

export interface AppServerSteerResult {
  turnId: string
}

export interface AppServerAgentHandle {
  readonly workflowRunId: string
  readonly agentId: string
  readonly label: string | null
  readonly phase: string | null
  readonly requestedModel: string
  readonly resolvedModel: string
  readonly threadId: string
  readonly turnId: string
  readonly events: AsyncIterable<AppServerNormalizedEvent>
  readonly eventLog: readonly AppServerNormalizedEvent[]
  subscribe(listener: AppServerNormalizedEventListener): () => void
  steer(input: string | readonly AppServerTextInput[], expectedTurnId?: string): Promise<AppServerSteerResult>
  interrupt(): Promise<void>
  result(): Promise<AppServerAgentCall>
}

export interface AppServerModel {
  id: string
  model: string
  displayName?: string
  hidden?: boolean
  [key: string]: unknown
}

export interface AppServerInitializeResult {
  userAgent: string
  codexHome: string
  platformFamily: string
  platformOs: string
}

export interface AppServerAgentOptions {
  model?: string
  cwd?: string
  effort?: string
  schema?: AppServerJSONObject
  label?: string
  phase?: string
  sandbox?: "read-only" | "workspace-write" | "danger-full-access"
  approvalPolicy?: "untrusted" | "on-request" | "never"
  /** Host-only attribution and observation controls; never sent to App Server. */
  workflowRunId?: string
  agentId?: string
  eventSink?: AppServerNormalizedEventListener
  eventTimestamp?: () => number
}

export interface AppServerAgentEvidence {
  requestedModel: string
  resolvedModel: string
  threadId: string
  turnId: string
  itemIds: string[]
  terminalStatus: "completed"
  usage?: AppServerJSONValue | null
}

export interface AppServerAgentAttemptEvidence {
  requestedModel: string
  resolvedModel: string
  threadId: string
  turnId: string | null
  itemIds: string[]
  terminalStatus: string | null
  usage?: AppServerJSONValue | null
}

export interface AppServerAgentCall {
  result: AppServerJSONValue
  evidence: AppServerAgentEvidence
}

export class AppServerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AppServerError"
  }
}

export class AppServerProtocolError extends AppServerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AppServerProtocolError"
  }
}

export class AppServerTimeoutError extends AppServerError {
  constructor(message: string) {
    super(message)
    this.name = "AppServerTimeoutError"
  }
}

export class AppServerProcessError extends AppServerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AppServerProcessError"
  }
}

export class AppServerRemoteError extends AppServerError {
  readonly code: number | string | undefined

  constructor(message: string, code?: number | string) {
    super(message)
    this.name = "AppServerRemoteError"
    this.code = code
  }
}

export class AppServerModelError extends AppServerError {
  constructor(message: string) {
    super(message)
    this.name = "AppServerModelError"
  }
}

export class AppServerTurnError extends AppServerError {
  readonly status: string

  constructor(status: string, message: string) {
    super(message)
    this.name = "AppServerTurnError"
    this.status = status
  }
}

export class AppServerResultError extends AppServerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AppServerResultError"
  }
}

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface RecordValue {
  [key: string]: unknown
}

interface TurnCompletedParams {
  threadId: string
  turn: {
    id: string
    status: string
    error?: { message?: string | null } | null
  }
}

interface ItemCompletedParams {
  threadId: string
  turnId: string
  item: RecordValue
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string | number {
  return (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isSafeInteger(value))
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return String(error)
}

function readString(record: RecordValue, key: string, message: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new AppServerProtocolError(message)
  }
  return value
}

function readModelListResult(value: unknown): { data: AppServerModel[]; nextCursor: string | null } {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new AppServerProtocolError("model/list response must contain a data array")
  }
  const data = value.data.map((model, index) => {
    if (!isRecord(model)) {
      throw new AppServerProtocolError(`model/list response data[${index}] is not an object`)
    }
    const id = readString(model, "id", `model/list response data[${index}].id is required`)
    const modelId = readString(model, "model", `model/list response data[${index}].model is required`)
    return { ...model, id, model: modelId }
  })
  const nextCursor = value.nextCursor
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new AppServerProtocolError("model/list response nextCursor must be a string or null")
  }
  return { data, nextCursor }
}

function readThreadStartResult(value: unknown): { threadId: string; model: string } {
  if (!isRecord(value) || !isRecord(value.thread)) {
    throw new AppServerProtocolError("thread/start response must contain a thread object")
  }
  return {
    threadId: readString(value.thread, "id", "thread/start response thread.id is required"),
    model: readString(value, "model", "thread/start response model is required"),
  }
}

function readTurnStartResult(value: unknown): { turnId: string } {
  if (!isRecord(value) || !isRecord(value.turn)) {
    throw new AppServerProtocolError("turn/start response must contain a turn object")
  }
  return { turnId: readString(value.turn, "id", "turn/start response turn.id is required") }
}

function readTurnSteerResult(value: unknown): AppServerSteerResult {
  if (!isRecord(value)) throw new AppServerProtocolError("turn/steer response must be an object")
  return { turnId: readString(value, "turnId", "turn/steer response turnId is required") }
}

function readTurnInterruptResult(value: unknown): void {
  if (!isRecord(value)) throw new AppServerProtocolError("turn/interrupt response must be an object")
}

function readInitializeResult(value: unknown): AppServerInitializeResult {
  if (!isRecord(value)) throw new AppServerProtocolError("initialize response must be an object")
  return {
    userAgent: readString(value, "userAgent", "initialize response userAgent is required"),
    codexHome: readString(value, "codexHome", "initialize response codexHome is required"),
    platformFamily: readString(value, "platformFamily", "initialize response platformFamily is required"),
    platformOs: readString(value, "platformOs", "initialize response platformOs is required"),
  }
}

function readItemCompletedParams(value: unknown): ItemCompletedParams | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || typeof value.turnId !== "string" || !isRecord(value.item)) {
    return null
  }
  return {
    threadId: value.threadId,
    turnId: value.turnId,
    item: value.item,
  }
}

function readTurnCompletedParams(value: unknown): TurnCompletedParams | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || !isRecord(value.turn)) return null
  if (typeof value.turn.id !== "string" || typeof value.turn.status !== "string") return null
  return {
    threadId: value.threadId,
    turn: value.turn as TurnCompletedParams["turn"],
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function asJSONValue(value: unknown): AppServerJSONValue | null {
  if (value === null) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((entry) => asJSONValue(entry))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sensitiveEventKey(key) ? "[REDACTED]" : asJSONValue(entry)]))
  }
  return null
}

function sensitiveEventKey(key: string): boolean {
  return /(?:authorization|api[-_]?key|access[-_]?token|cookie|password|secret|environment)/i.test(key) || /^(?:token|env)$/i.test(key)
}

function itemSubject(item: RecordValue): AppServerEventSubject {
  switch (item.type) {
    case "agentMessage": return "message"
    case "plan": return "plan"
    case "reasoning": return "reasoning"
    case "commandExecution": return "command"
    case "fileChange": return "file"
    case "mcpToolCall":
    case "dynamicToolCall": return "tool"
    case "collabAgentToolCall": return "collaboration"
    default: return "item"
  }
}

function notificationIds(params: unknown): {
  threadId: string | null
  turnId: string | null
  itemId: string | null
} {
  if (!isRecord(params)) return { threadId: null, turnId: null, itemId: null }
  return {
    threadId: stringOrNull(params.threadId),
    turnId: stringOrNull(params.turnId) ?? (isRecord(params.turn) ? stringOrNull(params.turn.id) : null),
    itemId: stringOrNull(params.itemId) ?? (isRecord(params.item) ? stringOrNull(params.item.id) : null),
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppServerTimeoutError(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function defaultSpawner(options: {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}): AppServerProcess {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "inherit"],
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    once: (event, listener) => child.once(event, listener),
    kill: (signal) => child.kill(signal as NodeJS.Signals | undefined),
  }
}

class AsyncEventBuffer implements AsyncIterable<AppServerNormalizedEvent> {
  private readonly pending: Array<(result: IteratorResult<AppServerNormalizedEvent>) => void> = []
  private readonly queue: AppServerNormalizedEvent[] = []
  private readonly values: AppServerNormalizedEvent[] = []
  private closed = false

  get history(): readonly AppServerNormalizedEvent[] {
    return this.values
  }

  push(event: AppServerNormalizedEvent): void {
    if (this.closed) return
    const waiter = this.pending.shift()
    if (waiter) waiter({ done: false, value: event })
    else this.queue.push(event)
    this.values.push(event)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.pending.length > 0) this.pending.shift()?.({ done: true, value: undefined })
  }

  next(): Promise<IteratorResult<AppServerNormalizedEvent>> {
    const value = this.queue.shift()
    if (value) return Promise.resolve({ done: false, value })
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => this.pending.push(resolve))
  }

  [Symbol.asyncIterator](): AsyncIterator<AppServerNormalizedEvent> {
    return this
  }
}

type AgentExecutionState = "starting" | "active" | "interrupting" | "completed" | "failed"

interface AgentExecution {
  readonly workflowRunId: string
  readonly agentId: string
  readonly label: string | null
  readonly phase: string | null
  readonly requestedModel: string
  readonly schema: AppServerJSONObject | undefined
  resolvedModel: string | null
  readonly threadId: string
  turnId: string | null
  state: AgentExecutionState
  terminalStatus: string | null
  terminalError: string | null
  usage: AppServerJSONValue | null
  readonly completedItems: Array<{ id: string; text: string }>
  readonly itemIds: string[]
  turnStartedEmitted: boolean
  readonly eventBuffer: AsyncEventBuffer
  readonly eventListeners: Set<AppServerNormalizedEventListener>
  readonly eventSink: AppServerNormalizedEventListener | undefined
  readonly eventTimestamp: () => number
  resultPromise: Promise<AppServerAgentCall>
  resolveResult: (call: AppServerAgentCall) => void
  rejectResult: (error: unknown) => void
  interruptPromise: Promise<void> | null
  settled: boolean
}

class AgentHandle implements AppServerAgentHandle {
  constructor(
    private readonly execution: AgentExecution,
    private readonly steerCall: (execution: AgentExecution, input: string | readonly AppServerTextInput[], expectedTurnId?: string) => Promise<AppServerSteerResult>,
    private readonly interruptCall: (execution: AgentExecution) => Promise<void>,
  ) {}

  get workflowRunId(): string { return this.execution.workflowRunId }
  get agentId(): string { return this.execution.agentId }
  get label(): string | null { return this.execution.label }
  get phase(): string | null { return this.execution.phase }
  get requestedModel(): string { return this.execution.requestedModel }
  get resolvedModel(): string { return this.execution.resolvedModel ?? this.execution.requestedModel }
  get threadId(): string { return this.execution.threadId }
  get turnId(): string {
    if (this.execution.turnId === null) throw new AppServerTurnError("starting", "agent turn is not active yet")
    return this.execution.turnId
  }
  get events(): AsyncIterable<AppServerNormalizedEvent> { return this.execution.eventBuffer }
  get eventLog(): readonly AppServerNormalizedEvent[] { return this.execution.eventBuffer.history }

  subscribe(listener: AppServerNormalizedEventListener): () => void {
    for (const event of this.execution.eventBuffer.history) listener(event)
    if (this.execution.state === "completed" || this.execution.state === "failed") return () => undefined
    this.execution.eventListeners.add(listener)
    return () => this.execution.eventListeners.delete(listener)
  }

  steer(input: string | readonly AppServerTextInput[], expectedTurnId?: string): Promise<AppServerSteerResult> {
    return this.steerCall(this.execution, input, expectedTurnId)
  }

  interrupt(): Promise<void> {
    return this.interruptCall(this.execution)
  }

  result(): Promise<AppServerAgentCall> {
    return this.execution.resultPromise
  }
}

export class AppServerClient {
  readonly initializeResult!: AppServerInitializeResult

  private readonly process: AppServerProcess
  private readonly requestTimeoutMs: number
  private readonly turnTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly listeners = new Set<AppServerNotificationListener>()
  private readonly normalizedListeners = new Set<AppServerNormalizedEventListener>()
  private readonly failureListeners = new Set<(error: AppServerError) => void>()
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly agents = new Map<string, AgentExecution>()
  private readonly availableModels = new Map<string, AppServerModel>()
  private nextRequestId = 1
  private state: "starting" | "ready" | "closing" | "closed" | "failed" = "starting"
  private failure: AppServerError | null = null
  private exitPromise: Promise<void>
  private resolveExit!: () => void
  private initialized = false
  private discoveredModelList: AppServerModel[] = []
  private discoveredModelPages = 0
  private lastAgentEvidence: AppServerAgentEvidence | null = null
  private lastAgentAttempt: AppServerAgentAttemptEvidence | null = null
  private eventSequence = 0

  private constructor(
    process: AppServerProcess,
    private readonly options: AppServerClientOptions,
  ) {
    this.process = process
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.turnTimeoutMs = options.turnTimeoutMs ?? 120_000
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 500
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve })
  }

  static async connect(options: AppServerClientOptions = {}): Promise<AppServerClient> {
    const command = options.command ?? "codex"
    const args = options.args ?? ["app-server"]
    const spawner = options.spawn ?? defaultSpawner
    const process = spawner({ command, args, cwd: options.cwd, env: options.env })
    const client = new AppServerClient(process, options)
    client.installProcessHandlers()
    void client.readOutput()
    try {
      const initializeResult = await client.initialize()
      ;(client as { initializeResult: AppServerInitializeResult }).initializeResult = initializeResult
      client.state = "ready"
      if (options.requiredModels) await client.assertRequiredModels(options.requiredModels)
      return client
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
  }

  get status(): "starting" | "ready" | "closing" | "closed" | "failed" {
    return this.state
  }

  get discoveredModels(): readonly AppServerModel[] {
    return this.discoveredModelList
  }

  get modelListPages(): number {
    return this.discoveredModelPages
  }

  get lastAgentCallEvidence(): AppServerAgentEvidence | null {
    return this.lastAgentEvidence
  }

  get lastAgentAttemptEvidence(): AppServerAgentAttemptEvidence | null {
    return this.lastAgentAttempt
  }

  subscribe(listener: AppServerNotificationListener): () => void {
    if (this.state === "closed" || this.state === "failed") {
      throw this.failure ?? new AppServerProcessError(`App Server is ${this.state}`)
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeEvents(listener: AppServerNormalizedEventListener): () => void {
    if (this.state === "closed" || this.state === "failed") {
      throw this.failure ?? new AppServerProcessError(`App Server is ${this.state}`)
    }
    this.normalizedListeners.add(listener)
    return () => this.normalizedListeners.delete(listener)
  }

  private onFailure(listener: (error: AppServerError) => void): () => void {
    if (this.failure) {
      listener(this.failure)
      return () => undefined
    }
    this.failureListeners.add(listener)
    return () => this.failureListeners.delete(listener)
  }

  async request(method: string, params: AppServerJSONValue | undefined = {}): Promise<unknown> {
    if (method === "initialize" && this.initialized) {
      throw new AppServerProtocolError("initialize may only be sent once")
    }
    if (!this.initialized && method !== "initialize") {
      throw new AppServerProtocolError(`cannot send ${method} before initialize`)
    }
    if (this.state === "closed" || this.state === "closing") {
      throw new AppServerProcessError(`cannot send ${method}: App Server is ${this.state}`)
    }
    if (this.state === "failed") throw this.failure ?? new AppServerProcessError("App Server failed")

    const id = this.nextRequestId++
    const request = { method, id, ...(params === undefined ? {} : { params }) }
    const pending = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AppServerTimeoutError(`${method} request ${id} timed out after ${this.requestTimeoutMs}ms`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
    })

    try {
      await this.writeMessage(request)
    } catch (error) {
      const entry = this.pending.get(id)
      if (entry) {
        clearTimeout(entry.timer)
        this.pending.delete(id)
        entry.reject(error)
      }
      this.failConnection(error instanceof AppServerError
        ? error
        : new AppServerProcessError(`failed to write ${method} request: ${describeError(error)}`, { cause: error }))
    }
    return pending
  }

  async listModels(): Promise<AppServerModel[]> {
    const models: AppServerModel[] = []
    let pageCount = 0
    let cursor: string | null = null
    const seenCursors = new Set<string>()
    do {
      const response = readModelListResult(await this.request("model/list", {
        includeHidden: true,
        ...(cursor === null ? {} : { cursor }),
      }))
      pageCount++
      models.push(...response.data)
      for (const model of response.data) {
        this.availableModels.set(model.id, model)
        this.availableModels.set(model.model, model)
      }
      if (response.nextCursor !== null) {
        if (seenCursors.has(response.nextCursor)) {
          throw new AppServerProtocolError(`model/list pagination repeated cursor ${response.nextCursor}`)
        }
        seenCursors.add(response.nextCursor)
      }
      cursor = response.nextCursor
    } while (cursor !== null)
    this.discoveredModelList = models
    this.discoveredModelPages = pageCount
    return models
  }

  async assertRequiredModels(requiredModels: readonly string[] = REQUIRED_APP_SERVER_MODELS): Promise<AppServerModel[]> {
    const models = await this.listModels()
    const available = new Set(models.flatMap((model) => [model.id, model.model]))
    const missing = requiredModels.filter((model) => !available.has(model))
    if (missing.length > 0) {
      throw new AppServerModelError(`required App Server models unavailable: ${missing.join(", ")}`)
    }
    return models
  }

  async startAgent(prompt: string, options: AppServerAgentOptions = {}): Promise<AppServerAgentHandle> {
    if (typeof prompt !== "string") throw new TypeError("agent() prompt must be a string")
    const model = options.model
    if (!model) throw new AppServerModelError("agent() requires an explicit model")
    if (this.availableModels.size === 0) await this.listModels()
    if (!this.availableModels.has(model)) {
      throw new AppServerModelError(`agent() model is not available: ${model}`)
    }

    const cwd = options.cwd ?? this.options.cwd
    const approvalPolicy = options.approvalPolicy ?? "never"
    const sandbox = options.sandbox ?? "read-only"
    const threadResult = readThreadStartResult(await this.request("thread/start", {
      model,
      approvalPolicy,
      sandbox,
      ephemeral: true,
      ...(cwd === undefined ? {} : { cwd }),
    }))
    const workflowRunId = options.workflowRunId ?? `workflow-${randomUUID()}`
    const agentId = options.agentId ?? `agent-${randomUUID()}`
    const execution: AgentExecution = {
      workflowRunId,
      agentId,
      label: options.label ?? null,
      phase: options.phase ?? null,
      requestedModel: model,
      schema: options.schema,
      resolvedModel: threadResult.model,
      threadId: threadResult.threadId,
      turnId: null,
      state: "starting",
      terminalStatus: null,
      terminalError: null,
      usage: null,
      completedItems: [],
      itemIds: [],
      turnStartedEmitted: false,
      eventBuffer: new AsyncEventBuffer(),
      eventListeners: new Set(),
      eventSink: options.eventSink,
      eventTimestamp: options.eventTimestamp ?? this.options.now ?? (() => Date.now()),
      resultPromise: Promise.resolve(undefined as unknown as AppServerAgentCall),
      resolveResult: () => undefined,
      rejectResult: () => undefined,
      interruptPromise: null,
      settled: false,
    }
    execution.resultPromise = new Promise<AppServerAgentCall>((resolve, reject) => {
      execution.resolveResult = resolve
      execution.rejectResult = reject
    })
    this.agents.set(threadResult.threadId, execution)
    this.lastAgentAttempt = {
      requestedModel: model,
      resolvedModel: threadResult.model,
      threadId: threadResult.threadId,
      turnId: null,
      itemIds: [],
      terminalStatus: null,
    }

    const handle = new AgentHandle(execution, (current, input, expectedTurnId) => this.steerAgent(current, input, expectedTurnId), (current) => this.interruptAgent(current))
    try {
      this.emitEvent(execution, "thread/start", {
        type: "lifecycle",
        lifecycle: "started",
        subject: "thread",
        itemType: null,
        item: null,
        status: "started",
      })
      const turnResultResponse = readTurnStartResult(await this.request("turn/start", {
        threadId: threadResult.threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        model,
        ...(cwd === undefined ? {} : { cwd }),
        approvalPolicy,
        sandboxPolicy: sandboxPolicyFor(sandbox, cwd),
        ...(options.effort === undefined ? {} : { effort: options.effort }),
        ...(options.schema === undefined ? {} : { outputSchema: normalizeOutputSchema(options.schema) }),
        ...(options.label === undefined && options.phase === undefined ? {} : {
          responsesapiClientMetadata: {
            ...(options.label === undefined ? {} : { workflow_label: options.label }),
            ...(options.phase === undefined ? {} : { workflow_phase: options.phase }),
          },
        }),
      }))
      if (execution.turnId !== null && execution.turnId !== turnResultResponse.turnId) {
        throw new AppServerProtocolError(`turn/start response id ${turnResultResponse.turnId} disagrees with active turn ${execution.turnId}`)
      }
      execution.turnId = turnResultResponse.turnId
      this.emitTurnStartedIfNeeded(execution, turnResultResponse.turnId, "turn/start")
      if (execution.state === "starting") execution.state = "active"
      if (this.lastAgentAttempt?.threadId === threadResult.threadId) this.lastAgentAttempt.turnId = execution.turnId
      void withTimeout(execution.resultPromise, this.turnTimeoutMs, `turn ${execution.turnId} timed out after ${this.turnTimeoutMs}ms`)
        .catch((error: unknown) => this.failAgent(execution, error))
      this.maybeFinishAgent(execution, options)
      return handle
    } catch (error) {
      this.failAgent(execution, error)
      throw error
    }
  }

  async callAgent(prompt: string, options: AppServerAgentOptions = {}): Promise<AppServerAgentCall> {
    const handle = await this.startAgent(prompt, options)
    return handle.result()
  }

  async agent(prompt: string, options: AppServerAgentOptions = {}): Promise<AppServerJSONValue> {
    return (await this.callAgent(prompt, options)).result
  }

  private async steerAgent(
    execution: AgentExecution,
    input: string | readonly AppServerTextInput[],
    expectedTurnId = execution.turnId ?? "",
  ): Promise<AppServerSteerResult> {
    if (execution.state !== "active" || execution.terminalStatus !== null) {
      throw new AppServerTurnError(execution.terminalStatus ?? execution.state, `thread ${execution.threadId} turn is not active; steering is no longer allowed`)
    }
    if (execution.turnId === null || expectedTurnId.length === 0) {
      throw new AppServerTurnError("starting", `thread ${execution.threadId} has no active turn to steer`)
    }
    if (expectedTurnId !== execution.turnId) {
      throw new AppServerTurnError("stale", `expected active turn ${execution.turnId}, received ${expectedTurnId}`)
    }
    const inputItems = typeof input === "string"
      ? [{ type: "text", text: input, text_elements: [] }] satisfies AppServerTextInput[]
      : input.map((item) => {
        if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string" || !Array.isArray(item.text_elements)) {
          throw new TypeError("turn/steer input must contain text items")
        }
        return {
          type: "text",
          text: item.text,
          text_elements: item.text_elements,
        } satisfies AppServerTextInput
      })
    const accepted = readTurnSteerResult(await this.request("turn/steer", {
      threadId: execution.threadId,
      input: inputItems,
      expectedTurnId,
    }))
    execution.turnId = accepted.turnId
    if (execution.terminalStatus === null) {
      this.emitEvent(execution, "turn/steer", {
        type: "lifecycle",
        lifecycle: "intermediate",
        subject: "turn",
        itemType: null,
        item: null,
        status: "steered",
      })
    }
    return accepted
  }

  private async interruptAgent(execution: AgentExecution): Promise<void> {
    if (execution.state === "completed" || execution.state === "failed") return
    if (execution.interruptPromise !== null) return execution.interruptPromise
    if (execution.turnId === null) {
      throw new AppServerTurnError("starting", `thread ${execution.threadId} has no active turn to interrupt`)
    }
    const turnId = execution.turnId
    execution.state = "interrupting"
    execution.interruptPromise = (async () => {
      readTurnInterruptResult(await this.request("turn/interrupt", {
        threadId: execution.threadId,
        turnId,
      }))
      if (execution.terminalStatus === null) {
        this.emitEvent(execution, "turn/interrupt", {
          type: "lifecycle",
          lifecycle: "intermediate",
          subject: "turn",
          itemType: null,
          item: null,
          status: "interrupt-requested",
        })
      }
    })().catch((error: unknown) => {
      if (execution.state === "interrupting") execution.state = "active"
      execution.interruptPromise = null
      throw error
    })
    return execution.interruptPromise
  }

  private maybeFinishAgent(execution: AgentExecution, options: AppServerAgentOptions): void {
    if (execution.settled || execution.terminalStatus === null || execution.turnId === null) return
    execution.settled = true
    const turnId = execution.turnId
    if (execution.terminalStatus !== "completed") {
      execution.state = "failed"
      const detail = execution.terminalError ? `: ${execution.terminalError}` : ""
      execution.rejectResult(new AppServerTurnError(execution.terminalStatus, `thread ${execution.threadId}, turn ${turnId} ended with status ${execution.terminalStatus}${detail}`))
      execution.eventBuffer.close()
      this.agents.delete(execution.threadId)
      return
    }
    const finalItem = execution.completedItems[execution.completedItems.length - 1]
    if (!finalItem) {
      execution.state = "failed"
      execution.rejectResult(new AppServerResultError(`turn ${turnId} completed without an authoritative completed agent message`))
      execution.eventBuffer.close()
      this.agents.delete(execution.threadId)
      return
    }
    try {
      const result = options.schema === undefined
        ? finalItem.text
        : parseAndValidateStructuredResult(finalItem.text, options.schema)
      const evidence: AppServerAgentEvidence = {
        requestedModel: execution.requestedModel,
        resolvedModel: execution.resolvedModel ?? execution.requestedModel,
        threadId: execution.threadId,
        turnId,
        itemIds: [...execution.itemIds],
        terminalStatus: "completed",
        ...(execution.usage === null ? {} : { usage: execution.usage }),
      }
      const call = { result, evidence } satisfies AppServerAgentCall
      this.lastAgentEvidence = evidence
      execution.state = "completed"
      execution.resolveResult(call)
    } catch (error) {
      execution.state = "failed"
      execution.rejectResult(error)
    } finally {
      execution.eventBuffer.close()
      this.agents.delete(execution.threadId)
    }
  }

  private failAgent(execution: AgentExecution, error: unknown): void {
    if (execution.settled) return
    execution.settled = true
    execution.state = "failed"
    execution.rejectResult(error)
    execution.eventBuffer.close()
    this.agents.delete(execution.threadId)
  }

  private emitEvent(
    execution: AgentExecution,
    method: string,
    payload: Record<string, unknown>,
    ids: { threadId?: string | null; turnId?: string | null; itemId?: string | null } = {},
  ): void {
    const timestamp = execution.eventTimestamp()
    if (!Number.isFinite(timestamp)) throw new AppServerProtocolError("normalized event timestamp must be finite")
    const event = {
      sequence: ++this.eventSequence,
      timestamp,
      workflowRunId: execution.workflowRunId,
      agentId: execution.agentId,
      label: execution.label,
      phase: execution.phase,
      requestedModel: execution.requestedModel,
      resolvedModel: execution.resolvedModel,
      threadId: ids.threadId === undefined ? execution.threadId : ids.threadId,
      turnId: ids.turnId === undefined ? execution.turnId : ids.turnId,
      itemId: ids.itemId === undefined ? null : ids.itemId,
      method,
      ...payload,
    } as AppServerNormalizedEvent
    execution.eventBuffer.push(event)
    for (const listener of execution.eventListeners) this.notifyObserver(listener, event)
    if (execution.eventSink) this.notifyObserver(execution.eventSink, event)
    for (const listener of this.normalizedListeners) this.notifyObserver(listener, event)
  }

  private notifyObserver(listener: AppServerNormalizedEventListener, event: AppServerNormalizedEvent): void {
    try {
      listener(event)
    } catch {
      // Progress observers are diagnostic. They must not tear down the shared transport or sibling turns.
    }
  }

  private emitTurnStartedIfNeeded(execution: AgentExecution, turnId: string, method: string): void {
    if (execution.turnStartedEmitted) return
    execution.turnStartedEmitted = true
    execution.turnId = turnId
    this.emitEvent(execution, method, {
      type: "lifecycle",
      lifecycle: "started",
      subject: "turn",
      itemType: null,
      item: null,
      status: "inProgress",
    }, { turnId })
  }

  async close(): Promise<void> {
    if (this.state === "closed") return
    if (this.state === "closing") {
      await withTimeout(this.exitPromise, this.shutdownTimeoutMs, "timed out waiting for App Server shutdown")
      return
    }
    this.state = "closing"
    const error = new AppServerProcessError("App Server client shut down")
    for (const listener of this.failureListeners) listener(error)
    this.failureListeners.clear()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
    for (const execution of this.agents.values()) this.failAgent(execution, error)
    try { this.process.stdin.end() } catch { /* already closed */ }
    try { this.process.kill("SIGTERM") } catch { /* already exited */ }
    try {
      await withTimeout(this.exitPromise, this.shutdownTimeoutMs, "timed out waiting for App Server shutdown")
    } catch {
      try { this.process.kill("SIGKILL") } catch { /* already exited */ }
    }
    this.state = "closed"
    this.resolveExit()
  }

  private installProcessHandlers(): void {
    this.process.once("error", (error) => {
      this.failConnection(new AppServerProcessError(`App Server process error: ${describeError(error)}`, { cause: error }))
    })
    this.process.once("exit", (code, signal) => {
      this.resolveExit()
      if (this.state === "closing" || this.state === "closed") return
      this.failConnection(new AppServerProcessError(`App Server exited before completion (code=${String(code)}, signal=${String(signal)})`))
    })
    this.process.once("close", () => this.resolveExit())
  }

  private async initialize(): Promise<AppServerInitializeResult> {
    if (this.initialized) throw new AppServerProtocolError("initialize may only be sent once")
    const clientInfo: AppServerClientInfo = {
      name: this.options.clientInfo?.name ?? "gpt-workflow",
      title: this.options.clientInfo?.title ?? "GPT Workflow Runtime",
      version: this.options.clientInfo?.version ?? "0.1.0",
    }
    const result = readInitializeResult(await this.request("initialize", {
      clientInfo,
      capabilities: { experimentalApi: true, requestAttestation: false },
    }))
    this.initialized = true
    await this.writeMessage({ method: "initialized", params: {} })
    return result
  }

  private async writeMessage(message: RecordValue): Promise<void> {
    if (this.state === "failed" || this.state === "closed") {
      throw this.failure ?? new AppServerProcessError("App Server is unavailable")
    }
    const line = `${JSON.stringify(message)}\n`
    let result = await this.process.stdin.write(line)
    if (result === false) {
      await withTimeout(new Promise<void>((resolve) => {
        this.process.stdin.once("drain", resolve)
      }), this.requestTimeoutMs, "timed out waiting for App Server stdin backpressure")
      result = true
    }
  }

  private async readOutput(): Promise<void> {
    let buffer = ""
    const textDecoder = new TextDecoder()
    try {
      for await (const chunk of this.process.stdout) {
        buffer += typeof chunk === "string" ? chunk : textDecoder.decode(chunk, { stream: true })
        let newlineIndex = buffer.indexOf("\n")
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "")
          buffer = buffer.slice(newlineIndex + 1)
          if (line.trim().length === 0) throw new AppServerProtocolError("App Server emitted a blank JSONL line")
          this.dispatchLine(line)
          newlineIndex = buffer.indexOf("\n")
        }
      }
      buffer += textDecoder.decode()
      if (buffer.trim().length > 0) throw new AppServerProtocolError("App Server ended with a partial JSONL message")
      if (this.state !== "closing" && this.state !== "closed") {
        this.failConnection(new AppServerProcessError("App Server stdout reached EOF before completion"))
      }
    } catch (error) {
      if (this.state !== "closing" && this.state !== "closed") {
        this.failConnection(error instanceof AppServerError
          ? error
          : new AppServerProcessError(`failed reading App Server stdout: ${describeError(error)}`, { cause: error }))
      }
    }
  }

  private dispatchLine(line: string): void {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      throw new AppServerProtocolError(`App Server emitted malformed JSON: ${describeError(error)}`, { cause: error })
    }
    if (!isRecord(value) || typeof value.method !== "string" && !Object.hasOwn(value, "id")) {
      throw new AppServerProtocolError("App Server emitted a message without a method or request id")
    }
    if (Object.hasOwn(value, "id")) {
      if (!isRequestId(value.id)) throw new AppServerProtocolError("App Server response id must be a string or safe integer")
      const hasResult = Object.hasOwn(value, "result")
      const hasError = Object.hasOwn(value, "error")
      if (hasResult === hasError) throw new AppServerProtocolError(`App Server response ${String(value.id)} must contain exactly one of result or error`)
      const pending = this.pending.get(value.id)
      if (!pending) throw new AppServerProtocolError(`App Server response ${String(value.id)} has no pending request`)
      clearTimeout(pending.timer)
      this.pending.delete(value.id)
      if (hasError) {
        const remoteError = isRecord(value.error) ? value.error : {}
        const message = typeof remoteError.message === "string" ? remoteError.message : JSON.stringify(value.error)
        pending.reject(new AppServerRemoteError(`${pending.method} failed: ${message}`, typeof remoteError.code === "number" || typeof remoteError.code === "string" ? remoteError.code : undefined))
      } else {
        pending.resolve(value.result)
      }
      return
    }
    if (typeof value.method !== "string") throw new AppServerProtocolError("App Server notification method must be a string")
    const notification = { method: value.method, params: value.params }
    for (const listener of this.listeners) listener(notification)
    this.routeNormalizedNotification(notification)
  }

  private routeNormalizedNotification(notification: AppServerNotification): void {
    const ids = notificationIds(notification.params)
    if (ids.threadId === null) return
    const execution = this.agents.get(ids.threadId)
    if (!execution) return
    if (execution.turnId !== null && ids.turnId !== null && ids.turnId !== execution.turnId) return
    if (ids.turnId !== null) this.emitTurnStartedIfNeeded(execution, ids.turnId, "turn/started")

    const params = isRecord(notification.params) ? notification.params : {}
    switch (notification.method) {
      case "turn/started": {
        if (ids.turnId === null) return
        execution.turnId = ids.turnId
        return
      }
      case "turn/completed": {
        const completed = readTurnCompletedParams(notification.params)
        if (completed === null) throw new AppServerProtocolError("turn/completed notification has invalid params")
        execution.turnId = completed.turn.id
        execution.terminalStatus = completed.turn.status
        execution.terminalError = completed.turn.error?.message ?? null
        execution.state = completed.turn.status === "completed" ? "completed" : "failed"
        if (this.lastAgentAttempt?.threadId === execution.threadId) {
          this.lastAgentAttempt.turnId = completed.turn.id
          this.lastAgentAttempt.terminalStatus = completed.turn.status
          if (execution.usage !== null) this.lastAgentAttempt.usage = execution.usage
        }
        this.emitEvent(execution, notification.method, {
          type: "terminal",
          lifecycle: "completed",
          status: completed.turn.status,
          error: execution.terminalError,
          usage: execution.usage,
        }, { threadId: completed.threadId, turnId: completed.turn.id })
        return this.maybeFinishAgent(execution, this.agentOptionsFor(execution))
      }
      case "item/started":
      case "item/completed": {
        const itemParams = notification.method === "item/completed"
          ? readItemCompletedParams(notification.params)
          : isRecord(params) && typeof params.threadId === "string" && typeof params.turnId === "string" && isRecord(params.item)
            ? { threadId: params.threadId, turnId: params.turnId, item: params.item }
            : null
        if (itemParams === null) throw new AppServerProtocolError(`${notification.method} notification has invalid params`)
        const item = itemParams.item
        const itemType = stringOrNull(item.type)
        const itemId = stringOrNull(item.id)
        const subject = itemSubject(item)
        const lifecycle: AppServerEventLifecycle = notification.method === "item/started" ? "started" : "completed"
        if (notification.method === "item/completed" && itemType === "agentMessage" && itemId !== null && typeof item.text === "string") {
          execution.completedItems.push({ id: itemId, text: item.text })
          execution.itemIds.push(itemId)
          if (this.lastAgentAttempt?.threadId === execution.threadId) this.lastAgentAttempt.itemIds.push(itemId)
        }
        if (subject === "collaboration") {
          this.emitEvent(execution, notification.method, {
            type: "collaboration",
            lifecycle,
            item: asJSONValue(item),
          }, { threadId: itemParams.threadId, turnId: itemParams.turnId, itemId })
        } else {
          this.emitEvent(execution, notification.method, {
            type: "lifecycle",
            lifecycle,
            subject,
            itemType,
            item: asJSONValue(item),
            status: stringOrNull(item.status),
          }, { threadId: itemParams.threadId, turnId: itemParams.turnId, itemId })
        }
        if (notification.method === "item/completed") this.maybeFinishAgent(execution, this.agentOptionsFor(execution))
        return
      }
      case "item/agentMessage/delta": {
        this.emitEvent(execution, notification.method, { type: "message-delta", delta: stringOrNull(params.delta) ?? "" }, ids)
        return
      }
      case "item/plan/delta": {
        this.emitEvent(execution, notification.method, {
          type: "plan",
          delta: stringOrNull(params.delta),
          explanation: null,
          plan: null,
        }, ids)
        return
      }
      case "turn/plan/updated": {
        this.emitEvent(execution, notification.method, {
          type: "plan",
          delta: null,
          explanation: stringOrNull(params.explanation),
          plan: asJSONValue(params.plan),
        }, ids)
        return
      }
      case "model/rerouted": {
        const resolvedModel = stringOrNull(params.toModel)
        if (resolvedModel !== null) execution.resolvedModel = resolvedModel
        this.emitEvent(execution, notification.method, {
          type: "lifecycle",
          lifecycle: "intermediate",
          subject: "turn",
          itemType: null,
          item: null,
          status: "model-rerouted",
        }, ids)
        return
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryPartAdded": {
        const reasoningKind = notification.method.endsWith("textDelta")
          ? notification.method.includes("summary") ? "summary" : "text"
          : "summary-part"
        this.emitEvent(execution, notification.method, {
          type: "reasoning",
          delta: stringOrNull(params.delta),
          index: numberOrNull(params.summaryIndex ?? params.contentIndex),
          reasoningKind,
        }, ids)
        return
      }
      case "item/commandExecution/outputDelta":
      case "command/exec/outputDelta":
      case "process/outputDelta":
      case "process/exited":
      case "item/commandExecution/terminalInteraction": {
        this.emitEvent(execution, notification.method, {
          type: "command",
          commandKind: notification.method.endsWith("terminalInteraction") ? "terminal-interaction" : "output-delta",
          delta: stringOrNull(params.delta) ?? stringOrNull(params.stdout),
          processId: stringOrNull(params.processId) ?? stringOrNull(params.processHandle),
          stream: stringOrNull(params.stream),
          capReached: booleanOrNull(params.capReached) ?? booleanOrNull(params.stdoutCapReached),
          data: notification.method === "process/exited" ? asJSONValue(params) : null,
        }, ids)
        return
      }
      case "item/fileChange/outputDelta":
      case "item/fileChange/patchUpdated":
      case "turn/diff/updated": {
        this.emitEvent(execution, notification.method, {
          type: "file",
          fileKind: notification.method.endsWith("patchUpdated") ? "patch-updated" : notification.method === "turn/diff/updated" ? "diff" : "output-delta",
          delta: stringOrNull(params.delta) ?? stringOrNull(params.diff),
          changes: asJSONValue(params.changes),
        }, ids)
        return
      }
      case "item/mcpToolCall/progress":
      case "mcpServer/startupStatus/updated": {
        this.emitEvent(execution, notification.method, {
          type: "tool",
          toolKind: notification.method === "item/mcpToolCall/progress" ? "mcp-progress" : "mcp-server",
          message: stringOrNull(params.message) ?? stringOrNull(params.status),
          data: asJSONValue(params),
        }, ids)
        return
      }
      case "thread/tokenUsage/updated": {
        const usage = asJSONValue(params.tokenUsage) ?? {}
        execution.usage = usage
        if (this.lastAgentAttempt?.threadId === execution.threadId) this.lastAgentAttempt.usage = usage
        this.emitEvent(execution, notification.method, { type: "usage", usage }, ids)
        return
      }
      case "warning": {
        this.emitEvent(execution, notification.method, { type: "warning", message: stringOrNull(params.message) ?? "" }, ids)
        return
      }
      case "error": {
        const error = isRecord(params.error) ? stringOrNull(params.error.message) : null
        this.emitEvent(execution, notification.method, {
          type: "error",
          message: error ?? "App Server reported an error",
          willRetry: booleanOrNull(params.willRetry),
        }, ids)
        return
      }
      case "thread/closed": {
        this.emitEvent(execution, notification.method, {
          type: "lifecycle",
          lifecycle: "completed",
          subject: "thread",
          itemType: null,
          item: null,
          status: "closed",
        }, ids)
      }
    }
  }

  private agentOptionsFor(execution: AgentExecution): AppServerAgentOptions {
    return {
      model: execution.requestedModel,
      schema: execution.schema,
      workflowRunId: execution.workflowRunId,
      agentId: execution.agentId,
      label: execution.label ?? undefined,
      phase: execution.phase ?? undefined,
    }
  }

  private failConnection(error: AppServerError): void {
    if (this.state === "failed" || this.state === "closed" || this.state === "closing") return
    this.state = "failed"
    this.failure = error
    for (const listener of this.failureListeners) listener(error)
    this.failureListeners.clear()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
    for (const execution of this.agents.values()) this.failAgent(execution, error)
    try { this.process.kill("SIGTERM") } catch { /* already exited */ }
    this.resolveExit()
  }
}

function sandboxPolicyFor(
  sandbox: "read-only" | "workspace-write" | "danger-full-access",
  cwd: string | undefined,
): AppServerJSONObject {
  switch (sandbox) {
    case "read-only":
      return { type: "readOnly", networkAccess: false }
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: cwd === undefined ? [] : [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      }
    case "danger-full-access":
      return { type: "dangerFullAccess" }
  }
}

function parseAndValidateStructuredResult(text: string, schema: AppServerJSONObject): AppServerJSONValue {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new AppServerResultError("authoritative structured agent text was not valid JSON", { cause: error })
  }
  const validator = new Ajv({ allErrors: true, strict: false }).compile(schema as AnySchema)
  if (!validator(value)) {
    const details = validator.errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "failed validation"}`).join(", ") ?? "unknown schema error"
    throw new AppServerResultError(`authoritative structured agent result failed schema validation: ${details}`)
  }
  return value as AppServerJSONValue
}

function normalizeOutputSchema(value: AppServerJSONValue): AppServerJSONValue {
  if (Array.isArray(value)) return value.map(normalizeOutputSchema)
  if (value === null || typeof value !== "object") return value

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeOutputSchema(child)]),
  ) as AppServerJSONObject
  if (normalized.type === "object" || normalized.properties !== undefined) {
    normalized.additionalProperties = false
  }
  return normalized
}
