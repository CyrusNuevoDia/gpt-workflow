import { expect, test } from "bun:test"
// biome-ignore lint/performance/noNamespaceImport: The test asserts the complete runtime export set.
import * as api from "../src/index.js"

test("publishes only the deliberate runtime and App Server values", () => {
  expect(Object.keys(api).sort()).toEqual([
    "AppServerClient",
    "AppServerError",
    "AppServerModelError",
    "AppServerProcessError",
    "AppServerProtocolError",
    "AppServerRemoteError",
    "AppServerResultError",
    "AppServerTimeoutError",
    "AppServerTurnError",
    "JSONBoundaryError",
    "REQUIRED_APP_SERVER_MODELS",
    "WorkflowLoadError",
    "parseWorkflowJournalEntry",
    "parseWorkflowScript",
    "runWorkflowScript"
  ])
})
