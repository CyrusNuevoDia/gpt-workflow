// Parity: composed quality patterns at miniature scale (<=5 agents).
// Covers: the loop-until-dry skeleton (dedup vs a `seen` set, dry counter),
// a schema-driven finder over a snippet with two planted bugs, and
// adversarial verification — three refuter lenses voting in parallel with a
// majority rule in plain script code. The loop is capped at one round to
// bound cost; the control flow is what's under test.
export const meta = {
  description:
    "Quality patterns mini-scale: schema finder, dedup-vs-seen loop-until-dry skeleton, 3-lens adversarial verify with majority vote",
  name: "parity-11-patterns",
  phases: [
    { detail: "one finder over a planted-bug snippet", title: "Find" },
    {
      detail: "3 adversarial refuter lenses vote on the top finding",
      title: "Verify"
    }
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

// Two planted bugs: the loop starts at index 1, and it divides by .count
// instead of .length.
const SNIPPET = [
  "function avg(xs) {",
  "  let total = 0",
  "  for (let i = 1; i < xs.length; i++) total += xs[i]",
  "  return total / xs.count",
  "}"
].join("\n");

const FINDINGS_SCHEMA = {
  properties: {
    findings: {
      items: {
        properties: { title: { type: "string" }, why: { type: "string" } },
        required: ["title", "why"],
        type: "object"
      },
      type: "array"
    }
  },
  required: ["findings"],
  type: "object"
};
const VERDICT_SCHEMA = {
  properties: { reason: { type: "string" }, refuted: { type: "boolean" } },
  required: ["refuted", "reason"],
  type: "object"
};

const seen = new Set();
const confirmed = [];
let lastVotes = [];
let survives = null;
let dry = 0;
let rounds = 0;

while (dry < 1 && rounds < 1) {
  // loop-until-dry skeleton, capped to one round to bound cost
  rounds++;
  const found = await agent(
    "Find the bugs in this JavaScript function. Report each as a short title plus why it is a bug.\n\n" +
      SNIPPET,
    {
      label: "find:round" + rounds,
      model: "gpt-5.6-luna",
      phase: "Find",
      schema: FINDINGS_SCHEMA
    }
  );
  const findings = (found && found.findings) || [];
  const fresh = findings.filter((f) => !seen.has(f.title));
  log(
    "round " +
      rounds +
      ": " +
      findings.length +
      " findings, " +
      fresh.length +
      " fresh"
  );
  if (fresh.length === 0) {
    dry++;
    continue;
  }
  dry = 0;
  fresh.forEach((f) => seen.add(f.title));

  const top = fresh[0];
  lastVotes = (
    await parallel(
      ["correctness", "reproduction", "reading-the-code-literally"].map(
        (lens) => () =>
          agent(
            "Adversarially try to REFUTE this bug report about the code below, through the " +
              lens +
              " lens. " +
              "Set refuted=true only if the report is actually wrong; if it is a real bug, set refuted=false.\n\n" +
              "Report: " +
              top.title +
              " — " +
              top.why +
              "\n\nCode:\n" +
              SNIPPET,
            {
              effort: "low",
              label: "refute:" + lens,
              model: "gpt-5.6-luna",
              phase: "Verify",
              schema: VERDICT_SCHEMA
            }
          )
      )
    )
  ).filter(Boolean);
  survives = lastVotes.filter((v) => v.refuted === false).length >= 2;
  if (survives) {
    confirmed.push({ title: top.title, votesCollected: lastVotes.length });
  }
}

check(
  "finder returned structured findings (planted bugs found)",
  seen.size >= 1,
  "distinct findings=" + seen.size
);
check(
  "dedup-vs-seen loop skeleton ran",
  rounds === 1 && dry === 0,
  "rounds=" + rounds + " dry=" + dry
);
check(
  "all 3 adversarial refuter lenses returned verdicts",
  lastVotes.length === 3,
  "votes=" + lastVotes.length
);
check(
  "majority rule computed over refuter verdicts in plain script code",
  typeof survives === "boolean",
  JSON.stringify({ survives })
);
check(
  "INFO planted bug survived refutation (model-dependent, recorded)",
  true,
  JSON.stringify(confirmed)
);

const passed = checks.every((c) => c.pass);
log(
  "parity-11-patterns: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, confirmed, passed, suite: 'parity-11-patterns' }
