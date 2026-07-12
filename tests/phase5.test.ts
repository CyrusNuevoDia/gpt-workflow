import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type {
  AppServerAgentHandle,
  AppServerClient
} from "../src/app-server.js"
import { type JSONValue, runWorkflowScript } from "../src/runtime.js"

const execFileAsync = promisify(execFile)
function script(body: string, name = "phase5-offline"): string {
  return `export const meta = { name: '${name}', description: 'Phase 5 offline probe' }\n${body}`
}

const fakeHandle = (result: JSONValue): AppServerAgentHandle => ({
  agentId: "fake-agent",
  eventLog: [],
  events: {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: ignore
    async *[Symbol.asyncIterator]() {}
  },
  interrupt: async () => undefined,
  label: null,
  phase: null,
  requestedModel: "gpt-5.6-luna",
  resolvedModel: "gpt-5.6-luna",
  result: async () => ({
    evidence: {
      itemIds: ["fake-item"],
      requestedModel: "gpt-5.6-luna",
      resolvedModel: "gpt-5.6-luna",
      terminalStatus: "completed",
      threadId: "fake-thread",
      turnId: "fake-turn",
      usage: { total: { totalTokens: 7 } }
    },
    result
  }),
  steer: async () => ({ turnId: "fake-turn" }),
  subscribe: () => () => undefined,
  threadId: "fake-thread",
  turnId: "fake-turn",
  workflowRunId: "fake-run"
})

test("composition resolves script paths and names, preserves args/results, and rejects grandchild calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-composition-"))
  try {
    const childPath = join(directory, "child.js")
    const nestedPath = join(directory, "nested.js")
    await writeFile(
      childPath,
      script("return { child: true, args }", "child-workflow")
    )
    await writeFile(
      nestedPath,
      script(
        `
      try {
        await workflow({ scriptPath: ${JSON.stringify(childPath)} })
        return { nestedThrew: false }
      } catch (error) {
        return { nestedThrew: true, message: error.message }
      }
    `,
        "nested-probe"
      )
    )
    const parent = script(`
      const argsValue = { topic: 'tea', list: ['a', 'b'] }
      const byPath = await workflow({ scriptPath: ${JSON.stringify(childPath)} }, argsValue)
      const byName = await workflow('child-workflow', argsValue)
      const nested = await workflow({ scriptPath: ${JSON.stringify(nestedPath)} })
      let unknown = false
      try { await workflow('missing-workflow') } catch { unknown = true }
      return { byPath, byName, nested, unknown }
    `)
    const execution = await runWorkflowScript(parent, {
      fileName: join(directory, "parent.js"),
      workflowDirectory: directory
    })
    expect(execution.result).toEqual({
      byName: { args: { list: ["a", "b"], topic: "tea" }, child: true },
      byPath: { args: { list: ["a", "b"], topic: "tea" }, child: true },
      nested: {
        message:
          "workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly.",
        nestedThrew: true
      },
      unknown: true
    })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("parent and child share agent IDs and the scheduler state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-shared-state-"))
  try {
    const childPath = join(directory, "child.js")
    await writeFile(
      childPath,
      script(
        "return await agent('child', { model: 'gpt-5.6-luna' })",
        "shared-child"
      )
    )
    const agentIds: string[] = []
    const appServer = {
      startAgent: (_prompt: string, options: Record<string, JSONValue>) => {
        agentIds.push(String(options.agentId))
        return fakeHandle(String(_prompt))
      }
    } as unknown as AppServerClient
    const execution = await runWorkflowScript(
      script(`
      const child = await workflow({ scriptPath: ${JSON.stringify(childPath)} })
      const parent = await agent('parent', { model: 'gpt-5.6-luna' })
      return { child, parent }
    `),
      {
        appServer,
        caps: { maxConcurrentAgents: 1 },
        workflowDirectory: directory,
        workflowRunId: "phase5-shared"
      }
    )
    expect(execution.result).toEqual({ child: "child", parent: "parent" })
    expect(agentIds).toEqual(["phase5-shared:agent-1", "phase5-shared:agent-2"])
    expect(execution.usage).toMatchObject({
      agentCount: 2,
      liveAgentCount: 2,
      peakConcurrentAgents: 1
    })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("shared queue bounds concurrency while all queued agents complete", async () => {
  let active = 0
  let peak = 0
  const execution = await runWorkflowScript(
    script(`
    return await parallel(Array.from({ length: 7 }, (_, index) => () => agent('queued-' + index)))
  `),
    {
      agent: async (prompt) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active -= 1
        return prompt
      },
      caps: { maxConcurrentAgents: 2 }
    }
  )
  expect(execution.result).toEqual([
    "queued-0",
    "queued-1",
    "queued-2",
    "queued-3",
    "queued-4",
    "queued-5",
    "queued-6"
  ])
  expect(peak).toBe(2)
  expect(execution.usage).toMatchObject({
    agentCount: 7,
    liveAgentCount: 7,
    peakConcurrentAgents: 2,
    replayedAgentCount: 0
  })
})

