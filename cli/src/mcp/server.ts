// MCP over stdio: one JSON-RPC message per line. Only what Claude Code needs from a tools-only server.
import { createInterface } from 'node:readline'
import type { Tool } from './tools'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, any>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

const DEFAULT_PROTOCOL = '2025-06-18'
export const SERVER_INFO = { name: 'neo-agents', version: '0.1.0' } as const
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

/** Answers one message. Notifications (no id) get no reply. */
export async function handleMessage(tools: Record<string, Tool>, message: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
  const { id, method, params } = message
  if (id === undefined) return undefined
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, text: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message: text } })

  switch (method) {
    case 'initialize':
      return reply({ protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({
        tools: Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.schema, annotations: { readOnlyHint: true } })),
      })
    case 'tools/call': {
      const tool = Object.hasOwn(tools, params?.name) ? tools[params!.name] : undefined
      if (!tool) return fail(INVALID_PARAMS, 'unknown tool')
      try {
        return reply({ content: [{ type: 'text', text: await tool.call(params?.arguments ?? {}) }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: 'error: ' + (e as Error).message }], isError: true })
      }
    }
    default:
      return fail(METHOD_NOT_FOUND, 'method not found')
  }
}

/** Reads lines from `input` until it closes; each reply is one line on `output`. Replies keep the order of the requests. */
export async function serveStdio(tools: Record<string, Tool>, input: NodeJS.ReadableStream, output: (line: string) => void) {
  let chain = Promise.resolve()
  for await (const line of createInterface({ input })) {
    if (!line.trim()) continue
    let message: JsonRpcRequest
    try { message = JSON.parse(line) } catch { continue }
    chain = chain.then(async () => {
      const response = await handleMessage(tools, message)
      if (response) output(JSON.stringify(response) + '\n')
    })
  }
  await chain
}
