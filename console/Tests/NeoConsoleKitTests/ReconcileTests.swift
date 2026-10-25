import XCTest
@testable import NeoConsoleKit

final class ReconcileTests: XCTestCase {
  func status(installed: Bool = true, running: Bool = true, plist: Bool = true, symlink: Bool = true, version: String? = "0.1.0", build: String? = "b1") -> DaemonStatus {
    DaemonStatus(label: "x", installed: installed, loaded: installed, running: running, pid: running ? 1 : nil, version: running ? version : nil, build: running ? build : nil,
                 protocolVersion: 1, binary: "/b/neo", plist: .init(path: "p", binary: "/b/neo", current: plist), symlink: .init(path: "s", target: "/b/neo", current: symlink),
                 home: "h", logs: .init(daemon: "d", crash: "c"))
  }
  func step(_ s: DaemonStatus, v: String? = "0.1.0", b: String? = "b1") -> ReconcileStep { reconcileStep(s, bundledVersion: v, bundledBuild: b) }

  func testNotInstalledGoesToOnboarding() { XCTAssertEqual(step(status(installed: false, running: false)), .needsInstall) }
  func testHandStartedDaemonIsJustConnectedTo() { XCTAssertEqual(step(status(installed: false, running: true)), .ready) }
  func testWrongBinaryPathIsRepairedEvenWhileRunning() {
    XCTAssertEqual(step(status(plist: false)), .repair)
    XCTAssertEqual(step(status(running: false, symlink: false)), .repair)
  }
  func testInstalledButStoppedIsStarted() { XCTAssertEqual(step(status(running: false)), .start) }
  func testVersionOrBuildMismatchRestartsWhenIdle() {
    XCTAssertEqual(step(status(build: "b0")), .restartWhenIdle)
    XCTAssertEqual(step(status(version: "0.0.9")), .restartWhenIdle)
  }
  func testMatchingOrUnknownBundleIsReady() {
    XCTAssertEqual(step(status()), .ready)
    XCTAssertEqual(step(status(build: "other"), v: nil, b: nil), .ready)
  }
}
