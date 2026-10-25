import XCTest
@testable import NeoConsoleKit

/// A neo command that answers from a script and an events stream the test drives by hand.
final class FakeRunner: NeoRunner, @unchecked Sendable {
  // the model calls in from the cooperative pool while the test thread pokes at the same state
  private let lock = NSLock()
  private var _calls: [[String]] = []
  private var _responses: [String: [RunResult]] = [:]
  private var _streams: [AsyncStream<StreamLine>.Continuation] = []
  private var _eventsOpened = 0
  private func locked<T>(_ body: () -> T) -> T { lock.lock(); defer { lock.unlock() }; return body() }

  var calls: [[String]] { locked { _calls } }
  var streams: [AsyncStream<StreamLine>.Continuation] { locked { _streams } }
  var eventsOpened: Int { locked { _eventsOpened } }
  /// "daemon status" → queue (the last one repeats)
  var responses: [String: [RunResult]] {
    get { locked { _responses } }
    set { locked { _responses = newValue } }
  }

  var stdins: [String?] { locked { _stdins } }
  private var _stdins: [String?] = []
  var envs: [[String: String]] { locked { _envs } }
  private var _envs: [[String: String]] = []
  /// Runs while a call is "executing" (before it answers), e.g. to read the files `memory edit` would be handed.
  var onRun: (([String], [String: String]) -> RunResult?)?
  func run(_ args: [String], stdin: String?, env: [String: String]) async -> RunResult {
    if let hook = locked({ onRun }), let result = hook(args, env) { locked { _calls.append(args); _stdins.append(stdin); _envs.append(env) }; return result }
    return locked {
      _calls.append(args)
      _stdins.append(stdin)
      _envs.append(env)
      let key = args.prefix(2).joined(separator: " ")
      guard var queue = _responses[key], !queue.isEmpty else { return RunResult(code: 0, stdout: "{}") }
      let next = queue.count > 1 ? queue.removeFirst() : queue[0]
      _responses[key] = queue
      return next
    }
  }
  func events() -> AsyncStream<StreamLine> {
    AsyncStream { c in locked { _eventsOpened += 1; _streams.append(c) } }
  }
  func shutdown() { streams.forEach { $0.finish() } }

  func push(_ json: String) { streams.last?.yield(try! StreamLine.decode(Data(json.utf8))) }
  func drop() { streams.last?.finish() }
}

@MainActor
final class ModelTests: XCTestCase {
  let config = NeoConfig(binary: "/b/neo", home: "/h", label: "com.mochi.neo.dev", port: 8100, binDir: "/bin", logDir: "/log", bundledVersion: "0.1.0", bundledBuild: "b1")

  func daemonJSON(installed: Bool = true, running: Bool = true, plist: Bool = true, build: String = "b1") -> RunResult {
    RunResult(code: 0, stdout: """
    {"label":"com.mochi.neo.dev","installed":\(installed),"loaded":\(installed),"running":\(running),"pid":1,"version":"0.1.0","build":"\(build)","protocol":1,"binary":"/b/neo",
     "plist":{"path":"p","binary":"/b/neo","current":\(plist)},"symlink":{"path":"s","target":"/b/neo","current":true},"home":"/h","logs":{"daemon":"/log/daemon.log","crash":"/log/c.log"}}
    """)
  }
  let statusEvent = #"{"type":"status","phone":false,"provider":"","model":null,"thinking":false,"consoles":1,"requireName":true,"bypass":true,"pet":null,"uptime":1,"pid":9,"at":1}"#

  func settle(_ condition: @autoclosure @escaping () -> Bool, timeout: Double = 3) async {
    let end = Date().addingTimeInterval(timeout)
    while !condition(), Date() < end { try? await Task.sleep(for: .milliseconds(10)) }
  }

  func make(_ runner: FakeRunner) -> ConsoleModel { ConsoleModel(runner: runner, config: config, pollInterval: .milliseconds(20)) }

