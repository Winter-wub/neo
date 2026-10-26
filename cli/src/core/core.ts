import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DoctorRow, NeoEvent, Status } from '../protocol'
import type { Brain } from './brain/brain'
import { createAnimations } from './animations/animations'
import { createClaudeBrain } from './brain/claude'
import type { Discovery } from './brain/discover'
import { createBrainHub } from './brain/hub'
import { humanize } from './cards/cards'
import type { Clock } from './clock'
import { createConversation, type Outcome } from './conversation/conversation'
import { createDevices } from './devices/devices'
import { agentsRow, claudeRow, claudeVersion, fdaRow, locate, networkRow, phoneRow, type FdaProbe } from './doctor/doctor'
import { sttRow } from './ears/doctor'
import { createEars } from './ears/ears'
import { createHelperStt } from './ears/helper'
import type { Stt, SttDoctor } from './ears/stt'
import { createEvents } from './events/events'
import { jobsRow } from './jobs/doctor'
import { createJobs } from './jobs/jobs'
import { createMemory } from './memory/memory'
import { createIdentity } from './pet/identity'
import { createRename } from './pet/rename'
import { createPet } from './pet/pet'
import { createSettings } from './settings/settings'
import { createWeather, homeOf } from './weather/weather'

type Live = Pick<Status, 'phone' | 'provider' | 'model' | 'thinking' | 'ringing' | 'busy'>

