import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AppServerAgentHandle,
  AppServerClient,
  AppServerModelError,
  type AppServerProcess,
  AppServerProcessError,
  AppServerProtocolError,
  AppServerResultError,
  type AppServerSpawner,
  AppServerTimeoutError,
  AppServerTurnError,
  REQUIRED_APP_SERVER_MODELS
} from "../src/app-server.js"
import { runWorkflowScript } from "../src/runtime.js"

const MALFORMED_JSON_PATTERN = /malformed JSON/
const NO_PENDING_REQUEST_PATTERN = /no pending request/
const EOF_PATTERN = /EOF/
const EXITED_PATTERN = /exited before completion/
const EXPECTED_ACTIVE_TURN_PATTERN = /expected active turn turn-steer/
const NO_LONGER_ALLOWED_PATTERN = /no longer allowed/
const INTERRUPTED_PATTERN = /interrupted/
const SCHEMA_VALIDATION_PATTERN = /schema validation/
const MISSING_AGENT_MESSAGE_PATTERN =
  /without an authoritative completed agent message/

type Message = Record<string, unknown>
type Handler = (message: Message, process: FakeProcess) => void | Promise<void>

class AsyncQueue<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private ended: boolean

  constructor() {
    this.ended = false
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift()
    if (value !== undefined) {
      return Promise.resolve({ done: false, value })
    }
    if (this.ended) {
      return Promise.resolve({ done: true, value: undefined })
    }
    return new Promise<IteratorResult<T>>((resolve) =>
      this.waiters.push(resolve)
    )
  }

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value })
    } else {
      this.values.push(value)
    }
  }

  end(): void {
    this.ended = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined })
    }
  }
}

class FakeProcess implements AppServerProcess {
  readonly messages: Message[] = []
  readonly stdoutQueue = new AsyncQueue<string>()
  readonly stdin: AppServerProcess["stdin"]
  backpressure: boolean
  private readonly handlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >()
  private readonly handler: Handler
  readonly stdout: AsyncIterable<string>

  constructor(handler: Handler) {
    this.backpressure = false
    this.handler = handler
    this.stdin = {
      end: () => this.exit(0, null),
      once: (event: "drain", listener: () => void) =>
        this.once(event, listener),
      write: (chunk: string): boolean => {
        const message = JSON.parse(chunk) as Message
        this.messages.push(message)
        const result = this.handler(message, this)
        if (result instanceof Promise) {
          result.catch((error: unknown) =>
            queueMicrotask(() => {
              throw error
            })
          )
        }
        if (this.backpressure) {
          setTimeout(() => this.emit("drain"), 0)
          return false
        }
        return true
      }
    }
    this.stdout = this.readStdout()
  }

  private async *readStdout(): AsyncIterable<string> {
    const next = await this.stdoutQueue.next()
    if (next.done) {
      return
    }
    yield next.value
    yield* this.readStdout()
  }

  once(
    event: "error" | "exit" | "close" | "drain",
    listener: (...args: unknown[]) => void
  ): void {
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
    for (const handler of handlers) {
      handler(...args)
    }
  }
}

function initializeHandler(next: Handler = () => undefined): Handler {
  return (message, process) => {
    if (message.method === "initialize") {
      process.respond({
        id: message.id,
        result: {
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
          userAgent: "codex-cli test"
        }
      })
      return
    }
    return next(message, process)
  }
}

function makeSpawner(
  handler: Handler,
  holder: { process?: FakeProcess }
): AppServerSpawner {
  return () => {
    const process = new FakeProcess(handler)
    holder.process = process
    return process
  }
}

async function connectFake(
  next: Handler = () => undefined,
  options: {
    requestTimeoutMs?: number
    turnTimeoutMs?: number
    shutdownTimeoutMs?: number
    requiredModels?: readonly string[]
  } = {}
): Promise<{ client: AppServerClient; process: FakeProcess }> {
  const holder: { process?: FakeProcess } = {}
  const client = await AppServerClient.connect({
    ...options,
    spawn: makeSpawner(initializeHandler(next), holder)
  })
  if (!holder.process) {
    throw new Error("fake process was not created")
  }
  return { client, process: holder.process }
}

