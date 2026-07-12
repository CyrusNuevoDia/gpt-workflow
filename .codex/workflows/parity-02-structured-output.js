// Parity: structured output.
// Covers: the `schema` option — agent() returns a validated object (not text),
// including nested objects, arrays, enums, integer types, and schema-enforced
// array length (minItems/maxItems). Validation happens at the tool-call layer,
// so the script consumes values directly with no parsing.
export const meta = {
  description:
    "schema option: agent() returns validated objects — nested objects, arrays, enums, integers, minItems/maxItems",
  name: "parity-02-structured-output",
  phases: [{ title: "Structured" }]
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

const PERSON_SCHEMA = {
  properties: {
    address: {
      properties: { city: { type: "string" }, zip: { type: "string" } },
      required: ["city", "zip"],
      type: "object"
    },
    age: { type: "integer" },
    name: { type: "string" },
    tags: { items: { type: "string" }, type: "array" },
    tier: { enum: ["free", "pro", "enterprise"], type: "string" }
  },
  required: ["name", "age", "tags", "tier", "address"],
  type: "object"
};

const LIST_SCHEMA = {
  properties: {
    items: {
      items: {
        properties: { id: { type: "integer" }, word: { type: "string" } },
        required: ["id", "word"],
        type: "object"
      },
      maxItems: 3,
      minItems: 3,
      type: "array"
    }
  },
  required: ["items"],
  type: "object"
};

phase("Structured");
const person = await agent(
  "Invent one fictional user profile for an integration test. Any plausible values are fine.",
  {
    label: "structured:person",
    model: "gpt-5.6-luna",
    phase: "Structured",
    schema: PERSON_SCHEMA
  }
);
check(
  "schema call returns an object, not a string",
  person !== null && typeof person === "object",
  "typeof=" + typeof person
);
check(
  "string field validated",
  !!person && typeof person.name === "string",
  person && JSON.stringify(person.name)
);
check(
  "integer field validated",
  !!person && Number.isInteger(person.age),
  person && JSON.stringify(person.age)
);
check(
  "array-of-strings field validated",
  !!person &&
    Array.isArray(person.tags) &&
    person.tags.every((t) => typeof t === "string"),
  person && JSON.stringify(person.tags)
);
check(
  "enum field constrained to allowed values",
  !!person && ["free", "pro", "enterprise"].indexOf(person.tier) !== -1,
  person && JSON.stringify(person.tier)
);
check(
  "nested object field validated",
  !!person &&
    !!person.address &&
    typeof person.address.city === "string" &&
    typeof person.address.zip === "string",
  person && JSON.stringify(person.address)
);

const list = await agent(
  "Return exactly 3 items with ids 1, 2, 3 and a distinct short lowercase word for each.",
  {
    label: "structured:list",
    model: "gpt-5.6-luna",
    phase: "Structured",
    schema: LIST_SCHEMA
  }
);
check(
  "array-of-objects schema validated",
  !!list &&
    Array.isArray(list.items) &&
    list.items.every(
      (it) => Number.isInteger(it.id) && typeof it.word === "string"
    ),
  JSON.stringify(list)
);
check(
  "minItems/maxItems enforced by the validator",
  !!list && list.items.length === 3,
  list && "length=" + list.items.length
);
check(
  "values usable directly in script — no parsing step",
  !!list &&
    typeof list.items.map((it) => it.id).reduce((a, b) => a + b, 0) ===
      "number",
  null
);
check(
  "INFO id sum as instructed (model-dependent, recorded)",
  true,
  list && "sum=" + list.items.map((it) => it.id).reduce((a, b) => a + b, 0)
);

const passed = checks.every((c) => c.pass);
log(
  "parity-02-structured-output: " +
    checks.filter((c) => c.pass).length +
    "/" +
    checks.length +
    " checks passed"
);
return { checks, passed, suite: 'parity-02-structured-output' }
