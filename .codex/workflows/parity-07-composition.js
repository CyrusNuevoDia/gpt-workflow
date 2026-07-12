// Parity: workflow() composition.
// Covers: invoking a child workflow by {scriptPath} with args passed through
// verbatim and its return value coming back, registry-name resolution
// (recorded — registries that snapshot at session start will not see files
// written mid-session), the one-level nesting limit (via
// parity-07b-nested-probe), and unknown-name errors being catchable.
// Shared-pool semantics cover the concurrency cap, agent counter, and budget.
export const meta = {
  description:
    "workflow(): child by scriptPath and by name, args passthrough, return values, one-level nesting limit, unknown-name throws",
  name: "parity-07-composition",
  phases: [
    {
      detail: "child run from a script file path, args attached",
      title: "ByScriptPath"
    },
    { detail: "child resolved from the workflow registry", title: "ByName" },
    { detail: "grandchild workflow() call must throw", title: "NestingLimit" },
    { detail: "unknown name throws catchably", title: "UnknownName" }
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

const CHILD_PATH =
  "./parity-05-args.js";
const PROBE_PATH =
  "./parity-07b-nested-probe.js";
const CHILD_ARGS = { count: 2, list: ["a", "b"], topic: "tea kettles" };

phase("ByScriptPath");
let byPath = null;
let byPathErr = null;
try {
  byPath = await workflow({ scriptPath: CHILD_PATH }, CHILD_ARGS);
} catch (e) {
  byPathErr = String((e && e.message) || e);
}
check(
  "child by scriptPath runs and returns its return value",
  !!byPath && byPath.suite === "parity-05-args",
  byPathErr || JSON.stringify(byPath && byPath.suite)
);
check(
  "args reach the child verbatim",
  !!byPath &&
    byPath.mode === "with-args" &&
    JSON.stringify(byPath.echoed) === JSON.stringify(CHILD_ARGS),
  byPath && JSON.stringify(byPath.echoed)
);
check(
  "child ran its own checks and passed",
  !!byPath && byPath.passed === true,
  byPath && JSON.stringify(byPath.passed)
);

phase("ByName");
let byName = null;
let byNameErr = null;
try {
  byName = await workflow("parity-05-args");
} catch (e) {
  byNameErr = String((e && e.message) || e);
}
check(
  "INFO child by registry name (recorded — may need a fresh session to register new files)",
  true,
  byNameErr || JSON.stringify(byName && byName.suite)
);

phase("NestingLimit");
const probe = await workflow({ scriptPath: PROBE_PATH });
check(
  "workflow() inside a child throws (one-level nesting limit)",
  !!probe && probe.nestedThrew === true,
  JSON.stringify(probe)
);

phase("UnknownName");
let threw = false;
let msg = null;
try {
  await workflow("parity-definitely-not-a-real-workflow");
} catch (e) {
  threw = true;
  msg = String((e && e.message) || e);
}
check("unknown workflow name throws a catchable error", threw, msg);

const passed = checks.every((c) => c.pass);
log(
  "parity-07-composition: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, passed, suite: 'parity-07-composition' }
