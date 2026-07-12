import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
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
  type VerificationReport
} from "../src/verification.ts"
import { checkMirror } from "./mirror.ts"

const execFileAsync = promisify(execFile)
const repository = resolve(process.cwd())
const TEST_TOTALS_PATTERN =
  /\n\s*(\d+) pass\s*\n\s*(\d+) fail\s*\n\s*(\d+) expect\(\) calls\s*\nRan \d+ tests across (\d+) files/

type CommandResult = {
  command: string
  exitCode: number
  output: string
}

export type OfflineVerificationResult = {
  exitCode: number
  report: VerificationReport
  reportPath: string
}

async function runCommand(
  command: string,
  args: string[]
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    })
    return {
      command: [command, ...args].join(" "),
      exitCode: 0,
      output: `${result.stdout}\n${result.stderr}`
    }
  } catch (error) {
    const failure = error as {
      code?: number
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      command: [command, ...args].join(" "),
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      output: `${failure.stdout ?? ""}\n${failure.stderr ?? failure.message ?? ""}`
    }
  }
}

export async function runOfflineVerification(): Promise<OfflineVerificationResult> {
  resetRedactionCount()
  const runId = newVerifierRunId()
  const writer = new VerificationArtifactWriter(runId, repository)
  await writer.open()
  const startedAt = new Date().toISOString()
  writer.appendEvent("verification.started", {
    phase: "offline",
    verifierRunId: runId
  })

  const [typecheck, tests] = await Promise.all([
    runCommand("bunx", ["tsc", "--noEmit"]),
    runCommand("bun", ["test"])
  ])
  const mirror = await checkMirror({
    sourceDirectory: join(repository, ".claude", "workflows"),
    targetDirectory: join(repository, ".codex", "workflows")
  })
  const mirrorResult: CommandResult = {
    command: "bun scripts/mirror.ts check",
    exitCode:
      mirror.missing.length === 0 &&
      mirror.extra.length === 0 &&
      mirror.drifted.length === 0
        ? 0
        : 1,
    output: JSON.stringify(mirror)
  }
  const testTotals = parseTestTotals(tests.output)
  const workflowFiles = await readdir(join(repository, ".codex", "workflows"), {
    withFileTypes: true
  })
  const discovered = workflowFiles
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort()
  const matrix = buildInvocationMatrix(discovered)
  const invocations = matrix.map(makeInvocationRecord)
  const commandEvidence = {
    mirror: { exitCode: mirrorResult.exitCode, ...mirror },
    tests: { exitCode: tests.exitCode, ...testTotals },
    typecheck: { exitCode: typecheck.exitCode }
  }
  const conditions: VerificationCondition[] = [
    condition(
      "R1",
      typecheck.exitCode === 0 &&
        tests.exitCode === 0 &&
        mirrorResult.exitCode === 0,
      commandEvidence
    ),
    condition("R2", mirrorResult.exitCode === 0, mirror),
    condition("R5", typecheck.exitCode === 0 && tests.exitCode === 0, {
      source: "offline test suite",
      testTotals
    }),
    condition("R6", typecheck.exitCode === 0 && tests.exitCode === 0, {
      source: "offline test suite",
      testTotals
    }),
    condition("R14", typecheck.exitCode === 0 && tests.exitCode === 0, {
      negativeControls: "temporary-fixture controls are exercised by tests",
      testTotals
    })
  ]
  const niceToHave = [
    condition(
      "N1",
      false,
      { reason: "requires live collaboration events", status: "skipped" },
      "skipped"
    ),
    condition(
      "N2",
      false,
      { reason: "requires live terminal progress", status: "skipped" },
      "skipped"
    ),
    condition(
      "N3",
      false,
      { reason: "requires live resume timing and usage", status: "skipped" },
      "skipped"
    )
  ]
  const allInvocations = invocations
  const totals = summarizeTotals(discovered, allInvocations)
  const report: VerificationReport = {
    artifacts: {
      browserProofPath: null,
      eventsPath: writer.eventsPath,
      reportPath: writer.reportPath
    },
    commands: [typecheck.command, tests.command, mirrorResult.command],
    commit: await gitState(),
    conditions,
    finalization: null,
    invocations: allInvocations,
    limitations: [
      "This artifact is offline-only and intentionally leaves live conditions pending.",
      "Bun node:vm is a trusted-workflow compatibility boundary, not a hostile-code sandbox."
    ],
    modelDiscovery: {
      reason: "offline verifier does not start App Server",
      status: "pending"
    },
    niceToHave,
    offlineTests: testTotals,
    outer: { durationMs: null, endedAt: new Date().toISOString(), startedAt },
    phase: "fresh",
    schemaVersion: 1,
    security: {
      eventAllowlist: eventAllowlist(),
      redactions: getRedactionCount(),
      secretScanPassed: true
    },
    totals,
    verdict:
      typecheck.exitCode === 0 &&
      tests.exitCode === 0 &&
      mirrorResult.exitCode === 0
        ? "PASS"
        : "FAIL",
    verifier: "phase-6",
    verifierRunId: runId,
    versions: {
      bun: await version("bun", ["--version"]),
      codex: await version("codex", ["--version"])
    }
  }
  const endedAt = report.outer.endedAt ?? startedAt
  report.outer.durationMs = Math.max(
    0,
    Date.parse(endedAt) - Date.parse(startedAt)
  )
  await writer.writeReport(report)
  const scan = await scanArtifactFiles([writer.reportPath, writer.eventsPath])
  report.security.secretScanPassed = scan.passed && writer.errors.length === 0
  report.verdict =
    report.verdict === "PASS" && report.security.secretScanPassed
      ? "PASS"
      : "FAIL"
  await writer.writeReport(report)
  console.log(`Offline verification report: ${writer.reportPath}`)
  console.log(
    `Offline tests: ${testTotals.passed} pass, ${testTotals.failed} fail, ${testTotals.assertions} expect() calls`
  )
  console.log(`VERDICT: ${report.verdict}`)
  return {
    exitCode: report.verdict === "PASS" ? 0 : 1,
    report,
    reportPath: writer.reportPath
  }
}

function condition(
  id: string,
  passed: boolean,
  evidence: unknown,
  status?: VerificationCondition["status"]
): VerificationCondition {
  return {
    evidence: sanitizeVerificationValue(evidence),
    id,
    status: status ?? (passed ? "passed" : "failed")
  }
}

function parseTestTotals(output: string): {
  passed: number
  failed: number
  assertions: number
  files: number | null
} {
  const summary = TEST_TOTALS_PATTERN.exec(output)
  return summary
    ? {
        assertions: Number(summary[3]),
        failed: Number(summary[2]),
        files: Number(summary[4]),
        passed: Number(summary[1])
      }
    : { assertions: 0, failed: 1, files: null, passed: 0 }
}

async function version(command: string, args: string[]): Promise<string> {
  const result = await runCommand(command, args)
  return result.exitCode === 0
    ? (result.output.trim().split("\n")[0] ?? "unknown")
    : "unavailable"
}

async function gitState(): Promise<Record<string, string | boolean>> {
  const hash = await runCommand("git", ["rev-parse", "HEAD"])
  const branch = await runCommand("git", ["branch", "--show-current"])
  const status = await runCommand("git", ["status", "--porcelain"])
  return {
    branch: branch.output.trim(),
    dirty: status.output.trim().length > 0,
    head: hash.output.trim(),
    status: status.output.trim()
  }
}

if (import.meta.main) {
  const result = await runOfflineVerification()
  process.exitCode = result.exitCode
}
