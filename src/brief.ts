import { writeFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import type { VerificationCondition, VerificationJSON, VerificationReport } from "./verification.ts"
import { redactText } from "./verification.ts"

export interface BriefCommit {
  hash: string
  subject: string
  date: string
}

export function generateBriefHTML(
  report: VerificationReport,
  commits: BriefCommit[],
  repository = process.cwd(),
): string {
  const condition = (id: string): VerificationCondition | undefined => report.conditions.find((entry) => entry.id === id)
  const evidence = (id: string): VerificationJSON => condition(id)?.evidence ?? null
  const artifactLink = (path: string): string => relative(repository, path).replaceAll("\\", "/")
  const statusClass = (status: string): string => status === "passed" ? "pass" : status === "failed" ? "fail" : "pending"
  const statusLabel = (status: string): string => status.toUpperCase()
  const invocationRows = report.invocations.map((invocation) => `
    <tr>
      <td><code>${escapeHTML(invocation.id)}</code></td>
      <td>${escapeHTML(invocation.file)}</td>
      <td>${escapeHTML(invocation.mode)}</td>
      <td class="${statusClass(invocation.status)}">${statusLabel(invocation.status)}</td>
      <td>${invocation.checks.nonInfoFailures.length === 0 ? `${invocation.checks.nonInfo}/${invocation.checks.total}` : escapeHTML(invocation.checks.nonInfoFailures.join(", "))}</td>
    </tr>`).join("")
  const conditionRows = [...report.conditions, ...report.niceToHave].map((entry) => `
    <tr><td><code>${escapeHTML(entry.id)}</code></td><td class="${statusClass(entry.status)}">${statusLabel(entry.status)}</td><td>${escapeHTML(compact(entry.evidence))}</td></tr>`).join("")
  const commitRows = commits.map((commit) => `<li><code>${escapeHTML(commit.hash.slice(0, 12))}</code> ${escapeHTML(commit.subject)} <small>${escapeHTML(commit.date)}</small></li>`).join("")
  const reportPath = artifactLink(report.artifacts.reportPath)
  const eventsPath = artifactLink(report.artifacts.eventsPath)
  const briefPath = artifactLink(report.artifacts.briefPath)
  const resumeEvidence = evidence("R11")
  const streamEvidence = evidence("R9")
  const steerEvidence = evidence("R10")
  const interruptionEvidence = steerEvidence !== null && typeof steerEvidence === "object" && !Array.isArray(steerEvidence)
    ? steerEvidence.interruption ?? null
    : null
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GPT Workflow Phase 6 Review</title>
<style>
:root{color-scheme:light;--ink:#17202a;--muted:#5c6873;--line:#d9e0e6;--surface:#fff;--wash:#f4f7f9;--green:#087443;--red:#b42318;--amber:#9a6700}
*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 24px 56px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}.eyebrow{color:var(--muted);font-size:12px;letter-spacing:.12em;text-transform:uppercase}h1{font-size:34px;line-height:1.08;margin:6px 0 8px}h2{font-size:20px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}.lede{color:var(--muted);max-width:720px;margin:0}.verdict{border:2px solid;padding:12px 18px;border-radius:12px;font-weight:800;letter-spacing:.08em}.verdict.pass{color:var(--green);border-color:#63b88e;background:#effaf4}.verdict.fail{color:var(--red);border-color:#e9a39d;background:#fff2f0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}.metric{font-size:26px;font-weight:800}.label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.wide{grid-column:span 2}.full{grid-column:1/-1}.architecture{display:grid;grid-template-columns:1fr 1fr;gap:16px}.boundary{border-left:3px solid #4c82c3;padding-left:12px}.boundary.vm{border-color:#a65cc7}.boundary p{margin:4px 0;color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:8px}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.pass{color:var(--green);font-weight:700}.fail{color:var(--red);font-weight:700}.pending{color:var(--amber);font-weight:700}.links a{display:inline-block;margin:0 12px 8px 0;color:#175cd3}.proof{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.proof .card{background:#fbfcfd}.notes{margin:0;padding-left:18px}.notes li{margin:5px 0}.small{font-size:12px;color:var(--muted)}button{border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:7px 10px;color:var(--ink);cursor:pointer}@media(max-width:820px){.hero,.architecture{display:block}.verdict{display:inline-block;margin-top:16px}.grid,.proof{grid-template-columns:repeat(2,minmax(0,1fr))}.wide{grid-column:span 2}}@media(max-width:560px){main{padding:20px 14px}.grid,.proof{display:block}.card{margin-bottom:12px}.wide{display:block}h1{font-size:28px}table{display:block;overflow-x:auto;white-space:nowrap}}
</style></head><body><main>
<header class="hero"><div><div class="eyebrow">GPT Workflow Runtime · Phase 6</div><h1>Morning review brief</h1><p class="lede">A report-backed review of the Bun workflow VM, the Codex App Server boundary, the complete invocation matrix, and the resume proof.</p></div><div class="verdict ${report.verdict === "PASS" ? "pass" : "fail"}">${escapeHTML(report.verdict)}</div></header>
<section class="grid">
  ${metric("Discovered workflows", report.totals.discoveredWorkflows)}
  ${metric("Required invocations", report.totals.requiredInvocations)}
  ${metric("Completed / passed", `${report.totals.completedInvocations} / ${report.totals.passedInvocations}`)}
  ${metric("Pending / skipped", `${report.totals.pendingInvocations} / ${report.totals.skippedInvocations}`)}
  ${metric("Failed / interrupted", `${report.totals.failedInvocations} / ${report.totals.interruptedInvocations}`)}
  ${metric("Absorbed failures", report.totals.absorbedAgentFailures)}
  ${metric("All Luna calls", `${report.totals.luna.logicalCalls} (${report.totals.luna.liveCalls} live / ${report.totals.luna.replayedCalls} replay)`)}
  ${metric("All Terra calls", `${report.totals.terra.logicalCalls} (${report.totals.terra.liveCalls} live / ${report.totals.terra.replayedCalls} replay)`)}
  ${metric("Subagent tokens", report.totals.luna.subagentTokens + report.totals.terra.subagentTokens + report.totals.otherModels.subagentTokens)}
  ${metric("Offline tests", `${report.offlineTests.passed} pass / ${report.offlineTests.failed} fail · ${report.offlineTests.assertions} assertions`)}
  ${metric("Duration", report.outer.durationMs === null ? "pending" : `${report.outer.durationMs} ms`)}
</section>
<section class="card full architecture"><div class="boundary vm"><h2>Bun workflow VM</h2><p>Loads literal metadata, runs trusted workflow JavaScript in a controlled <code>node:vm</code> context, owns deterministic orchestration, scheduling, composition, caps, journaling, result validation, and artifact generation.</p></div><div class="boundary"><h2>Codex App Server</h2><p>Runs as the live control plane over JSON-RPC stdio. The runtime performs initialization and model discovery, starts threads and turns, consumes authoritative completed items, normalizes progress, steers active turns, and interrupts isolated siblings.</p></div></section>
<section class="grid"><div class="card wide"><h2>Streaming and control proof</h2><div class="proof"><div class="card"><h3>R9 · stream</h3><p>${escapeHTML(compact(streamEvidence))}</p></div><div class="card"><h3>R10 · steer</h3><p>${escapeHTML(compact(steerEvidence))}</p></div><div class="card"><h3>R10 · interrupt</h3><p>${escapeHTML(compact(interruptionEvidence))}</p></div></div></div><div class="card wide"><h2>Resume proof</h2><p>${escapeHTML(compact(resumeEvidence))}</p><p class="small">The verifier derives expected journal coverage from the live-call counts in the three legs; it does not compare against a provider-specific token or timing total.</p></div></section>
<section class="card full"><h2>Exact invocation matrix</h2><table><thead><tr><th>ID</th><th>Workflow</th><th>Mode</th><th>Status</th><th>Checks</th></tr></thead><tbody>${invocationRows}</tbody></table></section>
<section class="card full"><h2>Required and nice-to-have conditions</h2><table><thead><tr><th>Condition</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${conditionRows}</tbody></table></section>
<section class="grid"><div class="card wide"><h2>Artifacts</h2><p class="links"><a href="${escapeHTML(reportPath)}">report.json</a><a href="${escapeHTML(eventsPath)}">events.jsonl</a><a href="${escapeHTML(briefPath)}">BRIEF.html</a></p><p class="small">Run <code>${escapeHTML(report.verifierRunId)}</code>. The event stream is append-only and allowlisted; raw protocol payloads and environment values are excluded.</p></div><div class="card wide"><h2>Limitations and failures</h2><ul class="notes">${report.limitations.map((item) => `<li>${escapeHTML(item)}</li>`).join("") || "<li>None recorded.</li>"}</ul></div></section>
<section class="card full"><h2>Logical implementation history</h2><ul class="notes">${commitRows || "<li>No commits supplied.</li>"}</ul></section>
<p class="small">Generated from the machine-readable report and local git history only. <button type="button" onclick="navigator.clipboard?.writeText(document.title)">Copy title</button></p>
<script>document.documentElement.dataset.verifierRunId=${JSON.stringify(report.verifierRunId)};</script>
</main></body></html>`
}

export async function writeBriefHTML(path: string, report: VerificationReport, commits: BriefCommit[], repository = process.cwd()): Promise<void> {
  await writeFile(resolve(path), generateBriefHTML(report, commits, repository))
}

function metric(label: string, value: string | number): string {
  return `<div class="card"><div class="label">${escapeHTML(label)}</div><div class="metric">${escapeHTML(String(value))}</div></div>`
}

function compact(value: VerificationJSON): string {
  if (value === null) return "No evidence recorded."
  return redactText(JSON.stringify(value))
}

function escapeHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}
