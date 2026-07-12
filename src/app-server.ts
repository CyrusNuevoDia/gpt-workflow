import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { Ajv, type AnySchema } from "ajv"

const SENSITIVE_EVENT_KEY =
  /(?:authorization|api[-_]?key|access[-_]?token|cookie|password|secret|environment)/i
const SENSITIVE_EVENT_EXACT_KEY = /^(?:token|env)$/i
const TRAILING_CARRIAGE_RETURN = /\r$/

export type AppServerJSONPrimitive = string | number | boolean | null
export type AppServerJSONValue =
  | AppServerJSONPrimitive
  | AppServerJSONArray
  | AppServerJSONObject
export type AppServerJSONArray = AppServerJSONValue[]
export type AppServerJSONObject = { [key: string]: AppServerJSONValue }

export const REQUIRED_APP_SERVER_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol"
] as const

export type AppServerClientInfo = {
  name: string
  title: string | null
  version: string
  [key: string]: AppServerJSONValue
}

export type AppServerProcess = {
  kill: (signal?: string) => void
  once: (
    event: "error" | "exit" | "close" | "drain",
    listener: (...args: unknown[]) => void
  ) => unknown
  stdin: AppServerWritable
  stdout: AsyncIterable<string | Uint8Array>
}

export type AppServerWritable = {
  end: () => void
  once: (event: "drain", listener: () => void) => unknown
  write: (chunk: string) => boolean | undefined | Promise<boolean | undefined>
}

export type AppServerSpawner = (options: {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}) => AppServerProcess

export type AppServerClientOptions = {
  args?: string[]
  clientInfo?: Partial<AppServerClientInfo>
  command?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  now?: () => number
  requestTimeoutMs?: number
  requiredModels?: readonly string[]
  shutdownTimeoutMs?: number
  spawn?: AppServerSpawner
  turnTimeoutMs?: number
}

export type AppServerNotification = {
  method: string
  params: unknown
}

export type AppServerNotificationListener = (
  notification: AppServerNotification
) => void

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

export type AppServerNormalizedEventBase = {
  agentId: string
  itemId: string | null
  label: string | null
  method: string
  phase: string | null
  requestedModel: string
  resolvedModel: string | null
  sequence: number
  threadId: string | null
  timestamp: number
  turnId: string | null
  workflowRunId: string
}

export type AppServerNormalizedEvent = AppServerNormalizedEventBase &
  (
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

export type AppServerNormalizedEventListener = (
  event: AppServerNormalizedEvent
) => void

export type AppServerTextInput = {
  text: string
  text_elements: AppServerJSONArray
  type: "text"
}

export type AppServerSteerResult = {
  turnId: string
}

export type AppServerAgentHandle = {
  readonly agentId: string
  readonly eventLog: readonly AppServerNormalizedEvent[]
  readonly events: AsyncIterable<AppServerNormalizedEvent>
  interrupt: () => Promise<void>
  readonly label: string | null
  readonly phase: string | null
  readonly requestedModel: string
  readonly resolvedModel: string
  result: () => Promise<AppServerAgentCall>
  steer: (
    input: string | readonly AppServerTextInput[],
    expectedTurnId?: string
  ) => Promise<AppServerSteerResult>
  subscribe: (listener: AppServerNormalizedEventListener) => () => void
  readonly threadId: string
  readonly turnId: string
  readonly workflowRunId: string
}

export type AppServerModel = {
  displayName?: string
  hidden?: boolean
  id: string
  model: string
  [key: string]: unknown
}

export type AppServerInitializeResult = {
  codexHome: string
  platformFamily: string
  platformOs: string
  userAgent: string
}

export type AppServerAgentOptions = {
  agentId?: string
  agentType?: string
  approvalPolicy?: "untrusted" | "on-request" | "never"
  cwd?: string
  effort?: string
  eventSink?: AppServerNormalizedEventListener
  eventTimestamp?: () => number
  isolation?: "worktree"
  label?: string
  model?: string
  phase?: string
  sandbox?: "read-only" | "workspace-write" | "danger-full-access"
  schema?: AppServerJSONObject
  /** Host-only attribution and observation controls; never sent to App Server. */
  workflowRunId?: string
}

export type AppServerAgentEvidence = {
  itemIds: string[]
  requestedModel: string
  resolvedModel: string
  terminalStatus: "completed"
  threadId: string
  turnId: string
  usage?: AppServerJSONValue | null
}

export type AppServerAgentAttemptEvidence = {
  itemIds: string[]
  requestedModel: string
  resolvedModel: string
  terminalStatus: string | null
  threadId: string
  turnId: string | null
  usage?: AppServerJSONValue | null
}

export type AppServerAgentCall = {
  evidence: AppServerAgentEvidence
  result: AppServerJSONValue
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

type PendingRequest = {
  method: string
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

type RecordValue = {
  [key: string]: unknown
}

type TurnCompletedParams = {
  threadId: string
  turn: {
    id: string
    status: string
    error?: { message?: string | null } | null
  }
}

type ItemCompletedParams = {
  item: RecordValue
  threadId: string
  turnId: string
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isSafeInteger(value))
  )
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  return String(error)
}

function readString(record: RecordValue, key: string, message: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new AppServerProtocolError(message)
  }
  return value
}

function readModelListResult(value: unknown): {
  data: AppServerModel[]
  nextCursor: string | null
} {
  if (!(isRecord(value) && Array.isArray(value.data))) {
    throw new AppServerProtocolError(
      "model/list response must contain a data array"
    )
  }
  const data = value.data.map((model, index) => {
    if (!isRecord(model)) {
      throw new AppServerProtocolError(
        `model/list response data[${index}] is not an object`
      )
    }
    const id = readString(
      model,
      "id",
      `model/list response data[${index}].id is required`
    )
    const modelId = readString(
      model,
      "model",
      `model/list response data[${index}].model is required`
    )
    return { ...model, id, model: modelId }
  })
  const { nextCursor } = value
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new AppServerProtocolError(
      "model/list response nextCursor must be a string or null"
    )
  }
  return { data, nextCursor }
}

function readThreadStartResult(value: unknown): {
  threadId: string
  model: string
} {
  if (!(isRecord(value) && isRecord(value.thread))) {
    throw new AppServerProtocolError(
      "thread/start response must contain a thread object"
    )
  }
  return {
    model: readString(
      value,
      "model",
      "thread/start response model is required"
    ),
    threadId: readString(
      value.thread,
      "id",
      "thread/start response thread.id is required"
    )
  }
}

