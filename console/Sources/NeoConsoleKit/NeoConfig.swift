import Foundation

/// Where this Neo Console's Neo lives. The dev build points at its own home, LaunchAgent label, phone port
/// and bin dir so it never touches the real Neo; the values come from Info.plist (NeoHome, NeoLabel, ...)
/// and can be overridden with NEO_CONSOLE_* environment variables.
public struct NeoConfig: Equatable {
  public var binary: String
  public var home: String
  public var label: String
  public var port: Int
  public var binDir: String
  public var logDir: String
  /// What the bundled neo says it is. nil = don't compare versions.
  public var bundledVersion: String?
  public var bundledBuild: String?

  public init(binary: String, home: String, label: String, port: Int, binDir: String, logDir: String, bundledVersion: String? = nil, bundledBuild: String? = nil) {
    self.binary = binary; self.home = home; self.label = label; self.port = port
    self.binDir = binDir; self.logDir = logDir; self.bundledVersion = bundledVersion; self.bundledBuild = bundledBuild
  }

  /// Environment for every `neo` child: redirects launchd-related paths (see cli/src/lifecycle/env.ts).
  public var childEnvironment: [String: String] {
    var env = ProcessInfo.processInfo.environment
    env["NEO_HOME"] = home
    env["NEO_LAUNCH_LABEL"] = label
    env["NEO_BIN_DIR"] = binDir
    env["NEO_LOG_DIR"] = logDir
    env["NEO_BINARY"] = binary
    return env
  }

  public static func fromBundle(_ bundle: Bundle = .main, environment: [String: String] = ProcessInfo.processInfo.environment) -> NeoConfig {
    func value(_ key: String, _ env: String) -> String? { environment[env] ?? bundle.object(forInfoDictionaryKey: key) as? String }
    let support = NSHomeDirectory() + "/Library/Application Support"
    func expand(_ s: String) -> String { (s as NSString).expandingTildeInPath }
    let home = expand(value("NeoHome", "NEO_CONSOLE_HOME") ?? support + "/Neo")
    return NeoConfig(
      binary: expand(value("NeoBinary", "NEO_CONSOLE_BINARY") ?? bundle.bundlePath + "/Contents/MacOS/neo"),
      home: home,
      label: value("NeoLabel", "NEO_CONSOLE_LABEL") ?? "com.mochi.neo",
      port: Int(value("NeoPort", "NEO_CONSOLE_PORT") ?? "") ?? 8000,
      binDir: expand(value("NeoBinDir", "NEO_CONSOLE_BIN_DIR") ?? NSHomeDirectory() + "/.local/bin"),
      logDir: expand(value("NeoLogDir", "NEO_CONSOLE_LOG_DIR") ?? NSHomeDirectory() + "/Library/Logs/Neo"),
      bundledVersion: bundle.object(forInfoDictionaryKey: "NeoDaemonVersion") as? String,
      bundledBuild: bundle.object(forInfoDictionaryKey: "NeoDaemonBuild") as? String
    )
  }
}
