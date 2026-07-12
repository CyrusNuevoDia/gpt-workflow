import { cpus } from "node:os"
import type { AppServerAgentHandle } from "./app-server.ts"

export type WorkflowCaps = {
  maxAgentsPerRun: number
  maxBoundaryItems: number
  maxConcurrentAgents: number
  maxWorkflowDepth: number
}

export type WorkflowCapOptions = {
  maxAgentsPerRun?: number
  maxBoundaryItems?: number
  maxConcurrentAgents?: number
  maxWorkflowDepth?: number
}

export type WorkflowUsage = {
  agentCount: number
  liveAgentCount: number
  modelUsage: Record<string, WorkflowModelUsage>
  peakConcurrentAgents: number
  replayedAgentCount: number
  subagentTokens: number
}

export type WorkflowModelUsage = {
  liveAgentCount: number
  replayedAgentCount: number
  subagentTokens: number
}

export type WorkflowBudgetState = {
  assertAvailable: () => void
  recordTokens: (tokens: number, model?: string) => void
  remaining: () => number
  spent: () => number
  total: number | null
}

type ScheduledTask = {
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  run: () => Promise<unknown>
}

export class WorkflowCanceledError extends Error {
  constructor() {
    super("workflow run was cancelled")
    this.name = "WorkflowCanceledError"
  }
}

export class WorkflowCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkflowCapError"
  }
}

class AgentQueue {
  private readonly pending: ScheduledTask[] = []
  private readonly limit: number
  private readonly onPeak: (peak: number) => void
  private active = 0
  private peak = 0
  private canceled: WorkflowCanceledError | null = null

  constructor(limit: number, onPeak: (peak: number) => void) {
    this.limit = limit
    this.onPeak = onPeak
  }

  get activeCount(): number {
    return this.active
  }

  schedule<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.canceled !== null || signal.aborted) {
      return Promise.reject(this.canceled ?? new WorkflowCanceledError())
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        reject,
        resolve: (value) => resolve(value as T),
        run: async () => run()
      })
      this.drain()
    })
  }

  cancel(error: WorkflowCanceledError): void {
    if (this.canceled !== null) {
      return
    }
    this.canceled = error
    while (this.pending.length > 0) {
      this.pending.shift()?.reject(error)
    }
  }

  private drain(): void {
    while (
      this.active < this.limit &&
      this.pending.length > 0 &&
      this.canceled === null
    ) {
      const task = this.pending.shift()
      if (!task) {
        return
      }
      this.active += 1
      this.peak = Math.max(this.peak, this.active)
      this.onPeak(this.peak)
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active -= 1
          this.drain()
        })
    }
  }
}

export type WorkflowRunStateOptions = {
  budgetTotal: number | null
  caps: WorkflowCaps
  signal?: AbortSignal
  spentSource: number | (() => number)
  workflowRunId: string
}

export class WorkflowRunState {
  readonly workflowRunId: string
  readonly caps: WorkflowCaps
  readonly controller = new AbortController()
  readonly signal: AbortSignal
  readonly usage: WorkflowUsage = {
    agentCount: 0,
    liveAgentCount: 0,
    modelUsage: {},
    peakConcurrentAgents: 0,
    replayedAgentCount: 0,
    subagentTokens: 0
  }
  readonly budget: WorkflowBudgetState
  private readonly queue: AgentQueue
  private readonly activeHandles = new Set<AppServerAgentHandle>()
  private worktreeCount = 0
  private callChain = "v2:root"

