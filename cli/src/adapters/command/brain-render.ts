import type { DiscoveredAgent, ModelList, ProviderConfigView, ProviderList } from '../../protocol'

const yes = (value: boolean) => (value ? 'ใช่' : 'ไม่')

export function providersMarkdown({ current, list }: ProviderList) {
  return [
    '# สมองของ Neo',
    '',
    ...list.map(p => `- **${p.name}**${p.name === current ? ' ← ใช้อยู่' : ''} · ${p.label}${p.type ? ` · ${p.type}` : ''}${p.found ? '' : ' · ตั้งเอง'}${p.model ? ` · โมเดล ${p.model}` : ''}`),
    '',
    'สลับ: neo provider use <ชื่อ>',
  ].join('\n')
}

export function discoveredMarkdown(agents: DiscoveredAgent[]) {
  if (!agents.length) return 'ไม่พบ agent ในเครื่อง (ติดตั้ง Claude Code หรือ agent ที่รองรับ ACP)'
  return [
    '# agent ที่หาเจอ',
    '',
    ...agents.map(a => `- **${a.name}** · ${a.label} · ${a.available ? `ใช้ได้${a.via ? ` (${a.via})` : ''}` : `ใช้ไม่ได้${a.why ? `: ${a.why}` : ''}`}`),
  ].join('\n')
}

/** The config of one provider (`name`) or of all of them. Keys are never shown, only whether one was found. */
export function configMarkdown(view: ProviderConfigView, name?: string) {
  const row = (n: string) => {
    const c = view.providers[n]!
    const lines = [`## ${n}`, `- **label:** ${c.label ?? n}`, `- **type:** ${c.type ?? '—'}`]
    if (c.baseUrl) lines.push(`- **baseUrl:** ${c.baseUrl}`)
    if (c.url) lines.push(`- **url:** ${c.url}`)
    if (c.command) lines.push(`- **command:** ${[c.command, ...(c.args ?? [])].join(' ')}`)
    if (c.model) lines.push(`- **model:** ${c.model}`)
    if (c.aliases?.length) lines.push(`- **aliases:** ${c.aliases.join(', ')}`)
    if (c.models && Object.keys(c.models).length) lines.push(`- **models:** ${Object.entries(c.models).map(([a, id]) => `${a} → ${id}`).join(', ')}`)
    if (c.apiKeyEnv || c.apiKeyFile) lines.push(`- **API key:** ${yes(view.keys[n] ?? false)} (${[c.apiKeyEnv && `env ${c.apiKeyEnv}`, c.apiKeyFile && `ไฟล์ ${c.apiKeyFile}`].filter(Boolean).join(' / ')})`)
    return lines.join('\n')
  }
  const names = name ? [name] : Object.keys(view.providers)
  return ['# ค่าตั้งของสมอง', '', ...names.map(row)].join('\n\n').replace('\n\n\n', '\n\n')
}

export function modelsMarkdown(models: ModelList) {
  const lines = [`# โมเดลของ ${models.name}`, '', `ใช้อยู่: ${models.current ?? 'ค่าเริ่มต้น'}`]
  if (models.mapped.length) lines.push('', '## ชื่อเล่น', ...models.mapped.map(m => `- ${m.alias} → ${m.id}`))
  if (models.list.length) lines.push('', '## โมเดลที่มี', ...models.list.map(m => `- ${m.id}${m.name !== m.id ? ` — ${m.name}` : ''}`))
  if (models.error) lines.push('', `ถามรายชื่อไม่สำเร็จ: ${models.error}`)
  else if (!models.list.length && !models.mapped.length) lines.push('', 'ไม่มีรายชื่อโมเดล (ใส่ชื่อเล่นได้ใน providers.json → models)')
  lines.push('', 'เลือก: neo model use <โมเดล>')
  return lines.join('\n')
}
