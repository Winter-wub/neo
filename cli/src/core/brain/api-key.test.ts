import { afterEach, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../../test/helpers'
import { authHeaders, readApiKey } from './api-key'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => void (await Promise.all(cleanups.splice(0).map(c => c()))))

test('the env var named by apiKeyEnv wins, then the file named by apiKeyFile; ~ expands to home', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  await mkdir(join(dir, 'cfg'))
  await writeFile(join(dir, 'cfg', 'k.key'), 'file-key\n')
  const cfg = { apiKeyEnv: 'MY_KEY', apiKeyFile: '~/cfg/k.key' }
  expect(readApiKey(cfg, { MY_KEY: 'env-key' }, dir)).toBe('env-key')
  expect(readApiKey(cfg, {}, dir)).toBe('file-key')
  expect(authHeaders({ ...cfg, headers: { 'X-Title': 'Neo' } }, {}, dir)).toEqual({ 'X-Title': 'Neo', Authorization: 'Bearer file-key' })
})

test('only the named places are read: no env var, no file, no key', async () => {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  // a key lying in the legacy place is ignored unless the provider names it
  await mkdir(join(dir, '.config/neo'), { recursive: true })
  await writeFile(join(dir, '.config/neo/openrouter.key'), 'legacy\n')
  expect(readApiKey({}, { OPENROUTER_API_KEY: 'x' }, dir)).toBe('')
  expect(readApiKey({ apiKeyFile: '~/missing.key' }, {}, dir)).toBe('')
  expect(authHeaders({}, {}, dir)).toEqual({})
})
