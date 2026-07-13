import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BUILTIN_AGENT_DEFINITIONS,
  resolveAgentType
} from "../src/agent-registry.js"

const BUILTIN_LIST_PATTERN = /available agent types: default, explorer, worker/
const CUSTOM_LIST_PATTERN = /custom, default, explorer, worker/

test("resolves all built-in agent definitions", async () => {
  await Promise.all(
    (["default", "worker", "explorer"] as const).map(async (name) =>
      expect(
        await resolveAgentType(name, { personalDirectory: "/missing" })
      ).toEqual(BUILTIN_AGENT_DEFINITIONS[name])
    )
  )
})

test("does not alias Claude agent-type names", async () => {
  await Promise.all(
    ["Explore", "general-purpose", "Plan"].map((name) =>
      expect(
        resolveAgentType(name, { personalDirectory: "/missing" })
      ).rejects.toThrow(BUILTIN_LIST_PATTERN)
    )
  )
})

test("project agents use the name field and shadow built-ins", async () => {
  await withDirectories(
    async ({ cwd, projectDirectory, personalDirectory }) => {
      await writeFile(
        join(projectDirectory, "not-worker.toml"),
        agentTOML({
          description: "Project worker",
          developerInstructions: "Project instructions",
          name: "worker"
        })
      )
      await expect(
        resolveAgentType("worker", { cwd, personalDirectory })
      ).resolves.toMatchObject({
        developerInstructions: "Project instructions",
        source: "project"
      })
    }
  )
})

test("consults personal agents after project agents", async () => {
  await withDirectories(async ({ cwd, personalDirectory }) => {
    await writeFile(
      join(personalDirectory, "reviewer.toml"),
      agentTOML({
        description: "Personal reviewer",
        developerInstructions: "Review carefully",
        name: "reviewer"
      })
    )
    await expect(
      resolveAgentType("reviewer", { cwd, personalDirectory })
    ).resolves.toMatchObject({
      name: "reviewer",
      source: "personal"
    })
  })
})

test("skips malformed and incomplete TOML files", async () => {
  await withDirectories(
    async ({ cwd, projectDirectory, personalDirectory }) => {
      await writeFile(join(projectDirectory, "malformed.toml"), "name = [")
      await writeFile(
        join(projectDirectory, "incomplete.toml"),
        'name = "partial"\n'
      )
      await expect(
        resolveAgentType("missing", { cwd, personalDirectory })
      ).rejects.toThrow(BUILTIN_LIST_PATTERN)
    }
  )
})

test("unknown names list discovered custom and built-in agents", async () => {
  await withDirectories(
    async ({ cwd, projectDirectory, personalDirectory }) => {
      await writeFile(
        join(projectDirectory, "custom.toml"),
        agentTOML({
          description: "Custom",
          developerInstructions: "Custom instructions",
          name: "custom"
        })
      )
      await expect(
        resolveAgentType("missing", { cwd, personalDirectory })
      ).rejects.toThrow(CUSTOM_LIST_PATTERN)
    }
  )
})

test("maps model effort and valid sandbox fields and ignores invalid sandboxes", async () => {
  await withDirectories(
    async ({ cwd, projectDirectory, personalDirectory }) => {
      await writeFile(
        join(projectDirectory, "configured.toml"),
        `${agentTOML({
          description: "Configured",
          developerInstructions: "Configured instructions",
          name: "configured"
        })}model = "gpt-custom"\nmodel_reasoning_effort = "high"\nsandbox_mode = "workspace-write"\n`
      )
      await writeFile(
        join(projectDirectory, "invalid.toml"),
        `${agentTOML({
          description: "Invalid sandbox",
          developerInstructions: "No sandbox override",
          name: "invalid"
        })}sandbox_mode = "root"\n`
      )
      await expect(
        resolveAgentType("configured", { cwd, personalDirectory })
      ).resolves.toMatchObject({
        effort: "high",
        model: "gpt-custom",
        sandbox: "workspace-write"
      })
      expect(
        await resolveAgentType("invalid", { cwd, personalDirectory })
      ).not.toHaveProperty("sandbox")
    }
  )
})

function agentTOML(options: {
  description: string
  developerInstructions: string
  name: string
}): string {
  return `name = ${JSON.stringify(options.name)}\ndescription = ${JSON.stringify(options.description)}\ndeveloper_instructions = ${JSON.stringify(options.developerInstructions)}\n`
}

async function withDirectories(
  callback: (paths: {
    cwd: string
    personalDirectory: string
    projectDirectory: string
  }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "gpt-workflow-agents-"))
  const cwd = join(root, "project")
  const projectDirectory = join(cwd, ".codex", "agents")
  const personalDirectory = join(root, "personal")
  await mkdir(projectDirectory, { recursive: true })
  await mkdir(personalDirectory, { recursive: true })
  try {
    await callback({ cwd, personalDirectory, projectDirectory })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}
