import { expect, test } from "bun:test"
import {
  AppServerClient,
  AppServerModelError,
  AppServerProcessError,
  AppServerProtocolError,
  AppServerResultError,
  AppServerTimeoutError,
  AppServerTurnError,
  REQUIRED_APP_SERVER_MODELS,
  type AppServerAgentHandle,
  type AppServerProcess,
  type AppServerSpawner,
} from "../src/app-server.ts"
import { runWorkflowScript } from "../src/runtime.ts"

type Message = Record<string, unknown>
type Handler = (message: Message, process: FakeProcess) => void | Promise<void>

class AsyncQueue<T> {
  private values: T[] = []
  private waiters: Array<(result: IteratorResult<T>) => void> = []
  private ended = false

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.ended) return Promise.resolve({ done: true, value: undefined })
    return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve))
  }

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.values.push(value)
  }

  end(): void {
    this.ended = true
    while (this.waiters.length > 0) this.waiters.shift()?.({ done: true, value: undefined })
  }
}

class FakeProcess implements AppServerProcess {
  readonly messages: Message[] = []
  readonly stdoutQueue = new AsyncQueue<string>()
  readonly stdin: AppServerProcess["stdin"]
  backpressure = false
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  private readonly handler: Handler
  readonly stdout: AsyncIterable<string>

  constructor(handler: Handler) {
    this.handler = handler
    this.stdin = {
      write: (chunk: string): boolean => {
        this.messages.push(JSON.parse(chunk) as Message)
        const result = this.handler(this.messages[this.messages.length - 1]!, this)
        if (result instanceof Promise) void result
        if (this.backpressure) {
          setTimeout(() => this.emit("drain"), 0)
          return false
        }
        return true
      },
      end: () => this.exit(0, null),
      once: (event: "drain", listener: () => void) => this.once(event, listener),
    }
    this.stdout = this.readStdout()
  }

  private async *readStdout(): AsyncIterable<string> {
    while (true) {
      const next = await this.stdoutQueue.next()
      if (next.done) return
      yield next.value
    }
  }

  once(event: "error" | "exit" | "close" | "drain", listener: (...args: unknown[]) => void): void {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(listener)
    this.handlers.set(event, handlers)
  }

  kill(): void {
    this.exit(null, "SIGTERM")
  }

  respond(message: Message): void {
    this.stdoutQueue.push(`${JSON.stringify(message)}\n`)
  }

  pushRaw(text: string): void {
    this.stdoutQueue.push(text)
  }

  closeStdout(): void {
    this.stdoutQueue.end()
  }

  exit(code: number | null, signal: string | null): void {
    this.stdoutQueue.end()
    this.emit("exit", code, signal)
    this.emit("close", code, signal)
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers.get(event) ?? []
    this.handlers.delete(event)
    for (const handler of handlers) handler(...args)
  }
}

function initializeHandler(next: Handler = () => undefined): Handler {
  return (message, process) => {
    if (message.method === "initialize") {
      process.respond({
        id: message.id,
        result: {
          userAgent: "codex-cli test",
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
        },
      })
      return
    }
    return next(message, process)
  }
}

function makeSpawner(handler: Handler, holder: { process?: FakeProcess }): AppServerSpawner {
  return () => {
    const process = new FakeProcess(handler)
    holder.process = process
    return process
  }
}

async function connectFake(
  next: Handler = () => undefined,
  options: { requestTimeoutMs?: number; turnTimeoutMs?: number; shutdownTimeoutMs?: number; requiredModels?: readonly string[] } = {},
): Promise<{ client: AppServerClient; process: FakeProcess }> {
  const holder: { process?: FakeProcess } = {}
  const client = await AppServerClient.connect({
    ...options,
    spawn: makeSpawner(initializeHandler(next), holder),
  })
  return { client, process: holder.process! }
}

function modelListHandler(message: Message, process: FakeProcess): void {
  if (message.method !== "model/list") return
  const cursor = (message.params as Message | undefined)?.cursor
  process.respond({
    id: message.id,
    result: cursor === "page-2"
      ? { data: [{ id: "gpt-5.6-terra", model: "gpt-5.6-terra" }], nextCursor: null }
      : { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: "page-2" },
  })
}

