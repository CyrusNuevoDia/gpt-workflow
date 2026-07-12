// Parity: budget.
// Covers: budget.total (number | null), budget.spent() (shared-pool output
// tokens, non-negative, monotonic across an agent call), budget.remaining()
// (Infinity with no target; bounded by total otherwise), and the
// loop-until-budget guard pattern running zero iterations when no target is
// set. The hard-ceiling behavior (agent() throws past total) is only
// observable with a "+Nk" directive — see PARITY.md.
export const meta = {
  description:
    "budget: total/spent()/remaining() contract, Infinity remaining with no target, loop-until-budget guard",
  name: "parity-06-budget",
  phases: [{ title: "Budget" }]
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

phase("Budget");
check(
  "budget.total is a number or null",
  budget.total === null || typeof budget.total === "number",
  "total=" + JSON.stringify(budget.total)
);

const spentBefore = budget.spent();
check(
  "budget.spent() returns a non-negative number",
  typeof spentBefore === "number" && spentBefore >= 0,
  "spent=" + spentBefore
);

if (budget.total === null) {
  check(
    "remaining() is Infinity when no target is set",
    budget.remaining() === Number.POSITIVE_INFINITY,
    "remaining=" + budget.remaining()
  );
} else {
  const remaining = budget.remaining();
  check(
    "remaining() is bounded by [0, total] when a target is set",
    remaining >= 0 && remaining <= budget.total,
    "remaining=" + remaining + " total=" + budget.total
  );
}

await agent("Reply with exactly: budget-probe-ok", {
  label: "budget:probe",
  model: "gpt-5.6-luna",
  phase: "Budget"
});
const spentAfter = budget.spent();
check(
  "spent() is monotonic non-decreasing across an agent call",
  spentAfter >= spentBefore,
  "before=" + spentBefore + " after=" + spentAfter
);
check(
  "INFO spent() delta across one gpt-5.6-luna agent call (recorded)",
  true,
  "delta=" + (spentAfter - spentBefore)
);

// Loop-until-budget: guarded on budget.total, so with no target this runs
// zero iterations instead of looping toward the 1000-agent cap.
let iterations = 0;
while (budget.total && budget.remaining() > 50_000 && iterations < 2) {
  iterations++;
  await agent("Reply with exactly: budget-loop-ok", {
    label: "budget:loop-" + iterations,
    model: "gpt-5.6-luna",
    phase: "Budget"
  });
  log(
    "budget loop iteration " + iterations + ", remaining=" + budget.remaining()
  );
}
check(
  "loop-until-budget guard runs zero iterations with no target",
  budget.total !== null || iterations === 0,
  "iterations=" + iterations
);

const passed = checks.every((c) => c.pass);
log(
  "parity-06-budget: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, passed, suite: 'parity-06-budget' }
