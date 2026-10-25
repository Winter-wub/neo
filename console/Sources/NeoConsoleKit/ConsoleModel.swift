import Foundation

public struct LogItem: Identifiable, Equatable {
  public let id: Int
  public var at: Date
  public var kind: EventKind
}

/// Where Neo Console stands with the daemon. Drives the menu bar icon and the status bar in the window.
public enum Link: Equatable {
  case starting
  case connected
  /// The daemon isn't running (stopped, crashed, or never started). The Console keeps watching and reconnects on its own.
  case down
  case notInstalled
  /// Restarting onto the bundled version.
  case updating
}

/// Neo Console's whole state. It holds no Neo logic: it reads `neo daemon status`, one `neo events` stream,
/// and calls `neo …` for every action.
@MainActor
public final class ConsoleModel: ObservableObject {
  @Published public private(set) var link: Link = .starting
  @Published public private(set) var items: [LogItem] = []
  @Published public private(set) var status: Status?
  @Published public private(set) var daemon: DaemonStatus?
  /// Last action error (Thai), shown inline, never as an alert.
  @Published public private(set) var notice: String?
  /// A newer bundled daemon is waiting for the work in progress to finish.
  @Published public private(set) var updatePending = false
  /// The daemon's settings, kept current by the `settings` event. nil until first read.
  @Published public private(set) var settings: Settings?
  /// Face colours for the log (cards use the phone's theme). From `hello`, then the `face` event.
  @Published public private(set) var face: Face = .mint
  /// Bumped whenever something a Settings tab shows changed, from anywhere (Terminal, phone, another Console).
  /// Tabs re-read through `SettingsModel.refresh()` on it.
  @Published public private(set) var revision = 0
  /// Per kind of file (`memory`, `journal`, `dream`, `jobs`), how many times the daemon has said it changed. Panes that show
  /// those files compare it with what they last read (`MemoryModel.sync`), so an edit in an editor shows up by itself.
  @Published public private(set) var fileStamps: [String: Int] = [:]
  @Published public private(set) var installResult: InstallResult?
  @Published public private(set) var installing = false

  private let runner: NeoRunner
  private let config: NeoConfig
  private let pollInterval: Duration
  private var supervisor: Task<Void, Never>?
  private var nextId = 0

  public init(runner: NeoRunner, config: NeoConfig, pollInterval: Duration = .seconds(2)) {
    self.runner = runner
    self.config = config
    self.pollInterval = pollInterval
  }

  public var isConnected: Bool { link == .connected }
  /// Onboarding runs until `onboarded` is true; a daemon that isn't installed yet is always in onboarding.
  public var needsOnboarding: Bool { link == .notInstalled || settings?.onboarded == false }
  public var logPath: String { daemon?.logs.daemon ?? config.logDir + "/daemon.log" }

  // MARK: lifecycle

  /// On launch: reconcile once, then keep the stream attached for as long as the app lives.
  public func start() {
    guard supervisor == nil else { return }
    supervisor = Task { [weak self] in
      guard let self else { return }
      await self.reconcile()
      await self.superviseForever()
    }
  }

  /// Quit: stop watching. The daemon is not touched.
  public func stop() {
    supervisor?.cancel()
    supervisor = nil
    runner.shutdown()
  }

  public func refreshDaemon() async -> DaemonStatus? {
    let result = await runner.run(["daemon", "status"])
    let parsed = result.decode(DaemonStatus.self)
    if let parsed { daemon = parsed }
    return parsed
  }

  /// The "เริ่ม Neo" path, also what runs at launch: bring the daemon to the state the bundled neo expects.
  public func reconcile() async {
    guard let current = await refreshDaemon() else {
      link = .down
      notice = "อ่านสถานะ Neo ไม่ได้"
      return
    }
    switch reconcileStep(current, bundledVersion: config.bundledVersion, bundledBuild: config.bundledBuild) {
    case .needsInstall:
      link = .notInstalled
    case .repair:
      await act(["daemon", "install", "--port", String(config.port)])
    case .start:
      await act(["daemon", "start"])
    case .restartWhenIdle:
      updatePending = true // `apply` restarts as soon as a status event says nothing is running
    case .ready:
      break
    }
    if link == .notInstalled { return }
    await refreshSettings()
    if let after = await refreshDaemon(), !after.running { link = .down }
  }

