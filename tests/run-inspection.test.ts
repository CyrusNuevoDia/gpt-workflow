import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listRunSummaries, readRunStatus } from "../src/run-inspection.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("run inspection", () => {
  test("lists newest-first with completed, failed, incomplete, and journal-only runs", async () => {
    const cwd = await makeTemporaryDirectory()
    await writeEvents(cwd, "completed", [
      startedRecord("completed", 300),
      terminalRecord("run.completed", "completed", 340, {
        failures: [],
        result: { answer: 42 },
        usage: { agentCount: 1 }
      })
    ])
    await writeEvents(cwd, "failed", [
      startedRecord("failed", 100),
      terminalRecord("run.failed", "failed", 120)
    ])
    await writeEvents(cwd, "incomplete", [
      startedRecord("incomplete", 200),
      eventRecord("workflow.event", "incomplete", 210, {
        event: {
          depth: 0,
          event: { detail: null, title: "Build", type: "phase" },
          fileName: "/tmp/incomplete.js"
        }
      })
    ])
    await writeJournal(cwd, "legacy", [
      { agentId: "legacy-agent", key: "same", type: "started" }
    ])

    const summaries = await listRunSummaries(cwd)

    expect(summaries.map(({ runId }) => runId)).toEqual([
      "completed",
      "incomplete",
      "failed",
      "legacy"
    ])
    expect(summaries[0]).toEqual({
      failureCount: 0,
      finishedAt: 340,
      lastEventAt: 340,
      name: "completed-name",
      runId: "completed",
      scriptPath: "/tmp/completed.js",
      startedAt: 300,
      status: "completed",
      usage: { agentCount: 1 }
    })
    expect(summaries[1]?.status).toBe("incomplete")
    expect(summaries[2]).toMatchObject({
      failureCount: 1,
      finishedAt: 120,
      status: "failed"
    })
    await expect(readRunStatus(cwd, "failed")).resolves.toMatchObject({
      failureCount: 1,
      status: "failed"
    })
    expect(summaries[3]).toEqual({
      journalOnly: true,
      lastEventAt: null,
      name: null,
      runId: "legacy",
      scriptPath: null,
      startedAt: null,
      status: "unknown"
    })
  })

  test("uses latest cumulative agent tokens and rolls them up by phase", async () => {
    const cwd = await makeTemporaryDirectory()
    const runId = "token-status"
    await writeEvents(cwd, runId, [
      startedRecord(runId, 10),
      eventRecord("workflow.event", runId, 11, {
        event: {
          depth: 0,
          event: { detail: "Do the work", title: "Build", type: "phase" },
          fileName: `/tmp/${runId}.js`
        }
      }),
      agentRecord(runId, 12, "agent-1", {
        lifecycle: "started",
        status: "started",
        subject: "thread",
        type: "lifecycle"
      }),
      agentRecord(runId, 13, "agent-1", {
        type: "usage",
        usage: { total: { inputTokens: 5, totalTokens: 10 } }
      }),
      agentRecord(runId, 14, "agent-1", {
        type: "usage",
        usage: { total: { inputTokens: 10, totalTokens: 20 } }
      }),
      agentRecord(runId, 15, "agent-1", {
        error: null,
        lifecycle: "completed",
        status: "completed",
        type: "terminal",
        usage: null
      }),
      agentRecord(runId, 16, "agent-2", {
        lifecycle: "started",
        status: "started",
        subject: "thread",
        type: "lifecycle"
      }),
      agentRecord(runId, 17, "agent-2", {
        type: "usage",
        usage: { total: { output_tokens: 5, total_tokens: 5 } }
      }),
      agentRecord(runId, 18, "agent-2", {
        error: "agent failed",
        lifecycle: "completed",
        status: "failed",
        type: "terminal",
        usage: { total: { output_tokens: 5, total_tokens: 5 } }
      }),
      terminalRecord("run.completed", runId, 20, {
        failures: [{ index: 1, kind: "agent", message: "agent failed" }],
        result: { ok: false },
        usage: { agentCount: 2 }
      })
    ])

    const status = await readRunStatus(cwd, runId)

    expect(status).not.toBeNull()
    if (status === null || status.status === "unknown") {
      throw new Error("expected event-backed status")
    }
    expect(status.agents).toEqual([
      {
        agentId: "agent-1",
        label: "agent-1-label",
        model: "resolved-model",
        phase: "Build",
        status: "completed",
        tokens: { total: { inputTokens: 10, totalTokens: 20 } }
      },
      {
        agentId: "agent-2",
        label: "agent-2-label",
        model: "resolved-model",
        phase: "Build",
        status: "failed",
        tokens: { total: { output_tokens: 5, total_tokens: 5 } }
      }
    ])
    expect(status.phases).toEqual([
      {
        agents: { completed: 1, failed: 1, started: 2 },
        detail: "Do the work",
        title: "Build",
        tokens: {
          cachedInputTokens: 0,
          inputTokens: 10,
          outputTokens: 5,
          reasoningOutputTokens: 0,
          totalTokens: 25
        }
      }
    ])
    expect(status.failures).toEqual([
      { index: 1, kind: "agent", message: "agent failed" }
    ])
    expect(status.result).toEqual({ ok: false })
  })

  test("reports persisted agent terminal states even when the run has no terminal record", async () => {
    const cwd = await makeTemporaryDirectory()
    const runId = "interrupted"
    await writeEvents(cwd, runId, [
      startedRecord(runId, 10),
      agentRecord(runId, 11, "agent-1", {
        lifecycle: "started",
        status: "started",
        subject: "thread",
        type: "lifecycle"
      }),
      agentRecord(runId, 12, "agent-1", {
        error: null,
        lifecycle: "completed",
        status: "completed",
        type: "terminal",
        usage: null
      }),
      agentRecord(runId, 13, "agent-2", {
        lifecycle: "started",
        status: "started",
        subject: "thread",
        type: "lifecycle"
      })
    ])

    const status = await readRunStatus(cwd, runId)

    expect(status).toMatchObject({ status: "incomplete" })
    if (status === null || status.status === "unknown") {
      throw new Error("expected event-backed status")
    }
    expect(status.agents[0]?.status).toBe("completed")
    expect(status.agents[1]?.status).toBe("incomplete")
  })

  test("skips malformed trailing event data and counts journal fallback records", async () => {
    const cwd = await makeTemporaryDirectory()
    await writeEvents(
      cwd,
      "partial",
      [
        startedRecord("partial", 10),
        terminalRecord("run.completed", "partial", 20, {
          failures: [],
          result: null,
          usage: { agentCount: 0 }
        })
      ],
      '{"type":"agent.event"'
    )
    await writeJournal(cwd, "legacy", [
      { agentId: "a", key: "one", type: "started" },
      { agentId: "a", key: "one", result: "done", type: "result" },
      { agentId: "b", key: "two", type: "started" },
      { agentId: "orphan", key: "three", result: null, type: "result" }
    ])

    await expect(readRunStatus(cwd, "partial")).resolves.toMatchObject({
      result: null,
      status: "completed"
    })
    await expect(listRunSummaries(cwd)).resolves.toContainEqual(
      expect.objectContaining({ runId: "partial", status: "completed" })
    )
    await expect(readRunStatus(cwd, "legacy")).resolves.toEqual({
      journal: { results: 2, started: 2, unmatched: 2 },
      journalOnly: true,
      runId: "legacy",
      status: "unknown"
    })
    await expect(readRunStatus(cwd, "missing")).resolves.toBeNull()
  })

  test("returns an empty list when the runs directory does not exist", async () => {
    const cwd = await makeTemporaryDirectory()
    await expect(listRunSummaries(cwd)).resolves.toEqual([])
  })
})

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-inspection-"))
  directories.push(directory)
  return directory
}

