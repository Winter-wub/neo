import XCTest
@testable import NeoConsoleKit

/// The real compiled neo (cli/dist/neo) as a `daemon run` child on a random port in a temp home, answering with
/// cli/test/fake-bin/claude. No launchd, no port 8000, no real Neo home, no Claude quota.
@MainActor
final class LiveNeoTests: XCTestCase {
  static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  /// A private copy: other agents rebuild cli/dist/neo while this runs.
  var neo = ""
  var home = ""
  var daemon: Process?

  override func setUpWithError() throws {
    // NEO_TEST_BINARY: run against another build of neo (e.g. one with a subcommand not merged yet)
    let built = ProcessInfo.processInfo.environment["NEO_TEST_BINARY"] ?? Self.repo.appendingPathComponent("cli/dist/neo").path
    guard FileManager.default.isExecutableFile(atPath: built) else { throw XCTSkip("cli/dist/neo is missing (cd cli && bun run build)") }
    home = "/tmp/neoc-\(UInt32.random(in: 0..<1_000_000))" // short: unix socket paths are limited to ~104 bytes
    try FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true)
    neo = home + "/neo-bin"
    try FileManager.default.copyItem(atPath: built, toPath: neo)
  }
  override func tearDown() async throws {
    daemon?.terminate(); daemon?.waitUntilExit()
    if !home.isEmpty { try? FileManager.default.removeItem(atPath: home) }
  }

  func startDaemon() async throws {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: neo)
    p.arguments = ["daemon", "run", "--home", home, "--port", String(20_000 + Int.random(in: 0..<20_000))]
    var env = ProcessInfo.processInfo.environment
    let bun = ["\(NSHomeDirectory())/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"].joined(separator: ":")
    env["PATH"] = Self.repo.appendingPathComponent("cli/test/fake-bin").path + ":" + bun + ":/usr/bin:/bin"
    env["NEO_LOG_DIR"] = home + "/logs"
    // The daemon puts the login shell's PATH first, which would shadow the fake `claude` with the real one (and spend quota).
    // A shell that prints nothing leaves PATH as given. NEO_DISCOVER=0: no probing of real ACP agents.
    env["NEO_LOGIN_SHELL"] = "/usr/bin/true"
    env["NEO_DISCOVER"] = "0"
    p.environment = env
    p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
    try p.run()
    daemon = p
    for _ in 0..<100 where !FileManager.default.fileExists(atPath: home + "/neo.sock") { try await Task.sleep(for: .milliseconds(50)) }
  }

  func settle(_ condition: @autoclosure @escaping () -> Bool, timeout: Double = 10) async {
    let end = Date().addingTimeInterval(timeout)
    while !condition(), Date() < end { try? await Task.sleep(for: .milliseconds(20)) }
  }

  func testTypedQuestionBecomesACardFromEventsAndSurvivesQuitAndDaemonRestart() async throws {
    try await startDaemon()
    let config = NeoConfig(binary: neo, home: home, label: "com.mochi.neo.test-never-installed", port: 0, binDir: home + "/bin", logDir: home + "/logs")
    let runner = ProcessRunner(config: config)
    let model = ConsoleModel(runner: runner, config: config, pollInterval: .milliseconds(100))
    model.start()
    await settle(model.link == .connected)
    XCTAssertEqual(model.link, .connected)
    await settle(model.status != nil)
    XCTAssertEqual(model.status?.consoles, 1, "the Console is one attached listener")

    _ = await runner.run(["settings", "set", "requireName", "false"])
    await model.say("ข่าววันนี้มีอะไร")
    XCTAssertNil(model.notice)
    await settle(model.items.contains { if case .card = $0.kind { return true } else { return false } })
    guard let card = model.items.compactMap({ item -> Card? in if case .card(let c) = item.kind { return c } else { return nil } }).first else {
      return XCTFail("no card arrived; log: \(model.items.map(\.kind))")
    }
    XCTAssertTrue(card.lines.first?.contains("ข่าววันนี้มีอะไร") == true, "\(card.lines)")
    XCTAssertTrue(model.items.contains { $0.kind == .heard(text: "ข่าววันนี้มีอะไร") })

    // quitting the Console leaves the daemon running
    model.stop()
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertTrue(daemon!.isRunning)
    let alive = await ProcessRunner(config: config).run(["status"])
    XCTAssertTrue(alive.ok, alive.failureMessage)

    // reopening reconnects and replays history
    let reopened = ConsoleModel(runner: ProcessRunner(config: config), config: config, pollInterval: .milliseconds(100))
    reopened.start()
    await settle(reopened.items.contains { if case .card = $0.kind { return true } else { return false } })
    XCTAssertTrue(reopened.items.contains { if case .card = $0.kind { return true } else { return false } }, "history replayed")
    XCTAssertEqual(reopened.link, .connected)

    // daemon goes away: down, no wake-up by the Console; comes back: reconnects by itself
    daemon!.terminate(); daemon!.waitUntilExit()
    await settle(reopened.link == .down)
    XCTAssertEqual(reopened.link, .down)
    try await Task.sleep(for: .milliseconds(400))
    XCTAssertFalse(FileManager.default.fileExists(atPath: home + "/neo.sock"), "a stopped daemon stays stopped")
    try await startDaemon()
    await settle(reopened.link == .connected)
    XCTAssertEqual(reopened.link, .connected, "daemon: \(String(describing: reopened.daemon)) notice: \(String(describing: reopened.notice)) sock: \(FileManager.default.fileExists(atPath: home + "/neo.sock")) running: \(daemon!.isRunning)")
    reopened.stop()
  }

  /// Settings tabs against the real neo: every control lands in `neo`'s own state, and a change made from "Terminal"
  /// (a second neo process) shows up in the model without any button press.
  func testSettingsControlsAndTerminalChangesRoundTripThroughRealNeo() async throws {
    try await startDaemon()
    let config = NeoConfig(binary: neo, home: home, label: "com.mochi.neo.test-never-installed", port: 0, binDir: home + "/bin", logDir: home + "/logs")
    let runner = ProcessRunner(config: config)
    let console = ConsoleModel(runner: runner, config: config, pollInterval: .milliseconds(100))
    console.start()
    await settle(console.link == .connected && console.settings != nil)
    XCTAssertEqual(console.settings?.onboarded, false, "fresh home = onboarding")
    XCTAssertTrue(console.needsOnboarding)
    let settings = SettingsModel(runner: runner)
    await settings.refresh()
    XCTAssertEqual(settings.settings?.idle.sleepAfter, 150)

    // controls
    await settings.set("lan", true)
    await settings.setSetting("idle.sleepAfter", "300")
    await settings.set("idle.clock", false)
    await settings.set("dream", false)
    await settings.setName("โมจิ")
    await settings.saveFace(Face(fg: "#112233", accent: "#445566", cheek: "#778899", bg: "#001122"))
    XCTAssertNil(settings.notice)
    let back = SettingsModel(runner: ProcessRunner(config: config))
    await back.refresh()
    XCTAssertEqual(back.settings?.lan, true); XCTAssertEqual(back.settings?.idle, Settings.Idle(sleepAfter: 300, clock: false)); XCTAssertEqual(back.settings?.dream, false)
    XCTAssertEqual(back.wake?.name, "โมจิ"); XCTAssertEqual(back.face?.fg, "#112233")

    // phone
    await settings.startPair()
    XCTAssertEqual(settings.pair?.code.count, 6, "\(settings.notice ?? "")")

    // doctor rows come back even when a required row fails
    await settings.runDoctor()
    XCTAssertNotNil(settings.doctor, settings.notice ?? "")
    XCTAssertTrue(settings.doctor?.contains { $0.id == "claude" } == true)

    // a change made in Terminal (another neo process) reaches the Console with no clicks
    let before = console.revision
    _ = await ProcessRunner(config: config).run(["settings", "set", "followUp", "false"])
    _ = await ProcessRunner(config: config).run(["face", "set", "--fg", "#abcdef"])
    await settle(console.revision >= before + 2 && console.settings?.followUp == false)
    XCTAssertEqual(console.settings?.followUp, false)
    await settings.refresh()
    XCTAssertEqual(settings.settings?.followUp, false); XCTAssertEqual(settings.face?.fg, "#abcdef")

    // finishing onboarding is a settings set; the Console leaves onboarding when the event arrives
    await settings.finishOnboarding()
    await settle(!console.needsOnboarding)
    XCTAssertFalse(console.needsOnboarding)
    console.stop()
  }
}
