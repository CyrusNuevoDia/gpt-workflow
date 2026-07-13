import { expect, test } from "bun:test"
import { runCLI } from "../src/cli.js"
import type {
  WorkflowExecution,
  WorkflowExecutionOptions
} from "../src/runtime.js"

type RecordLine = {
  [key: string]: unknown
  runId: string
  schemaVersion: number
  sequence: number
  type: string
}

function execution(): WorkflowExecution {
  return {
    agentEvents: [],
    events: [],
    failures: [],
    journalPath: "/repo/.codex/workflows/runs/workflow-test/journal.jsonl",
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

test("run streams ordered self-contained NDJSON and closes the App Server", async () => {
  const output: string[] = []
  const errors: string[] = []
  let closed = 0
  let receivedOptions: WorkflowExecutionOptions | undefined

  const exitCode = await runCLI(["run", "workflow.js"], {
    connect: (options) => {
      expect(options).toEqual({ defaultModel: undefined })
      return Promise.resolve({
        close: () => {
          closed += 1
          return Promise.resolve()
        },
        startAgent: () => Promise.resolve(undefined as never)
      })
    },
    cwd: () => "/repo",
    makeRunId: () => "workflow-test",
    readSource: (path) => {
      expect(path).toBe("/repo/workflow.js")
      return Promise.resolve("workflow source")
    },
    runWorkflow: async (_source, options) => {
      receivedOptions = options
      await options.appServer?.startAgent("connect-probe")
      options.onWorkflowEvent?.({
        depth: 0,
        event: { detail: null, title: "Build", type: "phase" },
        fileName: "/repo/workflow.js"
      })
      options.onAgentEvent?.({
        agentId: "agent-1",
        error: null,
        itemId: null,
        label: "worker",
        lifecycle: "completed",
        method: "turn/completed",
        phase: "Build",
        requestedModel: "gpt-5.6-luna",
        resolvedModel: "gpt-5.6-luna",
        sequence: 1,
        status: "completed",
        threadId: "thread-1",
        timestamp: 1,
        turnId: "turn-1",
        type: "terminal",
        usage: null,
        workflowRunId: "workflow-test"
      })
      return execution()
    },
    writeError: (text) => errors.push(text),
    writeOutput: (text) => output.push(text)
  })

  const records = output.flatMap((chunk) =>
    chunk
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordLine)
  )
  expect(exitCode).toBe(0)
  expect(errors).toEqual([])
  expect(closed).toBe(1)
  expect(records.map((record) => record.type)).toEqual([
    "run.started",
    "workflow.event",
    "agent.event",
    "run.completed"
  ])
  expect(records.map((record) => record.sequence)).toEqual([0, 1, 2, 3])
  expect(
    records.every(
      (record) => record.runId === "workflow-test" && record.schemaVersion === 1
    )
  ).toBe(true)
  expect(records.at(-1)).toMatchObject({
    journalPath: "/repo/.codex/workflows/runs/workflow-test/journal.jsonl",
    result: { answer: 42 },
    type: "run.completed"
  })
  expect(receivedOptions).toMatchObject({
    cwd: "/repo",
    fileName: "/repo/workflow.js",
    runDirectory: "/repo/.codex/workflows/runs/workflow-test",
    workflowRunId: "workflow-test"
  })
})

test("resume reuses the requested run ID and run directory", async () => {
  const output: string[] = []
  let receivedOptions: WorkflowExecutionOptions | undefined

  const exitCode = await runCLI(
    ["run", "--resume", "workflow-existing", "workflow.js"],
    {
      connect: () =>
        Promise.resolve({
          close: () => Promise.resolve(),
          startAgent: () => Promise.resolve(undefined as never)
        }),
      cwd: () => "/repo",
      makeRunId: () => {
        throw new Error("resume must not mint a run ID")
      },
      readSource: () => Promise.resolve("workflow source"),
      runWorkflow: (_source, options) => {
        receivedOptions = options
        return Promise.resolve({
          ...execution(),
          journalPath:
            "/repo/.codex/workflows/runs/workflow-existing/journal.jsonl",
          workflowRunId: "workflow-existing"
        })
      },
      writeError: () => undefined,
      writeOutput: (text) => output.push(text)
    }
  )

  expect(exitCode).toBe(0)
  expect(receivedOptions).toMatchObject({
    resumeFromRunId: "workflow-existing",
    runDirectory: "/repo/.codex/workflows/runs/workflow-existing"
  })
  expect(receivedOptions?.workflowRunId).toBeUndefined()
  expect(output.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      resumeFromRunId: "workflow-existing",
      runDirectory: "/repo/.codex/workflows/runs/workflow-existing",
      runId: "workflow-existing",
      type: "run.started"
    }),
    expect.objectContaining({
      journalPath:
        "/repo/.codex/workflows/runs/workflow-existing/journal.jsonl",
      runDirectory: "/repo/.codex/workflows/runs/workflow-existing",
      runId: "workflow-existing",
      type: "run.completed"
    })
  ])
})

