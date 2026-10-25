import { homedir } from 'node:os'
import { serveStdio } from './server'
import { createTools } from './tools'

/** `neo mcp`: the agents MCP server on stdin/stdout, started by `claude` from the MCP config. Ends when stdin closes. */
export async function runMcp(env: Record<string, string | undefined> = process.env) {
  await serveStdio(createTools({ env, home: homedir(), now: Date.now }), process.stdin, line => void process.stdout.write(line))
  return 0
}
