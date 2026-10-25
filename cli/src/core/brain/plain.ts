// Providers with no tools of their own: an OpenAI-compatible chat endpoint (Ollama, LM Studio, vLLM, OpenRouter …)
// or a custom HTTP endpoint. Ported from app/providers.js (OpenAIProvider, HttpProvider).
// The endpoint may be a different machine, so keys come only from the `apiKeyEnv` / `apiKeyFile` the provider names.
import type { ProviderConfig } from '../../protocol'
import type { AskRequest, ModelInfo, Provider, Reply, SkillRequest } from './brain'
import { authHeaders } from './api-key'
import { parseAnswer, parseLoose } from './parse'
import { askPrompt, followUpPrompt } from './prompts'

export const PLAIN_TIMEOUT_MS = 120_000
const MODELS_TIMEOUT_MS = 10_000
const ERROR_BODY_MAX = 120
const TEMPERATURE = 0.3
/** Both providers keep their own history under this id (the endpoint has no session). */
const CHAT_SESSION = 'chat'

export interface PlainOptions {
  name: string
  cfg: ProviderConfig
  env: Record<string, string | undefined>
  /** `~` in `apiKeyFile` expands to this. */
  homeDir?: string
  model?: () => string | null
  timeoutMs?: number
}

class Failure extends Error {}

const trimSlash = (url: string) => url.replace(/\/$/, '')

async function guard(work: () => Promise<Reply>): Promise<Reply> {
  try {
    return await work()
  } catch (e) {
    return { answer: { type: 'error', error: e instanceof Failure ? e.message : String((e as Error)?.message ?? e) }, session: null }
  }
}

/** POST json; maps abort / timeout / network failures to messages that never contain the key. */
async function post(label: string, url: string, headers: Record<string, string>, body: unknown, request: Pick<AskRequest, 'signal'>, timeoutMs: number) {
  if (request.signal.aborted) throw new Failure('interrupted')
  try {
    return await fetch(url, {
      method: 'POST',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch (e) {
    if (request.signal.aborted) throw new Failure('interrupted')
    if ((e as Error).name === 'TimeoutError') throw new Failure('timeout')
    throw new Failure(`${label}: ${(e as Error).message}`)
  }
}

async function failedStatus(label: string, res: Response) {
  const why = await res.text().catch(() => '')
  return new Failure(`${label} ตอบ ${res.status}${res.status === 401 ? ' (ไม่มี/ผิด API key)' : ''} ${why.slice(0, ERROR_BODY_MAX)}`.trim())
}

const noSkills = (label: string) => (_: SkillRequest): Promise<Reply> =>
  Promise.resolve({ answer: { type: 'error', error: `${label} ไม่รองรับขั้น skill` }, session: null })

export function createOpenAiBrain(options: PlainOptions): Provider {
  const { name, cfg, env, homeDir, timeoutMs = PLAIN_TIMEOUT_MS } = options
  const label = cfg.label || name
  const base = trimSlash(cfg.baseUrl ?? '')
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []

  return {
    label,
    ask: request =>
      guard(async () => {
        const fresh = request.resume === null || history.length === 0
        if (fresh) history.length = 0
        const model = options.model?.() ?? cfg.model
        if (!model) throw new Failure(`${label}: ยังไม่ได้เลือกโมเดล — เลือกด้วย neo model use`)
        history.push({ role: 'user', content: fresh ? askPrompt(request.text, request.context, 'plain', request.bypass) : followUpPrompt(request.text, request.context.notes) })
        try {
          const res = await post(label, `${base}/chat/completions`, authHeaders(cfg, env, homeDir), { model, messages: history, temperature: TEMPERATURE }, request, timeoutMs)
          if (!res.ok) throw await failedStatus(label, res)
          const json: any = await res.json().catch(() => ({}))
          const words: string = json?.choices?.[0]?.message?.content ?? ''
          history.push({ role: 'assistant', content: words })
          return { answer: parseLoose(words, request.context.petName), session: CHAT_SESSION }
        } catch (e) {
          if (history.at(-1)?.role === 'user') history.pop() // the turn did not happen
          throw e
        }
      }),
    runSkill: noSkills(label),
    /** `GET {baseUrl}/models` (OpenRouter, Ollama, LM Studio …). */
    async listModels(): Promise<ModelInfo[]> {
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(MODELS_TIMEOUT_MS), headers: authHeaders(cfg, env, homeDir) })
      if (!res.ok) throw new Error(`${label} /models ตอบ ${res.status}`)
      const json: any = await res.json()
      return (json.data ?? json.models ?? []).map((m: any) => ({ id: m.id ?? m.name, name: m.name && m.name !== m.id ? `${m.id} — ${m.name}` : (m.id ?? m.name) }))
    },
  }
}

/** POST `{text, prompt, sessionId, fresh, model}` → `{card}` | `{text}` | `{reply}` (+ `sessionId`). */
export function createHttpBrain(options: PlainOptions): Provider {
  const { name, cfg, env, homeDir, timeoutMs = PLAIN_TIMEOUT_MS } = options
  const label = cfg.label || name

  return {
    label,
    ask: request =>
      guard(async () => {
        const fresh = request.resume === null
        const model = options.model?.() ?? cfg.model ?? null
        const prompt = fresh ? askPrompt(request.text, request.context, 'plain', request.bypass) : followUpPrompt(request.text, request.context.notes)
        const res = await post(label, cfg.url ?? '', authHeaders(cfg, env, homeDir), { text: request.text, prompt, sessionId: request.resume, fresh, model }, request, timeoutMs)
        if (!res.ok) throw await failedStatus(label, res)
        const json: any = await res.json().catch(() => ({}))
        const answer = json.card ? parseAnswer(JSON.stringify(json.card)) : parseLoose(String(json.text ?? json.reply ?? ''), request.context.petName)
        return { answer, session: String(json.sessionId ?? request.resume ?? CHAT_SESSION) }
      }),
    runSkill: noSkills(label),
    // a custom endpoint has no standard way to list models: the names set in `models` are all there is
    listModels: async () => [],
  }
}
