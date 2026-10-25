import { execFile } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DeviceInfo, DoctorRow, PairAddress, ProviderInfo, Settings } from '../../protocol'
import { which } from '../brain/discover'

/** Where `bin` is on this PATH string (the daemon's, taken from the login shell); null when it isn't there. */
export const locate = (bin: string, path: string) => which(bin, path.split(':').filter(Boolean))

const ADDRESS_METHODS_NOT_LISTENING = ['USB', 'URL ของคุณเอง']
const VERSION_TIMEOUT_MS = 8000
const FDA_HINT = 'เปิด System Settings › Privacy & Security › Full Disk Access แล้วติ๊ก Neo Console (แล้ว neo daemon restart)'
/** Folders macOS only lets a process with Full Disk Access list. Tried in order; the first that exists decides. */
export const PROTECTED_PATHS = ['Library/Safari', 'Library/Mail', 'Library/Messages', 'Library/Application Support/com.apple.TCC'].map(p => join(homedir(), p))

export interface ClaudeCheck {
  /** The daemon's PATH. */
  path: string
  /** The effective Claude Code config dir (setting, else env var). */
  configDir: string | null
  /** `claude --version`; throws with a Thai reason on failure or timeout. */
  version: () => Promise<string>
}

export async function claudeRow({ path, configDir, version }: ClaudeCheck): Promise<DoctorRow> {
  const base = { id: 'claude', label: 'Claude Code (claude)' }
  const claude = locate('claude', path)
  if (!claude) {
    return {
      ...base, ok: false, found: { claude: null },
      detail: 'ไม่พบ claude ใน PATH ของ daemon (PATH มาจาก login shell ตอน daemon เริ่ม)',
      fix: 'ติดตั้ง Claude Code แล้ว neo daemon restart',
    }
  }
  const problems: string[] = []
  const fixes: string[] = []
  let detail = claude
  try {
    detail = `${(await version()).trim()} · ${claude}`
  } catch (e) {
    problems.push(`รัน claude --version ไม่ได้: ${(e as Error).message}`)
    fixes.push('ลองรัน claude --version ใน Terminal เองก่อน')
  }
  if (configDir && !(await access(configDir).then(() => true, () => false))) {
    problems.push(`claudeConfigDir ไม่มีอยู่: ${configDir}`)
    fixes.push('neo settings set claudeConfigDir <โฟลเดอร์ที่มีอยู่> (หรือ neo settings set claudeConfigDir unset)')
  }
  return problems.length
    ? { ...base, ok: false, found: { claude }, detail: problems.join('\n'), fix: fixes.join('\n') }
    : { ...base, ok: true, found: { claude }, detail: configDir ? `${detail}\nconfig: ${configDir}` : detail }
}

export type FdaProbe = 'granted' | 'denied' | 'unknown'

/** Really lists a protected folder: permission refused → `denied`; nothing to try on this Mac → `unknown`. */
export async function probeProtected(paths: readonly string[] = PROTECTED_PATHS): Promise<FdaProbe> {
  for (const path of paths) {
    try {
      await readdir(path)
      return 'granted'
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES') return 'denied'
    }
  }
  return 'unknown'
}

export async function fdaRow({ probe = probeProtected }: { probe?: () => Promise<FdaProbe> } = {}): Promise<DoctorRow> {
  const base = { id: 'fda', label: 'Full Disk Access', optional: true }
  const result = await probe()
  if (result === 'granted') return { ...base, ok: true, detail: 'อ่านโฟลเดอร์ที่ถูกป้องกันได้' }
  if (result === 'denied') return { ...base, ok: false, detail: 'อ่านโฟลเดอร์ที่ถูกป้องกันไม่ได้ งานที่ให้ Claude เปิดไฟล์ใน Documents/Desktop ฯลฯ อาจถูกปฏิเสธ', fix: FDA_HINT }
  return { ...base, ok: true, detail: 'ตรวจไม่ได้ (ไม่มีโฟลเดอร์ที่ใช้ทดสอบบนเครื่องนี้)' }
}

export function phoneRow({ devices, connected }: { devices: readonly DeviceInfo[]; connected: boolean }): DoctorRow {
  const base = { id: 'phone', label: 'มือถือ (NeoApp)' }
  if (!devices.length) return { ...base, ok: false, detail: 'ยังไม่มีมือถือที่จับคู่', fix: 'neo devices pair' }
  const names = devices.map(d => d.name).join(', ')
  return { ...base, ok: true, detail: `จับคู่แล้ว ${devices.length} เครื่อง (${names}) · ${connected ? 'เชื่อมต่ออยู่' : 'ไม่ได้เชื่อมต่อตอนนี้'}` }
}

export function networkRow({ addresses, settings, tailscaleBin }: {
  addresses: readonly PairAddress[]
  settings: Pick<Settings, 'tailscale' | 'lan'>
  tailscaleBin: string | null
}): DoctorRow {
  const base = { id: 'network', label: 'เครือข่ายสำหรับมือถือ', found: { tailscale: tailscaleBin } }
  const listening = addresses.filter(a => !ADDRESS_METHODS_NOT_LISTENING.includes(a.method))
  if (listening.length) return { ...base, ok: true, detail: listening.map(a => `${a.method}: ${a.url}`).join('\n') }
  const fix = !settings.tailscale && !settings.lan
    ? 'neo settings set tailscale true (หรือ neo settings set lan true)'
    : settings.tailscale && !tailscaleBin
      ? 'ติดตั้ง Tailscale แล้วเข้าสู่ระบบ (หรือ neo settings set lan true)'
      : 'ตรวจว่า Tailscale เปิดอยู่ / Mac ต่อ Wi-Fi เดียวกับมือถือ'
  return { ...base, ok: false, optional: true, detail: 'ฟังเฉพาะ localhost (ต่อผ่านสาย USB + adb reverse ได้)', fix }
}

export function agentsRow({ providers, found }: { providers: readonly ProviderInfo[]; found: Record<string, string | null> }): DoctorRow {
  const base = { id: 'agents', label: 'เอเจนต์ (ACP)', found }
  const others = providers.filter(p => p.type !== 'claude-code' && p.found)
  if (!others.length) return { ...base, ok: false, optional: true, detail: 'ไม่พบเอเจนต์อื่นนอกจาก Claude Code', fix: 'ติดตั้ง acpx หรือเอเจนต์ ACP แล้ว neo provider discover' }
  return { ...base, ok: true, detail: others.map(p => p.label).join(', ') }
}

/** `claude --version` on the daemon's PATH; 8 s at most. */
export function claudeVersion(path: string, env: Record<string, string | undefined> = {}) {
  return () =>
    new Promise<string>((resolve, reject) => {
      const claude = locate('claude', path)
      if (!claude) return reject(new Error('ไม่พบ claude'))
      execFile(claude, ['--version'], { timeout: VERSION_TIMEOUT_MS, env: { ...env, PATH: path } }, (error, stdout) => {
        if (error) reject(new Error(error.killed ? 'หมดเวลา' : error.message))
        else resolve(stdout)
      })
    })
}
