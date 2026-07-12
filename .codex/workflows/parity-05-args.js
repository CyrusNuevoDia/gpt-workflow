// Parity: args.
// Covers: the `args` global arriving VERBATIM — real objects/arrays stay
// intact (.map works), and a JSON-encoded string stays one string (the
// runtime never parses it; observed live against the reference runtime).
// Also covers `undefined` when the caller omits args, and args
// parameterizing agent prompts. Used as the child in parity-07-composition,
// so its return shape doubles as the child-return-value contract.
// Modes: 'no-args' | 'with-args' (object) | 'with-string-args'.
export const meta = {
  name: 'parity-05-args',
  description: 'args global: verbatim passthrough (objects intact, strings stay strings), undefined when omitted, parameterizes prompts',
  phases: [{ title: 'Args' }],
}

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail })
  log((pass ? 'PASS' : 'FAIL') + ': ' + name)
}

phase('Args')
if (args === undefined) {
  check('args is undefined when the caller omits it', true, 'typeof args=' + typeof args)
  log('parity-05-args: no-args mode, 1/1 checks passed')
  return { suite: 'parity-05-args', mode: 'no-args', passed: true, checks }
}

if (typeof args === 'string') {
  // The documented caveat, observed live: a JSON-encoded string reaches the
  // script as one string — verbatim means no parsing on the runtime's side.
  check('string args arrive verbatim as one string (runtime does not parse)', true, JSON.stringify(args))
  let parsed = null
  try { parsed = JSON.parse(args) } catch (e) { parsed = null }
  check('INFO string content survives unmangled (parsed keys recorded)', true, parsed && typeof parsed === 'object' ? JSON.stringify(Object.keys(parsed)) : 'not JSON')
  log('parity-05-args: with-string-args mode')
  return { suite: 'parity-05-args', mode: 'with-string-args', passed: checks.every(c => c.pass), checks, echoed: args }
}

check('args arrives as a real value, not a JSON string', typeof args === 'object' && args !== null, 'typeof=' + typeof args)
check('nested array survives verbatim (.map works)', Array.isArray(args.list) && args.list.map(x => String(x)).length === args.list.length, JSON.stringify(args.list))
check('string field arrives intact', typeof args.topic === 'string', JSON.stringify(args.topic))
check('number field arrives intact', typeof args.count === 'number', JSON.stringify(args.count))

const sentence = await agent(
  'Reply with one short sentence (under 15 words) about: ' + args.topic,
  { model: 'gpt-5.6-luna', label: 'args:consumer', phase: 'Args' },
)
check('args can parameterize agent prompts', typeof sentence === 'string' && sentence.length > 0, JSON.stringify(sentence))

const passed = checks.every(c => c.pass)
log('parity-05-args: ' + checks.filter(c => c.pass).length + '/' + checks.length + ' checks passed')
return { suite: 'parity-05-args', mode: 'with-args', passed, checks, echoed: args }
