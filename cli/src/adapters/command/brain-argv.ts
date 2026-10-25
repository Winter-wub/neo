/** Flags `neo provider` / `neo model` add to the parser. */
export const BRAIN_VALUE_FLAGS = ['--file', '--provider'] as const
export const BRAIN_SWITCHES = ['--api-key-stdin'] as const

export type BrainCommand =
  | { name: 'provider-list' }
  | { name: 'provider-use'; provider: string }
  | { name: 'provider-discover' }
  | { name: 'provider-config'; provider?: string }
  | { name: 'provider-config-set'; provider: string; file: string; apiKeyStdin: boolean }
  | { name: 'provider-config-rm'; provider: string }
  | { name: 'model-list'; provider?: string }
  | { name: 'model-use'; model: string; provider?: string }

export const BRAIN_USAGE = `  neo provider list                รายการสมอง (Claude Code, agent ที่หาเจอ, custom) และอันที่ใช้อยู่
  neo provider use <ชื่อ>           สลับสมอง
  neo provider discover            หา agent ในเครื่องใหม่ (acpx registry + ทดลองคุย ACP)
  neo provider config [<ชื่อ>]       ดูค่าตั้ง (ไม่แสดง API key)
  neo provider config set <ชื่อ> --file cfg.json [--api-key-stdin]   เพิ่ม/แก้ custom provider; key อ่านจาก stdin เก็บเป็นไฟล์ 0600
  neo provider config rm <ชื่อ>      ลบค่าตั้ง
  neo model list [--provider <ชื่อ>]   ชื่อเล่นและโมเดลที่มี
  neo model use <โมเดล|ชื่อเล่น|default> [--provider <ชื่อ>]   เลือกโมเดล`

type Flags = Map<string, string | true>

/** Parses `neo provider …` and `neo model …`. Returns null for any other noun. */
export function parseBrainArgv(
  noun: string | undefined,
  words: string[],
  flags: Flags,
  { only, noExtra, fail }: { only(allowed: string[]): void; noExtra(n: number): void; fail(message: string): never },
): BrainCommand | null {
  const [, verb] = words
  const text = (flag: string) => {
    const value = flags.get(flag)
    return typeof value === 'string' ? value : undefined
  }
  if (noun === 'provider') {
    switch (verb) {
      case undefined:
      case 'list':
        only([]); noExtra(2)
        return { name: 'provider-list' }
      case 'use':
        only([]); noExtra(3)
        return { name: 'provider-use', provider: words[2] ?? fail('neo provider use <ชื่อ>') }
      case 'discover':
        only([]); noExtra(2)
        return { name: 'provider-discover' }
      case 'config': {
        const sub = words[2]
        if (sub === 'set') {
          only(['--file', '--api-key-stdin']); noExtra(4)
          return {
            name: 'provider-config-set',
            provider: words[3] ?? fail('neo provider config set <ชื่อ> --file cfg.json [--api-key-stdin]'),
            file: text('--file') ?? fail('ต้องระบุ --file cfg.json'),
            apiKeyStdin: flags.has('--api-key-stdin'),
          }
        }
        if (sub === 'rm') {
          only([]); noExtra(4)
          return { name: 'provider-config-rm', provider: words[3] ?? fail('neo provider config rm <ชื่อ>') }
        }
        only([]); noExtra(3)
        return { name: 'provider-config', provider: sub }
      }
      default:
        return fail(`ไม่รู้จัก provider ${verb}`)
    }
  }
  if (noun === 'model') {
    switch (verb) {
      case undefined:
      case 'list':
        only(['--provider']); noExtra(2)
        return { name: 'model-list', provider: text('--provider') }
      case 'use':
        only(['--provider']); noExtra(3)
        return { name: 'model-use', model: words[2] ?? fail('neo model use <โมเดล>'), provider: text('--provider') }
      default:
        return fail(`ไม่รู้จัก model ${verb}`)
    }
  }
  return null
}
