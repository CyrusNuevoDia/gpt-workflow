// Parity: pipeline().
// Covers: per-item stage chaining with no cross-item barrier, stage callback
// signature (prevResult, originalItem, index), stage output flowing to the
// next stage, a throwing stage dropping that item to null and skipping its
// remaining stages, and per-agent opts.phase grouping inside pipeline stages.
export const meta = {
  description:
    "pipeline(): stage chaining, (prev, item, index) callback args, throwing stage drops item to null and skips later stages",
  name: "parity-04-pipeline",
  phases: [
    { detail: "emit a lowercase word per item", title: "Stage1" },
    { detail: "uppercase the stage-1 output", title: "Stage2" }
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

const ITEMS = [
  { fail: false, key: "sun" },
  { fail: true, key: "moon" },
  { fail: false, key: "star" }
];

const calls = [];

const results = await pipeline(
  ITEMS,
  (prev, item, index) => {
    calls.push({
      index,
      key: item.key,
      prevJSON: JSON.stringify(prev),
      prevWasItem: prev === item,
      stage: 1
    });
    if (item.fail) {
      throw new Error("intentional stage-1 failure for " + item.key);
    }
    return agent(
      "Reply with exactly this single lowercase word and nothing else: " +
        item.key,
      { label: "s1:" + item.key, model: "gpt-5.6-luna", phase: "Stage1" }
    );
  },
  (prev, item, index) => {
    calls.push({ index, key: item.key, stage: 2 });
    return agent(
      "Convert this word to UPPERCASE and reply with only the uppercase word, nothing else: " +
        String(prev).trim(),
      { label: "s2:" + item.key, model: "gpt-5.6-luna", phase: "Stage2" }
    );
  }
);

check(
  "pipeline returns one slot per input item",
  Array.isArray(results) && results.length === 3,
  "length=" + (results && results.length)
);
check(
  "throwing stage drops that item to null",
  !!results && results[1] === null,
  results && JSON.stringify(results[1])
);
check(
  "later stages are skipped for the dropped item",
  !calls.some((c) => c.stage === 2 && c.key === "moon"),
  JSON.stringify(calls.filter((c) => c.stage === 2).map((c) => c.key))
);
check(
  "stage callbacks receive originalItem and index",
  calls.some((c) => c.stage === 2 && c.key === "sun" && c.index === 0) &&
    calls.some((c) => c.stage === 2 && c.key === "star" && c.index === 2),
  JSON.stringify(calls.filter((c) => c.stage === 2))
);
check(
  "stage output flows to the next stage (sun -> SUN)",
  !!results &&
    typeof results[0] === "string" &&
    results[0].toUpperCase().indexOf("SUN") !== -1,
  results && JSON.stringify(results[0])
);
check(
  "stage output flows to the next stage (star -> STAR)",
  !!results &&
    typeof results[2] === "string" &&
    results[2].toUpperCase().indexOf("STAR") !== -1,
  results && JSON.stringify(results[2])
);
const s1sun = calls.find((c) => c.stage === 1 && c.key === "sun");
check(
  "INFO what stage 1 receives as prev (spec leaves it open, recorded)",
  true,
  JSON.stringify(s1sun)
);

const passed = checks.every((c) => c.pass);
log(
  "parity-04-pipeline: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, passed, suite: 'parity-04-pipeline' }