function modelListHandler(message: Message, process: FakeProcess): void {
  if (message.method !== "model/list") {
    return
  }
  const cursor = (message.params as Message | undefined)?.cursor
  let result = {
    data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
    nextCursor: "page-2" as string | null
  }
  if (cursor === "page-2") {
    result = {
      data: [{ id: "gpt-5.6-terra", model: "gpt-5.6-terra" }],
      nextCursor: "page-3"
    }
  } else if (cursor === "page-3") {
    result = {
      data: [{ id: "gpt-5.6-sol", model: "gpt-5.6-sol" }],
      nextCursor: null
    }
  }
  process.respond({
    id: message.id,
    result
  })
}

test("initializes exactly once, sends initialized after the response, correlates IDs, and handles backpressure", async () => {
  const { client, process: connectedProcess } = await connectFake(
    (message, process) => {
      if (message.method === "correlation/one") {
        process.respond({ id: message.id, result: "one" })
      }
      if (message.method === "correlation/two") {
        process.respond({ id: message.id, result: "two" })
      }
    }
  )
  connectedProcess.backpressure = true

  const first = client.request("correlation/one")
  const second = client.request("correlation/two")
  expect(await Promise.all([first, second])).toEqual(["one", "two"])
  expect(connectedProcess.messages.map((message) => message.method)).toEqual([
    "initialize",
    "initialized",
    "correlation/one",
    "correlation/two"
  ])
  expect(connectedProcess.messages[0]).toMatchObject({
    id: 1,
    method: "initialize"
  })
  expect(connectedProcess.messages[1]).not.toHaveProperty("id")
  await expect(client.request("initialize")).rejects.toThrow(
    AppServerProtocolError
  )
  await client.close()
  await client.close()
  expect(client.status).toBe("closed")
})

test("rejects malformed JSON and unknown protocol responses instead of hanging", async () => {
  const malformed = await connectFake()
  const pending = malformed.client.request("waiting")
  malformed.process.pushRaw("{not-json}\n")
  await expect(pending).rejects.toThrow(MALFORMED_JSON_PATTERN)
  await malformed.client.close()

  const unknown = await connectFake()
  const unknownPending = unknown.client.request("waiting")
  unknown.process.respond({ id: 999, result: true })
  await expect(unknownPending).rejects.toThrow(NO_PENDING_REQUEST_PATTERN)
  await unknown.client.close()
})

test("rejects early EOF, process exit, and request timeouts explicitly", async () => {
  const eof = await connectFake(undefined, { requestTimeoutMs: 1000 })
  const eofPending = eof.client.request("waiting")
  eof.process.closeStdout()
  await expect(eofPending).rejects.toThrow(EOF_PATTERN)

  const exited = await connectFake(undefined, { requestTimeoutMs: 1000 })
  const exitPending = exited.client.request("waiting")
  exited.process.exit(17, null)
  await expect(exitPending).rejects.toThrow(EXITED_PATTERN)

  const timeout = await connectFake(undefined, { requestTimeoutMs: 20 })
  await expect(timeout.client.request("never-responds")).rejects.toThrow(
    AppServerTimeoutError
  )
  await eof.client.close()
  await exited.client.close()
  await timeout.client.close()
})

test("paginates model/list and asserts the required model IDs", async () => {
  const { client } = await connectFake(modelListHandler)
  const models = await client.listModels()
  expect(models.map((model) => model.id)).toEqual([
    ...REQUIRED_APP_SERVER_MODELS
  ])
  await expect(client.assertRequiredModels()).resolves.toHaveLength(3)
  await client.close()

  const missing = await connectFake((message, process) => {
    if (message.method !== "model/list") {
      return
    }
    process.respond({
      id: message.id,
      result: {
        data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
        nextCursor: null
      }
    })
  })
  await expect(missing.client.assertRequiredModels()).rejects.toThrow(
    AppServerModelError
  )
  await missing.client.close()
})

