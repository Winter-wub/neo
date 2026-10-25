import { afterEach, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyLoginPath, readLoginPath } from './login-path'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
/** A stand-in for `zsh`: runs the `-c` string with a PATH only a login shell would have, after some rc-file noise. */
async function fakeShell(body: string) {
  const dir = await mkdtemp(join(tmpdir(), 'nl-'))
  dirs.push(dir)
  const file = join(dir, 'zsh')
  await writeFile(file, `#!/bin/sh\n${body}\n`)
  await chmod(file, 0o755)
  return file
}
const loginShell = (path: string) => fakeShell(`echo "welcome banner from .zshrc"\nPATH=${path}\nexport PATH\neval "$2"`)

test('reads PATH by running the command in a login shell, ignoring rc-file noise', async () => {
  const shell = await loginShell('/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin')
  expect(await readLoginPath({ shell })).toBe('/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin')
})

test('passes -lic, as `zsh -lic` does', async () => {
  const shell = await fakeShell('echo "$1" > "$0.args"; PATH=/x; export PATH; eval "$2"')
  await readLoginPath({ shell })
  expect((await Bun.file(`${shell}.args`).text()).trim()).toBe('-lic')
})

test('a shell that fails, hangs or prints no PATH gives null so the daemon keeps its own', async () => {
  expect(await readLoginPath({ shell: await fakeShell('exit 3') })).toBeNull()
  expect(await readLoginPath({ shell: await fakeShell('echo nothing useful') })).toBeNull()
  expect(await readLoginPath({ shell: await fakeShell('sleep 5'), timeoutMs: 100 })).toBeNull()
  expect(await readLoginPath({ shell: '/no/such/shell' })).toBeNull()
})

test('the login PATH comes first; entries only the daemon had are kept after it, without duplicates', () => {
  const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin:/launchd/only' }
  applyLoginPath(env, '/opt/homebrew/bin:/usr/bin')
  expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin:/launchd/only')
  applyLoginPath(env, null)
  expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin:/launchd/only')
})
