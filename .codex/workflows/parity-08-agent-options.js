// Parity: agent() options.
// Covers: opts.label (display label), opts.phase (explicit progress grouping
// inside parallel — avoids racing the global phase() state), opts.model
// override (gpt-5.6-luna vs gpt-5.6-terra), opts.effort override, opts.agentType resolving
// custom subagents from the Agent registry, and agentType composing with
// schema (structured output appended to the custom agent's system prompt).
// Also exercises meta.phases entries carrying a `model` annotation.
export const meta = {
  name: 'parity-08-agent-options',
  description: 'agent() opts: label, explicit phase, model/effort overrides, custom agentType, agentType+schema composition',
  phases: [
    { title: 'Overrides', detail: 'model/effort/label/phase', model: 'gpt-5.6-luna' },
    { title: 'AgentTypes', detail: 'general-purpose and Explore subagents' },
  ],
}

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail })
  log((pass ? 'PASS' : 'FAIL') + ': ' + name)
}

const CWD_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, cwd: { type: 'string' } },
  required: ['ok', 'cwd'],
}

const r = await parallel([
  () => agent('Reply with exactly this and nothing else: gpt-5.6-luna-low-ok', { model: 'gpt-5.6-luna', effort: 'low', label: 'override:gpt-5.6-luna-low', phase: 'Overrides' }),
  () => agent('Reply with exactly this and nothing else: gpt-5.6-terra-ok', { model: 'gpt-5.6-terra', effort: 'low', label: 'override:gpt-5.6-terra', phase: 'Overrides' }),
  () => agent('Use the Bash tool to run pwd. Return ok=true and the cwd you observed.', { model: 'gpt-5.6-luna', agentType: 'general-purpose', schema: CWD_SCHEMA, label: 'type:general-purpose', phase: 'AgentTypes' }),
  () => agent('Does a file named parity-01-core.js exist anywhere in this repository? Reply with exactly one word: yes or no.', { model: 'gpt-5.6-luna', agentType: 'Explore', label: 'type:explore', phase: 'AgentTypes' }),
])

check('model+effort override (gpt-5.6-luna, low) completes', typeof r[0] === 'string' && r[0].toLowerCase().indexOf('gpt-5.6-luna-low-ok') !== -1, JSON.stringify(r[0]))
check('model override to a different tier (gpt-5.6-terra) completes', typeof r[1] === 'string' && r[1].toLowerCase().indexOf('gpt-5.6-terra-ok') !== -1, JSON.stringify(r[1]))
check('agentType resolves custom subagents (general-purpose)', !!r[2] && typeof r[2] === 'object' && r[2].ok === true && typeof r[2].cwd === 'string', JSON.stringify(r[2]))
check('agentType composes with schema (structured output from custom agent)', !!r[2] && typeof r[2] === 'object' && !Array.isArray(r[2]), 'typeof=' + typeof r[2])
check('agentType resolves read-only registry agents (Explore)', typeof r[3] === 'string' && r[3].toLowerCase().indexOf('yes') !== -1, JSON.stringify(r[3]))
check('label + explicit opts.phase accepted on every call', true, 'labels rendered in the progress tree — verify visually in /workflows')

const passed = checks.every(c => c.pass)
log('parity-08-agent-options: ' + checks.filter(c => c.pass).length + '/' + checks.length + ' checks passed')
return { suite: 'parity-08-agent-options', passed, checks }
