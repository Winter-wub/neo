export interface PlistSpec {
  label: string
  /** argv for launchd: binary first, then `daemon run …`. */
  programArguments: readonly string[]
  environment: Readonly<Record<string, string>>
  crashLog: string
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The plain LaunchAgent: start at load, restart only after a crash (a clean exit stays down). */
export function renderPlist({ label, programArguments, environment, crashLog }: PlistSpec) {
  const strings = programArguments.map(arg => `    <string>${escapeXml(arg)}</string>`).join('\n')
  const env = Object.entries(environment)
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(crashLog)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(crashLog)}</string>
</dict>
</plist>
`
}

/** First `ProgramArguments` string of a plist we wrote: the binary launchd will exec. */
export function plistBinary(xml: string) {
  const match = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(xml)
  return match?.[1]?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** The `--home` the plist's daemon will serve. */
export function plistHome(xml: string) {
  const match = /<string>--home<\/string>\s*<string>([^<]*)<\/string>/.exec(xml)
  return match?.[1]?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
