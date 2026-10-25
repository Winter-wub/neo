import XCTest
@testable import NeoConsoleKit

@MainActor
final class MemoryModelTests: XCTestCase {
  func fixture(_ name: String) -> String {
    (try? String(contentsOf: FixtureTests.dir.appendingPathComponent(name + ".json"), encoding: .utf8)) ?? "{}"
  }
  func make(_ runner: FakeRunner) -> MemoryModel { MemoryModel(runner: runner, home: "/h") }

  // MARK: reading

  func testRefreshReadsEverythingThroughNeoAndOpensTheNewestDreamAndDay() async {
    let runner = FakeRunner()
    for (key, name) in [("jobs list", "jobs-list"), ("memory show", "memory-show-with-dream"), ("dream list", "dream-list"), ("dream status", "dream-status"),
                        ("dream show", "dream-show"), ("journal list", "journal-list"), ("journal show", "journal-doc")] {
      runner.responses[key] = [RunResult(code: 0, stdout: fixture(name))]
    }
    let model = make(runner)
    await model.refresh()
    XCTAssertEqual(model.jobs?.jobs.count, 1)
    XCTAssertEqual(model.memory?.items.count, 2)
    XCTAssertEqual(model.dreams.map(\.id), ["2026-10-25-2200"])
    XCTAssertEqual(model.dreamStatus?.running, false)
    XCTAssertEqual(model.dreamDoc?.id, "2026-10-25-2200")
    XCTAssertEqual(runner.calls.filter { $0.starts(with: ["dream", "show"]) }, [["dream", "show", "2026-10-25-2200"]])
    XCTAssertEqual(model.journalDays.map(\.day), ["2026-10-27", "2026-10-26"])
    XCTAssertEqual(runner.calls.filter { $0.starts(with: ["journal", "show"]) }, [["journal", "show", "2026-10-27"]], "newest day first")
  }

  func testFileUrlsAreUnderTheNeoHome() {
    let model = make(FakeRunner())
    XCTAssertEqual(model.url(.memory).path, "/h/memory.md")
    XCTAssertEqual(model.url(.jobs).path, "/h/jobs.md")
    XCTAssertEqual(model.url(.dream("2026-10-25-2200")).path, "/h/dreams/2026-10-25-2200.md")
    XCTAssertEqual(model.url(.journal("2026-10-26")).path, "/h/journal/2026-10-26.md")
  }

  func testOnlyWhatTheDaemonSaidChangedIsReread() async {
    let runner = FakeRunner()
    let model = make(runner)
    await model.refresh(stamps: ["memory": 1])
    let first = runner.calls.count
    await model.sync(["memory": 1]) // nothing moved
    XCTAssertEqual(runner.calls.count, first)
    await model.sync(["memory": 2])
    XCTAssertEqual(Array(runner.calls.dropFirst(first)), [["memory", "show"]])
    await model.sync(["memory": 2, "jobs": 1])
    XCTAssertEqual(runner.calls.last, ["jobs", "list"])
    let before = runner.calls.count
    await model.sync(["memory": 2, "jobs": 1, "journal": 1])
    XCTAssertTrue(runner.calls.dropFirst(before).allSatisfy { $0.first == "journal" })
    XCTAssertTrue(runner.calls.dropFirst(before).contains(["journal", "list"]))
    await model.sync(["memory": 2, "jobs": 1, "journal": 1, "dream": 1])
    XCTAssertTrue(runner.calls.suffix(2).allSatisfy { $0.first == "dream" })
  }

  // MARK: jobs

