export interface LaunchctlResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs `launchctl <args>`. Injected so tests never touch the real launchd. */
export type Launchctl = (args: readonly string[]) => Promise<LaunchctlResult>

export function systemLaunchctl(binary = '/bin/launchctl'): Launchctl {
  return async args => {
    const proc = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    return { code, stdout, stderr }
  }
}
