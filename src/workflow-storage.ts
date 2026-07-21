import type { Dirent } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

export type StoredWorkflowRun = {
  directory: string
  runId: string
  workflowName: string
}

export function resolveCodexHome(): string {
  const configured = process.env.CODEX_HOME
  return resolve(
    configured === undefined || configured.length === 0
      ? join(homedir(), ".codex")
      : configured
  )
}

export function encodeProjectPath(projectDirectory: string): string {
  const encoded = resolve(projectDirectory)
    .replaceAll("\\", "/")
    .replaceAll(":", "-")
    .replaceAll("/", "-")
  return encoded.startsWith("-") ? encoded : `-${encoded}`
}

export function projectWorkflowsDirectory(projectDirectory: string): string {
  return join(
    resolveCodexHome(),
    "projects",
    encodeProjectPath(projectDirectory),
    "workflows"
  )
}

export function workflowRunsDirectory(
  projectDirectory: string,
  workflowName: string
): string {
  assertSafePathSegment(workflowName, "workflow name")
  return join(projectWorkflowsDirectory(projectDirectory), workflowName, "runs")
}

export function workflowRunDirectory(
  projectDirectory: string,
  workflowName: string,
  runId: string
): string {
  assertSafePathSegment(runId, "run ID")
  return join(workflowRunsDirectory(projectDirectory, workflowName), runId)
}

export async function findStoredWorkflowRuns(
  projectDirectory: string,
  runId: string
): Promise<StoredWorkflowRun[]> {
  assertSafePathSegment(runId, "run ID")
  const workflowsDirectory = projectWorkflowsDirectory(projectDirectory)
  const workflows = await readDirectories(workflowsDirectory)
  const matches = await Promise.all(
    workflows.map(async ({ name: workflowName }) => {
      if (!isSafePathSegment(workflowName)) {
        return null
      }
      const directory = workflowRunDirectory(
        projectDirectory,
        workflowName,
        runId
      )
      return (await isDirectory(directory))
        ? { directory, runId, workflowName }
        : null
    })
  )
  return matches.filter((match) => match !== null)
}

export async function listStoredWorkflowRuns(
  projectDirectory: string
): Promise<StoredWorkflowRun[]> {
  const workflows = await readDirectories(
    projectWorkflowsDirectory(projectDirectory)
  )
  const grouped = await Promise.all(
    workflows.map(async ({ name: workflowName }) => {
      if (!isSafePathSegment(workflowName)) {
        return []
      }
      const runs = await readDirectories(
        workflowRunsDirectory(projectDirectory, workflowName)
      )
      return runs
        .filter(({ name: runId }) => isSafePathSegment(runId))
        .map(({ name: runId }) => ({
          directory: workflowRunDirectory(
            projectDirectory,
            workflowName,
            runId
          ),
          runId,
          workflowName
        }))
    })
  )
  return grouped.flat()
}

export function isSafePathSegment(value: string): boolean {
  return (
    SAFE_PATH_SEGMENT_PATTERN.test(value) && value !== "." && value !== ".."
  )
}

export function assertSafePathSegment(value: string, name: string): void {
  if (!isSafePathSegment(value)) {
    throw new TypeError(
      `${name} must contain only letters, numbers, periods, underscores, and hyphens, and must not be . or ..`
    )
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isMissingFile(error)) {
      return false
    }
    throw error
  }
}

async function readDirectories(path: string): Promise<Dirent<string>[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory()
    )
  } catch (error) {
    if (isMissingFile(error)) {
      return []
    }
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  )
}