test("run emits a terminal NDJSON failure and human stderr", async () => {
  const output: string[] = []
  const errors: string[] = []
  let closed = 0
  const exitCode = await runCLI(["run", "broken.js"], {
    connect: () =>
      Promise.resolve({
        close: () => {
          closed += 1
          return Promise.resolve()
        },
        startAgent: () => Promise.resolve(undefined as never)
      }),
    cwd: () => "/repo",
    makeRunId: () => "workflow-failed",
    readSource: () => Promise.resolve("broken source"),
    runWorkflow: () => Promise.reject(new Error("workflow exploded")),
    writeError: (text) => errors.push(text),
    writeOutput: (text) => output.push(text)
  })

  const records = output.map((line) => JSON.parse(line) as RecordLine)
  expect(exitCode).toBe(1)
  expect(closed).toBe(0)
  expect(records.map((record) => record.type)).toEqual([
    "run.started",
    "run.failed"
  ])
  expect(records[1]).toMatchObject({
    error: { message: "workflow exploded", name: "Error" },
    sequence: 1
  })
  expect(errors.join("")).toBe("gpt-workflow: workflow exploded\n")
})

test("help and invalid invocations stay outside the run stream", async () => {
  const helpOutput: string[] = []
  const helpCode = await runCLI(["--help"], {
    connect: () => Promise.reject(new Error("must not connect")),
    cwd: () => "/repo",
    makeRunId: () => "unused",
    readSource: () => Promise.resolve(""),
    runWorkflow: () => Promise.resolve(execution()),
    writeError: () => undefined,
    writeOutput: (text) => helpOutput.push(text)
  })
  expect(helpCode).toBe(0)
  expect(helpOutput.join("")).toContain(
    "gpt-workflow run [--default-model <name>] [--resume <runId>] <script.js>"
  )

  const errors: string[] = []
  const invalidCode = await runCLI(["run"], {
    connect: () => Promise.reject(new Error("must not connect")),
    cwd: () => "/repo",
    makeRunId: () => "unused",
    readSource: () => Promise.resolve(""),
    runWorkflow: () => Promise.resolve(execution()),
    writeError: (text) => errors.push(text),
    writeOutput: () => undefined
  })
  expect(invalidCode).toBe(1)
  expect(errors.join("")).toContain(
    "expected exactly: gpt-workflow run [--default-model <name>] [--resume <runId>] <script.js>"
  )
})

test("default model is passed to the App Server connection", async () => {
  let connectOptions: { defaultModel?: string } | undefined
  const exitCode = await runCLI(
    ["run", "--default-model", "gpt-5.6-luna", "workflow.js"],
    {
      connect: (options) => {
        connectOptions = options
        return Promise.resolve({
          close: () => Promise.resolve(),
          startAgent: () => Promise.resolve(undefined as never)
        })
      },
      cwd: () => "/repo",
      makeRunId: () => "workflow-test",
      readSource: () => Promise.resolve("workflow source"),
      runWorkflow: async (_source, options) => {
        await options.appServer?.startAgent("connect-probe")
        return execution()
      },
      writeError: () => undefined,
      writeOutput: () => undefined
    }
  )

  expect(exitCode).toBe(0)
  expect(connectOptions).toEqual({ defaultModel: "gpt-5.6-luna" })
})

test("invalid resume IDs fail before the run stream starts", async () => {
  const output: string[] = []
  const errors: string[] = []
  const exitCode = await runCLI(
    ["run", "--resume", "../escaped", "workflow.js"],
    {
      connect: () => Promise.reject(new Error("must not connect")),
      cwd: () => "/repo",
      makeRunId: () => "unused",
      readSource: () => Promise.reject(new Error("must not read")),
      runWorkflow: () => Promise.reject(new Error("must not run")),
      writeError: (text) => errors.push(text),
      writeOutput: (text) => output.push(text)
    }
  )

  expect(exitCode).toBe(1)
  expect(output).toEqual([])
  expect(errors.join("")).toContain("--resume must contain only")
  expect(errors.join("")).toContain("Usage:")
})

test("live agents use the CLI invocation directory", async () => {
  let receivedOptions: WorkflowExecutionOptions | undefined
  const exitCode = await runCLI(["run", "scripts/workflow.js"], {
    connect: () => Promise.reject(new Error("must not connect")),
    cwd: () => "/repo",
    makeRunId: () => "workflow-test",
    readSource: () => Promise.resolve("workflow source"),
    runWorkflow: (_source, options) => {
      receivedOptions = options
      return Promise.resolve(execution())
    },
    writeError: () => undefined,
    writeOutput: () => undefined
  })

  expect(exitCode).toBe(0)
  expect(receivedOptions?.cwd).toBe("/repo")
  expect(receivedOptions?.fileName).toBe("/repo/scripts/workflow.js")
})

test("a close failure after success still completes the run", async () => {
  const output: string[] = []
  const errors: string[] = []
  const exitCode = await runCLI(["run", "workflow.js"], {
    connect: () =>
      Promise.resolve({
        close: () => Promise.reject(new Error("close exploded")),
        startAgent: () => Promise.resolve(undefined as never)
      }),
    cwd: () => "/repo",
    makeRunId: () => "workflow-test",
    readSource: () => Promise.resolve("workflow source"),
    runWorkflow: async (_source, options) => {
      await options.appServer?.startAgent("connect-probe")
      return execution()
    },
    writeError: (text) => errors.push(text),
    writeOutput: (text) => output.push(text)
  })

  expect(exitCode).toBe(0)
  expect(output.map((line) => JSON.parse(line).type)).toEqual([
    "run.started",
    "run.completed"
  ])
  expect(errors.join("")).toBe(
    "gpt-workflow: App Server close failed after run completion: close exploded\n"
  )
})
