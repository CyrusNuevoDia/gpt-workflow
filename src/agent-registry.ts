import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type AgentDefinition = {
  name: string
  description: string
  developerInstructions: string
  model?: string
  effort?: string
  sandbox?: "read-only" | "workspace-write" | "danger-full-access"
  source: "builtin" | "project" | "personal"
}

export const BUILTIN_AGENT_DEFINITIONS = {
  default: {
    description: "General-purpose fallback",
    developerInstructions:
      "General-purpose subagent. Complete the delegated task and return the result.",
    name: "default",
    source: "builtin"
  },
  explorer: {
    description: "Read-heavy repository exploration",
    developerInstructions:
      "Act as a read-only repository exploration agent. Do not edit files. When searching, include hidden and ignored directories where relevant (for example, use fd -H -I). Verify filesystem claims with tools before answering.",
    name: "explorer",
    sandbox: "read-only",
    source: "builtin"
  },
  worker: {
    description: "Execution-focused implementation and fixes",
    developerInstructions:
      "Execution-focused subagent for implementation and fixes. Own the delegated change: make the smallest defensible edit, keep unrelated files untouched, and validate only the behavior you changed.",
    name: "worker",
    sandbox: "workspace-write",
    source: "builtin"
  }
} as const satisfies Record<string, AgentDefinition>

export async function resolveAgentType(
  agentType: string,
  options: { cwd?: string; personalDirectory?: string } = {}
): Promise<AgentDefinition> {
  const projectDirectory = join(
    options.cwd ?? process.cwd(),
    ".codex",
    "agents"
  )
  const personalDirectory =
    options.personalDirectory ?? join(homedir(), ".codex", "agents")
  const projectAgents = await loadAgents(projectDirectory, "project")
  const projectMatch = projectAgents.find((agent) => agent.name === agentType)
  if (projectMatch) {
    return projectMatch
  }
  const personalAgents = await loadAgents(personalDirectory, "personal")
  const personalMatch = personalAgents.find((agent) => agent.name === agentType)
  if (personalMatch) {
    return personalMatch
  }
  const customAgents = [...projectAgents, ...personalAgents]
  const builtin =
    BUILTIN_AGENT_DEFINITIONS[
      agentType as keyof typeof BUILTIN_AGENT_DEFINITIONS
    ]
  if (builtin) {
    return builtin
  }
  const available = [
    ...new Set([
      ...Object.keys(BUILTIN_AGENT_DEFINITIONS),
      ...customAgents.map((agent) => agent.name)
    ])
  ].sort()
  throw new Error(
    `unknown agent type "${agentType}"; available agent types: ${available.join(", ")}`
  )
}

async function loadAgents(
  directory: string,
  source: "project" | "personal"
): Promise<AgentDefinition[]> {
  let filenames: string[]
  try {
    filenames = (await readdir(directory))
      .filter((filename) => filename.endsWith(".toml"))
      .sort()
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return []
    }
    throw error
  }
  const agents = await Promise.all(
    filenames.map(async (filename) => {
      try {
        const parsed = Bun.TOML.parse(
          await readFile(join(directory, filename), "utf8")
        ) as Record<string, unknown>
        return parseAgentDefinition(parsed, source)
      } catch {
        return null
      }
    })
  )
  return agents.filter((agent): agent is AgentDefinition => agent !== null)
}

function parseAgentDefinition(
  value: Record<string, unknown>,
  source: "project" | "personal"
): AgentDefinition | null {
  if (
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.developer_instructions !== "string"
  ) {
    return null
  }
  const sandbox = isSandbox(value.sandbox_mode) ? value.sandbox_mode : undefined
  return {
    description: value.description,
    developerInstructions: value.developer_instructions,
    name: value.name,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.model_reasoning_effort === "string"
      ? { effort: value.model_reasoning_effort }
      : {}),
    ...(sandbox === undefined ? {} : { sandbox }),
    source
  }
}

function isSandbox(
  value: unknown
): value is "read-only" | "workspace-write" | "danger-full-access" {
  return (
    value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
