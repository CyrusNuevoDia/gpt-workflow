// Parity: parallel().
// Covers: barrier semantics (awaits all thunks), positional results, a
// throwing thunk resolving to null instead of rejecting the whole call,
// non-agent async thunks, and the .filter(Boolean) idiom for dropping
// failed slots.
export const meta = {
  description:
    "parallel(): barrier, positional results, throwing thunk -> null (call never rejects), non-agent thunks, filter(Boolean)",
  name: "parity-03-parallel",
  phases: [{ title: "Parallel" }]
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

phase("Parallel");
let rejected = null;
let results = null;
try {
  results = await parallel([
    () =>
      agent("Reply with exactly this single word and nothing else: alpha", {
        label: "par:alpha",
        model: "haiku",
        phase: "Parallel"
      }),
    () =>
      agent("Reply with exactly this single word and nothing else: beta", {
        label: "par:beta",
        model: "haiku",
        phase: "Parallel"
      }),
    () => {
      throw new Error("intentional thunk failure");
    },
    () => Promise.resolve("plain-value")
  ]);
} catch (e) {
  rejected = String((e && e.message) || e);
}

check(
  "parallel() never rejects, even with a throwing thunk",
  rejected === null,
  rejected
);
check(
  "returns one slot per thunk, positionally",
  !!results && Array.isArray(results) && results.length === 4,
  results && "length=" + results.length
);
check(
  "throwing thunk resolves to null",
  !!results && results[2] === null,
  results && JSON.stringify(results[2])
);
check(
  "agent results land in their thunk position",
  !!results &&
    typeof results[0] === "string" &&
    results[0].toLowerCase().indexOf("alpha") !== -1 &&
    typeof results[1] === "string" &&
    results[1].toLowerCase().indexOf("beta") !== -1,
  results && JSON.stringify([results[0], results[1]])
);
check(
  "non-agent async thunks are allowed",
  !!results && results[3] === "plain-value",
  results && JSON.stringify(results[3])
);
check(
  ".filter(Boolean) drops failed slots",
  !!results && results.filter(Boolean).length === 3,
  results && "kept=" + results.filter(Boolean).length
);

const passed = checks.every((c) => c.pass);
log(
  "parity-03-parallel: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, passed, suite: 'parity-03-parallel' }
