// Parity: pipeline().
// Covers: per-item stage chaining with no cross-item barrier, stage callback
// signature (prevResult, originalItem, index), stage output flowing to the
// next stage, a throwing stage dropping that item to null and skipping its
// remaining stages, and per-agent opts.phase grouping inside pipeline stages.
export const meta = {
  name: 'parity-04-pipeline',
  description: 'pipeline(): stage chaining, (prev, item, index) callback args, throwing stage drops item to null and skips later stages',
  phases: [
    { title: 'Stage1', detail: 'emit a lowercase word per item' },
    { title: 'Stage2', detail: 'uppercase the stage-1 output' },
  ],
}

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail })
  log((pass ? 'PASS' : 'FAIL') + ': ' + name)
}

const ITEMS = [
  { key: 'sun', fail: false },
  { key: 'moon', fail: true },
  { key: 'star', fail: false },
]

const calls = []

const results = await pipeline(
  ITEMS,
  (prev, item, index) => {
    calls.push({ stage: 1, key: item.key, index, prevWasItem: prev === item, prevJSON: JSON.stringify(prev) })
    if (item.fail) throw new Error('intentional stage-1 failure for ' + item.key)
    return agent('Reply with exactly this single lowercase word and nothing else: ' + item.key, { model: 'haiku', label: 's1:' + item.key, phase: 'Stage1' })
  },
  (prev, item, index) => {
    calls.push({ stage: 2, key: item.key, index })
    return agent('Convert this word to UPPERCASE and reply with only the uppercase word, nothing else: ' + String(prev).trim(), { model: 'haiku', label: 's2:' + item.key, phase: 'Stage2' })
  },
)

check('pipeline returns one slot per input item', Array.isArray(results) && results.length === 3, 'length=' + (results && results.length))
check('throwing stage drops that item to null', !!results && results[1] === null, results && JSON.stringify(results[1]))
check('later stages are skipped for the dropped item', !calls.some(c => c.stage === 2 && c.key === 'moon'), JSON.stringify(calls.filter(c => c.stage === 2).map(c => c.key)))
check('stage callbacks receive originalItem and index', calls.some(c => c.stage === 2 && c.key === 'sun' && c.index === 0) && calls.some(c => c.stage === 2 && c.key === 'star' && c.index === 2), JSON.stringify(calls.filter(c => c.stage === 2)))
check('stage output flows to the next stage (sun -> SUN)', !!results && typeof results[0] === 'string' && results[0].toUpperCase().indexOf('SUN') !== -1, results && JSON.stringify(results[0]))
check('stage output flows to the next stage (star -> STAR)', !!results && typeof results[2] === 'string' && results[2].toUpperCase().indexOf('STAR') !== -1, results && JSON.stringify(results[2]))
const s1sun = calls.find(c => c.stage === 1 && c.key === 'sun')
check('INFO what stage 1 receives as prev (spec leaves it open, recorded)', true, JSON.stringify(s1sun))

const passed = checks.every(c => c.pass)
log('parity-04-pipeline: ' + checks.filter(c => c.pass).length + '/' + checks.length + ' checks passed')
return { suite: 'parity-04-pipeline', passed, checks }
