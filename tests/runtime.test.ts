import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import {
  type JSONValue,
  parseWorkflowScript,
  runWorkflowScript,
  type WorkflowExecutionOptions
} from "../src/runtime.ts"

const META = `export const meta = {
  name: 'offline-runtime',
  description: 'Exercise the deterministic workflow VM',
  whenToUse: 'in focused tests',
  phases: [{ title: 'First', detail: 'first detail', model: 'offline' }],
}
`

function script(body: string, meta = META): string {
  return `${meta}\n${body}`
}

test("parses static literal meta and returns only the remaining body", () => {
  const loaded = parseWorkflowScript(script("return { ok: true }"))

  expect(loaded.meta).toEqual({
    description: "Exercise the deterministic workflow VM",
    name: "offline-runtime",
    phases: [{ detail: "first detail", model: "offline", title: "First" }],
    whenToUse: "in focused tests"
  })
  expect(loaded.body.trim()).toBe("return { ok: true }")
})

test("rejects computed, continued, malformed, missing, and non-first meta without running the body", async () => {
  const sources = [
    script("return 1", "export const meta = makeMeta()\n"),
    `export const meta = { name: 'x', description: 'y' }\n+ agent('must not run')`,
    script(
      "return 1",
      "export const meta = { name: 'x', description: 'y', phases: [ }\n"
    ),
    "const before = true\nexport const meta = { name: 'x', description: 'y' }\nreturn before",
    script("return 1", "export const meta = { name: 'x' }\n"),
    script("return 1", "export const meta = { description: 'y' }\n")
  ]
  let bodyCalls = 0
  const options: WorkflowExecutionOptions = {
    agent: () => {
      bodyCalls += 1
      return "unexpected"
    }
  }

  await Promise.all(
    sources.map((source) =>
      expect(runWorkflowScript(source, options)).rejects.toThrow()
    )
  )
  expect(bodyCalls).toBe(0)
})

test("supports top-level await and top-level return in strict JavaScript", async () => {
  const execution = await runWorkflowScript(
    script(`
    const value = await Promise.resolve(41)
    return { value: value + 1, strictThis: this === undefined }
  `)
  )

  expect(execution.result).toEqual({ strictThis: true, value: 42 })
})

test("injects the documented API while removing ambient host bindings", async () => {
  const execution = await runWorkflowScript(
    script(`
    const ownGlobals = Object.getOwnPropertyNames(globalThis)
    const localFunctionPrototype = Object.getPrototypeOf(() => {})
    const pendingAgent = agent('promise-realm-probe')
    return {
      types: [typeof agent, typeof parallel, typeof pipeline, typeof phase, typeof log, typeof workflow, typeof args, typeof budget],
      ambient: ['require', 'process', 'Bun', 'Deno', 'module', 'console', 'fetch', 'setTimeout', 'performance'].map(name => [name, ownGlobals.includes(name)]),
      dynamicCode: [typeof Function, typeof eval, typeof ShadowRealm, typeof ({}).constructor.constructor, typeof Object.getPrototypeOf(async function () {}).constructor, typeof Object.getPrototypeOf(function* () {}).constructor],
      functionsUseLocalPrototype: [agent, parallel, pipeline, phase, log, workflow, budget.spent, budget.remaining].every(value => Object.getPrototypeOf(value) === localFunctionPrototype || Object.getPrototypeOf(Object.getPrototypeOf(value)) === localFunctionPrototype),
      budgetPrototype: Object.getPrototypeOf(budget),
      agentPromiseUsesLocalConstructor: pendingAgent.constructor === Promise,
      promiseConstructorConstructor: typeof pendingAgent.constructor.constructor,
      phaseIsConstructible: (() => { try { new phase('bad'); return true } catch { return false } })(),
    }
  `),
    { agent: () => null }
  )

  expect(execution.result).toEqual({
    agentPromiseUsesLocalConstructor: true,
    ambient: [
      ["require", false],
      ["process", false],
      ["Bun", false],
      ["Deno", false],
      ["module", false],
      ["console", false],
      ["fetch", false],
      ["setTimeout", false],
      ["performance", false]
    ],
    budgetPrototype: null,
    dynamicCode: [
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined"
    ],
    functionsUseLocalPrototype: true,
    phaseIsConstructible: false,
    promiseConstructorConstructor: "undefined",
    types: [
      "function",
      "function",
      "function",
      "function",
      "function",
      "function",
      "undefined",
      "object"
    ]
  })
})

