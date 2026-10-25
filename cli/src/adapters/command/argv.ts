import { SETTING_NAMES, type SettingName } from '../../protocol'
import { BRAIN_SWITCHES, BRAIN_USAGE, BRAIN_VALUE_FLAGS, parseBrainArgv, type BrainCommand } from './brain-argv'
import { parseDreamArgv, DREAM_USAGE, type DreamCommand } from './dream-argv'
import { PET_SWITCHES, PET_USAGE, PET_VALUE_FLAGS, parsePetArgv, type PetCommand } from './pet-argv'
import { JOBS_SWITCHES, JOBS_USAGE, JOBS_VALUE_FLAGS, parseJobsArgv, type JobsCommand } from './jobs-argv'

export class UsageError extends Error {}

export interface Globals {
  home?: string
  json: boolean
  quiet: boolean
}

export type Command =
  | { name: 'status' }
  | { name: 'events'; history: boolean }
  | { name: 'say'; text: string; wait: boolean }
  | { name: 'cancel' }
  | { name: 'settings' }
  | { name: 'settings-set'; key: SettingName; args: string[] }
  | { name: 'daemon-run'; port: number }
  | { name: 'devices-list' }
  | { name: 'devices-pair' }
  | { name: 'devices-revoke'; id: string }
  | { name: 'daemon'; verb: DaemonVerb; follow: boolean; port?: number }
  | { name: 'memory-show' } | { name: 'memory-edit' } | { name: 'memory-clear' }
  | { name: 'memory-add'; text: string; section?: string }
  | { name: 'memory-forget'; text: string; all: boolean }
  | { name: 'journal-list' } | { name: 'journal-clear' }
  | { name: 'journal-show'; day?: string } | { name: 'journal-edit'; day: string }
  | { name: 'journal-forget'; text: string; all: boolean }
  | { name: 'phone-audio'; file: string }
  | { name: 'doctor'; fix?: string }
  | JobsCommand
  | DreamCommand
  | BrainCommand
  | PetCommand
  | { name: 'help' }

export const DEFAULT_PORT = 8000
export const DAEMON_VERBS = ['install', 'start', 'stop', 'restart', 'status', 'logs', 'uninstall'] as const
export type DaemonVerb = (typeof DAEMON_VERBS)[number]

export const USAGE = `neo <คำสั่ง> [ตัวเลือก]

  neo status                       สถานะตอนนี้
  neo say "<ข้อความ>" [--no-wait]   พิมพ์คุยกับ Neo (ทางเดียวกับเสียงพูด) รอการ์ดคำตอบ
  neo phone audio <ไฟล์.wav|->      เล่นไฟล์เสียง (WAV 16 kHz mono) เหมือนพูดใส่มือถือ ได้การ์ดเหมือนเสียงจริง
  neo doctor [--fix stt]           ตรวจเครื่อง (--fix stt = ขอสิทธิ์ Speech Recognition)
  neo cancel                       ยกเลิกงานที่ทำอยู่
  neo events [--history]           ดูเหตุการณ์สด (--history = เล่นย้อนหลังก่อน)
  neo settings                     ดูการตั้งค่า
  neo settings set <key> <ค่า>      key: ${SETTING_NAMES.join(' | ')}
                                   (home <เมือง> <lat> <lon> · mcpServers a,b · claudeConfigDir/home/mcpServers unset = ล้างค่า)
  neo devices pair                 สร้างรหัสจับคู่มือถือ + ที่อยู่ที่ต่อได้
  neo devices list                 มือถือที่จับคู่แล้ว (เห็นล่าสุดเมื่อไร)
  neo devices revoke <id>          ยกเลิกการจับคู่
  neo memory show|edit|clear       ความจำของ Neo (memory.md); edit เปิด $EDITOR และไม่บันทึกถ้าไฟล์ถูกแก้ซ้อน
  neo memory add "<ข้อความ>" [--section <หัวข้อ>]   เพิ่มหนึ่งข้อ
  neo memory forget "<ข้อความ>" [--all]   ลบข้อที่ตรง (ตรงหลายข้อ: แสดงรายการ exit 1 ยกเว้น --all)
  neo journal list                 วันที่มีบันทึกคำถาม-คำตอบ
  neo journal show [<วัน>]         ดูบันทึกของวัน (YYYY-MM-DD | today | yesterday)
  neo journal edit <วัน>           แก้ไฟล์ของวันนั้นใน $EDITOR
  neo journal forget "<ข้อความ>" [--all] · neo journal clear   ลบบันทึก
${DREAM_USAGE}
${JOBS_USAGE}
${BRAIN_USAGE}
${PET_USAGE}
  neo daemon run [--port <n>]      รัน Neo daemon (ค่าเริ่มต้น port ${DEFAULT_PORT})
  neo daemon install [--port <n>]  ติดตั้ง LaunchAgent + symlink ~/.local/bin/neo แล้วเริ่ม
  neo daemon start|stop|restart    สั่ง daemon ผ่าน launchd
  neo daemon status                ติดตั้งแล้วไหม · pid · version · build · protocol
  neo daemon logs [-f]             ดู log ของ daemon (-f = ตามต่อ)
  neo daemon uninstall             ถอด LaunchAgent + symlink (เก็บข้อมูลใน NEO_HOME)

ตัวเลือกทั่วไป: --home <dir> · --json · -q/--quiet
exit code: 0 ปกติ · 1 ทำไม่ได้ · 2 ใช้คำสั่งผิด · 3 Neo daemon ไม่ได้ทำงาน`

