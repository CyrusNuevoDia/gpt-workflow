import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkMirror,
  formatMirrorReport,
  mirrorPassed,
  syncMirror,
  transformWorkflow
} from "../scripts/mirror.js"

async function withDirectories(
  run: (directories: {
    sourceDirectory: string
    targetDirectory: string
  }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "gpt-workflow-mirror-"))
  const directories = {
    sourceDirectory: join(root, "source"),
    targetDirectory: join(root, "target")
  }
  await mkdir(directories.sourceDirectory, { recursive: true })
  await mkdir(directories.targetDirectory, { recursive: true })
  try {
    await run(directories)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

test("sync discovers direct regular JavaScript files and removes only extra mirror files", async () => {
  await withDirectories(async ({ sourceDirectory, targetDirectory }) => {
    const source = [
      "const sourcePath = '.claude/workflows/alpha.js'",
      "const models = ['haiku', 'sonnet']"
    ].join("\n")
    await writeFile(join(sourceDirectory, "alpha.js"), source)
    await mkdir(join(sourceDirectory, "nested"))
    await writeFile(join(sourceDirectory, "nested", "ignored.js"), "ignored")
    await writeFile(join(sourceDirectory, "notes.txt"), "ignored")
    await writeFile(join(targetDirectory, "extra.js"), "remove me")
    await writeFile(join(targetDirectory, "keep.txt"), "keep me")

    const syncReport = await syncMirror({ sourceDirectory, targetDirectory })
    expect(syncReport).toEqual({ discovered: 1, removed: 1, written: 1 })
    expect(await readFile(join(targetDirectory, "alpha.js"), "utf8")).toBe(
      transformWorkflow(source)
    )
    expect(await readFile(join(targetDirectory, "keep.txt"), "utf8")).toBe(
      "keep me"
    )
    await expect(readFile(join(targetDirectory, "extra.js"))).rejects.toThrow()

    const checkReport = await checkMirror({ sourceDirectory, targetDirectory })
    expect(mirrorPassed(checkReport)).toBe(true)
    expect(checkReport).toMatchObject({
      compared: 1,
      discovered: 1,
      target: 1
    })
  })
})

test("check rejects a missing mirror in a temporary directory", async () => {
  await withDirectories(async ({ sourceDirectory, targetDirectory }) => {
    await writeFile(join(sourceDirectory, "alpha.js"), "export const meta = {}")

    const report = await checkMirror({ sourceDirectory, targetDirectory })

    expect(mirrorPassed(report)).toBe(false)
    expect(report).toMatchObject({
      compared: 0,
      discovered: 1,
      missing: ["alpha.js"],
      target: 0
    })
    expect(formatMirrorReport(report)).toContain("Result: FAIL")
  })
})

test("transform maps Claude agent-type names to Codex built-ins", () => {
  expect(
    transformWorkflow(
      'await agent("x", { agentType: "general-purpose" })\n' +
        'await agent("y", { agentType: "Explore" })'
    )
  ).toBe(
    'await agent("x", { agentType: "default" })\n' +
      'await agent("y", { agentType: "explorer" })'
  )
})

test("check rejects stale Claude model text in a mirror", async () => {
  await withDirectories(async ({ sourceDirectory, targetDirectory }) => {
    const source = "const model = 'haiku'\n"
    await writeFile(join(sourceDirectory, "alpha.js"), source)
    await writeFile(join(targetDirectory, "alpha.js"), source)

    const report = await checkMirror({ sourceDirectory, targetDirectory })

    expect(mirrorPassed(report)).toBe(false)
    expect(report).toMatchObject({
      compared: 1,
      discovered: 1,
      drifted: ["alpha.js"],
      target: 1
    })
  })
})
