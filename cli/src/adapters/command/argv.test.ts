import { expect, test } from 'bun:test'
import { UsageError, parseArgs } from './argv'

const cmd = (...argv: string[]) => parseArgs(argv)

test('parses the commands of this ticket with their flags', () => {
  expect(cmd('status', '--json').command).toEqual({ name: 'status' })
  expect(cmd('status', '--json').globals.json).toBe(true)
  expect(cmd('events', '--history').command).toEqual({ name: 'events', history: true })
  expect(cmd('--home', '/x', 'events').globals.home).toBe('/x')
  expect(cmd('settings', 'set', 'bypass', 'false').command).toEqual({ name: 'settings-set', key: 'bypass', args: ['false'] })
  expect(cmd('settings', 'set', 'home', 'เชียงใหม่', '18.79', '-98.98').command).toEqual({ name: 'settings-set', key: 'home', args: ['เชียงใหม่', '18.79', '-98.98'] })
  expect(cmd('daemon', 'run', '--port', '8100').command).toEqual({ name: 'daemon-run', port: 8100 })
  expect(cmd('daemon', 'run').command).toEqual({ name: 'daemon-run', port: 8000 })
  expect(cmd('-q', 'status').globals.quiet).toBe(true)
})

test.each([
  [[]],
  [['nope']],
  [['status', '--wat']],
  [['status', 'extra']],
  [['events', '--port', '1']],
  [['--home']],
  [['settings', 'set', 'bypass']],
  [['settings', 'set', 'color', 'true']],
  [['daemon', 'run', '--port', '99999']],
  [['daemon', 'bogus']],
  [['daemon', 'stop', '--port', '1']],
  [['daemon', 'start', '-f']],
  [['daemon']],
])('usage error for %j', argv => {
  expect(() => parseArgs(argv)).toThrow(UsageError)
})