  constructor(options: WorkflowRunStateOptions) {
    this.workflowRunId = options.workflowRunId
    this.caps = options.caps
    this.signal = this.controller.signal
    this.queue = new AgentQueue(options.caps.maxConcurrentAgents, (peak) => {
      this.usage.peakConcurrentAgents = peak
    })
    let recordedTokens = 0
    const readSource = (): number => {
      const value =
        typeof options.spentSource === "function"
          ? options.spentSource()
          : options.spentSource
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(
          "budget.spent() must return a finite non-negative number"
        )
      }
      return value
    }
    this.budget = {
      assertAvailable: () => {
        if (
          options.budgetTotal !== null &&
          readSource() + recordedTokens >= options.budgetTotal
        ) {
          throw new WorkflowCapError(
            `agent() budget cap reached: spent=${readSource() + recordedTokens}, total=${options.budgetTotal}`
          )
        }
      },
      recordTokens: (tokens, model = "unknown") => {
        if (!Number.isFinite(tokens) || tokens < 0) {
          throw new TypeError(
            "agent usage tokens must be finite and non-negative"
          )
        }
        recordedTokens += tokens
        this.usage.subagentTokens += tokens
        this.modelBucket(model).subagentTokens += tokens
      },
      remaining: () =>
        options.budgetTotal === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, options.budgetTotal - readSource() - recordedTokens),
      spent: () => readSource() + recordedTokens,
      total: options.budgetTotal
    }
    if (options.signal) {
      if (options.signal.aborted) {
        this.cancel()
      } else {
        options.signal.addEventListener("abort", () => this.cancel(), {
          once: true
        })
      }
    }
  }

  reserveAgent(): string {
    this.assertNotCanceled()
    this.budget.assertAvailable()
    if (this.usage.agentCount >= this.caps.maxAgentsPerRun) {
      throw new WorkflowCapError(
        `agent() lifetime cap reached: maximum ${this.caps.maxAgentsPerRun} agents per workflow run`
      )
    }
    this.usage.agentCount += 1
    return `${this.workflowRunId}:agent-${this.usage.agentCount}`
  }

  scheduleAgent<T>(run: () => Promise<T>): Promise<T> {
    this.assertNotCanceled()
    return this.queue.schedule(run, this.signal)
  }

  markLiveAgent(model = "unknown"): void {
    this.usage.liveAgentCount += 1
    this.modelBucket(model).liveAgentCount += 1
  }

  markReplayedAgent(model = "unknown"): void {
    this.usage.replayedAgentCount += 1
    this.modelBucket(model).replayedAgentCount += 1
  }

  private modelBucket(model: string): WorkflowModelUsage {
    const key = model.length > 0 ? model : "unknown"
    const existing = this.usage.modelUsage[key]
    if (existing) {
      return existing
    }
    const bucket = {
      liveAgentCount: 0,
      replayedAgentCount: 0,
      subagentTokens: 0
    }
    this.usage.modelUsage[key] = bucket
    return bucket
  }

  registerHandle(handle: AppServerAgentHandle): () => void {
    this.activeHandles.add(handle)
    return () => this.activeHandles.delete(handle)
  }

  nextWorktreeNumber(): number {
    this.worktreeCount += 1
    return this.worktreeCount
  }

  get currentCallChain(): string {
    return this.callChain
  }

  set currentCallChain(value: string) {
    this.callChain = value
  }

  cancel(): void {
    if (this.signal.aborted) {
      return
    }
    const error = new WorkflowCanceledError()
    this.queue.cancel(error)
    this.controller.abort(error)
    for (const handle of this.activeHandles) {
      handle.interrupt().catch(() => undefined)
    }
  }

  assertNotCanceled(): void {
    if (this.signal.aborted) {
      throw new WorkflowCanceledError()
    }
  }
}

export function resolveWorkflowCaps(
  options: WorkflowCapOptions = {}
): WorkflowCaps {
  const available = Math.max(1, cpus().length - 2)
  return {
    maxAgentsPerRun: validateCap(
      options.maxAgentsPerRun ?? 1000,
      "maxAgentsPerRun"
    ),
    maxBoundaryItems: validateCap(
      options.maxBoundaryItems ?? 4096,
      "maxBoundaryItems"
    ),
    maxConcurrentAgents: validateCap(
      options.maxConcurrentAgents ?? Math.min(16, available),
      "maxConcurrentAgents"
    ),
    maxWorkflowDepth: validateCap(
      options.maxWorkflowDepth ?? 1,
      "maxWorkflowDepth"
    )
  }
}

function validateCap(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}
