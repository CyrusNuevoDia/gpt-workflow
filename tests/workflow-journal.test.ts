import { expect, test } from "bun:test"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  parseWorkflowJournalEntry,
  type WorkflowJournalEntry
} from "../src/index.js"

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

test("live library runs default to the Codex workflow run directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-default-run-"))
  const canonicalDirectory = await realpath(directory)
  const entrypoint = pathToFileURL(
    join(import.meta.dir, "..", "src", "index.ts")
  ).href
  const probe = `
    import { runWorkflowScript } from ${JSON.stringify(entrypoint)}
    const source = "export const meta = { name: 'default-run', description: 'default run path probe' }\\nreturn true"
    const execution = await runWorkflowScript(source, {
      appServer: {},
      workflowRunId: "workflow-default"
    })
    console.log(execution.journalPath)
  `

  try {
    const process = Bun.spawn(["bun", "-e", probe], {
      cwd: directory,
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
    expect(stdout.trim()).toBe(
      join(
        canonicalDirectory,
        ".codex",
        "workflows",
        "runs",
        "workflow-default",
        "journal.jsonl"
      )
    )
    expect(
      await readFile(
        join(
          directory,
          ".codex",
          "workflows",
          "runs",
          "workflow-default",
          "journal.jsonl"
        ),
        "utf8"
      )
    ).toBe("")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