function readTurnStartResult(value: unknown): { turnId: string } {
  if (!(isRecord(value) && isRecord(value.turn))) {
    throw new AppServerProtocolError(
      "turn/start response must contain a turn object"
    )
  }
  return {
    turnId: readString(
      value.turn,
      "id",
      "turn/start response turn.id is required"
    )
  }
}

function readTurnSteerResult(value: unknown): AppServerSteerResult {
  if (!isRecord(value)) {
    throw new AppServerProtocolError("turn/steer response must be an object")
  }
  return {
    turnId: readString(
      value,
      "turnId",
      "turn/steer response turnId is required"
    )
  }
}

function readTurnInterruptResult(value: unknown): void {
  if (!isRecord(value)) {
    throw new AppServerProtocolError(
      "turn/interrupt response must be an object"
    )
  }
}

function readInitializeResult(value: unknown): AppServerInitializeResult {
  if (!isRecord(value)) {
    throw new AppServerProtocolError("initialize response must be an object")
  }
  return {
    codexHome: readString(
      value,
      "codexHome",
      "initialize response codexHome is required"
    ),
    platformFamily: readString(
      value,
      "platformFamily",
      "initialize response platformFamily is required"
    ),
    platformOs: readString(
      value,
      "platformOs",
      "initialize response platformOs is required"
    ),
    userAgent: readString(
      value,
      "userAgent",
      "initialize response userAgent is required"
    )
  }
}

function readItemCompletedParams(value: unknown): ItemCompletedParams | null {
  if (
    !isRecord(value) ||
    typeof value.threadId !== "string" ||
    typeof value.turnId !== "string" ||
    !isRecord(value.item)
  ) {
    return null
  }
  return {
    item: value.item,
    threadId: value.threadId,
    turnId: value.turnId
  }
}

function readTurnCompletedParams(value: unknown): TurnCompletedParams | null {
  if (
    !isRecord(value) ||
    typeof value.threadId !== "string" ||
    !isRecord(value.turn)
  ) {
    return null
  }
  if (
    typeof value.turn.id !== "string" ||
    typeof value.turn.status !== "string"
  ) {
    return null
  }
  return {
    threadId: value.threadId,
    turn: value.turn as TurnCompletedParams["turn"]
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
  if (value === null) {
    return null
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (Array.isArray(value)) {
    return value.map((entry) => asJSONValue(entry))
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveEventKey(key) ? "[REDACTED]" : asJSONValue(entry)
      ])
    )
  }
  return null
}

function sensitiveEventKey(key: string): boolean {
  return SENSITIVE_EVENT_KEY.test(key) || SENSITIVE_EVENT_EXACT_KEY.test(key)
}

function reasoningKind(method: string): string {
  if (!method.endsWith("textDelta")) {
    return "summary-part"
  }
  return method.includes("summary") ? "summary" : "text"
}

function fileEventKind(method: string): string {
  if (method.endsWith("patchUpdated")) {
    return "patch-updated"
  }
  return method === "turn/diff/updated" ? "diff" : "output-delta"
}

function commandEventPayload(method: string, params: RecordValue): RecordValue {
  return {
    capReached:
      booleanOrNull(params.capReached) ??
      booleanOrNull(params.stdoutCapReached),
    commandKind: method.endsWith("terminalInteraction")
      ? "terminal-interaction"
      : "output-delta",
    data: method === "process/exited" ? asJSONValue(params) : null,
    delta: stringOrNull(params.delta) ?? stringOrNull(params.stdout),
    processId:
      stringOrNull(params.processId) ?? stringOrNull(params.processHandle),
    stream: stringOrNull(params.stream),
    type: "command"
  }
}

function recordOrEmpty(value: unknown): RecordValue {
  return isRecord(value) ? value : {}
}

function itemSubject(item: RecordValue): AppServerEventSubject {
  switch (item.type) {
    case "agentMessage":
      return "message"
    case "plan":
      return "plan"
    case "reasoning":
      return "reasoning"
    case "commandExecution":
      return "command"
    case "fileChange":
      return "file"
    case "mcpToolCall":
    case "dynamicToolCall":
      return "tool"
    case "collabAgentToolCall":
      return "collaboration"
    default:
      return "item"
  }
}

function notificationIds(params: unknown): {
  threadId: string | null
  turnId: string | null
  itemId: string | null
} {
  if (!isRecord(params)) {
    return { itemId: null, threadId: null, turnId: null }
  }
  return {
    itemId:
      stringOrNull(params.itemId) ??
      (isRecord(params.item) ? stringOrNull(params.item.id) : null),
    threadId: stringOrNull(params.threadId),
    turnId:
      stringOrNull(params.turnId) ??
      (isRecord(params.turn) ? stringOrNull(params.turn.id) : null)
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppServerTimeoutError(message)),
      timeoutMs
    )
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
    stdio: ["pipe", "pipe", "inherit"]
  })
  return {
    kill: (signal) => child.kill(signal as NodeJS.Signals | undefined),
    once: (event, listener) => child.once(event, listener),
    stdin: child.stdin,
    stdout: child.stdout
  }
}

class AsyncEventBuffer implements AsyncIterable<AppServerNormalizedEvent> {
  private readonly pending: Array<
    (result: IteratorResult<AppServerNormalizedEvent>) => void
  > = []
  private readonly queue: AppServerNormalizedEvent[] = []
  private readonly values: AppServerNormalizedEvent[] = []
  private closed: boolean

  constructor() {
    this.closed = false
  }

  get history(): readonly AppServerNormalizedEvent[] {
    return this.values
  }

  push(event: AppServerNormalizedEvent): void {
    if (this.closed) {
      return
    }
    const waiter = this.pending.shift()
    if (waiter) {
      waiter({ done: false, value: event })
    } else {
      this.queue.push(event)
    }
    this.values.push(event)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    while (this.pending.length > 0) {
      this.pending.shift()?.({ done: true, value: undefined })
    }
  }

