import type { DaemonStatus } from './lifecycle'

const mark = (ok: boolean) => (ok ? '✓' : '✗ (ชี้ไปที่อื่น: รัน neo daemon install เพื่อซ่อม)')

export function daemonStatusMarkdown(s: DaemonStatus) {
  if (!s.installed) {
    return ['# Neo daemon', '', '- **ติดตั้ง:** ยังไม่ได้ติดตั้ง (รัน: neo daemon install)', `- **ทำงานอยู่:** ${s.running ? `ใช่ (pid ${s.pid ?? '?'})` : 'ไม่'}`].join('\n')
  }
  return [
    '# Neo daemon',
    '',
    `- **ติดตั้ง:** ใช่ (${s.label})`,
    `- **ทำงานอยู่:** ${s.running ? `ใช่ (pid ${s.pid ?? '?'})` : s.loaded ? 'ไม่ (หยุดอยู่ รัน: neo daemon start)' : 'ไม่ (launchd ยังไม่โหลด รัน: neo daemon start)'}`,
    ...(s.running ? [`- **version:** ${s.version} · **build:** ${s.build} · **protocol:** ${s.protocol}`] : []),
    `- **binary:** ${s.binary}`,
    `- **plist:** ${s.plist.path} → ${s.plist.binary ?? '—'} ${mark(s.plist.current)}`,
    `- **symlink:** ${s.symlink.path} → ${s.symlink.target ?? '—'} ${mark(s.symlink.current)}`,
    `- **log:** ${s.logs.daemon}`,
  ].join('\n')
}