function agentHandler(text: string, status = "completed"): Handler {
  return (message, process) => {
    if (message.method === "model/list") {
      process.respond({
        id: message.id,
        result: {
          data: REQUIRED_APP_SERVER_MODELS.map((model) => ({
            id: model,
            model
          })),
          nextCursor: null
        }
      })
      return
    }
    if (message.method === "thread/start") {
      process.respond({
        id: message.id,
        result: {
          model: (message.params as Message).model,
          thread: { id: "thread-1" }
        }
      })
      return
    }
    if (message.method === "turn/start") {
      const params = message.params as Message
      const threadId = params.threadId as string
      process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
      queueMicrotask(() => {
        process.respond({
          method: "item/agentMessage/delta",
          params: {
            delta: "stale delta",
            itemId: "item-1",
            threadId,
            turnId: "turn-1"
          }
        })
        process.respond({
          method: "item/completed",
          params: {
            completedAtMs: 1,
            item: { id: "item-1", text, type: "agentMessage" },
            threadId,
            turnId: "turn-1"
          }
        })
        process.respond({
          method: "turn/completed",
          params: {
            threadId,
            turn: {
              error:
                status === "completed" ? null : { message: "terminal failure" },
              id: "turn-1",
              status
            }
          }
        })
      })
    }
  }
}

test("resolves text only from authoritative completed item state and terminal completion", async () => {
  const { client, process } = await connectFake(
    agentHandler("authoritative final text"),
    { requiredModels: REQUIRED_APP_SERVER_MODELS }
  )
  const call = await client.callAgent("return the final text", {
    agentType: "Explore",
    label: "text-probe",
    model: "gpt-5.6-luna",
    phase: "Probe"
  })
  expect(call.result).toBe("authoritative final text")
  expect(call.evidence).toEqual({
    itemIds: ["item-1"],
    requestedModel: "gpt-5.6-luna",
    resolvedModel: "gpt-5.6-luna",
    terminalStatus: "completed",
    threadId: "thread-1",
    turnId: "turn-1"
  })
  expect(
    process.messages.find((message) => message.method === "thread/start")
      ?.params
  ).toMatchObject({
    approvalPolicy: "never",
    developerInstructions: expect.stringContaining(
      "read-only repository exploration agent"
    ),
    ephemeral: true,
    model: "gpt-5.6-luna",
    sandbox: "read-only"
  })
  expect(
    process.messages.find((message) => message.method === "turn/start")?.params
  ).toMatchObject({
    approvalPolicy: "never",
    model: "gpt-5.6-luna",
    responsesapiClientMetadata: {
      workflow_label: "text-probe",
      workflow_phase: "Probe"
    },
    sandboxPolicy: { networkAccess: false, type: "readOnly" }
  })
  await client.close()
})

