import { cpus } from "node:os"
import type { AppServerAgentHandle } from "./app-server.ts"

export interface WorkflowCaps {
  maxConcurrentAgents: number
  maxAgentsPerRun: number
  maxBoundaryItems: number
  maxWorkflowDepth: number
}

export interface WorkflowCapOptions {
  maxConcurrentAgents?: number
  maxAgentsPerRun?: number
  maxBoundaryItems?: number
  maxWorkflowDepth?: number
}

export interface WorkflowUsage {
  agentCount: number
  liveAgentCount: number
  replayedAgentCount: number
  subagentTokens: number
  peakConcurrentAgents: number
  modelUsage: Record<string, WorkflowModelUsage>
}

export interface WorkflowModelUsage {
  liveAgentCount: number
  replayedAgentCount: number
  subagentTokens: number
}

export interface WorkflowBudgetState {
  total: number | null
  spent(): number
  remaining(): number
  assertAvailable(): void
  recordTokens(tokens: number, model?: string): void
}

interface ScheduledTask {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
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
  private active = 0
  private peak = 0
  private canceled: WorkflowCanceledError | null = null

  constructor(
    private readonly limit: number,
    private readonly onPeak: (peak: number) => void,
  ) {}

  get activeCount(): number {
    return this.active
  }

  schedule<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.canceled !== null || signal.aborted) return Promise.reject(this.canceled ?? new WorkflowCanceledError())
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ run: async () => run(), resolve: (value) => resolve(value as T), reject })
      this.drain()
    })
  }

  cancel(error: WorkflowCanceledError): void {
    if (this.canceled !== null) return
    this.canceled = error
    while (this.pending.length > 0) this.pending.shift()?.reject(error)
  }

  private drain(): void {
    while (this.active < this.limit && this.pending.length > 0 && this.canceled === null) {
      const task = this.pending.shift()!
      this.active++
      this.peak = Math.max(this.peak, this.active)
      this.onPeak(this.peak)
      void Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--
          this.drain()
        })
    }
  }
}

export interface WorkflowRunStateOptions {
  workflowRunId: string
  caps: WorkflowCaps
  budgetTotal: number | null
  spentSource: number | (() => number)
  signal?: AbortSignal
}

export class WorkflowRunState {
  readonly workflowRunId: string
  readonly caps: WorkflowCaps
  readonly controller = new AbortController()
  readonly signal: AbortSignal
  readonly usage: WorkflowUsage = {
    agentCount: 0,
    liveAgentCount: 0,
    replayedAgentCount: 0,
    subagentTokens: 0,
    peakConcurrentAgents: 0,
    modelUsage: {},
  }
  readonly budget: WorkflowBudgetState
  private readonly queue: AgentQueue
  private readonly activeHandles = new Set<AppServerAgentHandle>()
  private canceled = false
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
      const value = typeof options.spentSource === "function" ? options.spentSource() : options.spentSource
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError("budget.spent() must return a finite non-negative number")
      }
      return value
    }
    this.budget = {
      total: options.budgetTotal,
      spent: () => readSource() + recordedTokens,
      remaining: () => options.budgetTotal === null
        ? Infinity
        : Math.max(0, options.budgetTotal - readSource() - recordedTokens),
      assertAvailable: () => {
        if (options.budgetTotal !== null && readSource() + recordedTokens >= options.budgetTotal) {
          throw new WorkflowCapError(`agent() budget cap reached: spent=${readSource() + recordedTokens}, total=${options.budgetTotal}`)
        }
      },
      recordTokens: (tokens, model = "unknown") => {
        if (!Number.isFinite(tokens) || tokens < 0) throw new TypeError("agent usage tokens must be finite and non-negative")
        recordedTokens += tokens
        this.usage.subagentTokens += tokens
        this.modelBucket(model).subagentTokens += tokens
      },
    }
    if (options.signal) {
      if (options.signal.aborted) this.cancel()
      else options.signal.addEventListener("abort", () => this.cancel(), { once: true })
    }
  }

  reserveAgent(): string {
    this.assertNotCanceled()
    this.budget.assertAvailable()
    if (this.usage.agentCount >= this.caps.maxAgentsPerRun) {
      throw new WorkflowCapError(`agent() lifetime cap reached: maximum ${this.caps.maxAgentsPerRun} agents per workflow run`)
    }
    this.usage.agentCount++
    return `${this.workflowRunId}:agent-${this.usage.agentCount}`
  }

  scheduleAgent<T>(run: () => Promise<T>): Promise<T> {
    this.assertNotCanceled()
    return this.queue.schedule(run, this.signal)
  }

  markLiveAgent(model = "unknown"): void {
    this.usage.liveAgentCount++
    this.modelBucket(model).liveAgentCount++
  }

  markReplayedAgent(model = "unknown"): void {
    this.usage.replayedAgentCount++
    this.modelBucket(model).replayedAgentCount++
  }

  private modelBucket(model: string): WorkflowModelUsage {
    const key = model.length > 0 ? model : "unknown"
    const existing = this.usage.modelUsage[key]
    if (existing) return existing
    const bucket = { liveAgentCount: 0, replayedAgentCount: 0, subagentTokens: 0 }
    this.usage.modelUsage[key] = bucket
    return bucket
  }

  registerHandle(handle: AppServerAgentHandle): () => void {
    this.activeHandles.add(handle)
    return () => this.activeHandles.delete(handle)
  }

  nextWorktreeNumber(): number {
    return ++this.worktreeCount
  }

  get currentCallChain(): string {
    return this.callChain
  }

  set currentCallChain(value: string) {
    this.callChain = value
  }

  cancel(): void {
    if (this.canceled) return
    this.canceled = true
    const error = new WorkflowCanceledError()
    this.queue.cancel(error)
    this.controller.abort(error)
    for (const handle of this.activeHandles) void handle.interrupt().catch(() => undefined)
  }

  assertNotCanceled(): void {
    if (this.canceled || this.signal.aborted) throw new WorkflowCanceledError()
  }
}

export function resolveWorkflowCaps(options: WorkflowCapOptions = {}): WorkflowCaps {
  const available = Math.max(1, cpus().length - 2)
  return {
    maxConcurrentAgents: validateCap(options.maxConcurrentAgents ?? Math.min(16, available), "maxConcurrentAgents"),
    maxAgentsPerRun: validateCap(options.maxAgentsPerRun ?? 1000, "maxAgentsPerRun"),
    maxBoundaryItems: validateCap(options.maxBoundaryItems ?? 4096, "maxBoundaryItems"),
    maxWorkflowDepth: validateCap(options.maxWorkflowDepth ?? 1, "maxWorkflowDepth"),
  }
}

function validateCap(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  return value
}
