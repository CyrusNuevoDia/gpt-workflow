import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

export type MirrorDirectories = {
  sourceDirectory: string
  targetDirectory: string
}

export type MirrorReport = {
  compared: number
  discovered: number
  drifted: string[]
  extra: string[]
  missing: string[]
  target: number
}

export type SyncReport = {
  discovered: number
  removed: number
  written: number
}

const SOURCE_DIRECTORY = ".claude/workflows"
const TARGET_DIRECTORY = ".codex/workflows"

export const transformWorkflow = (source: string) =>
  source
    .replaceAll(".claude/workflows", ".codex/workflows")
    .replaceAll("haiku", "gpt-5.6-luna")
    .replaceAll("sonnet", "gpt-5.6-terra")
    .replaceAll("opus", "gpt-5.6-sol")
    .replaceAll("fable", "gpt-5.6-sol")

async function discoverWorkflowNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (isMissingDirectory(error)) {
      return []
    }
    throw error
  }
}

function isMissingDirectory(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function requireSourceDirectory(sourceDirectory: string): Promise<void> {
  const names = await discoverWorkflowNames(sourceDirectory)
  try {
    await readdir(sourceDirectory)
  } catch (error) {
    if (isMissingDirectory(error)) {
      throw new Error(
        `Workflow mirror source directory does not exist: ${sourceDirectory}`,
        { cause: error }
      )
    }
    throw error
  }
  if (names.length === 0) {
    throw new Error(
      `Workflow mirror source directory contains no direct *.js files: ${sourceDirectory}`
    )
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  return left.every((byte, index) => byte === right[index])
}

export async function checkMirror({
  sourceDirectory,
  targetDirectory
}: MirrorDirectories): Promise<MirrorReport> {
  await requireSourceDirectory(sourceDirectory)

  const sourceNames = await discoverWorkflowNames(sourceDirectory)
  const targetNames = await discoverWorkflowNames(targetDirectory)
  const targetSet = new Set(targetNames)
  const missing = sourceNames.filter((name) => !targetSet.has(name))
  const extra = targetNames.filter((name) => !sourceNames.includes(name))
  const comparedNames = sourceNames.filter((name) => targetSet.has(name))
  const comparisons = await Promise.all(
    comparedNames.map(async (name) => {
      const [source, target] = await Promise.all([
        readFile(resolve(sourceDirectory, name)),
        readFile(resolve(targetDirectory, name))
      ])
      const expected = Buffer.from(transformWorkflow(source.toString("utf8")))
      return bytesEqual(expected, target) ? null : name
    })
  )
  const drifted = comparisons.filter((name): name is string => name !== null)

  return {
    compared: comparedNames.length,
    discovered: sourceNames.length,
    drifted,
    extra,
    missing,
    target: targetNames.length
  }
}

export const mirrorPassed = (report: MirrorReport) =>
  report.missing.length === 0 &&
  report.extra.length === 0 &&
  report.drifted.length === 0

export function formatMirrorReport(report: MirrorReport): string {
  const formatNames = (names: string[]): string =>
    names.length === 0 ? "none" : names.join(", ")
  return [
    `Mirror check: discovered=${report.discovered} target=${report.target} compared=${report.compared}`,
    `Missing: ${formatNames(report.missing)}`,
    `Extra: ${formatNames(report.extra)}`,
    `Drifted: ${formatNames(report.drifted)}`,
    `Result: ${mirrorPassed(report) ? "PASS" : "FAIL"}`
  ].join("\n")
}

export async function syncMirror({
  sourceDirectory,
  targetDirectory
}: MirrorDirectories): Promise<SyncReport> {
  await requireSourceDirectory(sourceDirectory)
  await mkdir(targetDirectory, { recursive: true })

  const sourceNames = await discoverWorkflowNames(sourceDirectory)
  const targetNames = await discoverWorkflowNames(targetDirectory)
  const sourceSet = new Set(sourceNames)
  const extra = targetNames.filter((name) => !sourceSet.has(name))

  await Promise.all(
    sourceNames.map(async (name) => {
      const source = await readFile(resolve(sourceDirectory, name), "utf8")
      await writeFile(resolve(targetDirectory, name), transformWorkflow(source))
    })
  )
  await Promise.all(extra.map((name) => unlink(resolve(targetDirectory, name))))

  return {
    discovered: sourceNames.length,
    removed: extra.length,
    written: sourceNames.length
  }
}

async function main(): Promise<void> {
  const [, , mode] = process.argv
  const directories = {
    sourceDirectory: resolve(process.cwd(), SOURCE_DIRECTORY),
    targetDirectory: resolve(process.cwd(), TARGET_DIRECTORY)
  }

  if (mode === "sync") {
    const report = await syncMirror(directories)
    console.log(
      `Mirror sync: discovered=${report.discovered} written=${report.written} removed=${report.removed}`
    )
    return
  }

  if (mode === "check") {
    const report = await checkMirror(directories)
    console.log(formatMirrorReport(report))
    if (!mirrorPassed(report)) {
      process.exitCode = 1
    }
    return
  }

  throw new Error("Usage: bun scripts/mirror.ts <sync|check>")
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
