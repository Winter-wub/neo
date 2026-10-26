import type { Card } from '../../protocol'

/** What the Brain thinks the user wants. Brain only thinks: Conversation decides what happens next. */
export type Answer =
  | { type: 'card'; card: Card }
  | { type: 'schedule'; kind: string; title: string; prompt: string; at?: string; cron?: string }
  | { type: 'weather'; place: string; day: number }
  | { type: 'skill'; skill: string; plan: string; task: string }
  | { type: 'error'; error: string }

/** Everything Conversation knows that goes into a prompt. The Brain never reads Memory or Settings. */
export interface AskContext {
  petName: string
  wakeVariants: string[]
  memory: string
  /** What Neo answered without the Brain since the last ask (weather, schedule, skill results). */
  notes: string[]
  now: Date
}

interface RunRequest {
  /** Aborting kills the work in progress. */
  signal: AbortSignal
  onTool(name: string, input: string): void
}

/** A tool an ACP agent wants to run that is not read-only. */
export interface PermissionRequest {
  title: string
  /** ACP tool kind: edit, delete, move, execute, other … */
  kind?: string
  /** Label of the agent asking. */
  agent: string
}

export interface AskRequest extends RunRequest {
  text: string
  context: AskContext
  /** Provider session to continue, or null for a fresh one. */
  resume: string | null
  bypass: boolean
  /**
   * A side ask (Animations drawing): runs in a session / history of its own, never reads or replaces the conversation's, and its
   * `session` in the reply is not for resuming.
   */
  side?: boolean
  /** Ask the user (a card, then "ตกลง" within 30 s). Missing → writes are denied. */
  confirm?(request: PermissionRequest): Promise<boolean>
}

export interface SkillRequest extends RunRequest {
  skill: string
  plan: string
  task: string
  petName: string
}

/** `session` is the id to resume next time (null when the provider has none). */
export interface Reply {
  answer: Answer
  session: string | null
}

/** One dream: Memory's reorganising and deeper research while the user is away. The prompt lives in Brain. */
export interface DreamRequest extends RunRequest {
  petName: string
  /** memory.md as it is now. */
  memory: string
  /** The journal turns since the last dream (newest last). `at` is ms since epoch. */
  entries: Array<{ at: number; q: string; a: string; ok: boolean }>
  /** Hours of the day (0–23) when the user is normally away. */
  quietHours: number[]
}

/** What the model said about its dream. Memory decides what to keep. */
export type DreamResult =
  | {
    type: 'dream'
    /** The whole new memory.md. */
    memory: string
    insights: Array<{ q: string; finding: string }>
    patterns: string[]
    dream: string
    card: { title: string; lines: string[]; items: Array<{ t: string; v: string }> }
  }
  | { type: 'error'; error: string }

export interface Brain {
  /** Shown in `status` and `session` events. */
  readonly label: string
  /** Only providers that can research on their own (Claude Code) dream; never rejects. Missing → the provider cannot dream. */
  dream?(request: DreamRequest): Promise<DreamResult>
  /** Never rejects: failures come back as `{type:'error'}`. */
  ask(request: AskRequest): Promise<Reply>
  /** After the user said "ตกลง" to a skill confirmation. */
  runSkill(request: SkillRequest): Promise<Reply>
}

export interface ModelInfo {
  id: string
  name: string
}

/** A Brain that can be chosen in `neo provider use`. */
export interface Provider extends Brain {
  /** Models the provider offers. May start the agent (ACP) or call the endpoint, but never sends a prompt. */
  listModels(): Promise<ModelInfo[]>
  /** Stop any child process. */
  stop?(): void
}