  next(): Promise<IteratorResult<AppServerNormalizedEvent>> {
    const value = this.queue.shift()
    if (value) {
      return Promise.resolve({ done: false, value })
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    return new Promise((resolve) => this.pending.push(resolve))
  }

  [Symbol.asyncIterator](): AsyncIterator<AppServerNormalizedEvent> {
    return this
  }
}

type AgentExecutionState =
  | "starting"
  | "active"
  | "interrupting"
  | "completed"
  | "failed"

type AgentExecution = {
  readonly agentId: string
  readonly completedItems: Array<{ id: string; text: string }>
  readonly eventBuffer: AsyncEventBuffer
  readonly eventListeners: Set<AppServerNormalizedEventListener>
  readonly eventSink: AppServerNormalizedEventListener | undefined
  readonly eventTimestamp: () => number
  interruptPromise: Promise<void> | null
  readonly itemIds: string[]
  readonly label: string | null
  readonly phase: string | null
  rejectResult: (error: unknown) => void
  readonly requestedModel: string
  resolvedModel: string | null
  resolveResult: (call: AppServerAgentCall) => void
  resultPromise: Promise<AppServerAgentCall>
  readonly schema: AppServerJSONObject | undefined
  settled: boolean
  state: AgentExecutionState
  terminalError: string | null
  terminalStatus: string | null
  readonly threadId: string
  turnId: string | null
  turnStartedEmitted: boolean
  usage: AppServerJSONValue | null
  readonly workflowRunId: string
}

class AgentHandle implements AppServerAgentHandle {
  private readonly execution: AgentExecution
  private readonly steerCall: (
    execution: AgentExecution,
    input: string | readonly AppServerTextInput[],
    expectedTurnId?: string
  ) => Promise<AppServerSteerResult>
  private readonly interruptCall: (execution: AgentExecution) => Promise<void>

  constructor(
    execution: AgentExecution,
    steerCall: (
      execution: AgentExecution,
      input: string | readonly AppServerTextInput[],
      expectedTurnId?: string
    ) => Promise<AppServerSteerResult>,
    interruptCall: (execution: AgentExecution) => Promise<void>
  ) {
    this.execution = execution
    this.steerCall = steerCall
    this.interruptCall = interruptCall
  }

  get workflowRunId(): string {
    return this.execution.workflowRunId
  }
  get agentId(): string {
    return this.execution.agentId
  }
  get label(): string | null {
    return this.execution.label
  }
  get phase(): string | null {
    return this.execution.phase
  }
  get requestedModel(): string {
    return this.execution.requestedModel
  }
  get resolvedModel(): string {
    return this.execution.resolvedModel ?? this.execution.requestedModel
  }
  get threadId(): string {
    return this.execution.threadId
  }
  get turnId(): string {
    if (this.execution.turnId === null) {
      throw new AppServerTurnError("starting", "agent turn is not active yet")
    }
    return this.execution.turnId
  }
  get events(): AsyncIterable<AppServerNormalizedEvent> {
    return this.execution.eventBuffer
  }
  get eventLog(): readonly AppServerNormalizedEvent[] {
    return this.execution.eventBuffer.history
  }

  subscribe(listener: AppServerNormalizedEventListener): () => void {
    for (const event of this.execution.eventBuffer.history) {
      listener(event)
    }
    if (
      this.execution.state === "completed" ||
      this.execution.state === "failed"
    ) {
      return () => undefined
    }
    this.execution.eventListeners.add(listener)
    return () => this.execution.eventListeners.delete(listener)
  }

  steer(
    input: string | readonly AppServerTextInput[],
    expectedTurnId?: string
  ): Promise<AppServerSteerResult> {
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
  private readonly normalizedListeners =
    new Set<AppServerNormalizedEventListener>()
  private readonly failureListeners = new Set<(error: AppServerError) => void>()
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly agents = new Map<string, AgentExecution>()
  private readonly availableModels = new Map<string, AppServerModel>()
  private nextRequestId = 1
  private state: "starting" | "ready" | "closing" | "closed" | "failed" =
    "starting"
  private failure: AppServerError | null = null
  private readonly exitPromise: Promise<void>
  private resolveExit!: () => void
  private initialized: boolean
  private discoveredModelList: AppServerModel[] = []
  private discoveredModelPages = 0
  private lastAgentEvidence: AppServerAgentEvidence | null = null
  private lastAgentAttempt: AppServerAgentAttemptEvidence | null = null
  private eventSequence = 0
  private readonly options: AppServerClientOptions

  private constructor(
    process: AppServerProcess,
    options: AppServerClientOptions
  ) {
    this.process = process
    this.options = options
    this.initialized = false
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.turnTimeoutMs = options.turnTimeoutMs ?? 120_000
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 500
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve
    })
  }