  func testSpeechPreviewsThenAddsExactlyWhatWasPreviewed() async {
    let runner = FakeRunner()
    runner.responses["jobs parse"] = [RunResult(code: 0, stdout: #"{"draft":{"kind":"alarm","title":"ปลุก","at":1700025000000,"when":"พรุ่งนี้ 05:30"}}"#)]
    let model = make(runner)
    await model.previewJob("ปลุกพรุ่งนี้ตีห้าครึ่ง")
    XCTAssertEqual(model.preview?.when, "พรุ่งนี้ 05:30")
    XCTAssertFalse(runner.calls.contains { $0.starts(with: ["jobs", "add"]) }, "a preview adds nothing")
    let ok = await model.confirmPreview()
    XCTAssertTrue(ok)
    XCTAssertNil(model.preview)
    let add = runner.calls.first { $0.starts(with: ["jobs", "add"]) }
    XCTAssertEqual(Array(add!.prefix(6)), ["jobs", "add", "--kind", "alarm", "--title", "ปลุก"])
    XCTAssertEqual(add![6], "--at")
    XCTAssertTrue(add![7].range(of: #"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$"#, options: .regularExpression) != nil, add![7])
    XCTAssertEqual(MemoryModel.atFormatter.date(from: add![7])?.timeIntervalSince1970, 1700025000)
  }

  func testTaskPreviewKeepsThePromptAndCron() async {
    let runner = FakeRunner()
    runner.responses["jobs parse"] = [RunResult(code: 0, stdout: #"{"draft":{"kind":"task","title":"ข่าวเช้า","prompt":"สรุปข่าววันนี้","cron":"30 7 * * 1-5","when":"07:30 วันธรรมดา"}}"#)]
    let model = make(runner)
    await model.previewJob("ทุกวันธรรมดา 7 โมงครึ่ง สรุปข่าว")
    await model.confirmPreview()
    XCTAssertEqual(runner.calls.first { $0.starts(with: ["jobs", "add"]) }, ["jobs", "add", "--kind", "task", "--title", "ข่าวเช้า", "--prompt", "สรุปข่าววันนี้", "--cron", "30 7 * * 1-5"])
  }

  func testUnreadableSentenceShowsNeosMessageAndNoPreview() async {
    let runner = FakeRunner()
    runner.responses["jobs parse"] = [RunResult(code: 1, stdout: #"{"error":"ไม่เข้าใจเวลา","code":1}"#)]
    let model = make(runner)
    await model.previewJob("อะไรสักอย่าง")
    XCTAssertNil(model.preview)
    XCTAssertEqual(model.notice, "ไม่เข้าใจเวลา")
    let ok = await model.confirmPreview()
    XCTAssertFalse(ok)
  }

  func testNeoWithoutParseAddsDirectlyAndSaysSo() async {
    let runner = FakeRunner()
    runner.responses["jobs parse"] = [RunResult(code: 2, stdout: #"{"error":"ไม่รู้จัก jobs parse","code":2}"#)]
    let model = make(runner)
    await model.previewJob("ปลุกตีห้า")
    XCTAssertNil(model.preview)
    XCTAssertTrue(runner.calls.contains(["jobs", "add", "ปลุกตีห้า", "--yes"]))
    XCTAssertTrue(model.notice?.contains("เพิ่มให้เลย") == true)
  }

  func testDetailedAddEditToggleTestRemoveAndStop() async {
    let runner = FakeRunner()
    let model = make(runner)
    await model.addJob(kind: "alarm", title: "ประชุม", prompt: nil, cron: "0 9 * * 1-5")
    await model.editJob("abc", title: "ประชุมทีม", prompt: "x", at: Date(timeIntervalSince1970: 1_700_025_000))
    await model.setJob("abc", enabled: false)
    await model.setJob("abc", enabled: true)
    await model.testJob("abc")
    await model.removeJob("abc")
    await model.stopAlarm()
    let calls = runner.calls.filter { $0.first == "jobs" || $0.first == "alarm" }.filter { $0[1] != "list" }
    XCTAssertEqual(calls[0], ["jobs", "add", "--kind", "alarm", "--title", "ประชุม", "--cron", "0 9 * * 1-5"])
    XCTAssertEqual(Array(calls[1].prefix(7)), ["jobs", "edit", "abc", "--title", "ประชุมทีม", "--prompt", "x"])
    XCTAssertEqual(calls[1][7], "--at")
    XCTAssertEqual(Array(calls.dropFirst(2)), [["jobs", "off", "abc"], ["jobs", "on", "abc"], ["jobs", "test", "abc"], ["jobs", "rm", "abc"], ["alarm", "stop"]])
  }

  func testRefusedAddKeepsTheMessage() async {
    let runner = FakeRunner()
    runner.responses["jobs add"] = [RunResult(code: 1, stdout: #"{"error":"cron ไม่ถูกต้อง","code":1}"#)]
    let model = make(runner)
    let ok = await model.addJob(kind: "alarm", title: "x", prompt: nil, cron: "bad")
    XCTAssertFalse(ok)
    XCTAssertEqual(model.notice, "cron ไม่ถูกต้อง")
  }

  // MARK: memory

  func testAddAndForgetMemoryAreNeoCalls() async {
    let runner = FakeRunner()
    let model = make(runner)
    await model.addMemory("  แพ้กุ้ง ", section: " สุขภาพ ")
    await model.addMemory("ชอบแมว", section: "")
    await model.addMemory("   ", section: "x")
    await model.forgetMemory(MemoryDoc.Item(section: "สุขภาพ", text: "แพ้กุ้ง", from: nil))
    await model.clearMemory()
    XCTAssertEqual(runner.calls.filter { $0.first == "memory" && $0[1] != "show" },
                   [["memory", "add", "แพ้กุ้ง", "--section", "สุขภาพ"], ["memory", "add", "ชอบแมว"], ["memory", "forget", "แพ้กุ้ง"], ["memory", "clear"]])
  }

  func testSeveralMatchesAreRefusedWithNeosListing() async {
    let runner = FakeRunner()
    runner.responses["memory forget"] = [RunResult(code: 1, stdout: #"{"error":"ตรงหลายข้อ:\n- [a] x\n- [b] x","code":1}"#)]
    let model = make(runner)
    await model.forgetMemory(MemoryDoc.Item(section: "a", text: "x", from: nil))
    XCTAssertTrue(model.notice?.contains("ตรงหลายข้อ") == true)
  }

  func testReplacingOneItemKeepsEverythingElse() {
    let text = "ข้อความนำ\n## งาน\n- ใช้ Jira\n* ใช้ Slack\n\n## อื่น ๆ\n- ใช้ Jira\n"
    let jira = MemoryDoc.Item(section: "งาน", text: "ใช้ Jira", from: nil)
    XCTAssertEqual(MemoryText.replacing(jira, with: " ใช้  Linear \n", in: text), "ข้อความนำ\n## งาน\n- ใช้ Linear\n* ใช้ Slack\n\n## อื่น ๆ\n- ใช้ Jira\n", "the item in its own section only")
    XCTAssertEqual(MemoryText.replacing(MemoryDoc.Item(section: "งาน", text: "ใช้ Slack", from: nil), with: "x", in: text)?.contains("* x\n"), true, "keeps the bullet marker")
    XCTAssertNil(MemoryText.replacing(MemoryDoc.Item(section: "งาน", text: "ไม่มี", from: nil), with: "x", in: text))
    XCTAssertNil(MemoryText.replacing(jira, with: "   ", in: text), "an empty text is a delete, not an edit")
    XCTAssertEqual(MemoryText.replacing(MemoryDoc.Item(section: "", text: "ก่อนหัวข้อ", from: nil), with: "ข", in: "- ก่อนหัวข้อ\n## ส\n- ค"), "- ข\n## ส\n- ค")
  }

  /// The one-shot editor: it refuses when the file neo hands it is not the one the window started from.
  func testEditMemorySavesThroughNeoEditWithAnEditorThatChecksTheBase() async throws {
    let runner = FakeRunner()
    let base = MemoryDoc(text: "## งาน\n- ใช้ Jira\n", version: "v1", items: [MemoryDoc.Item(section: "งาน", text: "ใช้ Jira", from: nil)])
    var seenEditor = ""
    runner.onRun = { args, env in
      guard args == ["memory", "edit"] else { return nil }
      seenEditor = env["EDITOR"] ?? ""
      let path = String(seenEditor.dropFirst().dropLast()) // 'path'
      // what neo does: a copy of the current file, then the editor, then the save
      let file = NSTemporaryDirectory() + "neo-test-\(UUID().uuidString).md"
      try? base.text.write(toFile: file, atomically: true, encoding: .utf8)
      defer { try? FileManager.default.removeItem(atPath: file) }
      let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/sh"); p.arguments = ["-c", "exec '\(path)' \"$0\"", file]; p.environment = env
      try? p.run(); p.waitUntilExit()
      if p.terminationStatus != 0 { return RunResult(code: 1, stdout: #"{"error":"ตัวแก้ไข (x) ออกด้วย code \#(p.terminationStatus) ไม่ได้บันทึก","code":1}"#) }
      let edited = (try? String(contentsOfFile: file, encoding: .utf8)) ?? ""
      let json = try! JSONEncoder().encode(MemoryDoc(text: edited, version: "v2", items: []))
      return RunResult(code: 0, stdout: String(decoding: json, as: UTF8.self))
    }
    let model = make(runner)
    let ok = await model.editMemory(base.items[0], to: "ใช้ Linear", base: base)
    XCTAssertTrue(ok, model.notice ?? "")
    XCTAssertEqual(model.memory?.text, "## งาน\n- ใช้ Linear\n")
    XCTAssertEqual(runner.envs.last?["VISUAL"], seenEditor)
    XCTAssertFalse(FileManager.default.fileExists(atPath: String(seenEditor.dropFirst().dropLast())), "the helper is cleaned up")

    // the file moved on (another editor saved first): refused, with the clear message, and the newest text is loaded
    runner.onRun = { args, env in
      guard args == ["memory", "edit"] else { return nil }
      let path = String((env["EDITOR"] ?? "").dropFirst().dropLast())
      let file = NSTemporaryDirectory() + "neo-test-\(UUID().uuidString).md"
      try? "## งาน\n- ใช้ Jira\n- ใช้ Confluence\n".write(toFile: file, atomically: true, encoding: .utf8)
      defer { try? FileManager.default.removeItem(atPath: file) }
      let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/sh"); p.arguments = ["-c", "exec '\(path)' \"$0\"", file]; p.environment = env
      try? p.run(); p.waitUntilExit()
      return RunResult(code: Int32(p.terminationStatus == 0 ? 0 : 1), stdout: #"{"error":"ตัวแก้ไข (x) ออกด้วย code \#(p.terminationStatus) ไม่ได้บันทึก","code":1}"#)
    }
    runner.responses["memory show"] = [RunResult(code: 0, stdout: "{\"text\":\"## งาน\\n- ใช้ Jira\\n- ใช้ Confluence\\n\",\"version\":\"v3\",\"items\":[]}")]
    let refused = await model.editMemory(base.items[0], to: "ใช้ Notion", base: base)
    XCTAssertFalse(refused)
    XCTAssertTrue(model.notice?.contains("ถูกแก้จากที่อื่น") == true && model.notice?.contains("ไม่ได้บันทึก") == true, model.notice ?? "")
    XCTAssertEqual(model.memory?.version, "v3", "re-read after a refusal")
  }

  func testDaemonConflictMessageIsShownWithoutTheLeftoverPathLine() async throws {
    let dir = NSTemporaryDirectory() + "neo-edit-\(UUID().uuidString)"
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    try "x".write(toFile: dir + "/memory.md", atomically: true, encoding: .utf8)
    let runner = FakeRunner()
    let message = "memory.md ถูกแก้ไประหว่างที่คุณแก้ ไม่ได้บันทึก\\nสิ่งที่คุณแก้ยังอยู่ที่ \(dir)/memory.md"
    runner.responses["memory edit"] = [RunResult(code: 1, stdout: #"{"error":"\#(message)","code":1}"#)]
    let model = make(runner)
    let base = MemoryDoc(text: "## ก\n- ข\n", version: "v1", items: [])
    let ok = await model.saveMemory("## ก\n- ค\n", base: base)
    XCTAssertFalse(ok)
    XCTAssertEqual(model.notice, "memory.md ถูกแก้ไประหว่างที่คุณแก้ ไม่ได้บันทึก")
    XCTAssertFalse(FileManager.default.fileExists(atPath: dir), "neo's leftover copy is removed")
  }

  // MARK: dreams and journal

  func testDreamControlsAreNeoCalls() async {
    let runner = FakeRunner()
    let model = make(runner)
    await model.setDreamEnabled(false)
    await model.setDreamEnabled(true)
    await model.dreamNow()
    XCTAssertFalse(model.dreamingNow)
    await model.removeDream("2026-10-25-2200")
    await model.clearDreams()
    await model.forgetTurn(JournalEntry(day: "2026-10-26", time: "09:41", q: "ราคาทอง", a: "x", ok: true))
    await model.clearJournal()
    XCTAssertEqual(runner.calls.filter { ["on", "off", "now", "rm", "clear", "forget"].contains($0[1]) },
                   [["dream", "off"], ["dream", "on"], ["dream", "now"], ["dream", "rm", "2026-10-25-2200"], ["dream", "clear"], ["journal", "forget", "ราคาทอง"], ["journal", "clear"]])
  }
}
