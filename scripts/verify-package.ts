import { spawn } from "node:child_process"
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

type PackResult = {
  filename: string
  files: { path: string }[]
}

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const distPath = join(repository, "dist")
const buildInfoPath = join(repository, "tsconfig.tsbuildinfo")

const publicValueExports =
  "AppServerClient AppServerError AppServerModelError AppServerProcessError AppServerProtocolError AppServerRemoteError AppServerResultError AppServerTimeoutError AppServerTurnError BUILTIN_AGENT_DEFINITIONS JSONBoundaryError REQUIRED_APP_SERVER_MODELS WorkflowLoadError listRunSummaries parseWorkflowJournalEntry parseWorkflowScript readRunStatus resolveAgentType runWorkflowScript".split(
    " "
  )

const smokeSource = `
import * as api from "gpt-workflow"
const expectedExports = ${JSON.stringify(publicValueExports)}
const actualExports = Object.keys(api).sort()
if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
  throw new Error("unexpected public value exports: " + JSON.stringify(actualExports))
}
const source = 'export const meta = { name: "package-smoke", description: "installed package smoke" }\\nreturn { answer: await agent("offline-smoke", { mode: "offline" }) }'
const parsed = api.parseWorkflowScript(source, "package-smoke.js")
if (parsed.meta.name !== "package-smoke") {
  throw new Error("workflow parse returned unexpected metadata: " + JSON.stringify(parsed.meta))
}
const journalEntry = api.parseWorkflowJournalEntry('{"type":"result","key":"v2:package","agentId":"package-agent","result":{"ok":true}}')
if (journalEntry.type !== "result" || journalEntry.result.ok !== true) {
  throw new Error("journal parser returned an unexpected record: " + JSON.stringify(journalEntry))
}
const execution = await api.runWorkflowScript(source, {
  agent: async (prompt, options) => {
    if (prompt !== "offline-smoke" || options?.mode !== "offline") {
      throw new Error("injected agent received unexpected arguments")
    }
    return "package-smoke-result"
  }
})
if (JSON.stringify(execution.result) !== '{"answer":"package-smoke-result"}') {
  throw new Error("workflow returned unexpected result: " + JSON.stringify(execution.result))
}
console.log("PACKAGE_SMOKE_SUCCESS")
`

const typeSmokeSource = `
import {
  AppServerClient,
  type AppServerClientOptions,
  parseWorkflowJournalEntry,
  type WorkflowExecution,
  type WorkflowExecutionOptions,
  type WorkflowJournalEntry,
  runWorkflowScript
} from "gpt-workflow"

const clientOptions: AppServerClientOptions = {}
const executionOptions: WorkflowExecutionOptions = {
  agent: async () => "typed-offline-result"
}
const clientPromise: Promise<AppServerClient> = AppServerClient.connect(clientOptions)
const journalEntry: WorkflowJournalEntry = parseWorkflowJournalEntry(
  '{"type":"started","key":"v2:type-smoke","agentId":"type-smoke-agent"}'
)
const executionPromise: Promise<WorkflowExecution> = runWorkflowScript(
  'export const meta = { name: "type-smoke", description: "type smoke" }\\nreturn null',
  executionOptions
)
void clientPromise
void executionPromise
void journalEntry
`

const cliSmokeSource = `export const meta = {
  name: "cli-package-smoke",
  description: "installed CLI smoke"
}
phase("Package smoke")
log("installed CLI is streaming")
return { installed: true }
`

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function run(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) =>
      reject(new Error(`${label} could not start: ${error.message}`))
    )
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout)
        return
      }
      const detail = stderr.trim() || stdout.trim() || "no command output"
      reject(new Error(`${label} failed with exit code ${code}: ${detail}`))
    })
  })
}

