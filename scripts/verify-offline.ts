import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { promisify } from "node:util"
import { join, resolve } from "node:path"
import { generateBriefHTML } from "../src/brief.ts"
import {
  buildInvocationMatrix,
  eventAllowlist,
  getRedactionCount,
  makeInvocationRecord,
  newVerifierRunId,
  resetRedactionCount,
  sanitizeVerificationValue,
  scanArtifactFiles,
  summarizeTotals,
  VerificationArtifactWriter,
  type VerificationCondition,
  type VerificationReport,
} from "../src/verification.ts"
import { checkMirror } from "./mirror.ts"

const execFileAsync = promisify(execFile)
const repository = resolve(process.cwd())

interface CommandResult {
  command: string
  exitCode: number
  output: string
}

export interface OfflineVerificationResult {
  exitCode: number
  reportPath: string
  report: VerificationReport
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, { cwd: repository, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
    return { command: [command, ...args].join(" "), exitCode: 0, output: `${result.stdout}\n${result.stderr}` }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      command: [command, ...args].join(" "),
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      output: `${failure.stdout ?? ""}\n${failure.stderr ?? failure.message ?? ""}`,
    }
  }
}

export async function runOfflineVerification(): Promise<OfflineVerificationResult> {
  resetRedactionCount()
  const runId = newVerifierRunId()
  const writer = new VerificationArtifactWriter(runId, repository)
  await writer.open()
  const startedAt = new Date().toISOString()
  writer.appendEvent("verification.started", { verifierRunId: runId, phase: "offline" })

  const [typecheck, tests] = await Promise.all([
    runCommand("bunx", ["tsc", "--noEmit"]),
    runCommand("bun", ["test"]),
  ])
  const mirror = await checkMirror({ sourceDirectory: join(repository, ".claude", "workflows"), targetDirectory: join(repository, ".codex", "workflows") })
  const mirrorResult: CommandResult = {
    command: "bun scripts/mirror.ts check",
    exitCode: mirror.missing.length === 0 && mirror.extra.length === 0 && mirror.drifted.length === 0 ? 0 : 1,
    output: JSON.stringify(mirror),
  }
  const testTotals = parseTestTotals(tests.output)
  const workflowFiles = await readdir(join(repository, ".codex", "workflows"), { withFileTypes: true })
  const discovered = workflowFiles.filter((entry) => entry.isFile() && entry.name.endsWith(".js")).map((entry) => entry.name).sort()
  const matrix = buildInvocationMatrix(discovered)
  const invocations = matrix.map(makeInvocationRecord)
  const commandEvidence = {
    typecheck: { exitCode: typecheck.exitCode },
    tests: { exitCode: tests.exitCode, ...testTotals },
    mirror: { exitCode: mirrorResult.exitCode, ...mirror },
  }
  const conditions: VerificationCondition[] = [
    condition("R1", typecheck.exitCode === 0 && tests.exitCode === 0 && mirrorResult.exitCode === 0, commandEvidence),
    condition("R2", mirrorResult.exitCode === 0, mirror),
    condition("R5", typecheck.exitCode === 0 && tests.exitCode === 0, { testTotals, source: "offline test suite" }),
    condition("R6", typecheck.exitCode === 0 && tests.exitCode === 0, { testTotals, source: "offline test suite" }),
    condition("R14", typecheck.exitCode === 0 && tests.exitCode === 0, { negativeControls: "temporary-fixture controls are exercised by tests", testTotals }),
  ]
  const niceToHave = [
    condition("N1", false, { status: "skipped", reason: "requires live collaboration events" }, "skipped"),
    condition("N2", false, { status: "skipped", reason: "requires live terminal progress" }, "skipped"),
    condition("N3", false, { status: "skipped", reason: "requires live resume timing and usage" }, "skipped"),
  ]
  const allInvocations = invocations
  const totals = summarizeTotals(discovered, allInvocations)
  const report: VerificationReport = {
    schemaVersion: 1,
    verifierRunId: runId,
    verifier: "phase-6",
    phase: "fresh",
    verdict: typecheck.exitCode === 0 && tests.exitCode === 0 && mirrorResult.exitCode === 0 ? "PASS" : "FAIL",
    outer: { startedAt, endedAt: new Date().toISOString(), durationMs: null },
    versions: { bun: await version("bun", ["--version"]), codex: await version("codex", ["--version"]) },
    commit: await gitState(),
    commands: [typecheck.command, tests.command, mirrorResult.command],
    offlineTests: testTotals,
    modelDiscovery: { status: "pending", reason: "offline verifier does not start App Server" },
    conditions,
    niceToHave,
    invocations: allInvocations,
    totals,
    artifacts: { reportPath: writer.reportPath, eventsPath: writer.eventsPath, briefPath: join(writer.directory, "BRIEF.html"), browserProofPath: null },
    limitations: ["This artifact is offline-only and intentionally leaves live conditions pending.", "Bun node:vm is a trusted-workflow compatibility boundary, not a hostile-code sandbox."],
    security: { secretScanPassed: true, redactions: getRedactionCount(), eventAllowlist: eventAllowlist() },
    finalization: null,
  }
  report.outer.durationMs = Math.max(0, Date.parse(report.outer.endedAt!) - Date.parse(startedAt))
  const commits = await gitHistory()
  await writer.writeReport(report)
  await Bun.write(report.artifacts.briefPath, generateBriefHTML(report, commits, repository))
  const scan = await scanArtifactFiles([writer.reportPath, writer.eventsPath, report.artifacts.briefPath])
  report.security.secretScanPassed = scan.passed && writer.errors.length === 0
  report.verdict = report.verdict === "PASS" && report.security.secretScanPassed ? "PASS" : "FAIL"
  await writer.writeReport(report)
  console.log(`Offline verification report: ${writer.reportPath}`)
  console.log(`Offline tests: ${testTotals.passed} pass, ${testTotals.failed} fail, ${testTotals.assertions} expect() calls`)
  console.log(`VERDICT: ${report.verdict}`)
  return { exitCode: report.verdict === "PASS" ? 0 : 1, reportPath: writer.reportPath, report }
}

