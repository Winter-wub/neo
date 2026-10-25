// Fake ACP agent for tests (JSON-RPC over stdio). Never calls a model.
// Appends every request it receives to $FAKE_ACP_LOG as {method, params, env}.
//   prompt contains "PERM"  → asks the client's permission for an edit; the answer reports what it got
//   prompt contains "READ"  → asks permission for a read-kind tool (should never reach the user)
//   prompt contains "SLOW"  → waits for session/cancel
//   prompt contains "TEXT"  → answers plain words (no JSON)
//   FAKE_MODELS=models      → models come as `models.availableModels` instead of a `model` config option
//   FAKE_MODES=a,b          → offers these modes (session/set_mode)
import { appendFileSync } from 'node:fs'

let buf = ''
let nextId = 1000
const sessions = {}
const waiting = {}
const out = m => process.stdout.write(JSON.stringify(m) + '\n')
const update = (sid, u) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: u } })
const say = (sid, text) => update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
const log = m => process.env.FAKE_ACP_LOG && appendFileSync(process.env.FAKE_ACP_LOG, JSON.stringify({ method: m.method, params: m.params, env: { CLAUDECODE: process.env.CLAUDECODE ?? null, CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT ?? null } }) + '\n')

process.stdin.on('data', d => {
  buf += d
  for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
    const l = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (l.trim()) handle(JSON.parse(l))
  }
})

async function permission(sid, toolCall) {
  const id = nextId++
  const res = await new Promise(r => {
    waiting[id] = r
    out({ jsonrpc: '2.0', id, method: 'session/request_permission', params: { sessionId: sid, toolCall, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] } })
  })
  return res.outcome.optionId || res.outcome.outcome
}

async function handle(m) {
  if (m.id !== undefined && !m.method && waiting[m.id]) { waiting[m.id](m.result); delete waiting[m.id]; return }
  if (m.method) log(m)
  const reply = result => out({ jsonrpc: '2.0', id: m.id, result })
  if (m.method === 'initialize') return reply({ protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'fake', title: 'Fake Agent' } })
  if (m.method === 'session/new') {
    const sid = 'S' + (Object.keys(sessions).length + 1)
    sessions[sid] = { turns: 0, mcp: m.params.mcpServers.map(x => x.name) }
    const modes = process.env.FAKE_MODES ? { modes: { availableModes: process.env.FAKE_MODES.split(',').map(id => ({ id })), currentModeId: 'x' } } : {}
    return reply(process.env.FAKE_MODELS === 'models'
      ? { sessionId: sid, models: { availableModels: [{ modelId: 'haiku', name: 'Haiku' }, { modelId: 'sonnet', name: 'Sonnet' }], currentModelId: 'haiku' }, ...modes }
      : { sessionId: sid, configOptions: [{ id: 'model', currentValue: 'm0', options: [{ value: 'm0', name: 'M0' }, { value: 'm1', name: 'M1' }] }], ...modes })
  }
  if (m.method === 'session/set_model') { sessions[m.params.sessionId].model = m.params.modelId; return reply({}) }
  if (m.method === 'session/set_mode') { sessions[m.params.sessionId].mode = m.params.modeId; return reply({}) }
  if (m.method === 'session/set_config_option') { sessions[m.params.sessionId][m.params.configId] = m.params.value; return reply({}) }
  if (m.method === 'session/cancel') { const s = sessions[m.params.sessionId]; if (s.slow) { s.slow({ stopReason: 'cancelled' }); s.slow = null } return }
  if (m.method === 'session/prompt') {
    const sid = m.params.sessionId
    const s = sessions[sid]
    const text = m.params.prompt[0].text
    s.turns++
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 't' + s.turns, title: 'Search the web', kind: 'search', status: 'pending' })
    if (text.includes('SLOW')) return reply(await new Promise(res => { s.slow = res }))
    let perm = 'none'
    if (text.includes('PERM')) perm = await permission(sid, { toolCallId: 'e1', title: 'Edit README.md', kind: 'edit' })
    if (text.includes('READ')) perm = await permission(sid, { toolCallId: 'r1', title: 'Read README.md', kind: 'read' })
    if (text.includes('TEXT')) say(sid, 'ตอบเป็นข้อความธรรมดา')
    else say(sid, JSON.stringify({ layout: 'text', title: 'turn ' + s.turns, lines: ['sid ' + sid, 'perm ' + perm, 'model ' + (s.model || '-'), 'mode ' + (s.mode || '-'), 'mcp ' + s.mcp.join(','), 'fresh ' + text.includes('คุณคือ')] }))
    return reply({ stopReason: 'end_turn' })
  }
  if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no' } })
}
