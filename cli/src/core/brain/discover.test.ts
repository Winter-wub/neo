import { afterEach, expect, test } from 'bun:test'
import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../../test/helpers'
import { acpxRegistry, discoverInstalled, discoverVerified, probe, publicAgent, resolveNpx } from './discover'

const FAKE_AGENT = join(import.meta.dir, '../../../test/fake-acp-agent.js')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => void (await Promise.all(cleanups.splice(0).map(c => c()))))

const REGISTRY = `
const ACP_ADAPTER_PACKAGE_RANGES = {
  claude: "^0.3.0",
};
const AGENT_REGISTRY = {
  claude: \`npx -y @agentclientprotocol/claude-agent-acp@\${ACP_ADAPTER_PACKAGE_RANGES.claude}\`,
  fakeagent: "fake-acp --stdio",
  opencode: "npx -y opencode-ai acp",
  ghost: "npx -y ghost-acp",
};
export {};
`

/** A pretend machine: a PATH folder with some executables, and a global npm root holding acpx. */
async function machine({ withAcpx = true }: { withAcpx?: boolean } = {}) {
  const { dir, cleanup } = await tempHome()
  cleanups.push(cleanup)
  const bin = join(dir, 'bin')
  const root = join(dir, 'lib/node_modules')
  await mkdir(bin, { recursive: true })
  await mkdir(join(root, 'acpx/dist'), { recursive: true })
  if (withAcpx) await writeFile(join(root, 'acpx/dist/cli.js'), REGISTRY)
  const exe = async (name: string, body = '#!/bin/sh\nexit 0\n') => {
    await writeFile(join(bin, name), body)
    await chmod(join(bin, name), 0o755)
  }
  return { dir, bin, root, exe, deps: { env: { PATH: bin }, homeDir: dir, extraPath: [] as string[], npmRoot: async () => root } }
}

test('the acpx registry is read from its installed files, with version ranges filled in', async () => {
  const m = await machine()
  expect(acpxRegistry(m.root)).toEqual({
    claude: 'npx -y @agentclientprotocol/claude-agent-acp@^0.3.0',
    fakeagent: 'fake-acp --stdio',
    opencode: 'npx -y opencode-ai acp',
    ghost: 'npx -y ghost-acp',
  })
  expect(acpxRegistry(null)).toEqual({})
  expect(acpxRegistry(join(m.dir, 'nowhere'))).toEqual({})
})

test('registry agents are available only when they can really run here; npx is replaced by the installed binary, never run', async () => {
  const m = await machine()
  await m.exe('claude')
  await m.exe('fake-acp')
  await m.exe('opencode') // opencode-ai → opencode on the PATH
  const found = await discoverInstalled(m.deps)
  expect(found.acpx).toBe(true)
  const byName = Object.fromEntries(found.agents.map(a => [a.name, a]))
  expect(byName.claude).toMatchObject({ type: 'claude-code', label: 'Claude Code', available: true, via: await realpath(join(m.bin, 'claude')) })
  expect(byName.fakeagent).toMatchObject({ type: 'acp', available: true, command: await realpath(join(m.bin, 'fake-acp')), args: ['--stdio'], via: 'PATH fake-acp' })
  expect(byName.opencode).toMatchObject({ available: true, args: ['acp'], via: 'PATH opencode' })
  expect(byName.ghost).toMatchObject({ available: false, registry: 'npx -y ghost-acp' })
  expect(byName.ghost!.command).toBeUndefined()
  // the registry's "claude" adapter is a separate brain from the claude CLI
  expect(byName['claude-acp']).toMatchObject({ label: 'Claude Code (ACP)', available: false })
})

test('a globally installed npm package is found through its bin entry', async () => {
  const m = await machine()
  await mkdir(join(m.root, 'ghost-acp'))
  await writeFile(join(m.root, 'ghost-acp/package.json'), JSON.stringify({ bin: { 'ghost-bin': 'x.js' } }))
  await m.exe('ghost-bin')
  expect(resolveNpx(['npx', '-y', 'ghost-acp@1.2', 'serve'], m.root, [m.bin])).toMatchObject({ args: ['serve'], via: 'global ghost-acp' })
  expect(resolveNpx(['npx', '-y', 'unknown-pkg'], m.root, [m.bin])).toBeNull()
})

test('no acpx and no claude → nothing is offered', async () => {
  const m = await machine({ withAcpx: false })
  expect(await discoverInstalled(m.deps)).toEqual({ agents: [], acpx: false })
})

test('verification: an agent that speaks ACP gets its own title; one that does not is marked unavailable with a reason', async () => {
  const m = await machine()
  await m.exe('fake-acp', `#!/bin/sh\nexec ${process.execPath} ${FAKE_AGENT} "$@"\n`)
  await m.exe('opencode', '#!/bin/sh\nsleep 0.1\nexit 0\n') // a binary of that name that is not an ACP agent
  const found = await discoverVerified({ ...m.deps, env: { PATH: m.bin } })
  const byName = Object.fromEntries(found.agents.map(a => [a.name, a]))
  expect(byName.fakeagent).toMatchObject({ available: true, label: 'Fake Agent', agentInfo: { name: 'fake' } })
  expect(byName.opencode).toMatchObject({ available: false })
  expect(byName.opencode!.why).toContain('ไม่ตอบ ACP')
  expect(publicAgent(byName.fakeagent!)).toEqual({ name: 'fakeagent', label: 'Fake Agent', type: 'acp', available: true, via: 'PATH fake-acp', registry: 'fake-acp --stdio' })
})

test('probe: an ACP agent answers, silence times out, a missing command is null', async () => {
  expect(await probe(process.execPath, [FAKE_AGENT], process.env)).toMatchObject({ name: 'fake' })
  expect(await probe(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], process.env, 200)).toBeNull()
  expect(await probe('/no/such/agent', [], process.env)).toBeNull()
})