  static async connect(
    options: AppServerClientOptions = {}
  ): Promise<AppServerClient> {
    const command = options.command ?? "codex"
    const args = options.args ?? ["app-server"]
    const spawner = options.spawn ?? defaultSpawner
    const process = spawner({
      args,
      command,
      cwd: options.cwd,
      env: options.env
    })
    const client = new AppServerClient(process, options)
    client.installProcessHandlers()
    client
      .readOutput()
      .catch((error: unknown) =>
        client.failConnection(
          error instanceof AppServerError
            ? error
            : new AppServerProcessError(
                `failed reading App Server stdout: ${describeError(error)}`,
                { cause: error }
              )
        )
      )
    try {
      const initializeResult = await client.initialize()
      ;(
        client as { initializeResult: AppServerInitializeResult }
      ).initializeResult = initializeResult
      client.state = "ready"
      if (options.requiredModels) {
        await client.assertRequiredModels(options.requiredModels)
      }
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
      throw (
        this.failure ?? new AppServerProcessError(`App Server is ${this.state}`)
      )
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeEvents(listener: AppServerNormalizedEventListener): () => void {
    if (this.state === "closed" || this.state === "failed") {
      throw (
        this.failure ?? new AppServerProcessError(`App Server is ${this.state}`)
      )
    }
    this.normalizedListeners.add(listener)
    return () => this.normalizedListeners.delete(listener)
  }

  async request(
    method: string,
    params: AppServerJSONValue | undefined = {}
  ): Promise<unknown> {
    if (method === "initialize" && this.initialized) {
      throw new AppServerProtocolError("initialize may only be sent once")
    }
    if (!this.initialized && method !== "initialize") {
      throw new AppServerProtocolError(
        `cannot send ${method} before initialize`
      )
    }
    if (this.state === "closed" || this.state === "closing") {
      throw new AppServerProcessError(
        `cannot send ${method}: App Server is ${this.state}`
      )
    }
    if (this.state === "failed") {
      throw this.failure ?? new AppServerProcessError("App Server failed")
    }

    const id = this.nextRequestId
    this.nextRequestId += 1
    const request = { id, method, ...(params === undefined ? {} : { params }) }
    const pending = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new AppServerTimeoutError(
            `${method} request ${id} timed out after ${this.requestTimeoutMs}ms`
          )
        )
      }, this.requestTimeoutMs)
      this.pending.set(id, { method, reject, resolve, timer })
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
      this.failConnection(
        error instanceof AppServerError
          ? error
          : new AppServerProcessError(
              `failed to write ${method} request: ${describeError(error)}`,
              { cause: error }
            )
      )
    }
    return pending
  }

  async listModels(): Promise<AppServerModel[]> {
    const models: AppServerModel[] = []
    const pageCount = await this.loadModelPages(null, new Set(), models)
    this.discoveredModelList = models
    this.discoveredModelPages = pageCount
    return models
  }

  private async loadModelPages(
    cursor: string | null,
    seenCursors: Set<string>,
    models: AppServerModel[]
  ): Promise<number> {
    const response = readModelListResult(
      await this.request("model/list", {
        includeHidden: true,
        ...(cursor === null ? {} : { cursor })
      })
    )
    models.push(...response.data)
    for (const model of response.data) {
      this.availableModels.set(model.id, model)
      this.availableModels.set(model.model, model)
    }
    if (response.nextCursor === null) {
      return 1
    }
    if (seenCursors.has(response.nextCursor)) {
      throw new AppServerProtocolError(
        `model/list pagination repeated cursor ${response.nextCursor}`
      )
    }
    seenCursors.add(response.nextCursor)
    return (
      1 + (await this.loadModelPages(response.nextCursor, seenCursors, models))
    )
  }

  async assertRequiredModels(
    requiredModels: readonly string[] = REQUIRED_APP_SERVER_MODELS
  ): Promise<AppServerModel[]> {
    const models = await this.listModels()
    const available = new Set(
      models.flatMap((model) => [model.id, model.model])
    )
    const missing = requiredModels.filter((model) => !available.has(model))
    if (missing.length > 0) {
      throw new AppServerModelError(
        `required App Server models unavailable: ${missing.join(", ")}`
      )
    }
    return models
  }

  async startAgent(
    prompt: string,
    options: AppServerAgentOptions = {}
  ): Promise<AppServerAgentHandle> {
    const { approvalPolicy, cwd, model, sandbox, threadResult } =
      await this.prepareAgent(prompt, options)
    const workflowRunId = options.workflowRunId ?? `workflow-${randomUUID()}`
    const agentId = options.agentId ?? `agent-${randomUUID()}`
    const execution = this.createAgentExecution(
      agentId,
      model,
      options,
      threadResult,
      workflowRunId
    )
    this.agents.set(threadResult.threadId, execution)
    this.lastAgentAttempt = {
      itemIds: [],
      requestedModel: model,
      resolvedModel: threadResult.model,
      terminalStatus: null,
      threadId: threadResult.threadId,
      turnId: null
    }

    const handle = new AgentHandle(
      execution,
      (current, input, expectedTurnId) =>
        this.steerAgent(current, input, expectedTurnId),
      (current) => this.interruptAgent(current)
    )
    try {
      this.emitEvent(execution, "thread/start", {
        item: null,
        itemType: null,
        lifecycle: "started",
        status: "started",
        subject: "thread",
        type: "lifecycle"
      })
      const turnResultResponse = readTurnStartResult(
        await this.request("turn/start", {
          input: [{ text: prompt, text_elements: [], type: "text" }],
          model,
          threadId: threadResult.threadId,
          ...(cwd === undefined ? {} : { cwd }),
          approvalPolicy,
          sandboxPolicy: sandboxPolicyFor(sandbox, cwd),
          ...(options.effort === undefined ? {} : { effort: options.effort }),
          ...(options.schema === undefined
            ? {}
            : { outputSchema: normalizeOutputSchema(options.schema) }),
          ...(options.label === undefined && options.phase === undefined
            ? {}
            : {
                responsesapiClientMetadata: {
                  ...(options.label === undefined
                    ? {}
                    : { workflow_label: options.label }),
                  ...(options.phase === undefined
                    ? {}
                    : { workflow_phase: options.phase })
                }
              })
        })
      )
      if (
        execution.turnId !== null &&
        execution.turnId !== turnResultResponse.turnId
      ) {
        throw new AppServerProtocolError(
          `turn/start response id ${turnResultResponse.turnId} disagrees with active turn ${execution.turnId}`
        )
      }
      execution.turnId = turnResultResponse.turnId
      this.emitTurnStartedIfNeeded(
        execution,
        turnResultResponse.turnId,
        "turn/start"
      )
      if (execution.state === "starting") {
        execution.state = "active"
      }
      if (this.lastAgentAttempt?.threadId === threadResult.threadId) {
        this.lastAgentAttempt.turnId = execution.turnId
      }
      withTimeout(
        execution.resultPromise,
        this.turnTimeoutMs,
        `turn ${execution.turnId} timed out after ${this.turnTimeoutMs}ms`
      ).catch((error: unknown) => this.failAgent(execution, error))
      this.maybeFinishAgent(execution, options)
      return handle
    } catch (error) {
      this.failAgent(execution, error)
      throw error
    }
  }

  private async prepareAgent(
    prompt: string,
    options: AppServerAgentOptions
  ): Promise<{
    approvalPolicy: string
    cwd: string | undefined
    model: string
    sandbox: "read-only" | "workspace-write" | "danger-full-access"
    threadResult: { model: string; threadId: string }
  }> {
    if (typeof prompt !== "string") {
      throw new TypeError("agent() prompt must be a string")
    }
    const { model } = options
    if (!model) {
      throw new AppServerModelError("agent() requires an explicit model")
    }
    if (this.availableModels.size === 0) {
      await this.listModels()
    }
    if (!this.availableModels.has(model)) {
      throw new AppServerModelError(`agent() model is not available: ${model}`)
    }

    const cwd = options.cwd ?? this.options.cwd
    const approvalPolicy = options.approvalPolicy ?? "never"
    const sandbox = options.sandbox ?? "read-only"
    const threadResult = readThreadStartResult(
      await this.request("thread/start", {
        approvalPolicy,
        ephemeral: true,
        model,
        sandbox,
        ...(options.agentType === undefined
          ? {}
          : {
              developerInstructions: agentTypeInstructions(options.agentType)
            }),
        ...(cwd === undefined ? {} : { cwd })
      })
    )
    return { approvalPolicy, cwd, model, sandbox, threadResult }
  }

  private createAgentExecution(
    agentId: string,
    model: string,
    options: AppServerAgentOptions,
    threadResult: { model: string; threadId: string },
    workflowRunId: string
  ): AgentExecution {
    const execution: AgentExecution = {
      agentId,
      completedItems: [],
      eventBuffer: new AsyncEventBuffer(),
      eventListeners: new Set(),
      eventSink: options.eventSink,
      eventTimestamp:
        options.eventTimestamp ?? this.options.now ?? (() => Date.now()),
      interruptPromise: null,
      itemIds: [],
      label: options.label ?? null,
      phase: options.phase ?? null,
      rejectResult: () => undefined,
      requestedModel: model,
      resolvedModel: threadResult.model,
      resolveResult: () => undefined,
      resultPromise: Promise.resolve(
        undefined as unknown as AppServerAgentCall
      ),
      schema: options.schema,
      settled: false,
      state: "starting",
      terminalError: null,
      terminalStatus: null,
      threadId: threadResult.threadId,
      turnId: null,
      turnStartedEmitted: false,
      usage: null,
      workflowRunId
    }
    execution.resultPromise = new Promise<AppServerAgentCall>(
      (resolve, reject) => {
        execution.resolveResult = resolve
        execution.rejectResult = reject
      }
    )
    return execution
  }

  async callAgent(
    prompt: string,
    options: AppServerAgentOptions = {}
  ): Promise<AppServerAgentCall> {
    const handle = await this.startAgent(prompt, options)
    return handle.result()
  }

  async agent(
    prompt: string,
    options: AppServerAgentOptions = {}
  ): Promise<AppServerJSONValue> {
    return (await this.callAgent(prompt, options)).result
  }

  private async steerAgent(
    execution: AgentExecution,
    input: string | readonly AppServerTextInput[],
    expectedTurnId = execution.turnId ?? ""
  ): Promise<AppServerSteerResult> {
    if (execution.state !== "active" || execution.terminalStatus !== null) {
      throw new AppServerTurnError(
        execution.terminalStatus ?? execution.state,
        `thread ${execution.threadId} turn is not active; steering is no longer allowed`
      )
    }
    if (execution.turnId === null || expectedTurnId.length === 0) {
      throw new AppServerTurnError(
        "starting",
        `thread ${execution.threadId} has no active turn to steer`
      )
    }
    if (expectedTurnId !== execution.turnId) {
      throw new AppServerTurnError(
        "stale",
        `expected active turn ${execution.turnId}, received ${expectedTurnId}`
      )
    }
    const inputItems =
      typeof input === "string"
        ? ([
            { text: input, text_elements: [], type: "text" }
          ] satisfies AppServerTextInput[])
        : input.map((item) => {
            if (
              !isRecord(item) ||
              item.type !== "text" ||
              typeof item.text !== "string" ||
              !Array.isArray(item.text_elements)
            ) {
              throw new TypeError("turn/steer input must contain text items")
            }
            return {
              text: item.text,
              text_elements: item.text_elements,
              type: "text"
            } satisfies AppServerTextInput
          })
    const accepted = readTurnSteerResult(
      await this.request("turn/steer", {
        expectedTurnId,
        input: inputItems,
        threadId: execution.threadId
      })
    )
    execution.turnId = accepted.turnId
    if (execution.terminalStatus === null) {
      this.emitEvent(execution, "turn/steer", {
        item: null,
        itemType: null,
        lifecycle: "intermediate",
        status: "steered",
        subject: "turn",
        type: "lifecycle"
      })
    }
    return accepted
  }

  private interruptAgent(execution: AgentExecution): Promise<void> {
    if (execution.state === "completed" || execution.state === "failed") {
      return Promise.resolve()
    }
    if (execution.interruptPromise !== null) {
      return execution.interruptPromise
    }
    if (execution.turnId === null) {
      throw new AppServerTurnError(
        "starting",
        `thread ${execution.threadId} has no active turn to interrupt`
      )
    }
    const { turnId } = execution
    execution.state = "interrupting"
    execution.interruptPromise = (async () => {
      readTurnInterruptResult(
        await this.request("turn/interrupt", {
          threadId: execution.threadId,
          turnId
        })
      )
      if (execution.terminalStatus === null) {
        this.emitEvent(execution, "turn/interrupt", {
          item: null,
          itemType: null,
          lifecycle: "intermediate",
          status: "interrupt-requested",
          subject: "turn",
          type: "lifecycle"
        })
      }
    })().catch((error: unknown) => {
      if (execution.state === "interrupting") {
        execution.state = "active"
      }
      execution.interruptPromise = null
      throw error
    })
    return execution.interruptPromise
  }

  private maybeFinishAgent(
    execution: AgentExecution,
    options: AppServerAgentOptions
  ): void {
    if (
      execution.settled ||
      execution.terminalStatus === null ||
      execution.turnId === null
    ) {
      return
    }
    execution.settled = true
    const { turnId } = execution
    if (execution.terminalStatus !== "completed") {
      execution.state = "failed"
      const detail = execution.terminalError
        ? `: ${execution.terminalError}`
        : ""
      execution.rejectResult(
        new AppServerTurnError(
          execution.terminalStatus,
          `thread ${execution.threadId}, turn ${turnId} ended with status ${execution.terminalStatus}${detail}`
        )
      )
      execution.eventBuffer.close()
      this.agents.delete(execution.threadId)
      return
    }
    const finalItem = execution.completedItems.at(-1)
    if (!finalItem) {
      execution.state = "failed"
      execution.rejectResult(
        new AppServerResultError(
          `turn ${turnId} completed without an authoritative completed agent message`
        )
      )
      execution.eventBuffer.close()
      this.agents.delete(execution.threadId)
      return
    }
    try {
      const result =
        options.schema === undefined
          ? finalItem.text
          : parseAndValidateStructuredResult(finalItem.text, options.schema)
      const evidence: AppServerAgentEvidence = {
        itemIds: [...execution.itemIds],
        requestedModel: execution.requestedModel,
        resolvedModel: execution.resolvedModel ?? execution.requestedModel,
        terminalStatus: "completed",
        threadId: execution.threadId,
        turnId,
        ...(execution.usage === null ? {} : { usage: execution.usage })
      }
      const call = { evidence, result } satisfies AppServerAgentCall
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
    if (execution.settled) {
      return
    }
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
    ids: {
      threadId?: string | null
      turnId?: string | null
      itemId?: string | null
    } = {}
  ): void {
    const timestamp = execution.eventTimestamp()
    if (!Number.isFinite(timestamp)) {
      throw new AppServerProtocolError(
        "normalized event timestamp must be finite"
      )
    }
    this.eventSequence += 1
    const event = {
      agentId: execution.agentId,
      itemId: ids.itemId === undefined ? null : ids.itemId,
      label: execution.label,
      method,
      phase: execution.phase,
      requestedModel: execution.requestedModel,
      resolvedModel: execution.resolvedModel,
      sequence: this.eventSequence,
      threadId: ids.threadId === undefined ? execution.threadId : ids.threadId,
      timestamp,
      turnId: ids.turnId === undefined ? execution.turnId : ids.turnId,
      workflowRunId: execution.workflowRunId,
      ...payload
    } as AppServerNormalizedEvent
    execution.eventBuffer.push(event)
    for (const listener of execution.eventListeners) {
      this.notifyObserver(listener, event)
    }
    if (execution.eventSink) {
      this.notifyObserver(execution.eventSink, event)
    }
    for (const listener of this.normalizedListeners) {
      this.notifyObserver(listener, event)
    }
  }

  private notifyObserver(
    listener: AppServerNormalizedEventListener,
    event: AppServerNormalizedEvent
  ): void {
    try {
      listener(event)
    } catch {
      // Progress observers are diagnostic. They must not tear down the shared transport or sibling turns.
    }
  }

  private emitTurnStartedIfNeeded(
    execution: AgentExecution,
    turnId: string,
    method: string
  ): void {
    if (execution.turnStartedEmitted) {
      return
    }
    execution.turnStartedEmitted = true
    execution.turnId = turnId
    this.emitEvent(
      execution,
      method,
      {
        item: null,
        itemType: null,
        lifecycle: "started",
        status: "inProgress",
        subject: "turn",
        type: "lifecycle"
      },
      { turnId }
    )
  }

  async close(): Promise<void> {
    if (this.state === "closed") {
      return
    }
    if (this.state === "closing") {
      await withTimeout(
        this.exitPromise,
        this.shutdownTimeoutMs,
        "timed out waiting for App Server shutdown"
      )
      return
    }
    this.state = "closing"
    const error = new AppServerProcessError("App Server client shut down")
    for (const listener of this.failureListeners) {
      listener(error)
    }
    this.failureListeners.clear()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
    for (const execution of this.agents.values()) {
      this.failAgent(execution, error)
    }
    try {
      this.process.stdin.end()
    } catch {
      /* already closed */
    }
    try {
      this.process.kill("SIGTERM")
    } catch {
      /* already exited */
    }
    try {
      await withTimeout(
        this.exitPromise,
        this.shutdownTimeoutMs,
        "timed out waiting for App Server shutdown"
      )
    } catch {
      try {
        this.process.kill("SIGKILL")
      } catch {
        /* already exited */
      }
    }
    this.state = "closed"
    this.resolveExit()
  }

  private installProcessHandlers(): void {
    this.process.once("error", (error) => {
      this.failConnection(
        new AppServerProcessError(
          `App Server process error: ${describeError(error)}`,
          { cause: error }
        )
      )
    })
    this.process.once("exit", (code, signal) => {
      this.resolveExit()
      if (this.state === "closing" || this.state === "closed") {
        return
      }
      this.failConnection(
        new AppServerProcessError(
          `App Server exited before completion (code=${String(code)}, signal=${String(signal)})`
        )
      )
    })
    this.process.once("close", () => this.resolveExit())
  }

  private async initialize(): Promise<AppServerInitializeResult> {
    if (this.initialized) {
      throw new AppServerProtocolError("initialize may only be sent once")
    }
    const clientInfo: AppServerClientInfo = {
      name: this.options.clientInfo?.name ?? "gpt-workflow",
      title: this.options.clientInfo?.title ?? "GPT Workflow Runtime",
      version: this.options.clientInfo?.version ?? "0.1.0"
    }
    const result = readInitializeResult(
      await this.request("initialize", {
        capabilities: { experimentalApi: true, requestAttestation: false },
        clientInfo
      })
    )
    this.initialized = true
    await this.writeMessage({ method: "initialized", params: {} })
    return result
  }

  private async writeMessage(message: RecordValue): Promise<void> {
    if (this.state === "failed" || this.state === "closed") {
      throw (
        this.failure ?? new AppServerProcessError("App Server is unavailable")
      )
    }
    const line = `${JSON.stringify(message)}\n`
    let result = await this.process.stdin.write(line)
    if (result === false) {
      await withTimeout(
        new Promise<void>((resolve) => {
          this.process.stdin.once("drain", resolve)
        }),
        this.requestTimeoutMs,
        "timed out waiting for App Server stdin backpressure"
      )
      result = true
    }
  }

  private async readOutput(): Promise<void> {
    let buffer = ""
    const textDecoder = new TextDecoder()
    try {
      for await (const chunk of this.process.stdout) {
        buffer +=
          typeof chunk === "string"
            ? chunk
            : textDecoder.decode(chunk, { stream: true })
        let newlineIndex = buffer.indexOf("\n")
        while (newlineIndex >= 0) {
          const line = buffer
            .slice(0, newlineIndex)
            .replace(TRAILING_CARRIAGE_RETURN, "")
          buffer = buffer.slice(newlineIndex + 1)
          if (line.trim().length === 0) {
            throw new AppServerProtocolError(
              "App Server emitted a blank JSONL line"
            )
          }
          this.dispatchLine(line)
          newlineIndex = buffer.indexOf("\n")
        }
      }
      buffer += textDecoder.decode()
      if (buffer.trim().length > 0) {
        throw new AppServerProtocolError(
          "App Server ended with a partial JSONL message"
        )
      }
      if (this.state !== "closing" && this.state !== "closed") {
        this.failConnection(
          new AppServerProcessError(
            "App Server stdout reached EOF before completion"
          )
        )
      }
    } catch (error) {
      if (this.state !== "closing" && this.state !== "closed") {
        this.failConnection(
          error instanceof AppServerError
            ? error
            : new AppServerProcessError(
                `failed reading App Server stdout: ${describeError(error)}`,
                { cause: error }
              )
        )
      }
    }
  }

  private dispatchLine(line: string): void {
    const value = this.parseProtocolLine(line)
    if (Object.hasOwn(value, "id")) {
      this.dispatchResponse(value)
      return
    }
    if (typeof value.method !== "string") {
      throw new AppServerProtocolError(
        "App Server notification method must be a string"
      )
    }
    const notification = { method: value.method, params: value.params }
    for (const listener of this.listeners) {
      listener(notification)
    }
    this.routeNormalizedNotification(notification)
  }

  private parseProtocolLine(line: string): RecordValue {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      throw new AppServerProtocolError(
        `App Server emitted malformed JSON: ${describeError(error)}`,
        { cause: error }
      )
    }
    if (
      !isRecord(value) ||
      (typeof value.method !== "string" && !Object.hasOwn(value, "id"))
    ) {
      throw new AppServerProtocolError(
        "App Server emitted a message without a method or request id"
      )
    }
    return value
  }

  private dispatchResponse(value: RecordValue): void {
    if (!isRequestId(value.id)) {
      throw new AppServerProtocolError(
        "App Server response id must be a string or safe integer"
      )
    }
    const hasResult = Object.hasOwn(value, "result")
    const hasError = Object.hasOwn(value, "error")
    if (hasResult === hasError) {
      throw new AppServerProtocolError(
        `App Server response ${String(value.id)} must contain exactly one of result or error`
      )
    }
    const pending = this.pending.get(value.id)
    if (!pending) {
      throw new AppServerProtocolError(
        `App Server response ${String(value.id)} has no pending request`
      )
    }
    clearTimeout(pending.timer)
    this.pending.delete(value.id)
    if (!hasError) {
      pending.resolve(value.result)
      return
    }
    const remoteError = isRecord(value.error) ? value.error : {}
    const message =
      typeof remoteError.message === "string"
        ? remoteError.message
        : JSON.stringify(value.error)
    pending.reject(
      new AppServerRemoteError(
        `${pending.method} failed: ${message}`,
        typeof remoteError.code === "number" ||
          typeof remoteError.code === "string"
          ? remoteError.code
          : undefined
      )
    )
  }

  private routeNormalizedNotification(
    notification: AppServerNotification
  ): void {
    const context = this.activeNotificationContext(notification.params)
    if (context === null) {
      return
    }
    const { execution, ids } = context
    if (ids.turnId !== null) {
      this.emitTurnStartedIfNeeded(execution, ids.turnId, "turn/started")
    }

    const params = recordOrEmpty(notification.params)
    switch (notification.method) {
      case "turn/started": {
        if (ids.turnId === null) {
          return
        }
        execution.turnId = ids.turnId
        return
      }
      case "turn/completed": {
        this.routeTurnCompleted(execution, notification)
        return
      }
      case "item/started":
      case "item/completed": {
        this.routeItemLifecycle(execution, notification, params)
        return
      }
      case "item/agentMessage/delta": {
        this.emitEvent(
          execution,
          notification.method,
          { delta: stringOrNull(params.delta) ?? "", type: "message-delta" },
          ids
        )
        return
      }
      case "item/plan/delta": {
        this.emitEvent(
          execution,
          notification.method,
          {
            delta: stringOrNull(params.delta),
            explanation: null,
            plan: null,
            type: "plan"
          },
          ids
        )
        return
      }
      case "turn/plan/updated": {
        this.emitEvent(
          execution,
          notification.method,
          {
            delta: null,
            explanation: stringOrNull(params.explanation),
            plan: asJSONValue(params.plan),
            type: "plan"
          },
          ids
        )
        return
      }
      case "model/rerouted": {
        const resolvedModel = stringOrNull(params.toModel)
        if (resolvedModel !== null) {
          execution.resolvedModel = resolvedModel
        }
        this.emitEvent(
          execution,
          notification.method,
          {
            item: null,
            itemType: null,
            lifecycle: "intermediate",
            status: "model-rerouted",
            subject: "turn",
            type: "lifecycle"
          },
          ids
        )
        return
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryPartAdded": {
        this.emitEvent(
          execution,
          notification.method,
          {
            delta: stringOrNull(params.delta),
            index: numberOrNull(params.summaryIndex ?? params.contentIndex),
            reasoningKind: reasoningKind(notification.method),
            type: "reasoning"
          },
          ids
        )
        return
      }
      case "item/commandExecution/outputDelta":
      case "command/exec/outputDelta":
      case "process/outputDelta":
      case "process/exited":
      case "item/commandExecution/terminalInteraction": {
        this.emitEvent(
          execution,
          notification.method,
          commandEventPayload(notification.method, params),
          ids
        )
        return
      }
      case "item/fileChange/outputDelta":
      case "item/fileChange/patchUpdated":
      case "turn/diff/updated": {
        this.emitEvent(
          execution,
          notification.method,
          {
            changes: asJSONValue(params.changes),
            delta: stringOrNull(params.delta) ?? stringOrNull(params.diff),
            fileKind: fileEventKind(notification.method),
            type: "file"
          },
          ids
        )
        return
      }
      case "item/mcpToolCall/progress":
      case "mcpServer/startupStatus/updated": {
        this.emitEvent(
          execution,
          notification.method,
          {
            data: asJSONValue(params),
            message:
              stringOrNull(params.message) ?? stringOrNull(params.status),
            toolKind:
              notification.method === "item/mcpToolCall/progress"
                ? "mcp-progress"
                : "mcp-server",
            type: "tool"
          },
          ids
        )
        return
      }
      case "thread/tokenUsage/updated": {
        const usage = asJSONValue(params.tokenUsage) ?? {}
        execution.usage = usage
        if (this.lastAgentAttempt?.threadId === execution.threadId) {
          this.lastAgentAttempt.usage = usage
        }
        this.emitEvent(
          execution,
          notification.method,
          { type: "usage", usage },
          ids
        )
        return
      }
      case "warning": {
        this.emitEvent(
          execution,
          notification.method,
          { message: stringOrNull(params.message) ?? "", type: "warning" },
          ids
        )
        return
      }
      case "error": {
        const error = isRecord(params.error)
          ? stringOrNull(params.error.message)
          : null
        this.emitEvent(
          execution,
          notification.method,
          {
            message: error ?? "App Server reported an error",
            type: "error",
            willRetry: booleanOrNull(params.willRetry)
          },
          ids
        )
        return
      }
      case "thread/closed": {
        this.emitEvent(
          execution,
          notification.method,
          {
            item: null,
            itemType: null,
            lifecycle: "completed",
            status: "closed",
            subject: "thread",
            type: "lifecycle"
          },
          ids
        )
        return
      }
      default:
        return
    }
  }

  private activeNotificationContext(params: unknown): {
    execution: AgentExecution
    ids: ReturnType<typeof notificationIds>
  } | null {
    const ids = notificationIds(params)
    if (ids.threadId === null) {
      return null
    }
    const execution = this.agents.get(ids.threadId)
    if (!execution) {
      return null
    }
    if (
      execution.turnId !== null &&
      ids.turnId !== null &&
      ids.turnId !== execution.turnId
    ) {
      return null
    }
    return { execution, ids }
  }

  private routeTurnCompleted(
    execution: AgentExecution,
    notification: AppServerNotification
  ): void {
    const completed = readTurnCompletedParams(notification.params)
    if (completed === null) {
      throw new AppServerProtocolError(
        "turn/completed notification has invalid params"
      )
    }
    execution.turnId = completed.turn.id
    execution.terminalStatus = completed.turn.status
    execution.terminalError = completed.turn.error?.message ?? null
    execution.state =
      completed.turn.status === "completed" ? "completed" : "failed"
    if (this.lastAgentAttempt?.threadId === execution.threadId) {
      this.lastAgentAttempt.turnId = completed.turn.id
      this.lastAgentAttempt.terminalStatus = completed.turn.status
      if (execution.usage !== null) {
        this.lastAgentAttempt.usage = execution.usage
      }
    }
    this.emitEvent(
      execution,
      notification.method,
      {
        error: execution.terminalError,
        lifecycle: "completed",
        status: completed.turn.status,
        type: "terminal",
        usage: execution.usage
      },
      { threadId: completed.threadId, turnId: completed.turn.id }
    )
    this.maybeFinishAgent(execution, this.agentOptionsFor(execution))
  }

  private routeItemLifecycle(
    execution: AgentExecution,
    notification: AppServerNotification,
    params: RecordValue
  ): void {
    let itemParams: ReturnType<typeof readItemCompletedParams> = null
    if (notification.method === "item/completed") {
      itemParams = readItemCompletedParams(notification.params)
    } else if (
      typeof params.threadId === "string" &&
      typeof params.turnId === "string" &&
      isRecord(params.item)
    ) {
      itemParams = {
        item: params.item,
        threadId: params.threadId,
        turnId: params.turnId
      }
    }
    if (itemParams === null) {
      throw new AppServerProtocolError(
        `${notification.method} notification has invalid params`
      )
    }
    const { item } = itemParams
    const itemType = stringOrNull(item.type)
    const itemId = stringOrNull(item.id)
    const subject = itemSubject(item)
    const lifecycle: AppServerEventLifecycle =
      notification.method === "item/started" ? "started" : "completed"
    if (
      notification.method === "item/completed" &&
      itemType === "agentMessage" &&
      itemId !== null &&
      typeof item.text === "string"
    ) {
      execution.completedItems.push({ id: itemId, text: item.text })
      execution.itemIds.push(itemId)
      if (this.lastAgentAttempt?.threadId === execution.threadId) {
        this.lastAgentAttempt.itemIds.push(itemId)
      }
    }
    const ids = {
      itemId,
      threadId: itemParams.threadId,
      turnId: itemParams.turnId
    }
    if (subject === "collaboration") {
      this.emitEvent(
        execution,
        notification.method,
        {
          item: asJSONValue(item),
          lifecycle,
          type: "collaboration"
        },
        ids
      )
    } else {
      this.emitEvent(
        execution,
        notification.method,
        {
          item: asJSONValue(item),
          itemType,
          lifecycle,
          status: stringOrNull(item.status),
          subject,
          type: "lifecycle"
        },
        ids
      )
    }
    if (notification.method === "item/completed") {
      this.maybeFinishAgent(execution, this.agentOptionsFor(execution))
    }
  }

  private agentOptionsFor(execution: AgentExecution): AppServerAgentOptions {
    return {
      agentId: execution.agentId,
      label: execution.label ?? undefined,
      model: execution.requestedModel,
      phase: execution.phase ?? undefined,
      schema: execution.schema,
      workflowRunId: execution.workflowRunId
    }
  }

  private failConnection(error: AppServerError): void {
    if (
      this.state === "failed" ||
      this.state === "closed" ||
      this.state === "closing"
    ) {
      return
    }
    this.state = "failed"
    this.failure = error
    for (const listener of this.failureListeners) {
      listener(error)
    }
    this.failureListeners.clear()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
    for (const execution of this.agents.values()) {
      this.failAgent(execution, error)
    }
    try {
      this.process.kill("SIGTERM")
    } catch {
      /* already exited */
    }
    this.resolveExit()
  }
}