test("normalizes early lifecycle and intermediate events with complete run attribution", async () => {
  let timestamp = 1000
  const { client, process: connectedProcess } = await connectFake(
    (message, process) => {
      if (message.method === "model/list") {
        process.respond({
          id: message.id,
          result: {
            data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
            nextCursor: null
          }
        })
        return
      }
      if (message.method === "thread/start") {
        process.respond({
          id: message.id,
          result: { model: "gpt-5.6-luna", thread: { id: "thread-events" } }
        })
        return
      }
      if (message.method !== "turn/start") {
        return
      }
      const params = message.params as Message
      const threadId = params.threadId as string
      process.respond({
        method: "item/started",
        params: {
          item: { id: "item-final", text: "", type: "agentMessage" },
          startedAtMs: 1,
          threadId,
          turnId: "turn-events"
        }
      })
      process.respond({
        method: "item/agentMessage/delta",
        params: {
          delta: "stale intermediate",
          itemId: "item-final",
          threadId,
          turnId: "turn-events"
        }
      })
      process.respond({
        id: message.id,
        result: { turn: { id: "turn-events" } }
      })
      queueMicrotask(() => {
        process.respond({
          method: "item/plan/delta",
          params: {
            delta: "inspect",
            itemId: "plan-1",
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "item/reasoning/summaryTextDelta",
          params: {
            delta: "because",
            itemId: "reason-1",
            summaryIndex: 0,
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "item/commandExecution/outputDelta",
          params: {
            delta: "output",
            itemId: "command-1",
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "item/fileChange/patchUpdated",
          params: {
            changes: [{ path: "src/app.ts" }],
            itemId: "file-1",
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "item/mcpToolCall/progress",
          params: {
            itemId: "tool-1",
            message: "working",
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "item/started",
          params: {
            item: {
              id: "collab-1",
              prompt: null,
              receiverThreadIds: [],
              senderThreadId: threadId,
              status: "inProgress",
              type: "collabAgentToolCall"
            },
            startedAtMs: 2,
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "item/completed",
          params: {
            completedAtMs: 3,
            item: {
              id: "collab-1",
              prompt: null,
              receiverThreadIds: [],
              senderThreadId: threadId,
              status: "completed",
              type: "collabAgentToolCall"
            },
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "thread/tokenUsage/updated",
          params: {
            threadId,
            tokenUsage: {
              last: { totalTokens: 19 },
              modelContextWindow: 1000,
              total: { totalTokens: 19 }
            },
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "warning",
          params: { message: "non-fatal warning", threadId }
        })
        process.respond({
          method: "error",
          params: {
            error: { message: "retryable error" },
            threadId,
            turnId: "turn-events",
            willRetry: true
          }
        })
        process.respond({
          method: "item/completed",
          params: {
            completedAtMs: 4,
            item: {
              id: "item-final",
              phase: null,
              text: "authoritative nonce-final",
              type: "agentMessage"
            },
            threadId,
            turnId: "turn-events"
          }
        })
        process.respond({
          method: "turn/completed",
          params: {
            threadId,
            turn: { error: null, id: "turn-events", status: "completed" }
          }
        })
      })
    },
    { requiredModels: ["gpt-5.6-luna"] }
  )

  const handle = await client.startAgent("stream", {
    agentId: "agent-events",
    eventTimestamp: () => {
      const current = timestamp
      timestamp += 1
      return current
    },
    label: "events-label",
    model: "gpt-5.6-luna",
    phase: "events-phase",
    workflowRunId: "workflow-events"
  })
  const call = await handle.result()
  expect(call.result).toBe("authoritative nonce-final")

  const eventLog = [...handle.eventLog]
  expect(eventLog.map((event) => event.type)).toEqual([
    "lifecycle",
    "lifecycle",
    "lifecycle",
    "message-delta",
    "plan",
    "reasoning",
    "command",
    "file",
    "tool",
    "collaboration",
    "collaboration",
    "usage",
    "warning",
    "error",
    "lifecycle",
    "terminal"
  ])
  expect(eventLog.map((event) => event.sequence)).toEqual(
    eventLog.map((_, index) => index + 1)
  )
  expect(
    eventLog.every(
      (event) =>
        event.workflowRunId === "workflow-events" &&
        event.agentId === "agent-events" &&
        event.label === "events-label" &&
        event.phase === "events-phase" &&
        event.requestedModel === "gpt-5.6-luna" &&
        event.resolvedModel === "gpt-5.6-luna" &&
        event.threadId === "thread-events"
    )
  ).toBe(true)
  expect(
    eventLog.find(
      (event) =>
        event.type === "lifecycle" &&
        event.subject === "turn" &&
        event.lifecycle === "started"
    )
  ).toMatchObject({ turnId: "turn-events" })
  expect(
    eventLog
      .filter((event) =>
        [
          "message-delta",
          "plan",
          "reasoning",
          "command",
          "file",
          "tool",
          "collaboration",
          "terminal"
        ].includes(event.type)
      )
      .every((event) => event.turnId === "turn-events")
  ).toBe(true)
  expect(eventLog.every((event) => event.timestamp >= 1000)).toBe(true)
  expect(
    eventLog.find(
      (event) =>
        event.type === "message-delta" &&
        event.method === "item/agentMessage/delta"
    )?.sequence
  ).toBeLessThan(
    eventLog.find((event) => event.type === "terminal")?.sequence ??
      Number.POSITIVE_INFINITY
  )
  expect(eventLog.find((event) => event.type === "terminal")).toMatchObject({
    status: "completed",
    usage: { total: { totalTokens: 19 } }
  })
  expect(call.evidence).toMatchObject({
    terminalStatus: "completed",
    usage: { total: { totalTokens: 19 } }
  })
  await client.close()
  expect(
    connectedProcess.messages.filter(
      (message) => message.method === "turn/start"
    )
  ).toHaveLength(1)
})

test("runWorkflowScript uses the App Server client when no offline agent stub is supplied", async () => {
  const runDirectory = await mkdtemp(
    join(tmpdir(), "gpt-workflow-app-server-runtime-")
  )
  const { client } = await connectFake(agentHandler("runtime-wired"), {
    requiredModels: ["gpt-5.6-luna"]
  })
  let startedHandle: AppServerAgentHandle | undefined
  try {
    const execution = await runWorkflowScript(
      "export const meta = { name: 'live', description: 'live' }\nreturn await agent('say runtime-wired', { model: 'gpt-5.6-luna' })",
      {
        appServer: client,
        eventTimestamp: (() => {
          let timestamp = 1
          return () => {
            const current = timestamp
            timestamp += 1
            return current
          }
        })(),
        onAgentStart: (handle) => {
          startedHandle = handle
        },
        runDirectory,
        workflowRunId: "workflow-runtime"
      }
    )
    expect(execution.result).toBe("runtime-wired")
    expect(execution.workflowRunId).toBe("workflow-runtime")
    expect(execution.agentEvents.length).toBeGreaterThan(0)
    expect(
      execution.agentEvents.every(
        (event) =>
          event.workflowRunId === "workflow-runtime" &&
          event.agentId === "workflow-runtime:agent-1"
      )
    ).toBe(true)
    expect(startedHandle).toMatchObject({
      agentId: "workflow-runtime:agent-1",
      workflowRunId: "workflow-runtime"
    })
    expect(client.lastAgentCallEvidence).toMatchObject({
      requestedModel: "gpt-5.6-luna",
      threadId: "thread-1",
      turnId: "turn-1"
    })
  } finally {
    await client.close()
    await rm(runDirectory, { force: true, recursive: true })
  }
})

test("throwing progress observers do not fail the App Server transport or active turn", async () => {
  const { client } = await connectFake(agentHandler("observer-safe"), {
    requiredModels: ["gpt-5.6-luna"]
  })
  client.subscribeEvents(() => {
    throw new Error("global observer failure")
  })
  await expect(
    client.callAgent("complete", {
      eventSink: () => {
        throw new Error("agent observer failure")
      },
      model: "gpt-5.6-luna"
    })
  ).resolves.toMatchObject({ result: "observer-safe" })
  expect(client.status).toBe("ready")
  await client.close()
})

test("steers the exact active turn and rejects steering after authoritative terminal completion", async () => {
  const steerMessages: Message[] = []
  const { client, process: connectedProcess } = await connectFake(
    (message, process) => {
      if (message.method === "model/list") {
        process.respond({
          id: message.id,
          result: {
            data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
            nextCursor: null
          }
        })
      } else if (message.method === "thread/start") {
        process.respond({
          id: message.id,
          result: { model: "gpt-5.6-luna", thread: { id: "thread-steer" } }
        })
      } else if (message.method === "turn/start") {
        const params = message.params as Message
        const threadId = params.threadId as string
        process.respond({
          id: message.id,
          result: { turn: { id: "turn-steer" } }
        })
        queueMicrotask(() =>
          process.respond({
            method: "item/agentMessage/delta",
            params: {
              delta: "waiting for verifier",
              itemId: "item-steer",
              threadId,
              turnId: "turn-steer"
            }
          })
        )
      } else if (message.method === "turn/steer") {
        steerMessages.push(message)
        const params = message.params as Message
        expect(params).toMatchObject({
          expectedTurnId: "turn-steer",
          input: [{ text: "verifier-nonce", text_elements: [], type: "text" }],
          threadId: "thread-steer"
        })
        process.respond({ id: message.id, result: { turnId: "turn-steer" } })
        queueMicrotask(() => {
          process.respond({
            method: "item/agentMessage/delta",
            params: {
              delta: "verifier-nonce received",
              itemId: "item-steer",
              threadId: "thread-steer",
              turnId: "turn-steer"
            }
          })
          process.respond({
            method: "item/completed",
            params: {
              item: {
                id: "item-steer",
                text: "final verifier-nonce",
                type: "agentMessage"
              },
              threadId: "thread-steer",
              turnId: "turn-steer"
            }
          })
          process.respond({
            method: "turn/completed",
            params: {
              threadId: "thread-steer",
              turn: { error: null, id: "turn-steer", status: "completed" }
            }
          })
        })
      }
    },
    { requiredModels: ["gpt-5.6-luna"] }
  )

  const handle = await client.startAgent("wait", {
    agentId: "agent-steer",
    model: "gpt-5.6-luna",
    workflowRunId: "workflow-steer"
  })
  await expect(handle.steer("wrong-turn", "stale-turn")).rejects.toThrow(
    EXPECTED_ACTIVE_TURN_PATTERN
  )
  const accepted = await handle.steer("verifier-nonce", "turn-steer")
  expect(accepted).toEqual({ turnId: "turn-steer" })
  const result = await handle.result()
  expect(result.result).toBe("final verifier-nonce")
  expect(steerMessages).toHaveLength(1)
  await expect(handle.steer("too late")).rejects.toThrow(
    NO_LONGER_ALLOWED_PATTERN
  )
  expect(
    connectedProcess.messages.filter(
      (message) => message.method === "turn/steer"
    )
  ).toHaveLength(1)
  await client.close()
})

test("interrupts one sibling turn without cancelling the other", async () => {
  let threadCount = 0
  const { client, process: connectedProcess } = await connectFake(
    (message, process) => {
      if (message.method === "model/list") {
        process.respond({
          id: message.id,
          result: {
            data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
            nextCursor: null
          }
        })
        return
      }
      if (message.method === "thread/start") {
        threadCount += 1
        process.respond({
          id: message.id,
          result: {
            model: "gpt-5.6-luna",
            thread: { id: `thread-sibling-${threadCount}` }
          }
        })
        return
      }
      if (message.method === "turn/start") {
        const params = message.params as Message
        const threadId = params.threadId as string
        const turnId = `${threadId}-turn`
        process.respond({ id: message.id, result: { turn: { id: turnId } } })
        if (threadId === "thread-sibling-2") {
          queueMicrotask(() => {
            process.respond({
              method: "item/completed",
              params: {
                item: {
                  id: `${threadId}-item`,
                  text: "sibling-two-complete",
                  type: "agentMessage"
                },
                threadId,
                turnId
              }
            })
            process.respond({
              method: "turn/completed",
              params: {
                threadId,
                turn: { error: null, id: turnId, status: "completed" }
              }
            })
          })
        }
        return
      }
      if (message.method === "turn/interrupt") {
        const params = message.params as Message
        expect(params).toEqual({
          threadId: "thread-sibling-1",
          turnId: "thread-sibling-1-turn"
        })
        process.respond({ id: message.id, result: {} })
        queueMicrotask(() =>
          process.respond({
            method: "turn/completed",
            params: {
              threadId: "thread-sibling-1",
              turn: {
                error: { message: "requested by verifier" },
                id: "thread-sibling-1-turn",
                status: "interrupted"
              }
            }
          })
        )
      }
    },
    { requiredModels: ["gpt-5.6-luna"] }
  )

  const [first, second] = await Promise.all([
    client.startAgent("sibling one", {
      agentId: "agent-one",
      model: "gpt-5.6-luna",
      workflowRunId: "workflow-siblings"
    }),
    client.startAgent("sibling two", {
      agentId: "agent-two",
      model: "gpt-5.6-luna",
      workflowRunId: "workflow-siblings"
    })
  ])
  await first.interrupt()
  await expect(first.result()).rejects.toThrow(INTERRUPTED_PATTERN)
  await expect(first.interrupt()).resolves.toBeUndefined()
  await expect(first.steer("after interrupt")).rejects.toThrow(
    NO_LONGER_ALLOWED_PATTERN
  )
  await expect(second.result()).resolves.toMatchObject({
    evidence: { threadId: "thread-sibling-2" },
    result: "sibling-two-complete"
  })
  expect(
    connectedProcess.messages.filter(
      (message) => message.method === "turn/interrupt"
    )
  ).toHaveLength(1)
  await client.close()
})

test("parses and validates nested structured output, including enums, integers, and item limits", async () => {
  const schema = {
    properties: {
      age: { maximum: 99, minimum: 1, type: "integer" },
      name: { type: "string" },
      nested: {
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
        type: "object"
      },
      tags: {
        items: { type: "string" },
        maxItems: 2,
        minItems: 1,
        type: "array"
      },
      tier: { enum: ["free", "pro"], type: "string" }
    },
    required: ["name", "age", "tier", "tags", "nested"],
    type: "object"
  }
  const { client, process } = await connectFake(
    agentHandler(
      JSON.stringify({
        age: 37,
        name: "Ada",
        nested: { enabled: true },
        tags: ["math"],
        tier: "pro"
      })
    ),
    { requiredModels: REQUIRED_APP_SERVER_MODELS }
  )
  const result = await client.agent("return structured data", {
    model: "gpt-5.6-terra",
    schema
  })
  expect(result).toEqual({
    age: 37,
    name: "Ada",
    nested: { enabled: true },
    tags: ["math"],
    tier: "pro"
  })
  expect(
    process.messages.find((message) => message.method === "turn/start")?.params
  ).toMatchObject({
    outputSchema: {
      additionalProperties: false,
      properties: {
        nested: { additionalProperties: false }
      }
    }
  })
  await client.close()
})

test("rejects malformed JSON and schema-invalid authoritative results", async () => {
  const schema = {
    properties: { count: { minimum: 2, type: "integer" } },
    required: ["count"],
    type: "object"
  }
  const invalidJson = await connectFake(agentHandler("not-json"), {
    requiredModels: REQUIRED_APP_SERVER_MODELS
  })
  await expect(
    invalidJson.client.agent("bad JSON", { model: "gpt-5.6-terra", schema })
  ).rejects.toThrow(AppServerResultError)
  await invalidJson.client.close()

  const invalidSchema = await connectFake(
    agentHandler(JSON.stringify({ count: 1 })),
    { requiredModels: REQUIRED_APP_SERVER_MODELS }
  )
  await expect(
    invalidSchema.client.agent("bad schema", { model: "gpt-5.6-terra", schema })
  ).rejects.toThrow(SCHEMA_VALIDATION_PATTERN)
  await invalidSchema.client.close()
})

test("never reports failed or interrupted turns as successful agent results", async () => {
  const failed = await connectFake(agentHandler("ignored", "failed"), {
    requiredModels: REQUIRED_APP_SERVER_MODELS
  })
  await expect(
    failed.client.agent("fail", { model: "gpt-5.6-luna" })
  ).rejects.toThrow(AppServerTurnError)
  await failed.client.close()

  const interrupted = await connectFake(
    agentHandler("ignored", "interrupted"),
    { requiredModels: REQUIRED_APP_SERVER_MODELS }
  )
  await expect(
    interrupted.client.agent("interrupt", { model: "gpt-5.6-luna" })
  ).rejects.toThrow(INTERRUPTED_PATTERN)
  await interrupted.client.close()
})

test("turn completion without an authoritative completed agent item fails", async () => {
  const { client } = await connectFake(
    (message, process) => {
      if (message.method === "model/list") {
        process.respond({
          id: message.id,
          result: {
            data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
            nextCursor: null
          }
        })
      } else if (message.method === "thread/start") {
        process.respond({
          id: message.id,
          result: { model: "gpt-5.6-luna", thread: { id: "thread-1" } }
        })
      } else if (message.method === "turn/start") {
        process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
        queueMicrotask(() =>
          process.respond({
            method: "turn/completed",
            params: {
              threadId: "thread-1",
              turn: { error: null, id: "turn-1", status: "completed" }
            }
          })
        )
      }
    },
    { requiredModels: ["gpt-5.6-luna"] }
  )
  await expect(
    client.agent("no item", { model: "gpt-5.6-luna" })
  ).rejects.toThrow(MISSING_AGENT_MESSAGE_PATTERN)
  await client.close()
})

test("an active turn rejects immediately when the process reaches EOF and has an explicit turn timeout", async () => {
  const noCompletion = await connectFake(
    (message, process) => {
      if (message.method === "model/list") {
        process.respond({
          id: message.id,
          result: {
            data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
            nextCursor: null
          }
        })
      } else if (message.method === "thread/start") {
        process.respond({
          id: message.id,
          result: { model: "gpt-5.6-luna", thread: { id: "thread-1" } }
        })
      } else if (message.method === "turn/start") {
        process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
        queueMicrotask(() => process.closeStdout())
      }
    },
    { requiredModels: ["gpt-5.6-luna"], turnTimeoutMs: 1000 }
  )
  await expect(
    noCompletion.client.agent("EOF", { model: "gpt-5.6-luna" })
  ).rejects.toThrow(EOF_PATTERN)
  await noCompletion.client.close()

  const timeout = await connectFake(
    (message, process) => {
      if (message.method === "model/list") {
        process.respond({
          id: message.id,
          result: {
            data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna" }],
            nextCursor: null
          }
        })
      } else if (message.method === "thread/start") {
        process.respond({
          id: message.id,
          result: { model: "gpt-5.6-luna", thread: { id: "thread-1" } }
        })
      } else if (message.method === "turn/start") {
        process.respond({ id: message.id, result: { turn: { id: "turn-1" } } })
      }
    },
    { requiredModels: ["gpt-5.6-luna"], turnTimeoutMs: 20 }
  )
  await expect(
    timeout.client.agent("timeout", { model: "gpt-5.6-luna" })
  ).rejects.toThrow(AppServerTimeoutError)
  await timeout.client.close()
})

test("App Server process errors are surfaced through the client boundary", async () => {
  const holder: { process?: FakeProcess } = {}
  const clientPromise = AppServerClient.connect({
    requestTimeoutMs: 1000,
    spawn: makeSpawner(initializeHandler(), holder)
  })
  const client = await clientPromise
  const pending = client.request("waiting")
  holder.process?.exit(null, "SIGKILL")
  await expect(pending).rejects.toThrow(AppServerProcessError)
  expect(client.status).toBe("failed")
})
