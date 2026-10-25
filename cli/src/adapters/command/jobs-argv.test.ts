import { expect, test } from 'bun:test'
import { UsageError, parseArgs } from './argv'

const cmd = (...argv: string[]) => parseArgs(argv).command

test('neo jobs: list, add a sentence, the detailed add, edit, on/off, rm, clear, test', () => {
  expect(cmd('jobs')).toEqual({ name: 'jobs-list' })
  expect(cmd('jobs', 'list')).toEqual({ name: 'jobs-list' })
  expect(cmd('jobs', 'parse', 'ปลุก', '7', 'โมง')).toEqual({ name: 'jobs-parse', speech: 'ปลุก 7 โมง' })
  expect(cmd('jobs', 'add', 'ปลุกพรุ่งนี้ตีห้าครึ่ง')).toEqual({ name: 'jobs-add-speech', speech: 'ปลุกพรุ่งนี้ตีห้าครึ่ง', yes: false })
  expect(cmd('jobs', 'add', 'ปลุก 7 โมง', '--yes')).toEqual({ name: 'jobs-add-speech', speech: 'ปลุก 7 โมง', yes: true })
  const detailed = cmd('jobs', 'add', '--kind', 'task', '--title', 'ข่าว', '--prompt', 'สรุปข่าว', '--cron', '*/5 * * * *')
  expect(detailed).toEqual({ name: 'jobs-add', kind: 'task', title: 'ข่าว', prompt: 'สรุปข่าว', at: undefined, cron: '*/5 * * * *' })
  const at = cmd('jobs', 'add', '--kind', 'alarm', '--at', '2030-01-02 06:30')
  expect(at).toMatchObject({ name: 'jobs-add', at: new Date(2030, 0, 2, 6, 30).getTime() })
  expect(cmd('jobs', 'edit')).toEqual({ name: 'jobs-edit', ref: undefined, patch: { title: undefined, prompt: undefined, at: undefined, cron: undefined } })
  expect(cmd('jobs', 'edit', 'ยา', 'เช้า', '--title', 'x')).toMatchObject({ name: 'jobs-edit', ref: 'ยา เช้า', patch: { title: 'x' } })
  expect(cmd('jobs', 'on', 'ยา')).toEqual({ name: 'jobs-enable', ref: 'ยา', enabled: true })
  expect(cmd('jobs', 'off', 'ยา')).toEqual({ name: 'jobs-enable', ref: 'ยา', enabled: false })
  expect(cmd('jobs', 'rm', 'abc')).toEqual({ name: 'jobs-rm', ref: 'abc' })
  expect(cmd('jobs', 'clear')).toEqual({ name: 'jobs-clear', kind: undefined })
  expect(cmd('jobs', 'clear', '--kind', 'task')).toEqual({ name: 'jobs-clear', kind: 'task' })
  expect(cmd('jobs', 'test', 'abc')).toEqual({ name: 'jobs-test', ref: 'abc' })
})

test('neo alarm stop / snooze', () => {
  expect(cmd('alarm', 'stop')).toEqual({ name: 'alarm-stop' })
  expect(cmd('alarm', 'snooze', '10')).toEqual({ name: 'alarm-snooze', minutes: 10 })
})

test.each([
  [['jobs', 'wat']],
  [['jobs', 'on']],
  [['jobs', 'rm']],
  [['jobs', 'list', 'extra']],
  [['jobs', 'add', '--kind', 'alarm']],
  [['jobs', 'add', '--kind', 'alarm', '--at', '2030-01-02 06:30', '--cron', '* * * * *']],
  [['jobs', 'add', '--kind', 'nap', '--cron', '* * * * *']],
  [['jobs', 'add', '--kind', 'alarm', '--at', 'tomorrow']],
  [['jobs', 'add', '--kind', 'alarm', '--at', '2030-02-30 06:30']],
  [['jobs', 'add', 'ปลุก 7 โมง', '--cron', '* * * * *']],
  [['jobs', 'edit', '--title', 'x']],
  [['jobs', 'clear', '--kind', 'nap']],
  [['jobs', 'list', '--yes']],
  [['alarm']],
  [['alarm', 'snooze']],
  [['alarm', 'snooze', '0']],
  [['alarm', 'snooze', '61']],
  [['alarm', 'stop', 'now']],
])('usage error for %j', argv => {
  expect(() => parseArgs(argv)).toThrow(UsageError)
})
