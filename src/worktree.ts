import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"
import { dirname, join, resolve } from "node:path"

const execFileAsync = promisify(execFile)

export interface WorkflowWorktree {
  readonly path: string
  cleanup(): Promise<{ removed: boolean; reason?: string }>
}

export async function createWorkflowWorktree(
  cwd: string,
  workflowRunId: string,
  index: number,
): Promise<WorkflowWorktree> {
  const repository = await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => {
    throw new Error('Failed to resolve base branch "HEAD": git rev-parse failed')
  })
  await git(repository, ["rev-parse", "HEAD"]).catch(() => {
    throw new Error('Failed to resolve base branch "HEAD": git rev-parse failed')
  })

  const path = resolve(repository, ".verification-artifacts", "worktrees", `${safeName(workflowRunId)}-${index}`)
  await mkdir(dirname(path), { recursive: true })
  await git(repository, ["worktree", "add", "--detach", path, "HEAD"])
  return {
    path,
    cleanup: async () => {
      try {
        const status = await git(path, ["status", "--porcelain", "--untracked-files=all"])
        if (status.length > 0) return { removed: false, reason: "worktree is dirty" }
        await git(repository, ["worktree", "remove", path])
        return { removed: true }
      } catch (error) {
        return { removed: false, reason: describeError(error) }
      }
    },
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" })
  return result.stdout.trim()
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