test("initializes exactly once, sends initialized after the response, correlates IDs, and handles backpressure", async () => {
  const { client, process } = await connectFake((message, process) => {
    if (message.method === "correlation/one") process.respond({ id: message.id, result: "one" })
    if (message.method === "correlation/two") process.respond({ id: message.id, result: "two" })
  })
  process.backpressure = true

  const first = client.request("correlation/one")
  const second = client.request("correlation/two")
  expect(await Promise.all([first, second])).toEqual(["one", "two"])
  expect(process.messages.map((message) => message.method)).toEqual([
    "initialize",
    "initialized",
    "correlation/one",
    "correlation/two",
  ])
  expect(process.messages[0]).toMatchObject({ id: 1, method: "initialize" })
  expect(process.messages[1]).not.toHaveProperty("id")
  await expect(client.request("initialize")).rejects.toThrow(AppServerProtocolError)
  await client.close()
  await client.close()
  expect(client.status).toBe("closed")
})

test("rejects malformed JSON and unknown protocol responses instead of hanging", async () => {
  const malformed = await connectFake()
  const pending = malformed.client.request("waiting")
  malformed.process.pushRaw("{not-json}\n")
  await expect(pending).rejects.toThrow(/malformed JSON/)
  await malformed.client.close()

  const unknown = await connectFake()
  const unknownPending = unknown.client.request("waiting")
  unknown.process.respond({ id: 999, result: true })
  await expect(unknownPending).rejects.toThrow(/no pending request/)
  await unknown.client.close()
})

test("rejects early EOF, process exit, and request timeouts explicitly", async () => {
  const eof = await connectFake(undefined, { requestTimeoutMs: 1000 })
  const eofPending = eof.client.request("waiting")
  eof.process.closeStdout()
  await expect(eofPending).rejects.toThrow(/EOF/)

  const exited = await connectFake(undefined, { requestTimeoutMs: 1000 })
  const exitPending = exited.client.request("waiting")
  exited.process.exit(17, null)
  await expect(exitPending).rejects.toThrow(/exited before completion/)

  const timeout = await connectFake(undefined, { requestTimeoutMs: 20 })
  await expect(timeout.client.request("never-responds")).rejects.toThrow(AppServerTimeoutError)
  await eof.client.close()
  await exited.client.close()
  await timeout.client.close()
})

test("paginates model/list and asserts the literal Luna and Terra IDs", async () => {
  const { client } = await connectFake(modelListHandler)
  const models = await client.listModels()
  expect(models.map((model) => model.id)).toEqual([...REQUIRED_APP_SERVER_MODELS])
  await expect(client.assertRequiredModels()).resolves.toHaveLength(2)
  await client.close()

  const missing = await connectFake((message, process) => {
    if (message.method !== "model/list") return
    process.respond({ id: message.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } })
  })
  await expect(missing.client.assertRequiredModels()).rejects.toThrow(AppServerModelError)
  await missing.client.close()
})

function agentHandler(text: string, status = "completed"): Handler {
  return (message, process) => {
    if (message.method === "model/list") {
      process.respond({
        id: message.id,
        result: {
          data: REQUIRED_APP_SERVER_MODELS.map((model) => ({ id: model, model })),
          nextCursor: null,
        },
      })
      return
    }
    if (message.method === "thread/start") {
      process.respond({ id: message.id, result: { thread: { id: "thread-1" }, model: (message.params as Message).model } })
      return
    }
    if (message.method === "turn/start") {
      const params = message.params as Message
      const threadId = params.threadId as string
      process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
      queueMicrotask(() => {
        process.respond({ method: "item/agentMessage/delta", params: { threadId, turnId: "turn-1", itemId: "item-1", delta: "stale delta" } })
        process.respond({ method: "item/completed", params: { threadId, turnId: "turn-1", completedAtMs: 1, item: { type: "agentMessage", id: "item-1", text: text } } })
        process.respond({ method: "turn/completed", params: { threadId, turn: { id: "turn-1", status, error: status === "completed" ? null : { message: "terminal failure" } } } })
      })
    }
  }
}

test("resolves text only from authoritative completed item state and terminal completion", async () => {
  const { client, process } = await connectFake(agentHandler("authoritative final text"), { requiredModels: REQUIRED_APP_SERVER_MODELS })
  const call = await client.callAgent("return the final text", { model: "gpt-5.6-luna", label: "text-probe", phase: "Probe" })
  expect(call.result).toBe("authoritative final text")
  expect(call.evidence).toEqual({
    requestedModel: "gpt-5.6-luna",
    resolvedModel: "gpt-5.6-luna",
    threadId: "thread-1",
    turnId: "turn-1",
    itemIds: ["item-1"],
    terminalStatus: "completed",
  })
  expect(process.messages.find((message) => message.method === "thread/start")?.params).toMatchObject({
    model: "gpt-5.6-luna",
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
  })
  expect(process.messages.find((message) => message.method === "turn/start")?.params).toMatchObject({
    model: "gpt-5.6-luna",
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    responsesapiClientMetadata: { workflow_label: "text-probe", workflow_phase: "Probe" },
  })
  await client.close()
})

