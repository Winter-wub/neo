import XCTest
@testable import NeoConsoleKit

@MainActor
final class SettingsModelTests: XCTestCase {
  func fixture(_ name: String) -> String {
    (try? String(contentsOf: FixtureTests.dir.appendingPathComponent(name + ".json"), encoding: .utf8)) ?? "{}"
  }

  func make(_ runner: FakeRunner) -> SettingsModel { SettingsModel(runner: runner) }

  func testRefreshReadsEverythingThroughNeoOnly() async {
    let runner = FakeRunner()
    for (key, name) in [("settings", "settings-all"), ("face", "face-show"), ("name", "name-show"), ("provider list", "provider-list"), ("provider config", "provider-config"),
                        ("devices list", "devices-list"), ("pet", "pet-show"), ("model list", "model-list")] {
      runner.responses[key] = [RunResult(code: 0, stdout: fixture(name))]
    }
    let model = make(runner)
    await model.refresh()
    XCTAssertEqual(model.settings?.idle.sleepAfter, 600)
    XCTAssertEqual(model.face?.fg, "#ffffff")
    XCTAssertEqual(model.wake?.name, "จอห์น")
    XCTAssertEqual(model.providers?.current, "claude")
    XCTAssertEqual(model.providerConfig?.keys?["router"], true)
    XCTAssertEqual(model.devices.first?.name, "samsung SM-A750F")
    XCTAssertNotNil(model.pet)
    XCTAssertEqual(model.models?.name, "fakeagent", "models for the current provider are loaded")
    XCTAssertEqual(runner.calls.last, ["model", "list", "--provider", "claude"])
    XCTAssertTrue(runner.calls.allSatisfy { !$0.isEmpty }, "every read is a neo call")
  }

  func testTogglesAreSettingsSetCalls() async {
    let runner = FakeRunner()
    let model = make(runner)
    await model.set("requireName", false)
    await model.set("lan", true)
    await model.setSetting("idle.sleepAfter", "300")
    await model.set("idle.clock", false)
    await model.set("dream", false)
    await model.setSetting("claudeConfigDir", "unset")
    let sets = runner.calls.filter { $0.first == "settings" && $0.count > 1 }
    XCTAssertEqual(sets, [
      ["settings", "set", "requireName", "false"], ["settings", "set", "lan", "true"], ["settings", "set", "idle.sleepAfter", "300"],
      ["settings", "set", "idle.clock", "false"], ["settings", "set", "dream", "false"], ["settings", "set", "claudeConfigDir", "unset"],
    ])
  }