/** The core: knows nothing about HTTP or argv. Adapters wrap it. */
export async function createCore({ home, clock, pid, brain, discover, stt, audioDir = join(tmpdir(), 'neo-audio'), env = process.env, weatherFetch, dream, doctorProbes }: {
  home: string
  clock: Clock
  pid: number
  /** Tests inject a fake; the default is the Claude Code provider. */
  brain?: Brain
  /** The agents this machine offers (acpx registry + ACP probes). Default none: tests never run real agents; the daemon passes the real one. */
  discover?: () => Promise<Discovery>
  /** Tests inject a fake; the default is the neo-stt helper (`NEO_STT`, else next to the neo binary). */
  stt?: Stt & Partial<SttDoctor>
  /** Where the last speech segments are kept for debugging (rotating). */
  audioDir?: string
  env?: Record<string, string | undefined>
  /** Tests inject a fake open-meteo; the default is the network. */
  weatherFetch?: typeof fetch
  /** Tests inject a fake; the default is Memory's dream (after 15 minutes of deep sleep). */
  dream?: (reason: string) => unknown
  /** Tests replace what `neo doctor` really does to the machine (`claude --version`, reading a protected folder). */
  doctorProbes?: { claudeVersion?: () => Promise<string>; fda?: () => Promise<FdaProbe> }
}) {
  const startedAt = clock.now()
  const events = createEvents({ clock })
  const settings = await createSettings({ home, events })
  const devices = await createDevices({ home, clock, events })
  const memory = createMemory({
    home, clock, events,
    // read when a dream starts, so these may point at things created below
    dreaming: { brain: () => hub.brain, petName: () => identity.wake().name, busy: () => live.thinking, enabled: () => settings.get().dream },
  })
  const store = { read: settings.raw, write: settings.setRaw }
  const identity = createIdentity({ events, store })
  // after 15 minutes of deep sleep Pet asks Memory to dream (when the dream setting is on)
  const pet = createPet({ clock, events, store, dream: dream ?? (reason => memory.dreamIfAllowed(reason)) })
  const jobs = await createJobs({ home, clock, events, ask: text => conversation.ask(text), busy: () => live.thinking, onState: state => update(state) })
  const live: Live = { phone: false, provider: '', model: null, thinking: false, ringing: false, busy: false }
  // the settings win; the environment variables only fill in while a setting is unset
  const claudeConfigDir = () => settings.get().claudeConfigDir ?? (env.CLAUDE_CONFIG_DIR || undefined)
  const mcpServers = () => settings.get().mcpServers ?? env.NEO_MCP?.split(',').map(x => x.trim()).filter(Boolean)
  const hub = await createBrainHub({
    home, events, env, discover,
    // chosen provider and models live in state.json next to the settings
    store: { read: settings.raw, write: settings.setRaw },
    // under NEO_HOME, not $TMPDIR: the file holds MCP tokens and the old Neo writes $TMPDIR/neo-mcp.json
    claude: model => brain ?? createClaudeBrain({ cwd: join(home, 'tasks'), mcpFile: join(home, 'neo-mcp.json'), neoCommand: [process.execPath, 'mcp'], claudeConfigDir, mcpServers, model, env }),
    mcp: { configDir: claudeConfigDir, servers: mcpServers, neoCommand: [process.execPath, 'mcp'] },
    bypass: () => settings.get().bypass,
    petName: () => identity.wake().name,
    log: discover ? message => console.log(message) : undefined, // tests stay quiet
    onChange: () => update(hub.status()),
    onProviderChange: () => conversation.reset(),
  })
  Object.assign(live, hub.status())

  // pixel loops for the tools Neo uses, drawn in the background by the Brain in use (never while it is answering)
  const animations = createAnimations({
    home, clock, events, brain: hub.brain, busy: () => live.thinking,
    createdBy: () => [live.provider, live.model].filter(Boolean).join(' / '),
    log: discover ? message => console.log(message) : undefined, // tests stay quiet
  })

  const status = (): Status => {
    const { requireName, bypass } = settings.get()
    return {
      ...live,
      consoles: events.listeners(),
      requireName,
      bypass,
      pet: pet.current(),
      uptime: Math.floor((clock.now() - startedAt) / 1000),
      pid,
    }
  }
  const publishStatus = () => events.publish({ type: 'status', ...status() })
  const update = (patch: Partial<Live>) => {
    const changed = (Object.keys(patch) as Array<keyof Live>).some(key => patch[key] !== live[key])
    Object.assign(live, patch)
    if (changed) publishStatus()
  }
  const helper = stt ? null : createHelperStt({ command: env.NEO_STT ?? join(dirname(process.execPath), 'neo-stt') })
  if (helper && (await stat(env.NEO_STT ?? join(dirname(process.execPath), 'neo-stt')).catch(() => null))) helper.start()
  const speech = stt ?? helper!
  const weather = createWeather({ fetch: weatherFetch, home: () => homeOf(settings.raw('home')) })
  const rename = createRename({ identity })
  const conversation = createConversation({
    events, clock, settings: settings.get, onBusy: thinking => { update({ thinking }); animations.onBusy(thinking) }, toolAnimation: animations.onTool, listen: () => ears.listen(),
    memory: memory.context, onTurn: memory.record,
    pet: identity.wake, petPhrase: pet.understand,
    ringing: jobs.ringHeard, fast: [rename.understand, jobs.understand, animations.understand], intents: { schedule: jobs.intent, weather: weather.forecast },
    understandWeather: weather.understand,
    brain: hub.brain, switchBrain: hub.understand,
  })
  // find the agents in the background: the daemon is usable (with Claude Code) while it looks
  void hub.refresh().catch(e => console.error('agent discovery failed:', e))

  /** What the Ears transcribed. Not for typed text: while the name is being trained these are samples, not commands. */
  const transcript = async (text: string, startedAt?: number): Promise<Outcome> =>
    (await identity.hearing(text)) ? { outcome: 'heard', armed: false } : conversation.hear(text, startedAt)
  const ears = createEars({
    events, clock, stt: speech, audioDir,
    hints: () => [identity.wake().name, ...identity.wake().variants, 'Jira', 'Confluence', 'ยกเลิก', 'สภาพอากาศ'],
    // while the name is being trained, transcripts are samples, not commands
    hear: (text, startedAt) => transcript(text, startedAt),
    busy: () => live.thinking,
    onStreams: count => update({ phone: count > 0 }),
  })

  return {
    events,
    ears,
    /** A tap on the face: the next sentence is the question. */
    arm: conversation.arm,
    /** `neo doctor` rows owned by this core (other modules add theirs). */
    doctor: {
      rows: async (): Promise<DoctorRow[]> => {
        const path = env.PATH ?? ''
        const { tailscale, lan } = settings.get()
        const [claude, fda] = await Promise.all([
          claudeRow({ path, configDir: claudeConfigDir() ?? null, version: doctorProbes?.claudeVersion ?? claudeVersion(path, env) }),
          fdaRow({ probe: doctorProbes?.fda }),
        ])
        return [
          claude,
          await sttRow(speech),
          networkRow({ addresses: devices.addresses(), settings: { tailscale, lan }, tailscaleBin: locate('tailscale', path) }),
          agentsRow({
            providers: hub.list().list,
            found: { acpx: locate('acpx', path), orca: locate(env.ORCA_BIN ?? 'orca', path), 'ego-browser': locate(env.EGO_BIN ?? 'ego-browser', path) },
          }),
          phoneRow({ devices: devices.list(), connected: live.phone }),
          fda,
          jobsRow(jobs.problems(), jobs.list().length),
        ]
      },
      /** Runs one fix; null when there is none for that id. */
      fix: async (id: string): Promise<DoctorRow | null> => (id === 'stt' ? sttRow(speech, { fix: true }) : null),
    },
    /** Stops the neo-stt helper. */
    stop: async () => {
      hub.stop()
      animations.stop()
      jobs.stop()
      pet.stop()
      memory.close()
      await helper?.stop()
    },
    settings,
    devices,
    memory,
    /** The pet (feed, sleep, the phone's reports) and its identity (name, wake-word variants, face). */
    pet,
    identity,
    jobs,
    animations,
    status,
    /** Change what `status` reports; publishes a `status` event if anything differs. */
    update,
    /** Brains: `neo provider …` and `neo model …`. Changes are announced as events and, where the user asked, a card. */
    providers: {
      list: hub.list,
      config: hub.config,
      saveConfig: hub.saveConfig,
      listModels: hub.listModels,
      discover: () => hub.refresh({ announce: true }),
      async use(name: string) {
        if (name !== hub.current()) conversation.cancel() // work for the old brain is dropped, as before
        const card = humanize(await hub.use(name))
        events.publish({ type: 'card', card })
        return { current: hub.current(), card }
      },
      async useModel(model: string | null, name?: string) {
        const card = humanize(await hub.useModel(model, name))
        events.publish({ type: 'card', card })
        return { card }
      },
    },
    /** A transcript of the phone's microphone (the Ears' path). */
    transcript,
    /** What was typed or said: the one path into Conversation. */
    say: conversation.hear,
    /** Stop the work in progress. Resolves false when nothing was running. */
    cancel: conversation.cancel,
    /** A stream client (neo events). Counts as a console while attached. */
    attach(listener: (event: NeoEvent) => void, options?: { history?: boolean }) {
      const detach = events.subscribe(listener, options)
      publishStatus()
      return () => {
        detach()
        publishStatus()
      }
    },
  }
}

export type Core = Awaited<ReturnType<typeof createCore>>