test("normalizes early lifecycle and intermediate events with complete run attribution", async () => {
  let timestamp = 1000
  const { client, process } = await connectFake((message, process) => {
    if (message.method === "model/list") {
      process.respond({ id: message.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } })
      return
    }
    if (message.method === "thread/start") {
      process.respond({ id: message.id, result: { thread: { id: "thread-events" }, model: "gpt-5.6-luna" } })
      return
    }
    if (message.method !== "turn/start") return
    const params = message.params as Message
    const threadId = params.threadId as string
    process.respond({ method: "item/started", params: {
      threadId,
      turnId: "turn-events",
      startedAtMs: 1,
      item: { type: "agentMessage", id: "item-final", text: "" },
    } })
    process.respond({ method: "item/agentMessage/delta", params: { threadId, turnId: "turn-events", itemId: "item-final", delta: "stale intermediate" } })
    process.respond({ id: message.id, result: { turn: { id: "turn-events" } } })
    queueMicrotask(() => {
      process.respond({ method: "item/plan/delta", params: { threadId, turnId: "turn-events", itemId: "plan-1", delta: "inspect" } })
      process.respond({ method: "item/reasoning/summaryTextDelta", params: { threadId, turnId: "turn-events", itemId: "reason-1", summaryIndex: 0, delta: "because" } })
      process.respond({ method: "item/commandExecution/outputDelta", params: { threadId, turnId: "turn-events", itemId: "command-1", delta: "output" } })
      process.respond({ method: "item/fileChange/patchUpdated", params: { threadId, turnId: "turn-events", itemId: "file-1", changes: [{ path: "src/app.ts" }] } })
      process.respond({ method: "item/mcpToolCall/progress", params: { threadId, turnId: "turn-events", itemId: "tool-1", message: "working" } })
      process.respond({ method: "item/started", params: {
        threadId,
        turnId: "turn-events",
        startedAtMs: 2,
        item: { type: "collabAgentToolCall", id: "collab-1", status: "inProgress", senderThreadId: threadId, receiverThreadIds: [], prompt: null },
      } })
      process.respond({ method: "item/completed", params: {
        threadId,
        turnId: "turn-events",
        completedAtMs: 3,
        item: { type: "collabAgentToolCall", id: "collab-1", status: "completed", senderThreadId: threadId, receiverThreadIds: [], prompt: null },
      } })
      process.respond({ method: "thread/tokenUsage/updated", params: {
        threadId,
        turnId: "turn-events",
        tokenUsage: { total: { totalTokens: 19 }, last: { totalTokens: 19 }, modelContextWindow: 1000 },
      } })
      process.respond({ method: "warning", params: { threadId, message: "non-fatal warning" } })
      process.respond({ method: "error", params: { threadId, turnId: "turn-events", error: { message: "retryable error" }, willRetry: true } })
      process.respond({ method: "item/completed", params: {
        threadId,
        turnId: "turn-events",
        completedAtMs: 4,
        item: { type: "agentMessage", id: "item-final", text: "authoritative nonce-final", phase: null },
      } })
      process.respond({ method: "turn/completed", params: {
        threadId,
        turn: { id: "turn-events", status: "completed", error: null },
      } })
    })
  }, { requiredModels: ["gpt-5.6-luna"] })

  const handle = await client.startAgent("stream", {
    model: "gpt-5.6-luna",
    workflowRunId: "workflow-events",
    agentId: "agent-events",
    label: "events-label",
    phase: "events-phase",
    eventTimestamp: () => timestamp++,
  })
  const call = await handle.result()
  expect(call.result).toBe("authoritative nonce-final")

  const eventLog = [...handle.eventLog]
  expect(eventLog.map((event) => event.type)).toEqual([
    "lifecycle", "lifecycle", "lifecycle", "message-delta", "plan", "reasoning",
    "command", "file", "tool", "collaboration", "collaboration", "usage", "warning", "error", "lifecycle", "terminal",
  ])
  expect(eventLog.map((event) => event.sequence)).toEqual(eventLog.map((_, index) => index + 1))
  expect(eventLog.every((event) => event.workflowRunId === "workflow-events" && event.agentId === "agent-events" && event.label === "events-label" && event.phase === "events-phase" && event.requestedModel === "gpt-5.6-luna" && event.resolvedModel === "gpt-5.6-luna" && event.threadId === "thread-events")).toBe(true)
  expect(eventLog.find((event) => event.type === "lifecycle" && event.subject === "turn" && event.lifecycle === "started")).toMatchObject({ turnId: "turn-events" })
  expect(eventLog.filter((event) => ["message-delta", "plan", "reasoning", "command", "file", "tool", "collaboration", "terminal"].includes(event.type)).every((event) => event.turnId === "turn-events")).toBe(true)
  expect(eventLog.every((event) => event.timestamp >= 1000)).toBe(true)
  expect(eventLog.find((event) => event.type === "message-delta" && event.method === "item/agentMessage/delta")?.sequence).toBeLessThan(
    eventLog.find((event) => event.type === "terminal")?.sequence ?? Infinity,
  )
  expect(eventLog.find((event) => event.type === "terminal")).toMatchObject({ status: "completed", usage: { total: { totalTokens: 19 } } })
  expect(call.evidence).toMatchObject({ usage: { total: { totalTokens: 19 } }, terminalStatus: "completed" })
  await client.close()
  expect(process.messages.filter((message) => message.method === "turn/start")).toHaveLength(1)
})