async function writeEvents(
  cwd: string,
  runId: string,
  records: Record<string, unknown>[],
  trailing = ""
): Promise<void> {
  const directory = runDirectory(cwd, runId)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, "events.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n${trailing}`
  )
}

async function writeJournal(
  cwd: string,
  runId: string,
  records: Record<string, unknown>[]
): Promise<void> {
  const directory = runDirectory(cwd, runId)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, "journal.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  )
}

function runDirectory(cwd: string, runId: string): string {
  return join(cwd, ".codex", "workflows", "runs", runId)
}

function startedRecord(runId: string, ts: number): Record<string, unknown> {
  return eventRecord("run.started", runId, ts, {
    meta: { description: `${runId} description`, name: `${runId}-name` }
  })
}

function terminalRecord(
  type: "run.completed" | "run.failed",
  runId: string,
  ts: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return eventRecord(type, runId, ts, extra)
}

function agentRecord(
  runId: string,
  ts: number,
  agentId: string,
  event: Record<string, unknown>
): Record<string, unknown> {
  return eventRecord("agent.event", runId, ts, {
    event: {
      agentId,
      itemId: null,
      label: `${agentId}-label`,
      method: "test/event",
      phase: "Build",
      requestedModel: "requested-model",
      resolvedModel: "resolved-model",
      sequence: ts,
      threadId: `thread-${agentId}`,
      timestamp: ts,
      turnId: `turn-${agentId}`,
      workflowRunId: runId,
      ...event
    }
  })
}

function eventRecord(
  type: string,
  runId: string,
  ts: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    runDirectory: `/tmp/runs/${runId}`,
    runId,
    schemaVersion: 1,
    scriptPath: `/tmp/${runId}.js`,
    sequence: ts,
    ts,
    type,
    ...extra
  }
}
