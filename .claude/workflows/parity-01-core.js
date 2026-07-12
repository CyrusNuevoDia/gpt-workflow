// Parity: core surface.
// Covers: meta block (name/description/whenToUse/phases), phase(), log(),
// plain-text agent() return ("final text IS the return value"), subagent tool
// access (Bash), and the workflow return value as the run's result.
export const meta = {
  description:
    "Core surface: meta/phases, phase(), log(), plain-text agent() return, agent tool access, workflow return value",
  name: "parity-01-core",
  phases: [
    { detail: "plain-text agent return", title: "Text" },
    { detail: "agent exercises the Bash tool", title: "Tools" }
  ],
  whenToUse: "Run as an integration test of the core workflow runtime surface."
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

phase("Text");
const text = await agent(
  "Reply with exactly the single word: pong. No punctuation, no explanation, no markdown.",
  { label: "core:echo-text", model: "haiku" }
);
check(
  "agent() without schema returns final text as a string",
  typeof text === "string",
  "typeof=" + typeof text
);
check(
  "agent() text is raw data, not a wrapped message",
  typeof text === "string" && text.trim().toLowerCase().indexOf("pong") !== -1,
  JSON.stringify(text)
);

phase("Tools");
const toolOut = await agent(
  "Use the Bash tool to run exactly this command: echo workflow-tool-access-ok\n" +
    "Then return only the command stdout, nothing else.",
  { label: "core:bash-access", model: "haiku" }
);
check(
  "workflow agents have real tool access (Bash)",
  typeof toolOut === "string" &&
    toolOut.indexOf("workflow-tool-access-ok") !== -1,
  JSON.stringify(toolOut)
);

const passed = checks.every((c) => c.pass);
log(
  "parity-01-core: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, passed, suite: 'parity-01-core' }