function agentTypeInstructions(agentType: string): string {
  if (agentType.toLowerCase() === "explore") {
    return "Act as a read-only repository exploration agent. Do not edit files. When searching, include hidden and ignored directories where relevant (for example, use fd -H -I). Verify filesystem claims with tools before answering."
  }
  return `Act as the ${agentType} repository subagent requested by the parent workflow.`
}

function sandboxPolicyFor(
  sandbox: "read-only" | "workspace-write" | "danger-full-access",
  cwd: string | undefined
): AppServerJSONObject {
  switch (sandbox) {
    case "read-only":
      return { networkAccess: false, type: "readOnly" }
    case "workspace-write":
      return {
        excludeSlashTmp: true,
        excludeTmpdirEnvVar: true,
        networkAccess: false,
        type: "workspaceWrite",
        writableRoots: cwd === undefined ? [] : [cwd]
      }
    case "danger-full-access":
      return { type: "dangerFullAccess" }
    default:
      throw new TypeError(`unsupported sandbox policy: ${sandbox}`)
  }
}

function parseAndValidateStructuredResult(
  text: string,
  schema: AppServerJSONObject
): AppServerJSONValue {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new AppServerResultError(
      "authoritative structured agent text was not valid JSON",
      { cause: error }
    )
  }
  const validator = new Ajv({ allErrors: true, strict: false }).compile(
    schema as AnySchema
  )
  if (!validator(value)) {
    const details =
      validator.errors
        ?.map(
          (error) =>
            `${error.instancePath || "/"} ${error.message ?? "failed validation"}`
        )
        .join(", ") ?? "unknown schema error"
    throw new AppServerResultError(
      `authoritative structured agent result failed schema validation: ${details}`
    )
  }
  return value as AppServerJSONValue
}

function normalizeOutputSchema(value: AppServerJSONValue): AppServerJSONValue {
  if (Array.isArray(value)) {
    return value.map(normalizeOutputSchema)
  }
  if (value === null || typeof value !== "object") {
    return value
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeOutputSchema(child)
    ])
  ) as AppServerJSONObject
  if (normalized.type === "object" || normalized.properties !== undefined) {
    normalized.additionalProperties = false
  }
  return normalized
}
