import type { Launchctl, LaunchctlResult } from '../src/lifecycle/launchctl'

const ok = (stdout = ''): LaunchctlResult => ({ code: 0, stdout, stderr: '' })
const notLoaded: LaunchctlResult = { code: 113, stdout: '', stderr: 'Could not find service' }

export interface FakeLaunchd {
  launchctl: Launchctl
  calls: string[][]
  loaded: boolean
  pid: number | null
}

/**
 * A launchd with one job. `start` runs when the job is started (RunAtLoad or kickstart) and returns a pid;
 * `stop` runs when it is killed or booted out.
 */
export function fakeLaunchd({ start = async () => 4242, stop = async () => {} }: { start?: () => Promise<number>; stop?: () => Promise<void> } = {}): FakeLaunchd {
  const state: FakeLaunchd = {
    calls: [],
    loaded: false,
    pid: null,
    launchctl: async args => {
      state.calls.push([...args])
      const [verb, ...rest] = args
      const halt = async () => {
        if (state.pid !== null) await stop()
        state.pid = null
      }
      const run = async () => {
        if (state.pid === null) state.pid = await start()
      }
      switch (verb) {
        case 'bootstrap':
          if (state.loaded) return { code: 5, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error' }
          state.loaded = true
          await run()
          return ok()
        case 'bootout':
          if (!state.loaded) return notLoaded
          await halt()
          state.loaded = false
          return ok()
        case 'print':
          return state.loaded ? ok(`gui/501/com.test = {\n\tstate = ${state.pid === null ? 'not running' : 'running'}\n${state.pid === null ? '' : `\tpid = ${state.pid}\n`}}\n`) : notLoaded
        case 'kickstart':
          if (!state.loaded) return notLoaded
          if (rest[0] === '-k') await halt()
          await run()
          return ok()
        case 'kill':
          if (!state.loaded) return notLoaded
          await halt()
          return ok()
        default:
          return { code: 1, stdout: '', stderr: `unexpected launchctl ${args.join(' ')}` }
      }
    },
  }
  return state
}