  public func refreshSettings() async {
    if let s = await runner.run(["settings"]).decode(Settings.self) { settings = s }
  }

  /// Onboarding's "ติดตั้ง Neo": `neo daemon install`, then the same reconcile as launch.
  /// `installResult` keeps the PATH hint for the check step.
  @discardableResult
  public func install() async -> Bool {
    link = .starting
    installing = true; defer { installing = false }
    let result = await runner.run(["daemon", "install", "--port", String(config.port)])
    notice = result.ok ? nil : result.failureMessage
    if let parsed = result.decode(InstallResult.self), result.ok { installResult = parsed }
    await reconcile()
    return result.ok
  }

  // MARK: actions (every one is a neo call)

  public func say(_ text: String) async {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    // --no-wait: the card arrives from the event stream
    await act(["say", trimmed, "--no-wait"])
  }

  public func cancel() async { await act(["cancel"]) }
  public func startDaemon() async { await reconcile() }
  public func stopDaemon() async { await act(["daemon", "stop"]) }
  public func restartDaemon() async { await act(["daemon", "restart"]) }

  @discardableResult
  private func act(_ args: [String]) async -> Bool {
    let result = await runner.run(args)
    notice = result.ok ? nil : result.failureMessage
    return result.ok
  }

  // MARK: events

  /// Runs for the life of the app: attach when the daemon is up, otherwise poll `neo daemon status` (which,
  /// unlike every other neo command, never wakes a stopped daemon).
  private func superviseForever() async {
    while !Task.isCancelled {
      if link != .updating, let s = await refreshDaemon() {
        if s.running { await attach() }
        else if link == .notInstalled, s.installed { link = .down } // installed meanwhile, e.g. from Terminal
      }
      if Task.isCancelled { break }
      try? await Task.sleep(for: pollInterval)
    }
  }

  private func attach() async {
    items = []
    for await line in runner.events() {
      if Task.isCancelled { break }
      apply(line)
    }
    if Task.isCancelled { return }
    if link != .updating { link = .down }
    status = nil
  }

  func apply(_ line: StreamLine) {
    switch line {
    case .ping, .hello:
      if link != .connected { link = .connected }
      if case .hello(let hello) = line { face = hello.face; revision += 1; Task { await self.refreshSettings() } }
    case .event(let event):
      if link != .connected { link = .connected }
      if case .status(let s) = event.kind {
        status = s
        if updatePending, s.idle { Task { await self.restartForUpdate() } }
        return // status is state, not log
      }
      stamp(event.kind)
      switch event.kind {
      case .devices, .paired, .changed, .state: revision += 1
      case .settings(let s): settings = s; revision += 1
      case .face(let f): face = f; revision += 1
      default: break
      }
      if case .devices = event.kind { return }
      if case .changed = event.kind { return }
      if case .state = event.kind { return }
      if case .face = event.kind { return }
      nextId += 1
      items.append(LogItem(id: nextId, at: event.at, kind: event.kind))
    }
  }

  /// Event types that mean the dream status changed / the job list or the ringing alarm changed.
  static let dreamEvents: Set<String> = ["dreaming", "dream_done", "dream_fail"]
  static let jobEvents: Set<String> = ["alarm", "alarm_off", "job", "schedule"]

  private func stamp(_ kind: EventKind) {
    let key: String?
    switch kind {
    case .changed(let file): key = file
    case .state(let type): key = type == "jobs" || type == "jobs_warning" ? "jobs" : nil
    case .unknown(let type): key = Self.dreamEvents.contains(type) ? "dream" : Self.jobEvents.contains(type) ? "jobs" : nil
    default: key = nil
    }
    if let key { fileStamps[key, default: 0] += 1 }
  }

  /// The bundled neo differs from the running daemon and nothing is running: `neo daemon restart`.
  private func restartForUpdate() async {
    guard updatePending else { return }
    updatePending = false
    link = .updating
    let ok = await act(["daemon", "restart"])
    link = ok ? .starting : .down
    // the supervisor loop's stream ends when the old daemon exits, then it re-attaches to the new one
  }
}