function condition(id: string, passed: boolean, evidence: unknown, status?: VerificationCondition["status"]): VerificationCondition {
  return { id, status: status ?? (passed ? "passed" : "failed"), evidence: sanitizeVerificationValue(evidence) }
}

function parseTestTotals(output: string): { passed: number; failed: number; assertions: number; files: number | null } {
  const summary = /\n\s*(\d+) pass\s*\n\s*(\d+) fail\s*\n\s*(\d+) expect\(\) calls\s*\nRan \d+ tests across (\d+) files/.exec(output)
  return summary
    ? { passed: Number(summary[1]), failed: Number(summary[2]), assertions: Number(summary[3]), files: Number(summary[4]) }
    : { passed: 0, failed: 1, assertions: 0, files: null }
}

async function version(command: string, args: string[]): Promise<string> {
  const result = await runCommand(command, args)
  return result.exitCode === 0 ? result.output.trim().split("\n")[0] ?? "unknown" : "unavailable"
}

async function gitState(): Promise<Record<string, string | boolean>> {
  const hash = await runCommand("git", ["rev-parse", "HEAD"])
  const branch = await runCommand("git", ["branch", "--show-current"])
  const status = await runCommand("git", ["status", "--porcelain"])
  return { head: hash.output.trim(), branch: branch.output.trim(), dirty: status.output.trim().length > 0, status: status.output.trim() }
}

async function gitHistory(): Promise<Array<{ hash: string; subject: string; date: string }>> {
  const result = await runCommand("git", ["log", "--format=%H%x09%ad%x09%s", "--date=short"])
  return result.output.trim().split("\n").filter(Boolean).map((line) => {
    const [hash = "", date = "", ...subject] = line.split("\t")
    return { hash, date, subject: subject.join("\t") }
  })
}

if (import.meta.main) {
  const result = await runOfflineVerification()
  process.exitCode = result.exitCode
}
