import { spawn } from "node:child_process"
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
}

export interface AppServerNotification {
  method: string
  params: unknown
}

export type AppServerNotificationListener = (notification: AppServerNotification) => void

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
}

export interface AppServerAgentEvidence {
  requestedModel: string
  resolvedModel: string
  threadId: string
  turnId: string
  itemIds: string[]
  terminalStatus: "completed"
}

export interface AppServerAgentAttemptEvidence {
  requestedModel: string
  resolvedModel: string
  threadId: string
  turnId: string | null
  itemIds: string[]
  terminalStatus: string | null
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
  item: {
    type?: string
    id?: string
    text?: string
  }
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

export class AppServerClient {
  readonly initializeResult!: AppServerInitializeResult

  private readonly process: AppServerProcess
  private readonly requestTimeoutMs: number
  private readonly turnTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly listeners = new Set<AppServerNotificationListener>()
  private readonly failureListeners = new Set<(error: AppServerError) => void>()
  private readonly pending = new Map<string | number, PendingRequest>()
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

  async callAgent(prompt: string, options: AppServerAgentOptions = {}): Promise<AppServerAgentCall> {
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
    this.lastAgentAttempt = {
      requestedModel: model,
      resolvedModel: threadResult.model,
      threadId: threadResult.threadId,
      turnId: null,
      itemIds: [],
      terminalStatus: null,
    }

    const completedItems: Array<{ id: string; text: string }> = []
    let turnId: string | null = null
    let terminal: TurnCompletedParams | null = null
    let resolveTurn!: (value: AppServerAgentCall) => void
    let rejectTurn!: (error: unknown) => void
    const turnResult = new Promise<AppServerAgentCall>((resolve, reject) => {
      resolveTurn = resolve
      rejectTurn = reject
    })
    let settled = false
    const maybeFinish = () => {
      if (settled || turnId === null || terminal === null || terminal.turn.id !== turnId) return
      settled = true
      if (terminal.turn.status !== "completed") {
        const detail = terminal.turn.error?.message ? `: ${terminal.turn.error.message}` : ""
        rejectTurn(new AppServerTurnError(terminal.turn.status, `thread ${threadResult.threadId}, turn ${turnId} ended with status ${terminal.turn.status}${detail}`))
        return
      }
      if (completedItems.length === 0) {
        rejectTurn(new AppServerResultError(`turn ${turnId} completed without an authoritative completed agent message`))
        return
      }
      const finalItem = completedItems[completedItems.length - 1]
      if (!finalItem) {
        rejectTurn(new AppServerResultError(`turn ${turnId} completed without an authoritative final item`))
        return
      }
      try {
        const result = options.schema === undefined
          ? finalItem.text
          : parseAndValidateStructuredResult(finalItem.text, options.schema)
        const call = {
          result,
          evidence: {
            requestedModel: model,
            resolvedModel: threadResult.model,
            threadId: threadResult.threadId,
            turnId,
            itemIds: completedItems.map((item) => item.id),
            terminalStatus: "completed",
          },
        } satisfies AppServerAgentCall
        this.lastAgentEvidence = call.evidence
        resolveTurn(call)
      } catch (error) {
        rejectTurn(error)
      }
    }
    const unsubscribe = this.subscribe((notification) => {
      if (notification.method === "item/completed") {
        const params = readItemCompletedParams(notification.params)
        if (params === null) throw new AppServerProtocolError("item/completed notification has invalid params")
        if (params.threadId !== threadResult.threadId) return
        if (turnId !== null && params.turnId !== turnId) return
        if (params.item.type === "agentMessage" && typeof params.item.id === "string" && typeof params.item.text === "string") {
          completedItems.push({ id: params.item.id, text: params.item.text })
          if (this.lastAgentAttempt?.threadId === threadResult.threadId) {
            this.lastAgentAttempt.itemIds.push(params.item.id)
          }
          maybeFinish()
        }
      } else if (notification.method === "turn/completed") {
        const params = readTurnCompletedParams(notification.params)
        if (params === null) throw new AppServerProtocolError("turn/completed notification has invalid params")
        if (params.threadId !== threadResult.threadId) return
        if (turnId !== null && params.turn.id !== turnId) return
        terminal = params
        if (this.lastAgentAttempt?.threadId === threadResult.threadId) {
          this.lastAgentAttempt.terminalStatus = params.turn.status
        }
        maybeFinish()
      }
    })
    let removeFailureListener: () => void = () => undefined
    const connectionFailure = new Promise<never>((_, reject) => {
      removeFailureListener = this.onFailure(reject)
    })

    try {
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
      turnId = turnResultResponse.turnId
      if (this.lastAgentAttempt?.threadId === threadResult.threadId) this.lastAgentAttempt.turnId = turnId
      maybeFinish()
      return await withTimeout(Promise.race([turnResult, connectionFailure]), this.turnTimeoutMs, `turn ${turnId} timed out after ${this.turnTimeoutMs}ms`)
    } finally {
      removeFailureListener()
      unsubscribe()
    }
  }

  async agent(prompt: string, options: AppServerAgentOptions = {}): Promise<AppServerJSONValue> {
    return (await this.callAgent(prompt, options)).result
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
    for (const listener of this.listeners) listener({ method: value.method, params: value.params })
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