test("lifetime, boundary, and budget caps are explicit and catchable", async () => {
  const lifetime = await runWorkflowScript(
    script(`
    const values = await parallel(Array.from({ length: 4 }, (_, index) => () => agent('life-' + index)))
    return values
  `),
    {
      agent: async (prompt) => prompt,
      caps: { maxAgentsPerRun: 3 }
    }
  )
  expect(lifetime.result).toEqual(["life-0", "life-1", "life-2", null])
  expect(lifetime.failures[0]?.message).toContain("lifetime cap reached")
  expect(lifetime.usage.agentCount).toBe(3)

  const boundary = await runWorkflowScript(
    script(`
    try { await parallel([() => null, () => null, () => null]); return 'missed' }
    catch (error) { return error.message }
  `),
    { caps: { maxBoundaryItems: 2 } }
  )
  expect(boundary.result).toBe(
    "array length 3 exceeds the maximum of 2 supported across the workflow VM boundary"
  )

  const budget = await runWorkflowScript(
    script(`
    try { await agent('blocked'); return 'missed' }
    catch (error) { return error.message }
  `),
    { agent: async () => "never", budget: { total: 0 } }
  )
  expect(budget.result).toContain("budget cap reached")
  expect(budget.usage.agentCount).toBe(0)
})

test("cancellation is shared with queued child work", async () => {
  const controller = new AbortController()
  let started = false
  const promise = runWorkflowScript(
    script(`
    return await parallel([
      () => agent('first'),
      () => agent('second'),
    ])
  `),
    {
      agent: async () => {
        started = true
        await new Promise(() => undefined)
        return "unreachable"
      },
      caps: { maxConcurrentAgents: 1 },
      signal: controller.signal
    }
  )
  while (!started) {
    // biome-ignore lint/performance/noAwaitInLoops: ignore
    await Promise.resolve()
  }
  controller.abort()
  const execution = await promise
  expect(execution.result).toEqual([null, null])
  expect(
    execution.failures.every((failure) => failure.message.includes("cancelled"))
  ).toBe(true)
})