  func testFailedSettingShowsTheThaiMessageAndRereads() async {
    let runner = FakeRunner()
    runner.responses["settings set"] = [RunResult(code: 1, stdout: #"{"error":"ค่าไม่ถูกต้อง","code":1}"#)]
    let model = make(runner)
    await model.setSetting("idle.sleepAfter", "x")
    XCTAssertEqual(model.notice, "ค่าไม่ถูกต้อง")
    XCTAssertTrue(runner.calls.contains(["settings"]), "re-reads the real value after a refusal")
  }

  func testBrainControls() async {
    let runner = FakeRunner()
    runner.responses["provider list"] = [RunResult(code: 0, stdout: fixture("provider-list"))]
    runner.responses["model list"] = [RunResult(code: 0, stdout: fixture("model-list"))]
    let model = make(runner)
    await model.useProvider("fakeagent")
    await model.useModel("เร็ว", provider: "fakeagent")
    await model.discover()
    XCTAssertTrue(runner.calls.contains(["provider", "use", "fakeagent"]))
    XCTAssertTrue(runner.calls.contains(["model", "use", "เร็ว", "--provider", "fakeagent"]))
    XCTAssertTrue(runner.calls.contains(["provider", "discover"]))
  }

  func testSaveProviderSendsConfigByFileAndKeyByStdinOnly() async {
    let runner = FakeRunner()
    let model = make(runner)
    let ok = await model.saveProvider(name: "router", config: ["type": .string("openai"), "baseUrl": .string("http://x/v1"), "models": .object(["เร็ว": .string("m")])], apiKey: " sk-secret \n")
    XCTAssertTrue(ok)
    let call = runner.calls.first { $0.starts(with: ["provider", "config", "set"]) }
    XCTAssertEqual(Array(call?.prefix(4) ?? []), ["provider", "config", "set", "router"])
    XCTAssertTrue(call?.contains("--api-key-stdin") == true)
    XCTAssertFalse(call?.joined().contains("sk-secret") == true, "the key never goes in argv")
    XCTAssertEqual(runner.stdins[runner.calls.firstIndex { $0.starts(with: ["provider", "config", "set"]) }!], "sk-secret")

    runner.responses["provider config"] = [RunResult(code: 0, stdout: "{}")]
    _ = await model.saveProvider(name: "router", config: ["type": .string("openai")], apiKey: "")
    let second = runner.calls.last { $0.starts(with: ["provider", "config", "set"]) }
    XCTAssertFalse(second?.contains("--api-key-stdin") == true, "empty key = keep the one on disk")
    let removed = await model.removeProvider("router")
    XCTAssertTrue(removed)
    XCTAssertTrue(runner.calls.contains(["provider", "config", "rm", "router"]))
  }

  func testNameFaceAndTrainingCalls() async {
    let runner = FakeRunner()
    let model = make(runner)
    await model.setName("โมจิ")
    await model.train("โมจิ")
    await model.cancelTraining()
    await model.saveFace(Face(fg: "#111111", accent: "#222222", cheek: "#333333", bg: "#444444"))
    XCTAssertTrue(runner.calls.contains(["name", "set", "โมจิ"]))
    XCTAssertTrue(runner.calls.contains(["name", "train", "โมจิ"]))
    XCTAssertTrue(runner.calls.contains(["name", "train", "--cancel"]))
    XCTAssertTrue(runner.calls.contains(["face", "set", "--fg", "#111111", "--accent", "#222222", "--cheek", "#333333", "--bg", "#444444"]))
  }

  func testPairingShowsTheCodeThenWhoPaired() async {
    let runner = FakeRunner()
    runner.responses["devices pair"] = [RunResult(code: 0, stdout: fixture("devices-pair"))]
    runner.responses["devices list"] = [RunResult(code: 0, stdout: "[]"), RunResult(code: 0, stdout: fixture("devices-list"))]
    let model = make(runner)
    await model.refresh()
    await model.startPair()
    XCTAssertEqual(model.pair?.code, "123456")
    XCTAssertNil(model.pairedDevice)
    await model.refresh() // the `paired` event bumps the revision; the pane re-reads
    XCTAssertEqual(model.pairedDevice?.name, "samsung SM-A750F")
    await model.revoke("a1b2c3d4e5f6")
    XCTAssertTrue(runner.calls.contains(["devices", "revoke", "a1b2c3d4e5f6"]))
  }

  func testDoctorRowsAndFixes() async {
    let runner = FakeRunner()
    runner.responses["doctor"] = [RunResult(code: 1, stdout: fixture("doctor"))] // doctor exits 1 while a required row fails; the rows are still the answer
    let model = make(runner)
    await model.runDoctor()
    XCTAssertEqual(model.doctor?.count, 7)
    XCTAssertFalse(model.checksPassed)

    runner.responses["doctor"] = [RunResult(code: 0, stdout: fixture("doctor-stt-row").replacingOccurrences(of: "\"ok\": false", with: "\"ok\": true").wrappedInArray)]
    await model.fixSpeech()
    XCTAssertTrue(runner.calls.contains(["doctor", "--fix", "stt"]))
    XCTAssertEqual(model.doctor?.count, 1)
    XCTAssertTrue(model.checksPassed)

    let fda = DoctorRow(id: "fda", label: "Full Disk Access", ok: false, optional: true, detail: nil, fix: "เปิด System Settings")
    XCTAssertEqual(DoctorFix.forRow(fda), .openFullDiskAccess)
    XCTAssertFalse(fda.blocking, "Full Disk Access informs, it doesn't block")
  }

  func testOnboardingFlagIsASettingsSet() async {
    let runner = FakeRunner()
    let model = make(runner)
    await model.finishOnboarding()
    await model.restartOnboarding()
    XCTAssertTrue(runner.calls.contains(["settings", "set", "onboarded", "true"]))
    XCTAssertTrue(runner.calls.contains(["settings", "set", "onboarded", "false"]))
  }
}

private extension String {
  var wrappedInArray: String { "[" + self + "]" }
}