test("runWorkflowScript uses the App Server client when no offline agent stub is supplied", async () => {
  const { client } = await connectFake(agentHandler("runtime-wired"), { requiredModels: ["gpt-5.6-luna"] })
  let startedHandle: AppServerAgentHandle | undefined
  const execution = await runWorkflowScript(
    "export const meta = { name: 'live', description: 'live' }\nreturn await agent('say runtime-wired', { model: 'gpt-5.6-luna' })",
    {
      appServer: client,
      workflowRunId: "workflow-runtime",
      eventTimestamp: (() => { let timestamp = 1; return () => timestamp++ })(),
      onAgentStart: (handle) => { startedHandle = handle },
    },
  )
  expect(execution.result).toBe("runtime-wired")
  expect(execution.workflowRunId).toBe("workflow-runtime")
  expect(execution.agentEvents.length).toBeGreaterThan(0)
  expect(execution.agentEvents.every((event) => event.workflowRunId === "workflow-runtime" && event.agentId === "workflow-runtime:agent-1")).toBe(true)
  expect(startedHandle).toMatchObject({ workflowRunId: "workflow-runtime", agentId: "workflow-runtime:agent-1" })
  expect(client.lastAgentCallEvidence).toMatchObject({ requestedModel: "gpt-5.6-luna", threadId: "thread-1", turnId: "turn-1" })
  await client.close()
})

test("throwing progress observers do not fail the App Server transport or active turn", async () => {
  const { client } = await connectFake(agentHandler("observer-safe"), { requiredModels: ["gpt-5.6-luna"] })
  client.subscribeEvents(() => { throw new Error("global observer failure") })
  await expect(client.callAgent("complete", {
    model: "gpt-5.6-luna",
    eventSink: () => { throw new Error("agent observer failure") },
  })).resolves.toMatchObject({ result: "observer-safe" })
  expect(client.status).toBe("ready")
  await client.close()
})

