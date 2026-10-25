import { runCli } from './adapters/command/cli'
import { runDaemon } from './daemon'
import { lifecycleFromEnv } from './lifecycle/env'
import { runMcp } from './mcp/run'

const BUILD = process.env.NEO_BUILD ?? 'dev'

// `neo mcp` is the agents MCP server that claude starts from the MCP config: stdio only, no daemon
if (process.argv[2] === 'mcp') process.exit(await runMcp(process.env))

const abort = new AbortController()
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => abort.abort())

const code = await runCli(process.argv.slice(2), {
  out: text => void process.stdout.write(text),
  err: text => void process.stderr.write(text),
  env: process.env,
  signal: abort.signal,
  lifecycle: home => lifecycleFromEnv(process.env, home),
  confirm: process.stdin.isTTY ? async question => !/^\s*(n|no|ไม่)/i.test(prompt(question) ?? '') : undefined,
  runDaemon: ({ home, port }) => runDaemon({ home, port, build: BUILD }),
})
process.exit(code)
