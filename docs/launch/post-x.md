# Launch thread (X)

**1/**

multi-agent workflows are the highest-leverage way to spend tokens.

so I ported claude code's workflows to codex.

stop rationing, start tokenmaxxing.

**3/**

a workflow is just javascript. loops, retries, fan-out — your code decides.

use it for judge panels, critic fan-outs, migration sweeps.

```js
const summaries = await parallel(
  files.map((f) => () => agent(`Read ${f}, return 3 factual bullets.`))
);
```

pass a json schema, the runtime validates + retries for you

**4/**

bonus: you're not locked inside a chat session

standalone CLI — `gpt-workflow run` streams ordered NDJSON to stdout. tee it, jq it, wire it into scripts and CI

**5/**

install as a codex plugin — the bundled skill writes and debugs workflows for you.

github.com/CyrusNuevoDia/gpt-workflow