function parsePackResult(stdout: string, label: string): PackResult {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${describe(error)}`, {
      cause: error
    })
  }
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(
      `${label} must return exactly one package result; received ${Array.isArray(value) ? value.length : "non-array JSON"}`
    )
  }
  const result = value[0] as Partial<PackResult>
  if (typeof result.filename !== "string" || !Array.isArray(result.files)) {
    throw new Error(`${label} result is missing filename or files metadata`)
  }
  for (const file of result.files) {
    if (typeof file?.path !== "string" || file.path.length === 0) {
      throw new Error(`${label} returned a file entry without a path`)
    }
  }
  return result as PackResult
}

function requireExactPaths(
  label: string,
  result: PackResult,
  expected: string[]
): void {
  const actual = result.files.map((file) => file.path)
  const duplicates = actual.filter(
    (path, index) => actual.indexOf(path) !== index
  )
  if (duplicates.length > 0) {
    throw new Error(
      `${label} returned duplicate packed paths: ${[...new Set(duplicates)].join(", ")}`
    )
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((path) => !actual.includes(path))
    const extra = actual.filter((path) => !expected.includes(path))
    throw new Error(
      `${label} packed paths differ from package.json#files; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}], expected=[${expected.join(", ")}], actual=[${actual.join(", ")}]`
    )
  }
}

async function expectedPackedPaths(): Promise<string[]> {
  const packagePath = join(repository, "package.json")
  let manifest: { files?: unknown }
  try {
    manifest = JSON.parse(await readFile(packagePath, "utf8"))
  } catch (error) {
    throw new Error(`could not read package.json: ${describe(error)}`, {
      cause: error
    })
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("package.json#files must be a nonempty exact allowlist")
  }
  if (
    manifest.files.some((path) => typeof path !== "string" || path.length === 0)
  ) {
    throw new Error(
      "every package.json#files entry must be a nonempty path string"
    )
  }
  const files = manifest.files as string[]
  if (new Set(files).size !== files.length) {
    throw new Error("package.json#files contains duplicate paths")
  }
  return [...files, "README.md", "package.json"].sort()
}

async function assertNoDebris(): Promise<void> {
  const rootTarballs = (await readdir(repository)).filter((name) =>
    name.endsWith(".tgz")
  )
  const leftovers = [
    ...((await exists(distPath)) ? ["dist"] : []),
    ...((await exists(buildInfoPath)) ? ["tsconfig.tsbuildinfo"] : []),
    ...rootTarballs
  ]
  if (leftovers.length > 0) {
    throw new Error(
      `verification debris remains in the repository: ${leftovers.join(", ")}`
    )
  }
}

