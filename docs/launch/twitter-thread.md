# Launch thread (X)

**1/**

multi-agent workflows are the highest-leverage way to spend tokens. gpt-5.6 is the best place to spend them.

so I ported claude code's Workflow tool to codex: gpt-workflow

same orchestration, latest openai models, fraction of the bill 🧵

**2/**

nothing about the shapes changed — judge panels, critic fan-outs, migration sweeps. claude workflows do all of this too

what changed is the unit economics. a 50-agent sweep that's real money in claude tokens barely dents a codex plan

stuff you used to ration, you just run

**3/**

a workflow is just javascript. loops, retries, fan-out — your code decides. `agent()` spawns a codex thread when there's actual judgment needed

```js
const summaries = await parallel(
  files.map((f) => () =>
    agent(`Read ${f}, return 3 factual bullets.`)
  )
)
```

pass a json schema, the runtime validates + retries for you

**4/**

bonus: you're not locked inside a chat session

standalone CLI — `gpt-workflow run` streams ordered NDJSON to stdout. tee it, jq it, wire it into scripts and CI

porting is easy too: nearly-equivalent surface to claude's, better error-handling semantics. mostly a model-name swap. parity ledger in the docs

**5/**

install as a codex plugin — the bundled skill writes and debugs workflows for you

```
codex plugin marketplace add CyrusNuevoDia/gpt-workflow
codex plugin add gpt-workflow@gpt-workflow
```

or `bun add --global gpt-workflow`

github.com/CyrusNuevoDia/gpt-workflow
