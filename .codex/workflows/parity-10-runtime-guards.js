// Parity: determinism + sandbox guards. Spawns ZERO agents — also proves a
// workflow can run and return without any agent() calls.
// Covers: Date.now() / Math.random() / argless new Date() throwing (they
// would break resume), new Date(ms) with an argument still working, standard
// JS built-ins being available, no Node.js require(), and the 4096-item cap
// on a single parallel() call being an explicit error.
export const meta = {
  name: 'parity-10-runtime-guards',
  description: 'Zero-agent run + guards: Date.now/Math.random/argless new Date throw, built-ins work, no require(), 4096-item cap',
  phases: [{ title: 'Guards' }],
}

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail })
  log((pass ? 'PASS' : 'FAIL') + ': ' + name)
}

function throws(fn) {
  try { fn(); return { threw: false } } catch (e) { return { threw: true, message: String((e && e.message) || e) } }
}

phase('Guards')
const dateNow = throws(() => Date.now())
check('Date.now() throws', dateNow.threw, dateNow.message || 'no error')

const mathRandom = throws(() => Math.random())
check('Math.random() throws', mathRandom.threw, mathRandom.message || 'no error')

const arglessDate = throws(() => new Date())
check('argless new Date() throws', arglessDate.threw, arglessDate.message || 'no error')

const argDate = throws(() => {
  const d = new Date(1700000000000)
  if (d.getUTCFullYear() !== 2023) throw new Error('wrong year: ' + d.getUTCFullYear())
})
check('new Date(ms) with an argument works', !argDate.threw, argDate.message || 'ok')

check('standard built-ins available (Math, JSON, Array)',
  Math.max(2, 7) === 7 &&
  JSON.parse(JSON.stringify({ a: [1, 2] })).a.length === 2 &&
  Array.from({ length: 3 }, (_, i) => i).join('') === '012',
  null)

check('require() is not available', typeof require === 'undefined', 'typeof require=' + typeof require)
check('INFO typeof process (recorded, always passes)', true, 'typeof process=' + typeof process)

let capResult = null
try {
  await parallel(Array.from({ length: 4097 }, (_, i) => () => Promise.resolve(i)))
  capResult = { threw: false }
} catch (e) {
  capResult = { threw: true, message: String((e && e.message) || e) }
}
check('parallel() with more than 4096 items is an explicit error', capResult.threw, capResult.message || 'no error — 4097 thunks executed silently')

const passed = checks.every(c => c.pass)
log('parity-10-runtime-guards: ' + checks.filter(c => c.pass).length + '/' + checks.length + ' checks passed')
return { suite: 'parity-10-runtime-guards', passed, checks }
