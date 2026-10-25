import type { DeviceInfo, PairStart } from '../../protocol'

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function pairMarkdown({ code, expiresAt, addresses }: PairStart) {
  return [
    '# จับคู่มือถือ',
    '',
    `**รหัส: ${code}** (ใช้ได้ครั้งเดียว หมดอายุ ${clock(expiresAt)})`,
    '',
    'ที่อยู่ที่มือถือต่อได้:',
    ...addresses.map(a => `- **${a.method}:** ${a.url} (${a.note})`),
  ].join('\n')
}

export function devicesMarkdown(devices: DeviceInfo[]) {
  if (!devices.length) return '# อุปกรณ์\n\nยังไม่มีมือถือที่จับคู่ (neo devices pair)'
  return [
    '# อุปกรณ์',
    '',
    ...devices.map(d => `- **${d.name}** · id \`${d.id}\` · จับคู่ ${d.paired.slice(0, 10)} · เห็นล่าสุด ${d.lastSeen ? new Date(d.lastSeen).toLocaleString('en-GB') : 'ยังไม่เคย'}`),
  ].join('\n')
}
