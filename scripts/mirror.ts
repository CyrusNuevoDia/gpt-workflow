import { readdir, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

export interface MirrorDirectories {
  sourceDirectory: string
  targetDirectory: string
}

export interface MirrorReport {
  discovered: number
  target: number
  compared: number
  missing: string[]
  extra: string[]
  drifted: string[]
}

export interface SyncReport {
  discovered: number
  written: number
  removed: number
}

const SOURCE_DIRECTORY = ".claude/workflows"
const TARGET_DIRECTORY = ".codex/workflows"

export function transformWorkflow(source: string): string {
  return source
    .replaceAll(".claude/workflows", ".codex/workflows")
    .replaceAll("haiku", "gpt-5.6-luna")
    .replaceAll("sonnet", "gpt-5.6-terra")
}

async function discoverWorkflowNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (isMissingDirectory(error)) return []
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
      throw new Error(`Workflow mirror source directory does not exist: ${sourceDirectory}`)
    }
    throw error
  }
  if (names.length === 0) {
    throw new Error(`Workflow mirror source directory contains no direct *.js files: ${sourceDirectory}`)
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((byte, index) => byte === right[index])
}

export async function checkMirror({ sourceDirectory, targetDirectory }: MirrorDirectories): Promise<MirrorReport> {
  await requireSourceDirectory(sourceDirectory)

  const sourceNames = await discoverWorkflowNames(sourceDirectory)
  const targetNames = await discoverWorkflowNames(targetDirectory)
  const targetSet = new Set(targetNames)
  const missing = sourceNames.filter((name) => !targetSet.has(name))
  const extra = targetNames.filter((name) => !sourceNames.includes(name))
  const comparedNames = sourceNames.filter((name) => targetSet.has(name))
  const drifted: string[] = []

  for (const name of comparedNames) {
    const [source, target] = await Promise.all([
      readFile(resolve(sourceDirectory, name)),
      readFile(resolve(targetDirectory, name)),
    ])
    const expected = Buffer.from(transformWorkflow(source.toString("utf8")))
    if (!bytesEqual(expected, target)) drifted.push(name)
  }

  return {
    discovered: sourceNames.length,
    target: targetNames.length,
    compared: comparedNames.length,
    missing,
    extra,
    drifted,
  }
}

export function mirrorPassed(report: MirrorReport): boolean {
  return report.missing.length === 0 && report.extra.length === 0 && report.drifted.length === 0
}

export function formatMirrorReport(report: MirrorReport): string {
  const formatNames = (names: string[]): string => names.length === 0 ? "none" : names.join(", ")
  return [
    `Mirror check: discovered=${report.discovered} target=${report.target} compared=${report.compared}`,
    `Missing: ${formatNames(report.missing)}`,
    `Extra: ${formatNames(report.extra)}`,
    `Drifted: ${formatNames(report.drifted)}`,
    `Result: ${mirrorPassed(report) ? "PASS" : "FAIL"}`,
  ].join("\n")
}

export async function syncMirror({ sourceDirectory, targetDirectory }: MirrorDirectories): Promise<SyncReport> {
  await requireSourceDirectory(sourceDirectory)
  await mkdir(targetDirectory, { recursive: true })

  const sourceNames = await discoverWorkflowNames(sourceDirectory)
  const targetNames = await discoverWorkflowNames(targetDirectory)
  const sourceSet = new Set(sourceNames)
  const extra = targetNames.filter((name) => !sourceSet.has(name))

  for (const name of sourceNames) {
    const source = await readFile(resolve(sourceDirectory, name), "utf8")
    await writeFile(resolve(targetDirectory, name), transformWorkflow(source))
  }
  for (const name of extra) {
    await unlink(resolve(targetDirectory, name))
  }

  return {
    discovered: sourceNames.length,
    written: sourceNames.length,
    removed: extra.length,
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2]
  const directories = {
    sourceDirectory: resolve(process.cwd(), SOURCE_DIRECTORY),
    targetDirectory: resolve(process.cwd(), TARGET_DIRECTORY),
  }

  if (mode === "sync") {
    const report = await syncMirror(directories)
    console.log(`Mirror sync: discovered=${report.discovered} written=${report.written} removed=${report.removed}`)
    return
  }

  if (mode === "check") {
    const report = await checkMirror(directories)
    console.log(formatMirrorReport(report))
    if (!mirrorPassed(report)) process.exitCode = 1
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
