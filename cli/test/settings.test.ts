// Ticket 13 end to end: `neo settings set …` against a real core, a real socket and the fake `claude`.
import { afterEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '../src/adapters/command/cli'
import { startCommandServer } from '../src/adapters/command/server'
import { createCore } from '../src/core/core'
import { FakeClock, tempHome } from './helpers'

const FAKE_BIN = join(import.meta.dir, 'fake-bin')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(c => c()))
})

async function running(env: Record<string, string> = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const clock = new FakeClock()
  const core = await createCore({
    home: dir, clock, pid: 1,
    env: { PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_CLAUDE_LOG: join(dir, 'calls.jsonl'), HOME: dir, ...env },
  })
  const server = await startCommandServer({ core, clock, home: dir })
  cleanups.unshift(() => server.stop(), () => core.stop())
  return { dir, core }
}

async function neo(dir: string, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli([...args, '--home', dir], { out: t => void out.push(t), err: t => void err.push(t), env: {} })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

const claudeConfigDirSeen = async (dir: string) =>
  (await readFile(join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l).env.CLAUDE_CONFIG_DIR)

test('claudeConfigDir is a real setting: claude gets it, and unset passes nothing', async () => {
  const { dir } = await running()
  expect((await neo(dir, ['settings', 'set', 'claudeConfigDir', '/cfg/personal'])).code).toBe(0)
  await neo(dir, ['say', 'นีโอ สวัสดี'])
  expect((await neo(dir, ['settings', 'set', 'claudeConfigDir', 'unset'])).code).toBe(0)
  await neo(dir, ['say', 'นีโอ สวัสดีอีกที'])
  expect(await claudeConfigDirSeen(dir)).toEqual(['/cfg/personal', null])
})

test('the CLAUDE_CONFIG_DIR env var is only the fallback while the setting is unset', async () => {
  const { dir } = await running({ CLAUDE_CONFIG_DIR: '/from/env' })
  await neo(dir, ['say', 'นีโอ หนึ่ง'])
  await neo(dir, ['settings', 'set', 'claudeConfigDir', '/from/setting'])
  await neo(dir, ['say', 'นีโอ สอง'])
  expect(await claudeConfigDirSeen(dir)).toEqual(['/from/env', '/from/setting'])
})
