import { expect, test } from 'bun:test'
import { encodeLine } from './wire'

test('the real ping is exactly {"type":"ping"}', () => {
  expect(encodeLine({ type: 'ping' })).toBe('{"type":"ping"}\n')
})

test('a "ping" string token inside a payload is escaped so a line filter never sees it, and decodes unchanged', () => {
  const line = encodeLine({ type: 'paired', at: 1, name: 'ping' })
  expect(line).not.toContain('"ping"')
  expect(JSON.parse(line)).toEqual({ type: 'paired', at: 1, name: 'ping' })
})

test('text that merely mentions ping is left alone', () => {
  const line = encodeLine({ type: 'paired', at: 1, name: 'say "ping" now, pinging' })
  expect(JSON.parse(line).name).toBe('say "ping" now, pinging')
  expect(line).toBe('{"type":"paired","at":1,"name":"say \\"ping\\" now, pinging"}\n')
})