test("steers the exact active turn and rejects steering after authoritative terminal completion", async () => {
  const steerMessages: Message[] = []
  const { client, process } = await connectFake((message, process) => {
    if (message.method === "model/list") {
      process.respond({ id: message.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } })
    } else if (message.method === "thread/start") {
      process.respond({ id: message.id, result: { thread: { id: "thread-steer" }, model: "gpt-5.6-luna" } })
    } else if (message.method === "turn/start") {
      const params = message.params as Message
      const threadId = params.threadId as string
      process.respond({ id: message.id, result: { turn: { id: "turn-steer" } } })
      queueMicrotask(() => process.respond({ method: "item/agentMessage/delta", params: { threadId, turnId: "turn-steer", itemId: "item-steer", delta: "waiting for verifier" } }))
    } else if (message.method === "turn/steer") {
      steerMessages.push(message)
      const params = message.params as Message
      expect(params).toMatchObject({ threadId: "thread-steer", expectedTurnId: "turn-steer", input: [{ type: "text", text: "verifier-nonce", text_elements: [] }] })
      process.respond({ id: message.id, result: { turnId: "turn-steer" } })
      queueMicrotask(() => {
        process.respond({ method: "item/agentMessage/delta", params: { threadId: "thread-steer", turnId: "turn-steer", itemId: "item-steer", delta: "verifier-nonce received" } })
        process.respond({ method: "item/completed", params: { threadId: "thread-steer", turnId: "turn-steer", item: { type: "agentMessage", id: "item-steer", text: "final verifier-nonce" } } })
        process.respond({ method: "turn/completed", params: { threadId: "thread-steer", turn: { id: "turn-steer", status: "completed", error: null } } })
      })
    }
  }, { requiredModels: ["gpt-5.6-luna"] })

  const handle = await client.startAgent("wait", { model: "gpt-5.6-luna", workflowRunId: "workflow-steer", agentId: "agent-steer" })
  await expect(handle.steer("wrong-turn", "stale-turn")).rejects.toThrow(/expected active turn turn-steer/)
  const accepted = await handle.steer("verifier-nonce", "turn-steer")
  expect(accepted).toEqual({ turnId: "turn-steer" })
  const result = await handle.result()
  expect(result.result).toBe("final verifier-nonce")
  expect(steerMessages).toHaveLength(1)
  await expect(handle.steer("too late")).rejects.toThrow(/no longer allowed/)
  expect(process.messages.filter((message) => message.method === "turn/steer")).toHaveLength(1)
  await client.close()
})

test("interrupts one sibling turn without cancelling the other", async () => {
  let threadCount = 0
  const { client, process } = await connectFake((message, process) => {
    if (message.method === "model/list") {
      process.respond({ id: message.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } })
      return
    }
    if (message.method === "thread/start") {
      threadCount++
      process.respond({ id: message.id, result: { thread: { id: `thread-sibling-${threadCount}` }, model: "gpt-5.6-luna" } })
      return
    }
    if (message.method === "turn/start") {
      const params = message.params as Message
      const threadId = params.threadId as string
      const turnId = `${threadId}-turn`
      process.respond({ id: message.id, result: { turn: { id: turnId } } })
      if (threadId === "thread-sibling-2") {
        queueMicrotask(() => {
          process.respond({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: `${threadId}-item`, text: "sibling-two-complete" } } })
          process.respond({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", error: null } } })
        })
      }
      return
    }
    if (message.method === "turn/interrupt") {
      const params = message.params as Message
      expect(params).toEqual({ threadId: "thread-sibling-1", turnId: "thread-sibling-1-turn" })
      process.respond({ id: message.id, result: {} })
      queueMicrotask(() => process.respond({ method: "turn/completed", params: { threadId: "thread-sibling-1", turn: { id: "thread-sibling-1-turn", status: "interrupted", error: { message: "requested by verifier" } } } }))
    }
  }, { requiredModels: ["gpt-5.6-luna"] })

  const [first, second] = await Promise.all([
    client.startAgent("sibling one", { model: "gpt-5.6-luna", workflowRunId: "workflow-siblings", agentId: "agent-one" }),
    client.startAgent("sibling two", { model: "gpt-5.6-luna", workflowRunId: "workflow-siblings", agentId: "agent-two" }),
  ])
  await first.interrupt()
  await expect(first.result()).rejects.toThrow(/interrupted/)
  await expect(first.interrupt()).resolves.toBeUndefined()
  await expect(first.steer("after interrupt")).rejects.toThrow(/no longer allowed/)
  await expect(second.result()).resolves.toMatchObject({ result: "sibling-two-complete", evidence: { threadId: "thread-sibling-2" } })
  expect(process.messages.filter((message) => message.method === "turn/interrupt")).toHaveLength(1)
  await client.close()
})

test("parses and validates nested structured output, including enums, integers, and item limits", async () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer", minimum: 1, maximum: 99 },
      tier: { type: "string", enum: ["free", "pro"] },
      tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
      nested: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] },
    },
    required: ["name", "age", "tier", "tags", "nested"],
  }
  const { client, process } = await connectFake(agentHandler(JSON.stringify({ name: "Ada", age: 37, tier: "pro", tags: ["math"], nested: { enabled: true } })), { requiredModels: REQUIRED_APP_SERVER_MODELS })
  const result = await client.agent("return structured data", { model: "gpt-5.6-terra", schema })
  expect(result).toEqual({ name: "Ada", age: 37, tier: "pro", tags: ["math"], nested: { enabled: true } })
  expect(process.messages.find((message) => message.method === "turn/start")?.params).toMatchObject({
    outputSchema: {
      additionalProperties: false,
      properties: {
        nested: { additionalProperties: false },
      },
    },
  })
  await client.close()
})

