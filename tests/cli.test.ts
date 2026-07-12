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
    journalPath: "/repo/.gpt-workflow/runs/workflow-test/journal.jsonl",
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
    connect: () =>
      Promise.resolve({
        close: () => {
          closed += 1
          return Promise.resolve()
        },
        startAgent: () => Promise.resolve(undefined as never)
      }),
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
    journalPath: "/repo/.gpt-workflow/runs/workflow-test/journal.jsonl",
    result: { answer: 42 },
    type: "run.completed"
  })
  expect(receivedOptions).toMatchObject({
    cwd: "/repo",
    fileName: "/repo/workflow.js",
    transcriptDirectory: "/repo/.gpt-workflow/runs/workflow-test",
    workflowRunId: "workflow-test"
  })
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
  expect(helpOutput.join("")).toContain("gpt-workflow run <script.js>")

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
    "expected exactly: gpt-workflow run <script.js>"
  )
})
