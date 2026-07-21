import { afterEach, describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  encodeProjectPath,
  projectWorkflowsDirectory,
  resolveCodexHome,
  workflowRunDirectory
} from "../src/workflow-storage.js"

const originalCodexHome = process.env.CODEX_HOME

afterEach(() => {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = originalCodexHome
  }
})

describe("workflow storage", () => {
  test("uses CODEX_HOME and encodes the resolved project path", () => {
    process.env.CODEX_HOME = "relative-codex-home"
    const projectDirectory = "/Users/example/Git/project"

    expect(resolveCodexHome()).toBe(resolve("relative-codex-home"))
    expect(encodeProjectPath(projectDirectory)).toBe(
      "-Users-example-Git-project"
    )
    expect(projectWorkflowsDirectory(projectDirectory)).toBe(
      join(
        resolve("relative-codex-home"),
        "projects",
        "-Users-example-Git-project",
        "workflows"
      )
    )
  })

  test("defaults CODEX_HOME to the user's Codex directory", () => {
    delete process.env.CODEX_HOME
    expect(resolveCodexHome()).toBe(join(homedir(), ".codex"))
  })

  test("builds workflow-scoped run paths and rejects unsafe segments", () => {
    process.env.CODEX_HOME = "/tmp/codex-home"
    expect(workflowRunDirectory("/repo", "summarize-files", "workflow-1")).toBe(
      "/tmp/codex-home/projects/-repo/workflows/summarize-files/runs/workflow-1"
    )
    expect(() =>
      workflowRunDirectory("/repo", "../escape", "workflow-1")
    ).toThrow("workflow name must contain only")
    expect(() => workflowRunDirectory("/repo", "valid", "..")).toThrow(
      "run ID must contain only"
    )
  })
})