test("rejects malformed JSON and schema-invalid authoritative results", async () => {
  const schema = { type: "object", properties: { count: { type: "integer", minimum: 2 } }, required: ["count"] }
  const invalidJson = await connectFake(agentHandler("not-json"), { requiredModels: REQUIRED_APP_SERVER_MODELS })
  await expect(invalidJson.client.agent("bad JSON", { model: "gpt-5.6-terra", schema })).rejects.toThrow(AppServerResultError)
  await invalidJson.client.close()

  const invalidSchema = await connectFake(agentHandler(JSON.stringify({ count: 1 })), { requiredModels: REQUIRED_APP_SERVER_MODELS })
  await expect(invalidSchema.client.agent("bad schema", { model: "gpt-5.6-terra", schema })).rejects.toThrow(/schema validation/)
  await invalidSchema.client.close()
})

test("never reports failed or interrupted turns as successful agent results", async () => {
  const failed = await connectFake(agentHandler("ignored", "failed"), { requiredModels: REQUIRED_APP_SERVER_MODELS })
  await expect(failed.client.agent("fail", { model: "gpt-5.6-luna" })).rejects.toThrow(AppServerTurnError)
  await failed.client.close()

  const interrupted = await connectFake(agentHandler("ignored", "interrupted"), { requiredModels: REQUIRED_APP_SERVER_MODELS })
  await expect(interrupted.client.agent("interrupt", { model: "gpt-5.6-luna" })).rejects.toThrow(/interrupted/)
  await interrupted.client.close()
})

test("turn completion without an authoritative completed agent item fails", async () => {
  const { client } = await connectFake((message, process) => {
    if (message.method === "model/list") {
      process.respond({ id: message.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } })
    } else if (message.method === "thread/start") {
      process.respond({ id: message.id, result: { thread: { id: "thread-1" }, model: "gpt-5.6-luna" } })
    } else if (message.method === "turn/start") {
      process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
      queueMicrotask(() => process.respond({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } } }))
    }
  }, { requiredModels: ["gpt-5.6-luna"] })
  await expect(client.agent("no item", { model: "gpt-5.6-luna" })).rejects.toThrow(/without an authoritative completed agent message/)
  await client.close()
})

test("an active turn rejects immediately when the process reaches EOF and has an explicit turn timeout", async () => {
  const noCompletion = await connectFake((message, process) => {
    if (message.method === "model/list") {
      process.respond({ id: message.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } })
    } else if (message.method === "thread/start") {
      process.respond({ id: message.id, result: { thread: { id: "thread-1" }, model: "gpt-5.6-luna" } })
    } else if (message.method === "turn/start") {
      process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
      queueMicrotask(() => process.closeStdout())
    }
  }, { requiredModels: ["gpt-5.6-luna"], turnTimeoutMs: 1000 })
  await expect(noCompletion.client.agent("EOF", { model: "gpt-5.6-luna" })).rejects.toThrow(/EOF/)
  await noCompletion.client.close()

  const timeout = await connectFake((message, process) => {
    if (message.method === "model/list") {
      process.respond({ id: message.id, result: { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }], nextCursor: null } })
    } else if (message.method === "thread/start") {
      process.respond({ id: message.id, result: { thread: { id: "thread-1" }, model: "gpt-5.6-luna" } })
    } else if (message.method === "turn/start") {
      process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
    }
  }, { requiredModels: ["gpt-5.6-luna"], turnTimeoutMs: 20 })
  await expect(timeout.client.agent("timeout", { model: "gpt-5.6-luna" })).rejects.toThrow(AppServerTimeoutError)
  await timeout.client.close()
})

test("App Server process errors are surfaced through the client boundary", async () => {
  const holder: { process?: FakeProcess } = {}
  const clientPromise = AppServerClient.connect({
    requestTimeoutMs: 1000,
    spawn: makeSpawner(initializeHandler(), holder),
  })
  const client = await clientPromise
  const pending = client.request("waiting")
  holder.process!.exit(null, "SIGKILL")
  await expect(pending).rejects.toThrow(AppServerProcessError)
  expect(client.status).toBe("failed")
})