async function verify(): Promise<{ paths: string[]; tarball: string }> {
  let tempRoot: string | undefined
  let failure: unknown
  let result: { paths: string[]; tarball: string } | undefined
  try {
    tempRoot = await mkdtemp(join(tmpdir(), "gpt-workflow-package-"))
    const cache = join(tempRoot, "npm-cache")
    const packDirectory = join(tempRoot, "pack")
    const consumer = join(tempRoot, "consumer")
    await mkdir(packDirectory)
    await mkdir(consumer)
    const env = { ...process.env, npm_config_cache: cache }
    const paths = await expectedPackedPaths()

    const dryRun = parsePackResult(
      await run(
        "npm pack dry run",
        "npm",
        ["pack", "--dry-run", "--json"],
        repository,
        env
      ),
      "npm pack dry run"
    )
    requireExactPaths("npm pack dry run", dryRun, paths)

    const packed = parsePackResult(
      await run(
        "npm pack",
        "npm",
        ["pack", "--json", "--pack-destination", packDirectory],
        repository,
        env
      ),
      "npm pack"
    )
    requireExactPaths("npm pack", packed, paths)
    const tarballPath = resolve(packDirectory, packed.filename)
    if (dirname(tarballPath) !== resolve(packDirectory)) {
      throw new Error(
        `npm pack filename escapes the temporary pack directory: ${packed.filename}`
      )
    }
    if (!(await exists(tarballPath))) {
      throw new Error(
        `npm pack reported a tarball that does not exist: ${packed.filename}`
      )
    }

    await writeFile(
      join(consumer, "package.json"),
      '{"name":"package-smoke","private":true,"type":"module"}\n'
    )
    await run(
      "consumer install",
      "npm",
      [
        "install",
        tarballPath,
        "@types/node@^24.0.0",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--omit=dev"
      ],
      consumer,
      env
    )
    const smoke = await run(
      "installed package smoke",
      "bun",
      ["--eval", smokeSource],
      consumer,
      env
    )
    if (smoke.trim() !== "PACKAGE_SMOKE_SUCCESS") {
      throw new Error(
        `installed package smoke returned unexpected output: ${smoke.trim() || "no output"}`
      )
    }
    await writeFile(join(consumer, "smoke.ts"), typeSmokeSource)
    await writeFile(
      join(consumer, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            lib: ["ES2022"],
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            strict: true,
            target: "ES2022",
            types: ["node"]
          },
          include: ["smoke.ts"]
        },
        null,
        2
      )}\n`
    )
    await run(
      "installed package type smoke",
      join(repository, "node_modules", ".bin", "tsc"),
      ["--project", "tsconfig.json"],
      consumer,
      env
    )
    const cliWorkflowPath = join(consumer, "cli-smoke.js")
    await writeFile(cliWorkflowPath, cliSmokeSource)
    const cliOutput = await run(
      "installed CLI smoke",
      join(consumer, "node_modules", ".bin", "gpt-workflow"),
      ["run", cliWorkflowPath],
      consumer,
      env
    )
    const cliRecords = cliOutput
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const cliTypes = cliRecords.map((record) => record.type)
    if (
      JSON.stringify(cliTypes) !==
      JSON.stringify([
        "run.started",
        "workflow.event",
        "workflow.event",
        "run.completed"
      ])
    ) {
      throw new Error(
        `installed CLI returned unexpected record types: ${JSON.stringify(cliTypes)}`
      )
    }
    if (
      !cliRecords.every(
        (record, index) =>
          record.schemaVersion === 1 && record.sequence === index
      )
    ) {
      throw new Error("installed CLI records are not ordered schema version 1")
    }
    const cliCompleted = cliRecords.at(-1)
    if (
      JSON.stringify(cliCompleted?.result) !== '{"installed":true}' ||
      typeof cliCompleted?.journalPath !== "string" ||
      typeof cliCompleted?.runDirectory !== "string" ||
      cliCompleted.journalPath !==
        join(cliCompleted.runDirectory, "journal.jsonl") ||
      !(await exists(cliCompleted.journalPath))
    ) {
      throw new Error(
        `installed CLI completion is missing its result or durable journal: ${JSON.stringify(cliCompleted)}`
      )
    }
    const cliRunId = cliCompleted.runId
    if (typeof cliRunId !== "string") {
      throw new Error("installed CLI completion is missing its run ID")
    }
    const resumedOutput = await run(
      "installed CLI resume smoke",
      join(consumer, "node_modules", ".bin", "gpt-workflow"),
      ["run", "--resume", cliRunId, cliWorkflowPath],
      consumer,
      env
    )
    const resumedRecords = resumedOutput
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const resumedStarted = resumedRecords.at(0)
    const resumedCompleted = resumedRecords.at(-1)
    if (
      resumedStarted?.resumeFromRunId !== cliRunId ||
      resumedStarted.runDirectory !== cliCompleted.runDirectory ||
      resumedCompleted?.runId !== cliRunId ||
      resumedCompleted.journalPath !== cliCompleted.journalPath
    ) {
      throw new Error(
        `installed CLI resume did not reuse the run: ${JSON.stringify(resumedRecords)}`
      )
    }
    result = { paths, tarball: packed.filename }
  } catch (error) {
    failure = error
  } finally {
    const cleanupErrors = (
      await Promise.all(
        [tempRoot, distPath, buildInfoPath]
          .filter((path): path is string => path !== undefined)
          .map(async (path) => {
            try {
              await rm(path, { force: true, recursive: true })
              return null
            } catch (error) {
              return `${path}: ${describe(error)}`
            }
          })
      )
    ).filter((error): error is string => error !== null)
    try {
      await assertNoDebris()
    } catch (error) {
      cleanupErrors.push(describe(error))
    }
    if (cleanupErrors.length > 0) {
      failure = new Error(
        `${failure === undefined ? "cleanup failed" : describe(failure)}; cleanup: ${cleanupErrors.join("; ")}`
      )
    }
  }
  if (failure !== undefined) {
    throw failure
  }
  if (result === undefined) {
    throw new Error("package verification produced no result")
  }
  return result
}

try {
  const result = await verify()
  console.log("PACKAGE_VERIFICATION: PASS")
  console.log("Packed paths:")
  for (const path of result.paths) {
    console.log(`- ${path}`)
  }
  console.log(`Tarball: ${result.tarball}`)
  console.log(
    "Smoke: SUCCESS (package import/types, offline execution, installed CLI NDJSON and journal)"
  )
  console.log("GitHub remote install: NOT PROVEN")
} catch (error) {
  console.error(`PACKAGE_VERIFICATION: FAIL\n${describe(error)}`)
  process.exitCode = 1
}
