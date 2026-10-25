import XCTest
@testable import NeoConsoleKit

/// Every golden fixture NeoCli's tests write must decode with the hand-written Swift types.
final class FixtureTests: XCTestCase {
  static let dir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("cli/test/fixtures")

  func data(_ name: String) throws -> Data { try Data(contentsOf: Self.dir.appendingPathComponent(name + ".json")) }
  func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T { try JSONDecoder().decode(T.self, from: try data(name)) }

  /// Every fixture file must at least be valid JSON; the ones Neo Console reads today also decode into Swift types
  /// (`commands`, `errors`, event-*). Fixtures for screens that don't exist yet are listed by `typedLater`.
  func testEveryFixtureParses() throws {
    let names = try FileManager.default.contentsOfDirectory(atPath: Self.dir.path).filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }
    XCTAssertFalse(names.isEmpty, "no fixtures found at \(Self.dir.path)")
    for name in names {
      XCTAssertNoThrow(try JSONSerialization.jsonObject(with: try data(name)), "\(name).json is not valid JSON")
    }
    let typed = names.filter { $0.hasPrefix("event-") || Self.commands[$0] != nil || Self.errors.contains($0) }
    let typedLater = Set(names).subtracting(typed)
    print("fixtures: \(typed.count) decoded into Swift types, \(typedLater.count) parsed only (typed when their screens land): \(typedLater.sorted())")
  }

  static let errors: Set<String> = ["error-daemon-down", "error-usage"]
  static let commands: [String: (FixtureTests) throws -> Void] = [
    "daemon-status": { t in let s = try t.decode(DaemonStatus.self, "daemon-status"); XCTAssertEqual(s.protocolVersion, 1); XCTAssertTrue(s.plist.current); XCTAssertEqual(s.logs.crash, "<Logs>/Neo/daemon.crash.log") },
    "devices-list": { t in let d = try t.decode([DeviceInfo].self, "devices-list"); XCTAssertEqual(d.first?.name, "samsung SM-A750F") },
    "devices-pair": { t in let p = try t.decode(PairStart.self, "devices-pair"); XCTAssertEqual(p.code, "123456"); XCTAssertEqual(p.addresses.count, 2) },
    "say-card": { t in
      guard case .card(let card) = try t.decode(SayResult.self, "say-card") else { return XCTFail("not a card") }
      XCTAssertEqual(card.title, "คำตอบ")
    },
    "settings": { t in let s = try t.decode(Settings.self, "settings"); XCTAssertEqual(s.bypass, true); XCTAssertEqual(s.followUp, false); XCTAssertEqual(s.idle.sleepAfter, 150); XCTAssertNil(s.claudeConfigDir); XCTAssertEqual(s.home?.city, "กรุงเทพฯ") },
    "settings-all": { t in let s = try t.decode(Settings.self, "settings-all"); XCTAssertEqual(s.idle.sleepAfter, 600); XCTAssertEqual(s.claudeConfigDir, "/Users/me/.claude"); XCTAssertEqual(s.mcpServers, ["MCP_DOCKER"]); XCTAssertFalse(s.onboarded) },
    "doctor": { t in
      let rows = try t.decode([DoctorRow].self, "doctor")
      XCTAssertEqual(rows.map(\.id), ["claude", "stt", "network", "agents", "phone", "fda", "jobs"])
      XCTAssertEqual(rows.filter(\.blocking).map(\.id), ["stt", "phone"])
      XCTAssertEqual(DoctorFix.forRow(rows[1]), .none, "helper missing: nothing to click, read the fix text"); XCTAssertEqual(DoctorFix.forRow(rows[5]), .none)
    },
    "doctor-fix": { t in let r = try t.decode(DoctorRow.self, "doctor-fix"); XCTAssertTrue(r.ok); XCTAssertEqual(DoctorFix.forRow(r), .none) },
    "doctor-stt-row": { t in let r = try t.decode(DoctorRow.self, "doctor-stt-row"); XCTAssertEqual(DoctorFix.forRow(r), .speech) },
    "provider-list": { t in let l = try t.decode(ProviderList.self, "provider-list"); XCTAssertEqual(l.current, "claude"); XCTAssertEqual(l.list.map(\.name), ["claude", "fakeagent"]) },
    "provider-config": { t in
      let c = try t.decode(ProviderConfigView.self, "provider-config")
      XCTAssertEqual(c.providers["router"]?["baseUrl"]?.string, "http://127.0.0.1:1/v1")
      XCTAssertEqual(c.keys?["router"], true)
      XCTAssertEqual(c.discovered?.first?.via, "PATH fake")
    },
    "provider-discover": { t in XCTAssertEqual(try t.decode([DiscoveredAgent].self, "provider-discover").first?.name, "fakeagent") },
    "model-list": { t in let m = try t.decode(ModelList.self, "model-list"); XCTAssertEqual(m.mapped.first?.alias, "เร็ว"); XCTAssertEqual(m.list.map(\.id), ["m0", "m1"]); XCTAssertNil(m.current) },
    "name-show": { t in let n = try t.decode(NameInfo.self, "name-show"); XCTAssertEqual(n.variants.count, 3); XCTAssertNil(n.training) },
    "name-train": { t in XCTAssertEqual(try t.decode(NameInfo.self, "name-train").training, NameInfo.Training(name: "จอห์น", got: [])) },
    "face-show": { t in XCTAssertEqual(try t.decode(Face.self, "face-show").fg, "#ffffff") },
    "jobs-list": { t in let j = try t.decode(JobsList.self, "jobs-list"); XCTAssertEqual(j.jobs.first?.when, "พรุ่งนี้ 05:30"); XCTAssertNil(j.ringing); XCTAssertEqual(j.problems, []) },
    "jobs-add": { t in let j = try t.decode(JobsList.Job.self, "jobs-add"); XCTAssertEqual(j.kind, "task"); XCTAssertEqual(j.cron, "30 7 * * 1-5") },
    "memory-show-with-dream": { t in
      let m = try t.decode(MemoryDoc.self, "memory-show-with-dream")
      XCTAssertEqual(m.items.first?.from?.id, "2026-10-25-2200"); XCTAssertEqual(m.items.first?.from?.dream, "ฝันถึงปลาทอง")
    },
    "journal-list": { t in XCTAssertEqual(try t.decode([JournalDay].self, "journal-list").map(\.entries), [2, 1]) },
    "journal-doc": { t in
      let d = try t.decode(JournalDoc.self, "journal-doc")
      XCTAssertEqual(d.entries.first?.q, "ราคาทอง"); XCTAssertEqual(d.entries.first?.ok, true); XCTAssertEqual(d.day, "2026-10-26")
    },
    "dream-list": { t in let l = try t.decode([DreamInfo].self, "dream-list"); XCTAssertEqual(l.first?.id, "2026-10-25-2200"); XCTAssertEqual(l.first?.undelivered, true) },
    "dream-show": { t in
      let d = try t.decode(DreamDoc.self, "dream-show")
      XCTAssertEqual(d.added.count, 2); XCTAssertEqual(d.insights.first?.finding, "ไม่มีอะไรเพิ่ม"); XCTAssertEqual(d.patterns, ["ถามตอนเช้า"])
    },
    "dream-status": { t in
      let s = try t.decode(DreamStatus.self, "dream-status")
      XCTAssertTrue(s.enabled); XCTAssertFalse(s.running); XCTAssertNil(s.why); XCTAssertEqual(s.activity.count, 24); XCTAssertEqual(s.last?.dream, "ฝันถึงปลาทอง")
    },
    "memory-doc": { t in let m = try t.decode(MemoryDoc.self, "memory-doc"); XCTAssertEqual(m.items.first?.section, "งาน") },
    "pet-show": { t in let p = try t.decode(PetInfo.self, "pet-show"); XCTAssertEqual(p.pet?.hunger, 0.4); XCTAssertFalse(p.sleeping) },
    "status": { t in let s = try t.decode(Status.self, "status"); XCTAssertEqual(s.pid, 4242); XCTAssertNil(s.model); XCTAssertNil(s.pet); XCTAssertEqual(s.ringing, false); XCTAssertEqual(s.busy, false); XCTAssertTrue(s.idle) },
  ]

  func testCommandOutputFixturesDecode() throws {
    for (name, check) in Self.commands { try check(self) }
  }

  func testErrorFixturesDecode() throws {
    XCTAssertEqual(try decode(ErrorBody.self, "error-daemon-down").code, 3)
    XCTAssertEqual(try decode(ErrorBody.self, "error-usage").code, 2)
    // and RunResult turns them into the Thai message
    let json = String(decoding: try data("error-daemon-down"), as: UTF8.self)
    XCTAssertTrue(RunResult(code: 3, stdout: json).failureMessage.contains("Neo ไม่ได้ทำงานอยู่"))
  }

  func line(_ name: String) throws -> StreamLine { try StreamLine.decode(try data(name)) }
  func kind(_ name: String) throws -> EventKind {
    guard case .event(let e) = try line(name) else { throw XCTSkip("\(name) is not an event") }
    return e.kind
  }

  /// Events the Console log understands today. Any other event-* fixture (phone audio, jobs, ...) must still decode,
  /// as .unknown, until its screen is built.
  static let modelled: Set<String> = ["event-askerr", "event-cancelled", "event-card", "event-changed", "event-devices", "event-face", "event-heard", "event-idle", "event-jobs", "event-jobs_warning", "event-model", "event-provider", "event-train", "event-wake", "event-nothing", "event-paired", "event-session", "event-settings", "event-status", "event-stterr", "event-thinking", "event-tool"]

  func testEveryEventFixtureDecodes() throws {
    let names = try FileManager.default.contentsOfDirectory(atPath: Self.dir.path).filter { $0.hasPrefix("event-") && $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }
    XCTAssertGreaterThan(names.count, 10)
    for name in names { XCTAssertNoThrow(try line(name), "\(name) must decode") }
    for name in Self.modelled {
      if case .unknown(let type) = try kind(name) { XCTFail("\(name) decoded as unknown(\(type))") }
    }
    print("event fixtures left as .unknown: \(names.filter { !Self.modelled.contains($0) && $0 != "event-hello" }.sorted())")
    guard case .hello(let hello) = try line("event-hello") else { return XCTFail("hello") }
    XCTAssertFalse(hello.name.isEmpty); XCTAssertEqual(hello.face, .mint); XCTAssertNil(hello.ringing); XCTAssertEqual(hello.idle.sleepAfter, 150)

    XCTAssertEqual(try kind("event-heard"), .heard(text: "นีโอ ข่าววันนี้มีอะไร"))
    XCTAssertEqual(try kind("event-thinking"), .thinking(text: "ข่าววันนี้มีอะไร"))
    XCTAssertEqual(try kind("event-session"), .session(fresh: true, turn: 1, provider: "Claude Code"))
    XCTAssertEqual(try kind("event-tool"), .tool(name: "WebSearch", input: "{\"query\":\"ข่าววันนี้มีอะไร\"}"))
    XCTAssertEqual(try kind("event-askerr"), .askerr(error: "no result"))
    XCTAssertEqual(try kind("event-cancelled"), .cancelled)
    XCTAssertEqual(try kind("event-paired"), .paired(name: "Pixel"))
    XCTAssertEqual(try kind("event-devices"), .devices)
    XCTAssertEqual(try kind("event-changed"), .changed(file: "memory"))
    XCTAssertEqual(try kind("event-nothing"), .nothing)
    XCTAssertEqual(try kind("event-face"), .face(Face(fg: "#ffffff", accent: "#ff7aa8", cheek: "#ff9a9a", bg: "#000000")))
    XCTAssertEqual(try kind("event-wake"), .state(type: "wake"))
    XCTAssertEqual(try kind("event-provider"), .state(type: "provider"))
    XCTAssertEqual(try kind("event-train"), .state(type: "train"))
    XCTAssertEqual(try kind("event-stterr"), .stterr(error: "ถอดเสียงไม่สำเร็จ"))
    guard case .card(let card) = try kind("event-card") else { return XCTFail("card") }
    XCTAssertEqual(card.lines.first, "ตอบ: ข่าววันนี้มีอะไร"); XCTAssertEqual(card.seconds, 20)
    guard case .status(let status) = try kind("event-status") else { return XCTFail("status") }
    XCTAssertEqual(status.uptime, 65); XCTAssertEqual(status.consoles, 1)
    guard case .settings(let settings) = try kind("event-settings") else { return XCTFail("settings") }
    XCTAssertEqual(settings.tailscale, true); XCTAssertEqual(settings.idle.sleepAfter, 150)
    guard case .event(let heard) = try line("event-heard") else { return }
    XCTAssertEqual(heard.at.timeIntervalSince1970, 1_700_000_000)
  }

  func testPingAndUnknownEventsAreLenient() throws {
    XCTAssertEqual(try StreamLine.decode(Data(#"{"type":"ping"}"#.utf8)), .ping)
    guard case .event(let e) = try StreamLine.decode(Data(#"{"type":"dream_done","at":5,"x":1}"#.utf8)) else { return XCTFail() }
    XCTAssertEqual(e.kind, .unknown(type: "dream_done"))
  }
}
