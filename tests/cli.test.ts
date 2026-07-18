import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCLI } from "../src/cli.js"
import type {
  WorkflowExecution,
  WorkflowExecutionOptions
} from "../src/runtime.js"

const WORKFLOW_SOURCE = `export const meta = {
  name: "source-workflow",
  description: "Source workflow description"
}
return { ok: true }
`
const directories: string[] = []

type RecordLine = {
  [key: string]: unknown
  runId: string
  schemaVersion: number
  sequence: number
  ts: number
  type: string
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("run", () => {
  test("streams timestamped NDJSON and tees only status reconstruction events in order", async () => {
    const cwd = await makeTemporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    let closed = 0
    let receivedOptions: WorkflowExecutionOptions | undefined
    const exitCode = await runCLI(
      ["run", "--default-model", "requested-default", "workflow.js"],
      {
        connect: (options) => {
          expect(options).toEqual({
            defaultModel: "requested-default",
            turnTimeoutMs: 120_000
          })
          return Promise.resolve({
            close: () => {
              closed += 1
              return Promise.resolve()
            },
            startAgent: () => Promise.resolve(undefined as never)
          })
        },
        cwd: () => cwd,
        makeRunId: () => "workflow-test",
        readSource: () => Promise.resolve(WORKFLOW_SOURCE),
        runWorkflow: async (_source, options) => {
          receivedOptions = options
          await options.appServer?.startAgent("connect-probe")
          options.onWorkflowEvent?.({
            depth: 0,
            event: { detail: null, title: "Build", type: "phase" },
            fileName: join(cwd, "workflow.js")
          })
          for (const event of agentEvents()) {
            options.onAgentEvent?.(event as never)
          }
          return execution(options.runDirectory ?? cwd)
        },
        writeError: (text) => errors.push(text),
        writeOutput: (text) => output.push(text)
      }
    )

    const records = parseOutput(output)
    expect(exitCode).toBe(0)
    expect(errors).toEqual([])
    expect(closed).toBe(1)
    expect(records.map(({ sequence }) => sequence)).toEqual(
      records.map((_, index) => index)
    )
    expect(records.every(({ ts }) => Number.isFinite(ts))).toBe(true)
    expect(records[0]).toMatchObject({
      meta: {
        description: "Source workflow description",
        name: "source-workflow"
      },
      type: "run.started"
    })
    expect(receivedOptions).toMatchObject({
      cwd,
      fileName: join(cwd, "workflow.js"),
      runDirectory: runDirectory(cwd, "workflow-test"),
      workflowRunId: "workflow-test"
    })

    const persistedLines = (
      await readFile(
        join(runDirectory(cwd, "workflow-test"), "events.jsonl"),
        "utf8"
      )
    )
      .trim()
      .split("\n")
    const stdoutLines = output.map((line) => line.trim())
    const persistedTypes = persistedLines.map(
      (line) => (JSON.parse(line) as RecordLine).type
    )
    expect(persistedTypes).toEqual([
      "run.started",
      "workflow.event",
      "agent.event",
      "agent.event",
      "agent.event",
      "agent.event",
      "agent.event",
      "agent.event",
      "run.completed"
    ])
    expect(
      persistedLines.map((line) => {
        const record = JSON.parse(line) as {
          event?: { type?: string }
          type: string
        }
        return record.type === "agent.event" ? record.event?.type : record.type
      })
    ).toEqual([
      "run.started",
      "workflow.event",
      "lifecycle",
      "collaboration",
      "usage",
      "warning",
      "error",
      "terminal",
      "run.completed"
    ])
    expect(persistedLines).toEqual(
      stdoutLines.filter((line) => persistedLines.includes(line))
    )
    expect(records.map(({ type }) => type)).toEqual([
      "run.started",
      "workflow.event",
      ...Array.from({ length: 12 }, () => "agent.event"),
      "run.completed"
    ])
  })

  test("rejects invalid JSON args before the run stream starts", async () => {
    const cwd = await makeTemporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const exitCode = await runCLI(["run", "--args", "{nope", "workflow.js"], {
      cwd: () => cwd,
      makeRunId: () => {
        throw new Error("invalid args must not mint a run ID")
      },
      readSource: () => Promise.reject(new Error("must not read")),
      runWorkflow: () => Promise.reject(new Error("must not run")),
      writeError: (text) => errors.push(text),
      writeOutput: (text) => output.push(text)
    })

    expect(exitCode).toBe(1)
    expect(output).toEqual([])
    expect(errors.join("")).toContain("--args must be valid JSON")
    expect(errors.join("")).toContain("Usage:")
  })

  test("passes an explicit turn timeout to the App Server client", async () => {
    const cwd = await makeTemporaryDirectory()
    const exitCode = await runCLI(
      ["run", "--turn-timeout-ms", "1800000", "workflow.js"],
      {
        connect: (options) => {
          expect(options).toEqual({
            defaultModel: undefined,
            turnTimeoutMs: 1_800_000
          })
          return Promise.resolve({
            close: () => Promise.resolve(),
            startAgent: () => Promise.resolve(undefined as never)
          })
        },
        cwd: () => cwd,
        readSource: () => Promise.resolve(WORKFLOW_SOURCE),
        runWorkflow: async (_source, options) => {
          await options.appServer?.startAgent("connect-probe")
          return execution(options.runDirectory ?? cwd)
        },
        writeError: () => undefined,
        writeOutput: () => undefined
      }
    )

    expect(exitCode).toBe(0)
  })

  test("passes JSON values verbatim and composes args with resume", async () => {
    const cwd = await makeTemporaryDirectory()
    const received: WorkflowExecutionOptions[] = []
    let minted = 0
    const dependencies = {
      cwd: () => cwd,
      makeRunId: () => {
        const runId = `new-${minted}`
        minted += 1
        return runId
      },
      readSource: () => Promise.resolve(WORKFLOW_SOURCE),
      runWorkflow: (_source: string, options: WorkflowExecutionOptions) => {
        received.push(options)
        return Promise.resolve(execution(options.runDirectory ?? cwd))
      },
      writeError: () => undefined,
      writeOutput: () => undefined
    }

    expect(
      await runCLI(
        ["run", "--args", '{"topic":"tea","count":2}', "workflow.js"],
        dependencies
      )
    ).toBe(0)
    expect(
      await runCLI(["run", "--args", '"text"', "workflow.js"], dependencies)
    ).toBe(0)
    expect(
      await runCLI(
        [
          "run",
          "--resume",
          "existing-run",
          "--args",
          '{"resume":true}',
          "workflow.js"
        ],
        dependencies
      )
    ).toBe(0)

    expect(received[0]?.args).toEqual({ count: 2, topic: "tea" })
    expect(received[1]?.args).toBe("text")
    expect(received[2]).toMatchObject({
      args: { resume: true },
      resumeFromRunId: "existing-run",
      runDirectory: runDirectory(cwd, "existing-run")
    })
    expect(received[2]?.workflowRunId).toBeUndefined()
  })

  test("persists a parse failure before the runtime opens its journal", async () => {
    const cwd = await makeTemporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const exitCode = await runCLI(["run", "broken.js"], {
      cwd: () => cwd,
      makeRunId: () => "parse-failed",
      readSource: () => Promise.resolve("return 1"),
      runWorkflow: () => Promise.reject(new Error("must not run")),
      writeError: (text) => errors.push(text),
      writeOutput: (text) => output.push(text)
    })

    expect(exitCode).toBe(1)
    expect(parseOutput(output).map(({ type }) => type)).toEqual(["run.failed"])
    expect(errors.join("")).toContain("broken.js: expected export")
    const eventsPath = join(runDirectory(cwd, "parse-failed"), "events.jsonl")
    expect((await stat(eventsPath)).isFile()).toBe(true)
    expect(output).toHaveLength(1)
    expect((await readFile(eventsPath, "utf8")).trim()).toBe(
      (output[0] ?? "").trim()
    )
  })

  test("emits and persists a terminal runtime failure", async () => {
    const cwd = await makeTemporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const exitCode = await runCLI(["run", "broken.js"], {
      cwd: () => cwd,
      makeRunId: () => "runtime-failed",
      readSource: () => Promise.resolve(WORKFLOW_SOURCE),
      runWorkflow: () => Promise.reject(new Error("workflow exploded")),
      writeError: (text) => errors.push(text),
      writeOutput: (text) => output.push(text)
    })

    expect(exitCode).toBe(1)
    expect(parseOutput(output).map(({ type }) => type)).toEqual([
      "run.started",
      "run.failed"
    ])
    expect(errors.join("")).toBe("gpt-workflow: workflow exploded\n")
    expect(
      (
        await readFile(
          join(runDirectory(cwd, "runtime-failed"), "events.jsonl"),
          "utf8"
        )
      )
        .trim()
        .split("\n")
    ).toHaveLength(2)
  })

  test("a close failure after success still completes the run", async () => {
    const cwd = await makeTemporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const exitCode = await runCLI(["run", "workflow.js"], {
      connect: () =>
        Promise.resolve({
          close: () => Promise.reject(new Error("close exploded")),
          startAgent: () => Promise.resolve(undefined as never)
        }),
      cwd: () => cwd,
      makeRunId: () => "close-failed",
      readSource: () => Promise.resolve(WORKFLOW_SOURCE),
      runWorkflow: async (_source, options) => {
        await options.appServer?.startAgent("connect-probe")
        return execution(options.runDirectory ?? cwd)
      },
      writeError: (text) => errors.push(text),
      writeOutput: (text) => output.push(text)
    })

    expect(exitCode).toBe(0)
    expect(parseOutput(output).map(({ type }) => type)).toEqual([
      "run.started",
      "run.completed"
    ])
    expect(errors.join("")).toBe(
      "gpt-workflow: App Server close failed after run completion: close exploded\n"
    )
  })
})

describe("inspection subcommands", () => {
  test("list and status read persisted run events through the CLI", async () => {
    const cwd = await makeTemporaryDirectory()
    expect(
      await runCLI(["run", "workflow.js"], {
        cwd: () => cwd,
        makeRunId: () => "inspectable",
        readSource: () => Promise.resolve(WORKFLOW_SOURCE),
        runWorkflow: (_source, options) =>
          Promise.resolve(execution(options.runDirectory ?? cwd)),
        writeError: () => undefined,
        writeOutput: () => undefined
      })
    ).toBe(0)

    const listOutput: string[] = []
    expect(
      await runCLI(["list"], {
        cwd: () => cwd,
        writeError: () => undefined,
        writeOutput: (text) => listOutput.push(text)
      })
    ).toBe(0)
    expect(listOutput).toHaveLength(1)
    expect(JSON.parse(listOutput[0] ?? "")).toMatchObject({
      name: "source-workflow",
      runId: "inspectable",
      status: "completed"
    })

    const statusOutput: string[] = []
    expect(
      await runCLI(["status", "inspectable"], {
        cwd: () => cwd,
        writeError: () => undefined,
        writeOutput: (text) => statusOutput.push(text)
      })
    ).toBe(0)
    expect(statusOutput).toHaveLength(1)
    expect(JSON.parse(statusOutput[0] ?? "")).toMatchObject({
      agents: [],
      phases: [],
      result: { answer: 42 },
      runId: "inspectable",
      status: "completed"
    })
  })

  test("list is empty without a runs directory and status rejects unknown runs", async () => {
    const cwd = await makeTemporaryDirectory()
    const listOutput: string[] = []
    expect(
      await runCLI(["list"], {
        cwd: () => cwd,
        writeError: () => undefined,
        writeOutput: (text) => listOutput.push(text)
      })
    ).toBe(0)
    expect(listOutput).toEqual([])

    const errors: string[] = []
    expect(
      await runCLI(["status", "unknown"], {
        cwd: () => cwd,
        writeError: (text) => errors.push(text),
        writeOutput: () => undefined
      })
    ).toBe(1)
    expect(errors.join("")).toBe("gpt-workflow: run not found: unknown\n")
  })
})

describe("usage validation", () => {
  test("documents all commands and keeps invalid invocations off stdout", async () => {
    const output: string[] = []
    expect(
      await runCLI(["--help"], {
        writeError: () => undefined,
        writeOutput: (text) => output.push(text)
      })
    ).toBe(0)
    expect(output.join("")).toContain("gpt-workflow run")
    expect(output.join("")).toContain("gpt-workflow list")
    expect(output.join("")).toContain("gpt-workflow status <runId>")
    expect(output.join("")).toContain("--args <json>")
    expect(output.join("")).toContain("--turn-timeout-ms <ms>")

    const invalidOutput: string[] = []
    const errors: string[] = []
    expect(
      await runCLI(["run", "--resume", "../escaped", "workflow.js"], {
        writeError: (text) => errors.push(text),
        writeOutput: (text) => invalidOutput.push(text)
      })
    ).toBe(1)
    expect(invalidOutput).toEqual([])
    expect(errors.join("")).toContain("--resume must contain only")
    expect(errors.join("")).toContain("Usage:")
  })

  test.each([
    "0",
    "-1",
    "1.5",
    "Infinity",
    "NaN"
  ])("rejects invalid turn timeout %s before starting a run", async (turnTimeout) => {
    const output: string[] = []
    const errors: string[] = []
    const args =
      turnTimeout === "-1"
        ? ["run", "--turn-timeout-ms=-1", "workflow.js"]
        : ["run", "--turn-timeout-ms", turnTimeout, "workflow.js"]
    expect(
      await runCLI(args, {
        connect: () => Promise.reject(new Error("must not connect")),
        makeRunId: () => {
          throw new Error("invalid timeout must not mint a run ID")
        },
        writeError: (text) => errors.push(text),
        writeOutput: (text) => output.push(text)
      })
    ).toBe(1)
    expect(output).toEqual([])
    expect(errors.join("")).toContain(
      "--turn-timeout-ms must be a finite positive integer"
    )
    expect(errors.join("")).toContain("Usage:")
  })
})

function execution(runDirectoryPath: string): WorkflowExecution {
  return {
    agentEvents: [],
    events: [],
    failures: [],
    journalPath: join(runDirectoryPath, "journal.jsonl"),
    meta: { description: "CLI test", name: "cli-test" },
    result: { answer: 42 },
    usage: {
      agentCount: 0,
      liveAgentCount: 0,
      modelUsage: {},
      peakConcurrentAgents: 0,
      replayedAgentCount: 0,
      subagentTokens: 0
    },
    workflowRunId: "workflow-test"
  }
}

function agentEvents(): Record<string, unknown>[] {
  const base = {
    agentId: "agent-1",
    itemId: null,
    label: "worker",
    method: "test/event",
    phase: "Build",
    requestedModel: "requested-model",
    resolvedModel: "resolved-model",
    sequence: 1,
    threadId: "thread-1",
    timestamp: 1,
    turnId: "turn-1",
    workflowRunId: "workflow-test"
  }
  return [
    {
      ...base,
      item: null,
      itemType: null,
      lifecycle: "started",
      status: "started",
      subject: "thread",
      type: "lifecycle"
    },
    { ...base, delta: "discard", type: "message-delta" },
    { ...base, delta: "discard", explanation: null, plan: null, type: "plan" },
    {
      ...base,
      delta: "discard",
      index: 0,
      reasoningKind: "text",
      type: "reasoning"
    },
    {
      ...base,
      capReached: false,
      commandKind: "output-delta",
      data: null,
      delta: "discard",
      processId: "1",
      stream: "stdout",
      type: "command"
    },
    {
      ...base,
      changes: null,
      delta: "discard",
      fileKind: "output-delta",
      type: "file"
    },
    {
      ...base,
      data: null,
      message: "discard",
      toolKind: "mcp-progress",
      type: "tool"
    },
    { ...base, item: null, lifecycle: "started", type: "collaboration" },
    { ...base, type: "usage", usage: { total: { totalTokens: 9 } } },
    { ...base, message: "careful", type: "warning" },
    { ...base, message: "retrying", type: "error", willRetry: true },
    {
      ...base,
      error: null,
      lifecycle: "completed",
      status: "completed",
      type: "terminal",
      usage: { total: { totalTokens: 9 } }
    }
  ]
}

function parseOutput(output: string[]): RecordLine[] {
  return output.flatMap((chunk) =>
    chunk
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordLine)
  )
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-cli-"))
  directories.push(directory)
  return directory
}

function runDirectory(cwd: string, runId: string): string {
  return join(cwd, ".codex", "workflows", "runs", runId)
}
