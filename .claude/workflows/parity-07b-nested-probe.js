// Parity: nesting probe (companion to parity-07-composition).
// Calls workflow() itself — by scriptPath, so a throw can only mean the
// nesting limit, never name resolution — and reports whether that threw.
// Run directly (nesting level 1) the inner call succeeds -> nestedThrew=false.
// Run as a child of parity-07-composition (nesting level 2) the inner call
// must throw -> nestedThrew=true, proving the one-level nesting limit is
// catchable in the child script rather than killing the run.
export const meta = {
  description:
    "Nesting probe: calls workflow() and reports whether it threw (one-level nesting limit)",
  name: "parity-07b-nested-probe",
  phases: [{ title: "Probe" }]
};

phase("Probe");
try {
  const child = await workflow({
    scriptPath:
      "./parity-05-args.js"
  });
  log("inner workflow() succeeded — running at top level");
  return { childSuite: (child && child.suite) || null, nestedThrew: false, suite: 'parity-07b-nested-probe' }
} catch (e) {
  const message = String((e && e.message) || e);
  log("inner workflow() threw — running as a child: " + message);
  return { message, nestedThrew: true, suite: 'parity-07b-nested-probe' }
}
