import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

type VersionFile = {
  path: string
  source: string
}

export type VersionSyncReport = {
  changed: string[]
  version: string
}

type LockRunner = (sdkDirectory: string, check: boolean) => Promise<void>

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u
const PROJECT_VERSION_PATTERN = /^version = "[^"]+"$/mu
const RUNTIME_VERSION_PATTERN = /^VERSION = "[^"]+"$/mu
const VERIFIER_VERSION_PATTERN = /^EXPECTED_VERSION = "[^"]+"$/mu

async function canonicalVersion(repository: string): Promise<string> {
  const path = join(repository, "package.json")
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    throw new Error(`Could not read canonical version from ${path}`, {
      cause: error
    })
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    manifest.name !== "gpt-workflow" ||
    !("version" in manifest) ||
    typeof manifest.version !== "string" ||
    !VERSION_PATTERN.test(manifest.version)
  ) {
    throw new Error(
      "package.json must describe gpt-workflow with a stable x.y.z version"
    )
  }
  return manifest.version
}

function replaceExactly(
  path: string,
  source: string,
  pattern: RegExp,
  replacement: string
): string {
  const matches = source.match(pattern)
  if (matches?.length !== 1) {
    throw new Error(
      `Expected exactly one synchronized version marker in ${path}`
    )
  }
  return source.replace(pattern, replacement)
}

async function desiredFiles(
  repository: string,
  version: string
): Promise<VersionFile[]> {
  const paths = [
    "sdks/python/pyproject.toml",
    "sdks/python/src/gpt_workflow/_version.py",
    "sdks/python/scripts/verify-package.py"
  ]
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      source: await readFile(join(repository, path), "utf8")
    }))
  )
  const [project, runtime, verifier] = files
  if (!(project && runtime && verifier)) {
    throw new Error("Python release files are missing")
  }
  project.source = replaceExactly(
    project.path,
    project.source,
    PROJECT_VERSION_PATTERN,
    `version = "${version}"`
  )
  runtime.source = replaceExactly(
    runtime.path,
    runtime.source,
    RUNTIME_VERSION_PATTERN,
    `VERSION = "${version}"`
  )
  verifier.source = replaceExactly(
    verifier.path,
    verifier.source,
    VERIFIER_VERSION_PATTERN,
    `EXPECTED_VERSION = "${version}"`
  )
  return files
}

const runUVLock: LockRunner = async (sdkDirectory, check) => {
  const process = Bun.spawn(
    ["uv", "lock", "--project", sdkDirectory, ...(check ? ["--check"] : [])],
    { stderr: "pipe", stdout: "pipe" }
  )
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text()
  ])
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `uv lock exited ${exitCode}`)
  }
}

export async function syncPythonVersion(
  repository: string,
  lock: LockRunner = runUVLock
): Promise<VersionSyncReport> {
  const version = await canonicalVersion(repository)
  const files = await desiredFiles(repository, version)
  const writes = await Promise.all(
    files.map(async (file) => {
      const path = join(repository, file.path)
      if ((await readFile(path, "utf8")) === file.source) {
        return null
      }
      await writeFile(path, file.source)
      return file.path
    })
  )
  const changed = writes.filter((path): path is string => path !== null)
  const lockPath = join(repository, "sdks/python/uv.lock")
  const beforeLock = await readFile(lockPath, "utf8")
  await lock(join(repository, "sdks/python"), false)
  if ((await readFile(lockPath, "utf8")) !== beforeLock) {
    changed.push("sdks/python/uv.lock")
  }
  return { changed, version }
}

export async function checkPythonVersion(
  repository: string,
  lock: LockRunner = runUVLock
): Promise<VersionSyncReport> {
  const version = await canonicalVersion(repository)
  const files = await desiredFiles(repository, version)
  const comparisons = await Promise.all(
    files.map(async (file) =>
      (await readFile(join(repository, file.path), "utf8")) === file.source
        ? null
        : file.path
    )
  )
  const changed = comparisons.filter((path): path is string => path !== null)
  if (changed.length > 0) {
    throw new Error(`Python version drift: ${changed.join(", ")}`)
  }
  await lock(join(repository, "sdks/python"), true)
  return { changed, version }
}

async function main(): Promise<void> {
  const [, , mode] = process.argv
  const repository = resolve(process.cwd())
  let report: VersionSyncReport
  if (mode === "sync") {
    report = await syncPythonVersion(repository)
  } else if (mode === "check") {
    report = await checkPythonVersion(repository)
  } else {
    throw new Error("Usage: bun scripts/sync-python-version.ts <sync|check>")
  }
  console.log(
    `Python version ${mode}: version=${report.version} changed=${report.changed.length === 0 ? "none" : report.changed.join(",")}`
  )
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
