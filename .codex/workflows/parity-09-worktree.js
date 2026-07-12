// Parity: isolation: 'worktree'.
// Covers: an isolated agent running in its own git worktree (different
// toplevel path from the main checkout), file writes there never reaching
// the main tree, and leaving the worktree clean so it is auto-removed.
// The writer agent deletes its marker before finishing; isolation is proven
// by the differing toplevel paths plus the marker never appearing in main.
export const meta = {
  name: 'parity-09-worktree',
  description: 'isolation:"worktree": agent runs in a separate git worktree; main checkout untouched; clean worktree auto-removed',
  phases: [{ title: 'Worktree' }],
}

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail })
  log((pass ? 'PASS' : 'FAIL') + ': ' + name)
}

const MARKER = 'parity-worktree-marker.txt'

const WT_SCHEMA = {
  type: 'object',
  properties: { toplevel: { type: 'string' }, createdAndVerified: { type: 'boolean' } },
  required: ['toplevel', 'createdAndVerified'],
}
const MAIN_SCHEMA = {
  type: 'object',
  properties: { toplevel: { type: 'string' }, markerExists: { type: 'boolean' } },
  required: ['toplevel', 'markerExists'],
}

phase('Worktree')
const wt = await agent(
  'You are working in a git repository. Using the Bash tool: ' +
  '(1) run `git rev-parse --show-toplevel` and remember the output as toplevel. ' +
  '(2) create a file named ' + MARKER + ' at that toplevel containing the single line: worktree-isolated. ' +
  '(3) run `git status --porcelain` and confirm the file shows up as untracked. ' +
  '(4) delete the file again so the tree ends clean. ' +
  'Return toplevel, and createdAndVerified=true only if steps 2 and 3 both worked.',
  { model: 'gpt-5.6-luna', isolation: 'worktree', schema: WT_SCHEMA, label: 'worktree:writer', phase: 'Worktree' },
)
const main = await agent(
  'Using the Bash tool: run `git rev-parse --show-toplevel` and remember the output as toplevel. ' +
  'Then check whether a file named ' + MARKER + ' exists at that toplevel. Return toplevel and markerExists.',
  { model: 'gpt-5.6-luna', schema: MAIN_SCHEMA, label: 'worktree:main-checker', phase: 'Worktree' },
)

check('isolated agent completed inside a worktree', !!wt && wt.createdAndVerified === true, JSON.stringify(wt))
check('non-isolated agent sees the main checkout', !!main && typeof main.toplevel === 'string', JSON.stringify(main))
check('worktree toplevel differs from the main checkout', !!wt && !!main && typeof wt.toplevel === 'string' && wt.toplevel !== main.toplevel, JSON.stringify({ worktree: wt && wt.toplevel, main: main && main.toplevel }))
check('main tree never sees the worktree file', !!main && main.markerExists === false, JSON.stringify(main && main.markerExists))

const passed = checks.every(c => c.pass)
log('parity-09-worktree: ' + checks.filter(c => c.pass).length + '/' + checks.length + ' checks passed')
return { suite: 'parity-09-worktree', passed, checks }