test("enforces the documented Date and Math determinism guards", async () => {
  const execution = await runWorkflowScript(
    script(`
    function capture(callback) {
      try { callback(); return null } catch (error) { return error.message }
    }
    return {
      dateNow: capture(() => Date.now()),
      random: capture(() => Math.random()),
      arglessDate: capture(() => new Date()),
      dateWithMilliseconds: new Date(1700000000000).getUTCFullYear(),
      parsed: Date.parse('2020-01-01T00:00:00.000Z'),
      utc: Date.UTC(2020, 0, 1),
      dateGuardIsFrozen: Object.isFrozen(Date),
      mathGuardIsFrozen: Object.isFrozen(Math),
    }
  `)
  )

  expect(execution.result).toEqual({
    arglessDate:
      "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.",
    dateGuardIsFrozen: true,
    dateNow:
      "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.",
    dateWithMilliseconds: 2023,
    mathGuardIsFrozen: true,
    parsed: 1_577_836_800_000,
    random:
      "Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt.",
    utc: 1_577_836_800_000
  })
})

test("keeps ordinary deterministic JavaScript built-ins available", async () => {
  const execution = await runWorkflowScript(
    script(`
    const map = new Map([['a', 1]])
    const set = new Set([1, 2, 2])
    return {
      math: Math.max(2, 7),
      json: JSON.parse(JSON.stringify({ a: [1, 2] })).a.length,
      array: Array.from({ length: 3 }, (_, index) => index).join(''),
      set: set.size,
      map: map.get('a'),
      promise: await Promise.resolve('done'),
      regex: /^[a-z]+$/.test('plain'),
    }
  `)
  )

  expect(execution.result).toEqual({
    array: "012",
    json: 2,
    map: 1,
    math: 7,
    promise: "done",
    regex: true,
    set: 2
  })
})

test("round-trips JSON-compatible args and result data without parsing strings", async () => {
  const objectArgs = { count: 2, nested: [true, null, "x"], topic: "tea" }
  const objectExecution = await runWorkflowScript(
    script(
      "return { received: args, sameString: typeof args.topic === 'string' }"
    ),
    { args: objectArgs }
  )
  const stringExecution = await runWorkflowScript(
    script("return { received: args, type: typeof args }"),
    { args: JSON.stringify(objectArgs) }
  )

  expect(objectExecution.result).toEqual({
    received: objectArgs,
    sameString: true
  })
  expect(stringExecution.result).toEqual({
    received: JSON.stringify(objectArgs),
    type: "string"
  })
})

test("exposes omitted args as undefined", async () => {
  const execution = await runWorkflowScript(
    script("return { omitted: args === undefined, type: typeof args }")
  )
  expect(execution.result).toEqual({ omitted: true, type: "undefined" })
})

test("rejects every non-JSON value at the result boundary", async () => {
  const expressions = [
    "undefined",
    "function () {}",
    "Symbol('x')",
    "1n",
    "NaN",
    "Infinity",
    "new Date(0)",
    "new Set([1])",
    "new Map([['a', 1]])",
    "/x/"
  ]

  await Promise.all(
    expressions.map((expression) =>
      expect(runWorkflowScript(script(`return ${expression}`))).rejects.toThrow(
        "workflow result"
      )
    )
  )
})

test("validates host-call shapes before invoking host implementations", async () => {
  let agentCalls = 0
  let workflowCalls = 0
  const options: WorkflowExecutionOptions = {
    agent: () => {
      agentCalls += 1
      return null
    },
    workflow: () => {
      workflowCalls += 1
      return null
    }
  }

  await expect(
    runWorkflowScript(script("return agent('x', 'bad')"), options)
  ).rejects.toThrow("agent() options must be a plain object")
  await expect(
    runWorkflowScript(script("return workflow({ nope: true })"), options)
  ).rejects.toThrow("workflow() reference.scriptPath must be a string")
  expect({ agentCalls, workflowCalls }).toEqual({
    agentCalls: 0,
    workflowCalls: 0
  })
})

