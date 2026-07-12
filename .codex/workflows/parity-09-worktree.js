// Parity: isolation: 'worktree'.
// Covers: an isolated agent running in its own git worktree (different
// toplevel path from the main checkout), file writes there never reaching
// the main tree, and leaving the worktree clean so it is auto-removed.
// The writer agent deletes its marker before finishing; isolation is proven
// by the differing toplevel paths plus the marker never appearing in main.
export const meta = {
  description:
    'isolation:"worktree": agent runs in a separate git worktree; main checkout untouched; clean worktree auto-removed',
  name: "parity-09-worktree",
  phases: [{ title: "Worktree" }]
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

const MARKER = "parity-worktree-marker.txt";

const WT_SCHEMA = {
  properties: {
    createdAndVerified: { type: "boolean" },
    toplevel: { type: "string" }
  },
  required: ["toplevel", "createdAndVerified"],
  type: "object"
};
const MAIN_SCHEMA = {
  properties: {
    markerExists: { type: "boolean" },
    toplevel: { type: "string" }
  },
  required: ["toplevel", "markerExists"],
  type: "object"
};

phase("Worktree");
const wt = await agent(
  "You are working in a git repository. Using the Bash tool: " +
    "(1) run `git rev-parse --show-toplevel` and remember the output as toplevel. " +
    "(2) create a file named " +
    MARKER +
    " at that toplevel containing the single line: worktree-isolated. " +
    "(3) run `git status --porcelain` and confirm the file shows up as untracked. " +
    "(4) delete the file again so the tree ends clean. " +
    "Return toplevel, and createdAndVerified=true only if steps 2 and 3 both worked.",
  {
    isolation: "worktree",
    label: "worktree:writer",
    model: "gpt-5.6-luna",
    phase: "Worktree",
    schema: WT_SCHEMA
  }
);
const main = await agent(
  "Using the Bash tool: run `git rev-parse --show-toplevel` and remember the output as toplevel. " +
    "Then check whether a file named " +
    MARKER +
    " exists at that toplevel. Return toplevel and markerExists.",
  {
    label: "worktree:main-checker",
    model: "gpt-5.6-luna",
    phase: "Worktree",
    schema: MAIN_SCHEMA
  }
);

check(
  "isolated agent completed inside a worktree",
  !!wt && wt.createdAndVerified === true,
  JSON.stringify(wt)
);
check(
  "non-isolated agent sees the main checkout",
  !!main && typeof main.toplevel === "string",
  JSON.stringify(main)
);
check(
  "worktree toplevel differs from the main checkout",
  !!wt &&
    !!main &&
    typeof wt.toplevel === "string" &&
    wt.toplevel !== main.toplevel,
  JSON.stringify({ main: main && main.toplevel, worktree: wt && wt.toplevel })
);
check(
  "main tree never sees the worktree file",
  !!main && main.markerExists === false,
  JSON.stringify(main && main.markerExists)
);

const passed = checks.every((c) => c.pass);
log(
  "parity-09-worktree: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, passed, suite: 'parity-09-worktree' }
