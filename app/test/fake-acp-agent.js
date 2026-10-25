#!/usr/bin/env node
// agent ACP จำลองสำหรับเทสต์ (ไม่เรียกโมเดลจริง): จำจำนวนรอบต่อ session, ขออนุญาตเมื่อ prompt มี PERM, รอ cancel เมื่อมี SLOW
'use strict';
let buf = '', nextId = 1000; const sessions = {}, waiting = {};
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
const update = (sid, u) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: u } });
const say = (sid, text) => update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) handle(JSON.parse(l)); } });
async function handle(m) {
  if (m.id !== undefined && !m.method && waiting[m.id]) { waiting[m.id](m.result); delete waiting[m.id]; return; }
  const reply = result => out({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') return reply({ protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'fake' } });
  if (m.method === 'session/new') { const sid = 'S' + (Object.keys(sessions).length + 1); sessions[sid] = { turns: 0, mcp: m.params.mcpServers.map(x => x.name) };
    return reply(process.env.FAKE_MODELS === 'models' ? { sessionId: sid, models: { availableModels: [{ modelId: 'haiku', name: 'Haiku' }, { modelId: 'sonnet', name: 'Sonnet' }], currentModelId: 'haiku' } }
      : { sessionId: sid, configOptions: [{ id: 'model', currentValue: 'm0', options: [{ value: 'm0', name: 'M0' }, { value: 'm1', name: 'M1' }] }] }); }
  if (m.method === 'session/set_model') { sessions[m.params.sessionId].model = m.params.modelId; return reply({}); }
  if (m.method === 'session/set_config_option') { sessions[m.params.sessionId][m.params.configId] = m.params.value; return reply({}); }
  if (m.method === 'session/cancel') { const s = sessions[m.params.sessionId]; if (s.slow) { s.slow({ stopReason: 'cancelled' }); s.slow = null; } return; }
  if (m.method === 'session/prompt') {
    const sid = m.params.sessionId, s = sessions[sid], text = m.params.prompt[0].text; s.turns++;
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 't' + s.turns, title: 'Search the web', kind: 'search', status: 'pending' });
    if (text.includes('SLOW')) { const r = await new Promise(res => { s.slow = res; }); return reply(r); }
    let perm = 'none';
    if (text.includes('PERM')) {
      const id = nextId++;
      const res = await new Promise(r => { waiting[id] = r; out({ jsonrpc: '2.0', id, method: 'session/request_permission', params: { sessionId: sid, toolCall: { toolCallId: 'e1', title: 'Edit README.md', kind: 'edit' }, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] } }); });
      perm = res.outcome.optionId || res.outcome.outcome;
    }
    say(sid, '{"layout":"text","title":"turn ' + s.turns + '","lines":["sid ' + sid + '","perm ' + perm + '","model ' + (s.model || '-') + '","mcp ' + s.mcp.join(',') + '"]}');
    return reply({ stopReason: 'end_turn' });
  }
  if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no' } });
}