test("rejects undefined slots, functions, symbols, bigint, non-finite values, cycles, and non-plain args", async () => {
  const badArgs = [
    { value: { nested: undefined } },
    { value: [1, undefined] },
    { value: () => "nope" },
    { value: Symbol("nope") },
    { value: 1n },
    { value: Number.POSITIVE_INFINITY },
    { value: new Date(0) },
    { value: new Set([1]) }
  ]

  await Promise.all(
    badArgs.map(({ value }) =>
      expect(
        runWorkflowScript(script("return true"), {
          args: value as unknown as JSONValue
        })
      ).rejects.toThrow("args")
    )
  )

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  await expect(
    runWorkflowScript(script("return true"), { args: cyclic as JSONValue })
  ).rejects.toThrow("cyclic")
})

test("parallel starts all thunks concurrently and preserves positions", async () => {
  const execution = await runWorkflowScript(
    script(`
    let running = 0
    let maximum = 0
    const results = await parallel(Array.from({ length: 3 }, (_, index) => async () => {
      running++
      maximum = Math.max(maximum, running)
      await Promise.resolve()
      await Promise.resolve()
      running--
      return index
    }))
    const accepted = await parallel(Array.from({ length: 4096 }, () => () => null))
    return { results, maximum, accepted: accepted.length }
  `)
  )

  expect(execution.result).toEqual({
    accepted: 4096,
    maximum: 3,
    results: [0, 1, 2]
  })
  expect(execution.failures).toEqual([])
})

test("parallel absorbs slot failures, records attribution, and never rejects the barrier", async () => {
  const execution = await runWorkflowScript(
    script(`
    const results = await parallel([
      () => { throw new Error('intentional slot failure') },
      () => Promise.resolve('kept'),
      () => Promise.resolve(null),
    ])
    return { results, filtered: results.filter(Boolean) }
  `)
  )

  expect(execution.result).toEqual({
    filtered: ["kept"],
    results: [null, "kept", null]
  })
  expect(execution.failures).toEqual([
    { index: 0, kind: "parallel", message: "intentional slot failure" }
  ])
})

test("parallel enforces the exact documented 4096-item cap", async () => {
  const execution = await runWorkflowScript(
    script(`
    try {
      await parallel(Array.from({ length: 4097 }, () => () => Promise.resolve(null)))
      return { threw: false, message: null }
    } catch (error) {
      return { threw: true, message: error.message }
    }
  `)
  )

  expect(execution.result).toEqual({
    message:
      "array length 4097 exceeds the maximum of 4096 supported across the workflow VM boundary",
    threw: true
  })
})

test("pipeline flows items independently, passes callback arguments, and skips after failure", async () => {
  const execution = await runWorkflowScript(
    script(`
    const calls = []
    let releaseSlow
    const slow = new Promise(resolve => { releaseSlow = () => resolve({ key: 'fast' }) })
    const items = [{ key: 'fast', fail: null }, { key: 'stage2', fail: 1 }, { key: 'stage1', fail: 0 }]
    const results = await pipeline(
      items,
      async (previous, item, index) => {
        calls.push({ stage: 1, key: item.key, index, seeded: previous === item })
        if (item.key === 'fast') return slow
        if (item.fail === 0) throw new Error('stage one failed')
        return { key: item.key, previous }
      },
      async (previous, item, index) => {
        calls.push({ stage: 2, key: item.key, index, previousKey: previous.key })
        if (item.fail === 1) {
          releaseSlow()
          throw new Error('stage two failed')
        }
        releaseSlow()
        return previous.key.toUpperCase()
      },
      (previous, item, index) => {
        calls.push({ stage: 3, key: item.key, index })
        return previous + '!'
      },
    )
    return { results, calls }
  `)
  )

  expect(execution.result).toEqual({
    calls: [
      { index: 0, key: "fast", seeded: true, stage: 1 },
      { index: 1, key: "stage2", seeded: true, stage: 1 },
      { index: 2, key: "stage1", seeded: true, stage: 1 },
      { index: 1, key: "stage2", previousKey: "stage2", stage: 2 },
      { index: 0, key: "fast", previousKey: "fast", stage: 2 },
      { index: 0, key: "fast", stage: 3 }
    ],
    results: ["FAST!", null, null]
  })
  expect(execution.failures).toEqual([
    { index: 2, kind: "pipeline", message: "stage one failed", stage: 0 },
    { index: 1, kind: "pipeline", message: "stage two failed", stage: 1 }
  ])
})