test("worktree isolation propagates exact cwd and removes only clean worktrees", async () => {
  const repository = await mkdtemp(
    join(tmpdir(), "gpt-workflow-worktree-repo-")
  )
  await mkdir(join(repository, ".claude"), { recursive: true })
  await writeFile(join(repository, ".claude", "seed.txt"), "seed\n")
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repository })
  await execFileAsync("git", ["config", "user.email", "phase5@example.test"], {
    cwd: repository
  })
  await execFileAsync("git", ["config", "user.name", "Phase 5 Test"], {
    cwd: repository
  })
  await execFileAsync("git", ["add", "."], { cwd: repository })
  await execFileAsync("git", ["commit", "-qm", "seed"], { cwd: repository })
  const received: Record<string, JSONValue>[] = []
  const appServer = {
    startAgent: (_prompt: string, options: Record<string, JSONValue>) => {
      received.push(options)
      return fakeHandle("worktree-ok")
    }
  } as unknown as AppServerClient
  try {
    const runId = `phase5-worktree-${Date.now()}`
    const execution = await runWorkflowScript(
      script(`
      return await agent('worktree', { model: 'gpt-5.6-luna', isolation: 'worktree' })
    `),
      { appServer, cwd: repository, workflowRunId: runId }
    )
    expect(execution.result).toBe("worktree-ok")
    expect(received[0]?.cwd).toContain(
      `${repository}/.verification-artifacts/worktrees/${runId}-1`
    )
    expect(received[0]?.sandbox).toBe("workspace-write")
    expect(received[0]?.cwd).not.toBe(repository)
    const worktrees = await execFileAsync(
      "git",
      ["-C", repository, "worktree", "list", "--porcelain"],
      { encoding: "utf8" }
    )
    expect(worktrees.stdout).not.toContain(`${runId}-1`)

    const dirtyRunId = `phase5-dirty-${Date.now()}`
    const dirtyAppServer = {
      startAgent: async (
        _prompt: string,
        options: Record<string, JSONValue>
      ) => {
        await writeFile(`${String(options.cwd)}/dirty-marker.txt`, "leave me")
        return fakeHandle("dirty")
      }
    } as unknown as AppServerClient
    await runWorkflowScript(
      script(
        `return await agent('dirty', { model: 'gpt-5.6-luna', isolation: 'worktree' })`
      ),
      {
        appServer: dirtyAppServer,
        cwd: repository,
        workflowRunId: dirtyRunId
      }
    )
    const dirtyPath = `${repository}/.verification-artifacts/worktrees/${dirtyRunId}-1`
    expect(await readFile(`${dirtyPath}/dirty-marker.txt`, "utf8")).toBe(
      "leave me"
    )
    await unlink(`${dirtyPath}/dirty-marker.txt`)
    await execFileAsync(
      "git",
      ["-C", repository, "worktree", "remove", dirtyPath],
      { encoding: "utf8" }
    )
  } finally {
    await rm(repository, { force: true, recursive: true })
  }
})

test("journal replay is byte-identical, repeatable, and invalidates the later prefix", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-journal-"))
  let liveCalls = 0
  const source = script(
    `
    const a = await agent('A')
    const b = await agent('B:' + args.salt)
    const c = await agent('C')
    return { a, b, c }
  `,
    "resume-probe"
  )
  // biome-ignore lint/style/noIncrementDecrement: ignore
  const liveAgent = async () => `live-${++liveCalls}`
  try {
    const first = await runWorkflowScript(source, {
      agent: liveAgent,
      args: { salt: "s1" },
      transcriptDirectory: directory,
      workflowRunId: "phase5-resume"
    })
    const replay = await runWorkflowScript(source, {
      agent: liveAgent,
      args: { salt: "s1" },
      resumeFromRunId: "phase5-resume",
      transcriptDirectory: directory
    })
    const changed = await runWorkflowScript(source, {
      agent: liveAgent,
      args: { salt: "s2" },
      resumeFromRunId: "phase5-resume",
      transcriptDirectory: directory
    })
    expect(JSON.stringify(replay.result)).toBe(JSON.stringify(first.result))
    expect(replay.usage).toMatchObject({
      liveAgentCount: 0,
      replayedAgentCount: 3,
      subagentTokens: 0
    })
    expect(changed.result).toEqual({ a: "live-1", b: "live-4", c: "live-5" })
    expect(changed.result).not.toEqual(first.result)
    expect(changed.usage).toMatchObject({
      liveAgentCount: 2,
      replayedAgentCount: 1
    })

    const lines = (await readFile(join(directory, "journal.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; key: string })
    expect(lines).toHaveLength(10)
    const started = lines
      .filter((line) => line.type === "started")
      .map((line) => line.key)
    expect(started).toHaveLength(5)
    expect(new Set(started).size).toBe(5)
    expect(started[3]).not.toBe(started[1])
    expect(started[4]).not.toBe(started[2])
    expect(liveCalls).toBe(5)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
