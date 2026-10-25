import Foundation

/// What Neo Console must do about the daemon, decided from `neo daemon status --json` alone.
public enum ReconcileStep: Equatable {
  /// Not installed: onboarding (ticket 18). The tracer shows an install button instead.
  case needsInstall
  /// Plist or symlink points at another binary: `neo daemon install` repairs it.
  case repair
  /// Installed and current but not running.
  case start
  /// Running, but another version/build than the bundled one: restart once idle.
  case restartWhenIdle
  case ready
}

public func reconcileStep(_ status: DaemonStatus, bundledVersion: String?, bundledBuild: String?) -> ReconcileStep {
  // a daemon someone started by hand (`neo daemon run`) is still a daemon to connect to
  if !status.installed { return status.running ? .ready : .needsInstall }
  if !status.plist.current || !status.symlink.current { return .repair }
  if !status.running { return .start }
  let versionDiffers = bundledVersion.map { $0 != status.version } ?? false
  let buildDiffers = bundledBuild.map { $0 != status.build } ?? false
  return versionDiffers || buildDiffers ? .restartWhenIdle : .ready
}
