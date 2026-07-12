// Parity: resume and memoization.
// Covers: the in-script leg of the resume protocol. Three SEQUENTIAL agents
// pull nonces from true entropy (Bash: openssl rand -hex 8) — a live
// execution mints a fresh nonce, a journal replay returns the recorded one
// byte-for-byte. So nonce equality across runs is in-band proof of replay:
// no clock, no token counter, no journal access needed inside the script.
// Cross-run assertions live in the runner protocol: run this suite three times
// and diff the echoed nonces:
//   R1 fresh,      args {salt:'s1'}  -> record nonces + runId
//   R2 resume(R1), args {salt:'s1'}  -> all nonces identical, 0 subagent tokens
//   R3 resume(R1), args {salt:'s2'}  -> nonce A identical (unchanged prefix
//                                       replays); B fresh (changed call runs
//                                       live); C pins the semantics — fresh
//                                       => prefix memoization, identical =>
//                                       per-key cache.
// Agents A and C have distinct fixed prompts (identical (prompt, opts) would
// share a memoization key and confound the probe). Calls are deliberately
// sequential — "prefix" is only well-defined against a deterministic order.
export const meta = {
  description:
    "resumeFromRunId: entropy nonces expose which agents ran live vs replayed from the journal; run the 3-leg resume protocol",
  name: "parity-12-resume",
  phases: [
    { detail: "A fixed -> B salted -> C fixed, sequential", title: "Nonces" }
  ]
};

const checks = [];
function check(name, pass, detail) {
  checks.push({
    detail: detail === undefined ? null : detail,
    name,
    pass: !!pass
  });
  log((pass ? "PASS" : "FAIL") + ": " + name);
}

const HEX16 = /^[0-9a-f]{16}$/;
function noncePrompt(marker) {
  return (
    "Marker: " +
    marker +
    "\n" +
    "Use the Bash tool to run exactly this command: openssl rand -hex 8\n" +
    "Then return only the command stdout: 16 lowercase hex characters, nothing else."
  );
}

phase("Nonces");
// Tolerate the string-args arrival mode covered by parity-05: the runner can't
// always control whether args
// cross the tool-call boundary as an object or a JSON-encoded string, and the
// parse is deterministic so prompt hashes stay stable across legs.
let input = args;
if (typeof input === "string") {
  try {
    input = JSON.parse(input);
  } catch (e) {
    input = null;
  }
}
const salt = input && typeof input.salt === "string" ? input.salt : null;
check(
  "runner passed args.salt (this suite is one leg of a 3-run protocol)",
  salt !== null,
  "args=" + JSON.stringify(args === undefined ? null : args)
);
check(
  "INFO args arrival mode this leg",
  true,
  args === undefined
    ? "undefined"
    : typeof args === "string"
      ? "JSON-encoded string"
      : typeof args
);
if (salt === null) {
  return { checks, nonces: null, passed: false, salt: null, suite: 'parity-12-resume' }
}
log("leg: salt=" + JSON.stringify(salt));

const rawA = await agent(
  noncePrompt("alpha — fixed prompt, before the salted call"),
  { label: "resume:A-fixed", model: "gpt-5.6-luna", phase: "Nonces" }
);
const rawB = await agent(
  noncePrompt(
    "salted " + JSON.stringify(salt) + " — cache-busted by changing args.salt"
  ),
  { label: "resume:B-salted", model: "gpt-5.6-luna", phase: "Nonces" }
);
const rawC = await agent(
  noncePrompt("charlie — fixed prompt, after the salted call"),
  { label: "resume:C-fixed", model: "gpt-5.6-luna", phase: "Nonces" }
);

const a = typeof rawA === "string" ? rawA.trim() : rawA;
const b = typeof rawB === "string" ? rawB.trim() : rawB;
const c = typeof rawC === "string" ? rawC.trim() : rawC;
check(
  "nonce A is 16-char hex entropy from Bash",
  typeof a === "string" && HEX16.test(a),
  JSON.stringify(a)
);
check(
  "nonce B is 16-char hex entropy from Bash",
  typeof b === "string" && HEX16.test(b),
  JSON.stringify(b)
);
check(
  "nonce C is 16-char hex entropy from Bash",
  typeof c === "string" && HEX16.test(c),
  JSON.stringify(c)
);
check(
  "INFO nonces echoed for the runner to diff across legs",
  true,
  JSON.stringify({ a, b, c, salt })
);

const passed = checks.every((x) => x.pass);
log(
  "parity-12-resume: " +
    checks.filter((x) => x.pass).length +
    "/" +
    checks.length +
    " in-script checks passed (cross-run checks are the runner's)"
);
return { checks, nonces: { a, b, c }, passed, salt, suite: 'parity-12-resume' }
