import { expect, test } from 'bun:test'
import { UsageError, parseArgs } from './argv'

const cmd = (...argv: string[]) => parseArgs(argv).command

test('neo dream: now, on/off, list, show (default last), rm, clear, status', () => {
  expect(cmd('dream', 'now')).toEqual({ name: 'dream-now' })
  expect(cmd('dream', 'on')).toEqual({ name: 'dream-enable', enabled: true })
  expect(cmd('dream', 'off')).toEqual({ name: 'dream-enable', enabled: false })
  expect(cmd('dream', 'list')).toEqual({ name: 'dream-list' })
  expect(cmd('dream', 'show')).toEqual({ name: 'dream-show', id: 'last' })
  expect(cmd('dream', 'show', '2026-10-25-2200')).toEqual({ name: 'dream-show', id: '2026-10-25-2200' })
  expect(cmd('dream', 'rm', '2026-10-25-2200')).toEqual({ name: 'dream-rm', id: '2026-10-25-2200' })
  expect(cmd('dream', 'clear')).toEqual({ name: 'dream-clear' })
  expect(cmd('dream', 'status')).toEqual({ name: 'dream-status' })
})

const usageErrors: string[][] = [['dream'], ['dream', 'wat'], ['dream', 'rm'], ['dream', 'now', 'extra'], ['dream', 'now', '--all']]
test.each(usageErrors.map(argv => [argv.join(' '), argv] as const))('neo %s is a usage error', (_, argv) => {
  expect(() => parseArgs(argv)).toThrow(UsageError)
})
