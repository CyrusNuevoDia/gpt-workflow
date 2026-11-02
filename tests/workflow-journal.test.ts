import { expect, test } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { AppServerClient } from "../src/app-server.js"
import {
  parseWorkflowJournalEntry,
  runWorkflowScript,
  type WorkflowJournalEntry
} from "../src/index.js"
import { encodeProjectPath } from "../src/workflow-storage.js"

test("parses one started or result journal record", () => {
  const entries: WorkflowJournalEntry[] = [
    parseWorkflowJournalEntry(
      '{"type":"started","key":"v3:abc","agentId":"workflow-1:agent-1"}'
    ),
    parseWorkflowJournalEntry(
      '{"type":"result","key":"v3:abc","agentId":"workflow-1:agent-1","result":{"answer":42}}'
    )
  ]

  expect(entries).toEqual([
    {
      agentId: "workflow-1:agent-1",
      key: "v3:abc",
      type: "started"
    },
    {
      agentId: "workflow-1:agent-1",
      key: "v3:abc",
      result: { answer: 42 },
      type: "result"
    }
  ])
})

test("rejects blank, malformed, unknown, and invalid journal records", () => {
  const invalid = [
    "",
    "{",
    '{"type":"unknown","key":"v2:abc","agentId":"agent-1"}',
    '{"type":"started","key":1,"agentId":"agent-1"}',
    '{"type":"result","key":"v2:abc","agentId":"agent-1"}'
  ]

  for (const source of invalid) {
    expect(() => parseWorkflowJournalEntry(source)).toThrow(SyntaxError)
  }
})

const completedJournal =
  '{"type":"started","key":"v3:abc","agentId":"run:agent-1"}\n' +
  '{"type":"result","key":"v3:abc","agentId":"run:agent-1","result":"saved"}\n'

test.each([
  { line: null, name: "missing", source: null },
  { line: 1, name: "invalid first JSON", source: `{\n${completedJournal}` },
  {
    line: 2,
    name: "invalid interior JSON",
    source: completedJournal.replace("\n", "\n{\n")
  },
  {
    line: 3,
    name: "invalid trailing JSON",
    source: `${completedJournal}{\n`
  },
  {
    line: 3,
    name: "invalid record schema",
    source: `${completedJournal}{"type":"result","key":"v3:abc","agentId":"run:agent-2"}\n`
  },
  {
    line: 2,
    name: "blank interior record",
    source: completedJournal.replace("\n", "\n\n")
  },
  {
    line: 3,
    name: "blank trailing record",
    source: `${completedJournal}\n`
  },
  {
    line: 2,
    name: "unterminated valid record",
    source: completedJournal.trimEnd()
  },
  {
    line: 3,
    name: "unterminated partial record",
    source: `${completedJournal}{`
  }
])("resume rejects $name history before workflow or agent execution", async ({
  source,
  line
}) => {
  const directory = await mkdtemp(
    join(tmpdir(), "gpt-workflow-invalid-journal-")
  )
  const path = join(directory, "journal.jsonl")
  const events: unknown[] = []
  let agentStarts = 0
  const appServer = {
    startAgent: () => {
      agentStarts += 1
      throw new Error("agent must not start")
    }
  } as unknown as AppServerClient
  try {
    if (source !== null) {
      await writeFile(path, source)
    }
    let failure: unknown
    try {
      await runWorkflowScript(
        "export const meta = { name: 'integrity', description: 'Resume integrity probe' }\nlog('body executed'); return await agent('work', { model: 'gpt-5.6-sol' })",
        {
          appServer,
          onWorkflowEvent: (event) => events.push(event),
          resumeFromRunId: "run",
          runDirectory: directory
        }
      )
    } catch (error) {
      failure = error
    }
    expect(events).toEqual([])
    expect(agentStarts).toBe(0)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(path)
    if (line !== null) {
      expect((failure as Error).message).toContain(`line ${line}`)
    }
    if (source === null) {
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" })
    } else {
      expect(await readFile(path)).toEqual(Buffer.from(source))
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("fresh runs create empty journals that agentless runs can resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-empty-journal-"))
  const runDirectory = join(directory, "run")
  const source =
    "export const meta = { name: 'empty', description: 'Empty journal probe' }\nreturn true"
  try {
    const fresh = await runWorkflowScript(source, {
      runDirectory,
      workflowRunId: "run"
    })
    const resumed = await runWorkflowScript(source, {
      resumeFromRunId: "run",
      runDirectory
    })
    expect(fresh.result).toBe(true)
    expect(resumed.result).toBe(true)
    expect(await readFile(join(runDirectory, "journal.jsonl"), "utf8")).toBe("")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("valid v2 journal keys remain cache misses on resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-v2-journal-"))
  const path = join(directory, "journal.jsonl")
  const history = completedJournal.replaceAll("v3:", "v2:")
  let liveCalls = 0
  try {
    await writeFile(path, history)
    const execution = await runWorkflowScript(
      "export const meta = { name: 'legacy', description: 'Legacy journal key probe' }\nreturn await agent('work')",
      {
        agent: () => {
          liveCalls += 1
          return "live"
        },
        resumeFromRunId: "run",
        runDirectory: directory
      }
    )
    expect(execution.result).toBe("live")
    expect(liveCalls).toBe(1)
    expect(execution.usage).toMatchObject({
      liveAgentCount: 1,
      replayedAgentCount: 0
    })
    expect((await readFile(path, "utf8")).startsWith(history)).toBe(true)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("live library runs default to the Codex workflow run directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-default-run-"))
  const canonicalDirectory = await realpath(directory)
  const projectDirectory = join(canonicalDirectory, "project")
  await mkdir(projectDirectory)
  const codexHome = join(canonicalDirectory, "codex-home")
  const expectedRunDirectory = join(
    codexHome,
    "projects",
    encodeProjectPath(projectDirectory),
    "workflows",
    "default-run",
    "runs",
    "workflow-default"
  )
  const entrypoint = pathToFileURL(
    join(import.meta.dir, "..", "src", "index.ts")
  ).href
  const probe = `
    import { runWorkflowScript } from ${JSON.stringify(entrypoint)}
    const source = "export const meta = { name: 'default-run', description: 'default run path probe' }\\nreturn true"
    const execution = await runWorkflowScript(source, {
      appServer: {},
      cwd: ${JSON.stringify(projectDirectory)},
      workflowRunId: "workflow-default"
    })
    console.log(execution.journalPath)
  `

  try {
    const process = Bun.spawn(["bun", "-e", probe], {
      cwd: directory,
      env: { ...Bun.env, CODEX_HOME: codexHome },
      stderr: "pipe",
      stdout: "pipe"
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text()
    ])
    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe(join(expectedRunDirectory, "journal.jsonl"))
    expect(
      await readFile(join(expectedRunDirectory, "journal.jsonl"), "utf8")
    ).toBe("")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("explicit resume directories must already exist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-resume-run-"))
  const source =
    "export const meta = { name: 'resume-run', description: 'resume path probe' }\nreturn true"
  try {
    await expect(
      runWorkflowScript(source, {
        resumeFromRunId: "missing-run",
        runDirectory: join(directory, "missing-run")
      })
    ).rejects.toThrow("run not found: missing-run")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
