import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

export interface Network {
  ip: string
  iface: string
  /** `tailscale`: a Tailscale/VPN address (CGNAT 100.64/10). `lan`: any other private address. */
  kind: 'tailscale' | 'lan'
}

export interface TailscaleInfo {
  ip: string
  host: string | null
}

const isCgnat = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 100 && b! >= 64 && b! <= 127
}

/** IPv4 addresses of this Mac's non-loopback interfaces. */
export function systemNetworks(): Network[] {
  const found: Network[] = []
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      found.push({ ip: entry.address, iface, kind: isCgnat(entry.address) ? 'tailscale' : 'lan' })
    }
  }
  return found
}

const TAILSCALE_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const run = promisify(execFile)

/** Asks the `tailscale` CLI for this Mac's address and MagicDNS name; null when it isn't installed or running. */
export async function systemTailscale(): Promise<TailscaleInfo | null> {
  const onPath = (process.env.PATH ?? '').split(delimiter).map(dir => join(dir, 'tailscale')).find(existsSync)
  const bin = onPath ?? (existsSync(TAILSCALE_APP) ? TAILSCALE_APP : null)
  if (!bin) return null
  try {
    const { stdout } = await run(bin, ['status', '--json'], { timeout: 8000 })
    const status = JSON.parse(stdout) as { BackendState?: string; Self?: { TailscaleIPs?: string[]; DNSName?: string } }
    const ip = status.Self?.TailscaleIPs?.find(address => /^\d+\.\d+\.\d+\.\d+$/.test(address))
    if (!ip) return null
    const running = status.BackendState === 'Running' && status.Self?.DNSName
    return { ip, host: running ? status.Self!.DNSName!.replace(/\.$/, '') : null }
  } catch {
    return null
  }
}