test("pipeline enforces the same exact 4096-item cap", async () => {
  const execution = await runWorkflowScript(
    script(`
    try {
      await pipeline(Array.from({ length: 4097 }, (_, index) => index), value => value)
      return false
    } catch (error) {
      return error.message
    }
  `)
  )

  expect(execution.result).toBe(
    "array length 4097 exceeds the maximum of 4096 supported across the workflow VM boundary"
  )
})

test("phase and log append ordered typed events and preserve phase attribution", async () => {
  const seenAgents: Array<{ prompt: string; phase?: string }> = []
  const execution = await runWorkflowScript(
    script(`
    phase('First')
    log('before')
    const values = await parallel([
      () => agent('one'),
      () => agent('two', { phase: 'Explicit' }),
    ])
    log('after')
    return values
  `),
    {
      agent: (prompt, options) => {
        seenAgents.push({
          phase: options?.phase as string | undefined,
          prompt
        })
        return prompt
      }
    }
  )

  expect(execution.result).toEqual(["one", "two"])
  expect(seenAgents).toEqual([
    { phase: "First", prompt: "one" },
    { phase: "Explicit", prompt: "two" }
  ])
  expect(execution.events).toEqual([
    { detail: "first detail", title: "First", type: "phase" },
    { message: "before", type: "log" },
    { message: "after", type: "log" }
  ])
})

test("args, agent, workflow, and budget work with offline stubs and a testable spend source", async () => {
  let spent = 7
  const seenWorkflow: Array<{
    reference: string
    args: JSONValue | undefined
  }> = []
  const execution = await runWorkflowScript(
    script(`
    const before = { total: budget.total, spent: budget.spent(), remaining: budget.remaining() }
    const child = await workflow({ scriptPath: 'child.js' }, { topic: args.topic })
    return { before, after: { spent: budget.spent(), remaining: budget.remaining() }, child, args }
  `),
    {
      args: { topic: "tea" },
      budget: { spent: () => spent, total: 20 },
      workflow: (reference, args) => {
        seenWorkflow.push({
          args,
          reference:
            typeof reference === "string" ? reference : reference.scriptPath
        })
        spent = 13
        return { args: args ?? null, child: true }
      }
    }
  )

  expect(execution.result).toEqual({
    after: { remaining: 7, spent: 13 },
    args: { topic: "tea" },
    before: { remaining: 13, spent: 7, total: 20 },
    child: { args: { topic: "tea" }, child: true }
  })
  expect(seenWorkflow).toEqual([
    { args: { topic: "tea" }, reference: "child.js" }
  ])
})

test("budget without a total reports Infinity remaining", async () => {
  const execution = await runWorkflowScript(
    script(
      "return { total: budget.total, isInfinite: budget.remaining() === Infinity }"
    ),
    {
      budget: { spent: 11 }
    }
  )
  expect(execution.result).toEqual({ isInfinite: true, total: null })
})

test("uncaught workflow errors reject while absorbed failures and false suite results stay visible", async () => {
  const absorbed = await runWorkflowScript(
    script(`
    const values = await parallel([() => { throw new Error('absorbed') }])
    return { passed: false, values }
  `)
  )
  expect(absorbed.result).toEqual({ passed: false, values: [null] })
  expect(absorbed.failures).toEqual([
    { index: 0, kind: "parallel", message: "absorbed" }
  ])

  await expect(
    runWorkflowScript(script("throw new Error('uncaught workflow error')"))
  ).rejects.toThrow("uncaught workflow error")
})

test("parses all mirrored workflows and executes parity-10 runtime guards offline", async () => {
  const directory = new URL("../.codex/workflows/", import.meta.url)
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .sort()

  expect(files).toHaveLength(13)
  for (const file of files) {
    parseWorkflowScript(readFileSync(new URL(file, directory), "utf8"), file)
  }

  const guardFile = "parity-10-runtime-guards.js"
  const execution = await runWorkflowScript(
    readFileSync(new URL(guardFile, directory), "utf8"),
    { fileName: guardFile }
  )
  expect(execution.result).toMatchObject({
    passed: true,
    suite: "parity-10-runtime-guards"
  })
  expect(execution.failures).toEqual([])
})