  func testHistoryAndLiveEventsFillTheLogAndStatusIsNotLogged() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON()]
    let model = make(runner)
    model.start()
    await settle(!runner.streams.isEmpty)
    runner.push(#"{"type":"heard","text":"สวัสดี","at":1}"#)
    runner.push(statusEvent)
    runner.push(#"{"type":"card","card":{"kind":"text","layout":"text","icon":"x","title":"ตอบ","lines":["a"],"items":[],"emotion":"happy","sounds":[],"seconds":5},"at":2}"#)
    await settle(model.items.count == 2)
    XCTAssertEqual(model.link, .connected)
    XCTAssertEqual(model.items.map(\.kind).count, 2)
    XCTAssertEqual(model.status?.pid, 9)
    model.stop()
  }

  func testDaemonStopDimsThenReconnectsOnItsOwnAndReplaysHistory() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON()]
    let model = make(runner)
    model.start()
    await settle(!runner.streams.isEmpty)
    runner.push(#"{"type":"heard","text":"เก่า","at":1}"#)
    await settle(model.items.count == 1)

    runner.responses["daemon status"] = [daemonJSON(running: false)]
    runner.drop()
    await settle(model.link == .down)
    XCTAssertEqual(model.link, .down)
    XCTAssertNil(model.status)
    let openedWhileDown = runner.eventsOpened
    try? await Task.sleep(for: .milliseconds(100))
    XCTAssertEqual(runner.eventsOpened, openedWhileDown, "must not attach (which would wake the daemon) while it is down")

    runner.responses["daemon status"] = [daemonJSON()]
    await settle(runner.eventsOpened == openedWhileDown + 1)
    runner.push(#"{"type":"heard","text":"ใหม่","at":2}"#)
    await settle(model.link == .connected && model.items.count == 1)
    XCTAssertEqual(model.items.first?.kind, .heard(text: "ใหม่"), "history is replayed into a fresh log")
    model.stop()
  }

  func testStartButtonRunsReconcileAndStartsAStoppedDaemon() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON(running: false), daemonJSON(running: false), daemonJSON()]
    let model = make(runner)
    await model.refreshDaemonForTest()
    await model.startDaemon()
    XCTAssertTrue(runner.calls.contains(["daemon", "start"]))
  }

  func testRepairInstallsWithThePhonePort() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON(plist: false)]
    let model = make(runner)
    await model.reconcile()
    XCTAssertTrue(runner.calls.contains(["daemon", "install", "--port", "8100"]))
  }

  func testNotInstalledDoesNotInstallBehindTheUsersBack() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON(installed: false, running: false)]
    let model = make(runner)
    await model.reconcile()
    XCTAssertEqual(model.link, .notInstalled)
    XCTAssertFalse(runner.calls.contains { $0.starts(with: ["daemon", "install"]) })
  }

  func testTypingSendsSayNoWaitAndShowsFailuresInline() async {
    let runner = FakeRunner()
    runner.responses["say สวัสดี"] = [RunResult(code: 3, stdout: #"{"error":"Neo ไม่ได้ทำงานอยู่","code":3}"#)]
    let model = make(runner)
    await model.say("  สวัสดี ")
    XCTAssertEqual(runner.calls.last, ["say", "สวัสดี", "--no-wait"])
    XCTAssertEqual(model.notice, "Neo ไม่ได้ทำงานอยู่")
    await model.say("   ")
    XCTAssertEqual(runner.calls.count, 1, "blank input sends nothing")
  }

  func testVersionMismatchWaitsForIdleThenRestarts() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON(build: "old")]
    let model = make(runner)
    model.start()
    await settle(!runner.streams.isEmpty)
    XCTAssertTrue(model.updatePending)
    XCTAssertFalse(runner.calls.contains(["daemon", "restart"]))
    runner.push(statusEvent.replacingOccurrences(of: #""thinking":false"#, with: #""thinking":true"#))
    try? await Task.sleep(for: .milliseconds(80))
    XCTAssertFalse(runner.calls.contains(["daemon", "restart"]), "busy: keep waiting")
    runner.push(statusEvent)
    await settle(runner.calls.contains(["daemon", "restart"]))
    XCTAssertTrue(runner.calls.contains(["daemon", "restart"]))
    XCTAssertFalse(model.updatePending)
    model.stop()
  }

  func testInstallPassesThePortKeepsThePathHintAndThenReconciles() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON(installed: false, running: false), daemonJSON()]
    runner.responses["daemon install"] = [RunResult(code: 0, stdout: #"{"installed":true,"plist":"/p.plist","symlink":"/bin/neo","pathHint":"ใส่บรรทัดนี้ใน ~/.zprofile: export PATH=\"/bin:$PATH\""}"#)]
    let model = make(runner)
    await model.reconcile()
    XCTAssertEqual(model.link, .notInstalled)
    let ok = await model.install()
    XCTAssertTrue(ok)
    XCTAssertTrue(runner.calls.contains(["daemon", "install", "--port", "8100"]))
    XCTAssertTrue(model.installResult?.pathHint?.contains("export PATH") == true)
    XCTAssertNotEqual(model.link, .notInstalled, "reconciled onto the installed daemon")
  }

  func testBusyOrRingingHoldsTheVersionRestartUntilIdle() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON(build: "old")]
    let model = make(runner)
    model.start()
    await settle(!runner.streams.isEmpty)
    await settle(model.updatePending)
    XCTAssertTrue(model.updatePending)
    func status(_ extra: String) -> String { #"{"type":"status","phone":false,"provider":"","model":null,"thinking":false,\#(extra),"consoles":1,"requireName":true,"bypass":true,"pet":null,"uptime":1,"pid":9,"at":1}"# }
    runner.push(status(#""ringing":true,"busy":false"#))
    runner.push(status(#""ringing":false,"busy":true"#))
    try? await Task.sleep(for: .milliseconds(150))
    XCTAssertFalse(runner.calls.contains(["daemon", "restart"]), "an alarm ringing or a job running must not be interrupted")
    runner.push(status(#""ringing":false,"busy":false"#))
    await settle(runner.calls.contains(["daemon", "restart"]))
    XCTAssertTrue(runner.calls.contains(["daemon", "restart"]))
    model.stop()
  }

  func testOnboardingIsNeededUntilTheOnboardedSettingIsTrue() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON(installed: false, running: false)]
    let model = make(runner)
    model.start()
    await settle(model.link == .notInstalled)
    XCTAssertTrue(model.needsOnboarding, "not installed = onboarding")
    model.stop()

    let runner2 = FakeRunner()
    runner2.responses["daemon status"] = [daemonJSON()]
    runner2.responses["settings"] = [RunResult(code: 0, stdout: #"{"onboarded":false}"#)]
    let m2 = make(runner2)
    m2.start()
    await settle(m2.settings != nil)
    XCTAssertTrue(m2.needsOnboarding)
    await settle(!runner2.streams.isEmpty)
    runner2.push(#"{"type":"settings","onboarded":true,"at":2}"#) // finished from Terminal: `neo settings set onboarded true`
    await settle(!m2.needsOnboarding)
    XCTAssertFalse(m2.needsOnboarding)
    m2.stop()
  }

  func testChangesFromElsewhereBumpTheRevisionButStayOutOfTheLog() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON()]
    let model = make(runner)
    model.start()
    await settle(!runner.streams.isEmpty)
    let before = model.revision
    runner.push(##"{"type":"face","fg":"#ffffff","accent":"#ff7aa8","cheek":"#ff9a9a","bg":"#000000","at":1}"##)
    runner.push(#"{"type":"wake","name":"x","variants":["x"],"at":2}"#)
    runner.push(#"{"type":"provider","name":"p","label":"P","at":3}"#)
    runner.push(#"{"type":"devices","at":4}"#)
    await settle(model.revision >= before + 4)
    XCTAssertGreaterThanOrEqual(model.revision, before + 4)
    XCTAssertTrue(model.items.isEmpty, "state changes are not log lines")
    model.stop()
  }

  func testFileChangesAreCountedPerKindSoPanesRereadOnlyWhatMoved() async {
    let runner = FakeRunner()
    runner.responses["daemon status"] = [daemonJSON()]
    let model = make(runner)
    model.start()
    await settle(!runner.streams.isEmpty)
    runner.push(#"{"type":"changed","file":"memory","at":1}"#)
    runner.push(#"{"type":"changed","file":"journal","day":"2026-10-26","at":2}"#)
    runner.push(#"{"type":"changed","file":"dream","id":"2026-10-25-2200","at":3}"#)
    runner.push(#"{"type":"jobs","at":4}"#)
    runner.push(#"{"type":"jobs_warning","problems":[],"at":5}"#)
    runner.push(#"{"type":"alarm_off","id":"a","why":"ปิด","at":6}"#)
    runner.push(#"{"type":"dreaming","reason":"x","entries":1,"at":7}"#)
    runner.push(#"{"type":"heard","text":"ไม่เกี่ยว","at":8}"#)
    await settle(model.items.count >= 3)
    XCTAssertEqual(model.fileStamps, ["memory": 1, "journal": 1, "dream": 2, "jobs": 3])
    model.stop()
  }
}

extension ConsoleModel {
  func refreshDaemonForTest() async { _ = await refreshDaemon() }
}
