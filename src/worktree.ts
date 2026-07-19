import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type WorkflowWorktree = {
  cleanup: () => Promise<{ removed: boolean; reason?: string }>
  readonly path: string
}

export class WorkflowGitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "WorkflowGitError"
  }
}

export async function createWorkflowWorktree(
  cwd: string,
  workflowRunId: string,
  index: number
): Promise<WorkflowWorktree> {
  const repository = await git(cwd, ["rev-parse", "--show-toplevel"]).catch(
    (cause: unknown) => {
      throw new WorkflowGitError(
        'Failed to resolve base branch "HEAD": git rev-parse failed',
        { cause }
      )
    }
  )
  await git(repository, ["rev-parse", "HEAD"]).catch((cause: unknown) => {
    throw new WorkflowGitError(
      'Failed to resolve base branch "HEAD": git rev-parse failed',
      { cause }
    )
  })

  const path = resolve(
    repository,
    ".codex",
    "worktrees",
    `${safeName(workflowRunId)}-${index}`
  )
  await mkdir(dirname(path), { recursive: true })
  await git(repository, ["worktree", "add", "--detach", path, "HEAD"])
  return {
    cleanup: async () => {
      try {
        const status = await git(path, [
          "status",
          "--porcelain",
          "--untracked-files=all"
        ])
        if (status.length > 0) {
          return { reason: "worktree is dirty", removed: false }
        }
        await git(repository, ["worktree", "remove", path])
        return { removed: true }
      } catch (error) {
        return { reason: describeError(error), removed: false }
      }
    },
    path
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8"
    })
    return result.stdout.trim()
  } catch (cause) {
    throw new WorkflowGitError(describeError(cause), { cause })
  }
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