/** Flags with a value; everything else starting with `-` must be a known switch. */
const VALUE_FLAGS = new Set(['--home', '--port', '--section', '--fix', ...JOBS_VALUE_FLAGS, ...BRAIN_VALUE_FLAGS, ...PET_VALUE_FLAGS])
const SWITCHES = new Set(['--json', '-q', '--quiet', '--history', '--no-wait', '--help', '-h', '-f', '--all', ...JOBS_SWITCHES, ...BRAIN_SWITCHES, ...PET_SWITCHES])

const NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/

export function parseArgs(argv: readonly string[]): { globals: Globals; command: Command } {
  const flags = new Map<string, string | true>()
  const words: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('-') || arg === '-' || NEGATIVE_NUMBER.test(arg)) {
      words.push(arg)
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) throw new UsageError(`${arg} ต้องมีค่า`)
      flags.set(arg, value)
    } else if (SWITCHES.has(arg)) {
      flags.set(arg, true)
    } else {
      throw new UsageError(`ไม่รู้จักตัวเลือก ${arg}`)
    }
  }
  const globals: Globals = {
    home: flags.get('--home') as string | undefined,
    json: flags.has('--json'),
    quiet: flags.has('-q') || flags.has('--quiet'),
  }
  const only = (allowed: string[]) => {
    for (const flag of flags.keys()) {
      if (!['--home', '--json', '-q', '--quiet', '-h', '--help', ...allowed].includes(flag)) {
        throw new UsageError(`${flag} ใช้กับคำสั่งนี้ไม่ได้`)
      }
    }
  }
  const noExtra = (n: number) => {
    if (words.length > n) throw new UsageError(`มีค่าเกินมา: ${words.slice(n).join(' ')}`)
  }

  const [noun, verb] = words
  if (flags.has('--help') || flags.has('-h') || noun === 'help') return { globals, command: { name: 'help' } }
  switch (noun) {
    case 'status':
      only([]); noExtra(1)
      return { globals, command: { name: 'status' } }
    case 'say': {
      only(['--no-wait'])
      const text = words.slice(1).join(' ').trim()
      if (!text) throw new UsageError('neo say "<ข้อความ>"')
      return { globals, command: { name: 'say', text, wait: !flags.has('--no-wait') } }
    }
    case 'memory': {
      if (verb === 'show' || verb === 'edit' || verb === 'clear') {
        only([]); noExtra(2)
        return { globals, command: { name: `memory-${verb}` } }
      }
      const text = words.slice(2).join(' ').trim()
      if (verb === 'add') {
        only(['--section'])
        if (!text) throw new UsageError('neo memory add "<ข้อความ>" [--section <หัวข้อ>]')
        return { globals, command: { name: 'memory-add', text, section: flags.get('--section') as string | undefined } }
      }
      if (verb === 'forget') {
        only(['--all'])
        if (!text) throw new UsageError('neo memory forget "<ข้อความ>" [--all]')
        return { globals, command: { name: 'memory-forget', text, all: flags.has('--all') } }
      }
      throw new UsageError(`ไม่รู้จัก memory ${verb ?? ''}`.trim())
    }
    case 'journal': {
      if (verb === 'list' || verb === 'clear') {
        only([]); noExtra(2)
        return { globals, command: { name: `journal-${verb}` } }
      }
      if (verb === 'show') {
        only([]); noExtra(3)
        return { globals, command: { name: 'journal-show', day: words[2] } }
      }
      if (verb === 'edit') {
        only([]); noExtra(3)
        if (!words[2]) throw new UsageError('neo journal edit <วัน>')
        return { globals, command: { name: 'journal-edit', day: words[2] } }
      }
      if (verb === 'forget') {
        only(['--all'])
        const text = words.slice(2).join(' ').trim()
        if (!text) throw new UsageError('neo journal forget "<ข้อความ>" [--all]')
        return { globals, command: { name: 'journal-forget', text, all: flags.has('--all') } }
      }
      throw new UsageError(`ไม่รู้จัก journal ${verb ?? ''}`.trim())
    }
    case 'phone': {
      const act = parsePetArgv(noun, words, flags, { only, noExtra, fail: message => { throw new UsageError(message) } })
      if (act) return { globals, command: act }
      if (verb !== 'audio') throw new UsageError(`ไม่รู้จัก phone ${verb ?? ''}`.trim())
      only([]); noExtra(3)
      if (!words[2]) throw new UsageError('neo phone audio <ไฟล์.wav | ->')
      return { globals, command: { name: 'phone-audio', file: words[2] } }
    }
    case 'doctor':
      only(['--fix']); noExtra(1)
      return { globals, command: { name: 'doctor', fix: flags.get('--fix') as string | undefined } }
    case 'cancel':
      only([]); noExtra(1)
      return { globals, command: { name: 'cancel' } }
    case 'events':
      only(['--history']); noExtra(1)
      return { globals, command: { name: 'events', history: flags.has('--history') } }
    case 'settings': {
      only([])
      if (verb === undefined) return { globals, command: { name: 'settings' } }
      if (verb !== 'set') throw new UsageError(`ไม่รู้จัก settings ${verb}`)
      const [, , key, ...args] = words
      if (!(SETTING_NAMES as readonly string[]).includes(key ?? '')) throw new UsageError(`key ต้องเป็น ${SETTING_NAMES.join(' | ')}`)
      if (!args.length) throw new UsageError(`neo settings set ${key} <ค่า>`)
      return { globals, command: { name: 'settings-set', key: key as SettingName, args } }
    }
    case 'devices': {
      only([])
      if (verb === 'list') { noExtra(2); return { globals, command: { name: 'devices-list' } } }
      if (verb === 'pair') { noExtra(2); return { globals, command: { name: 'devices-pair' } } }
      if (verb === 'revoke') {
        noExtra(3)
        if (!words[2]) throw new UsageError('neo devices revoke <id>')
        return { globals, command: { name: 'devices-revoke', id: words[2] } }
      }
      throw new UsageError(`ไม่รู้จัก devices ${verb ?? ''}`.trim())
    }
    case 'daemon': {
      const lifecycleVerb = DAEMON_VERBS.find(v => v === verb)
      if (verb !== 'run' && !lifecycleVerb) throw new UsageError(`ไม่รู้จัก daemon ${verb ?? ''}`.trim())
      only(verb === 'logs' ? ['-f'] : verb === 'run' || verb === 'install' ? ['--port'] : []); noExtra(2)
      const raw = flags.get('--port')
      const port = raw === undefined ? undefined : Number(raw)
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new UsageError('--port ต้องเป็นตัวเลข 1-65535')
      if (lifecycleVerb) return { globals, command: { name: 'daemon', verb: lifecycleVerb, follow: flags.has('-f'), port } }
      return { globals, command: { name: 'daemon-run', port: port ?? DEFAULT_PORT } }
    }
    case 'jobs':
    case 'alarm': {
      const fail = (message: string): never => {
        throw new UsageError(message)
      }
      return { globals, command: parseJobsArgv(noun, words, flags, { only, noExtra, fail })! }
    }
    case 'dream':
      return { globals, command: parseDreamArgv(noun, words, { only, noExtra, fail: message => { throw new UsageError(message) } })! }
    case 'pet':
    case 'name':
    case 'face':
      return { globals, command: parsePetArgv(noun, words, flags, { only, noExtra, fail: message => { throw new UsageError(message) } })! }
    case 'provider':
    case 'model': {
      const fail = (message: string): never => {
        throw new UsageError(message)
      }
      return { globals, command: parseBrainArgv(noun, words, flags, { only, noExtra, fail })! }
    }
    case undefined:
      throw new UsageError('ต้องระบุคำสั่ง')
    default:
      throw new UsageError(`ไม่รู้จักคำสั่ง ${noun}`)
  }
}
