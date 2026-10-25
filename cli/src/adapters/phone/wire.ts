import type { StreamLine } from '../../protocol'

/**
 * One NDJSON line for the phone. NeoApp drops any line containing the token `"ping"` (Link.kt),
 * so inside payloads that token is written with a unicode escape: same JSON, different bytes.
 * The real ping stays exactly `{"type":"ping"}`.
 */
export function encodeLine(line: StreamLine) {
  const text = JSON.stringify(line)
  return (line.type === 'ping' ? text : text.replaceAll('"ping"', '"pin\\u0067"')) + '\n'
}
