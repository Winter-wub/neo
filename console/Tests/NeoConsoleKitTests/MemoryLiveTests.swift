import XCTest
@testable import NeoConsoleKit

/// The "ความจำ & งาน" window's model against the real compiled neo (see LiveNeoTests for the setup: temp home, random port,
/// fake `claude`, nothing of the real Neo). "Terminal" and "an editor" are a second neo process and plain file writes.
extension LiveNeoTests {
  struct Rig {
    var config: NeoConfig
    var console: ConsoleModel
    var memory: MemoryModel
    var terminal: ProcessRunner
  }

  func rig() async throws -> Rig {
    try await startDaemon()
    let config = NeoConfig(binary: neo, home: home, label: "com.mochi.neo.test-never-installed", port: 0, binDir: home + "/bin", logDir: home + "/logs")
    let console = ConsoleModel(runner: ProcessRunner(config: config), config: config, pollInterval: .milliseconds(100))
    console.start()
    await settle(console.link == .connected)
    XCTAssertEqual(console.link, .connected)
    let memory = MemoryModel(runner: ProcessRunner(config: config), home: home)
    await memory.refresh(stamps: console.fileStamps)
    return Rig(config: config, console: console, memory: memory, terminal: ProcessRunner(config: config))
  }

  /// Wait until the daemon has reported a change of `key` after `before`, then do what the window does: sync.
  func syncAfter(_ rig: Rig, _ key: String, above before: Int) async {
    await settle((rig.console.fileStamps[key] ?? 0) > before)
    XCTAssertGreaterThan(rig.console.fileStamps[key] ?? 0, before, "the daemon never reported a \(key) change")
    await rig.memory.sync(rig.console.fileStamps)
  }

  func testMemoryEditsAreConflictCheckedAndFileEditsShowUpWithoutReopening() async throws {
    let r = try await rig()
    defer { r.console.stop() }
    await r.memory.addMemory("ใช้ Jira", section: "งาน")
    XCTAssertNil(r.memory.notice)
    XCTAssertEqual(r.memory.memory?.items.map(\.text), ["ใช้ Jira"])
    let onDisk = try String(contentsOfFile: home + "/memory.md", encoding: .utf8)
    XCTAssertTrue(onDisk.contains("- ใช้ Jira"), onDisk)

    // the window opens an item for editing...
    let opened = try XCTUnwrap(r.memory.memory)
    let item = try XCTUnwrap(opened.items.first)
    // ...and an editor (a second neo) changes the file first
    let before = r.console.fileStamps["memory"] ?? 0
    let other = await r.terminal.run(["memory", "add", "ชอบแมว", "--section", "ผู้ใช้"])
    XCTAssertTrue(other.ok, other.failureMessage)
    // the window's save is refused, clearly, and nothing is clobbered
    let refused = await r.memory.editMemory(item, to: "ใช้ Linear", base: opened)
    XCTAssertFalse(refused)
    XCTAssertTrue(r.memory.notice?.contains("ถูกแก้จากที่อื่น") == true && r.memory.notice?.contains("ไม่ได้บันทึก") == true, r.memory.notice ?? "nil")
    let after = try String(contentsOfFile: home + "/memory.md", encoding: .utf8)
    XCTAssertTrue(after.contains("- ใช้ Jira") && after.contains("- ชอบแมว") && !after.contains("Linear"), after)
    XCTAssertEqual(r.memory.memory?.items.count, 2, "the newest text was loaded after the refusal")

    // from the newest text, the same edit goes through
    let fresh = try XCTUnwrap(r.memory.memory)
    let accepted = await r.memory.editMemory(try XCTUnwrap(fresh.items.first { $0.text == "ใช้ Jira" }), to: "ใช้ Linear", base: fresh)
    XCTAssertTrue(accepted, r.memory.notice ?? "")
    let saved = try String(contentsOfFile: home + "/memory.md", encoding: .utf8)
    XCTAssertTrue(saved.contains("- ใช้ Linear") && saved.contains("- ชอบแมว") && !saved.contains("Jira"), saved)

    // and the other direction: a text editor saves memory.md; the window follows without being reopened
    await syncAfter(r, "memory", above: before)
    let mark = r.console.fileStamps["memory"] ?? 0
    try (saved + "\n## งาน\n- เขียนใน editor\n").write(toFile: home + "/memory.md", atomically: true, encoding: .utf8)
    await syncAfter(r, "memory", above: mark)
    XCTAssertTrue(r.memory.memory?.items.contains { $0.text == "เขียนใน editor" } == true, "\(r.memory.memory?.items.map(\.text) ?? [])")

    // forget one item
    await r.memory.forgetMemory(try XCTUnwrap(r.memory.memory?.items.first { $0.text == "ชอบแมว" }))
    XCTAssertNil(r.memory.notice)
    XCTAssertFalse(r.memory.memory?.items.contains { $0.text == "ชอบแมว" } ?? true)
  }

  func testJobsAddToggleDeleteAndHandEditedJobsMdUpdatesTheWindow() async throws {
    let r = try await rig()
    defer { r.console.stop() }

    // detailed add, edit, toggle, delete
    let ok = await r.memory.addJob(kind: "alarm", title: "ประชุมทีม", prompt: nil, cron: "0 9 * * 1-5")
    XCTAssertTrue(ok, r.memory.notice ?? "")
    let job = try XCTUnwrap(r.memory.jobs?.jobs.first)
    XCTAssertEqual(job.title, "ประชุมทีม"); XCTAssertNotNil(job.next)
    let edited = await r.memory.editJob(job.id, title: "ประชุมใหญ่", prompt: nil, cron: "30 9 * * 1-5")
    XCTAssertTrue(edited, r.memory.notice ?? "")
    XCTAssertEqual(r.memory.jobs?.jobs.first?.title, "ประชุมใหญ่")
    await r.memory.setJob(job.id, enabled: false)
    XCTAssertEqual(r.memory.jobs?.jobs.first?.enabled, false)
    XCTAssertNil(r.memory.jobs?.jobs.first?.next)
    await r.memory.setJob(job.id, enabled: true)
    XCTAssertEqual(r.memory.jobs?.jobs.first?.enabled, true)

    // jobs.md edited in an editor: the window changes without reopening
    var mark = r.console.fileStamps["jobs"] ?? 0
    let hand = "# Neo jobs\n\n## ตื่นเช้า\n\n- kind: alarm\n- cron: 30 7 * * 1-5\n"
    try hand.write(toFile: home + "/jobs.md", atomically: true, encoding: .utf8)
    await syncAfter(r, "jobs", above: mark)
    XCTAssertEqual(r.memory.jobs?.jobs.map(\.title), ["ตื่นเช้า"], "jobs.md now has exactly the hand-written job")

    // a bad line keeps the previous jobs and shows the problem
    mark = r.console.fileStamps["jobs"] ?? 0
    try (hand + "\n## เสีย\n\n- kind: bogus\n").write(toFile: home + "/jobs.md", atomically: true, encoding: .utf8)
    await syncAfter(r, "jobs", above: mark)
    XCTAssertFalse(r.memory.jobs?.problems.isEmpty ?? true, "problems: \(String(describing: r.memory.jobs))")
    XCTAssertEqual(r.memory.jobs?.jobs.map(\.title), ["ตื่นเช้า"])

    // delete (from the fixed file)
    mark = r.console.fileStamps["jobs"] ?? 0
    try hand.write(toFile: home + "/jobs.md", atomically: true, encoding: .utf8)
    await syncAfter(r, "jobs", above: mark)
    XCTAssertTrue(r.memory.jobs?.problems.isEmpty ?? false)
    await r.memory.removeJob(try XCTUnwrap(r.memory.jobs?.jobs.first).id)
    XCTAssertEqual(r.memory.jobs?.jobs.count, 0)
  }

  func testSpeechPreviewsThenAdds() async throws {
    let r = try await rig()
    defer { r.console.stop() }
    let probe = await r.terminal.run(["jobs", "parse", "x"])
    guard probe.code != 2 else {
      // this neo has no `jobs parse`: the window falls back to adding straight away and says so
      await r.memory.previewJob("ปลุกพรุ่งนี้ตีห้าครึ่ง")
      XCTAssertNil(r.memory.preview)
      XCTAssertEqual(r.memory.jobs?.jobs.count, 1, r.memory.notice ?? "")
      XCTAssertTrue(r.memory.notice?.contains("เพิ่มให้เลย") == true)
      throw XCTSkip("neo has no `jobs parse` (see console/cli-jobs-parse.patch): preview-then-add not exercised; set NEO_TEST_BINARY to a build that has it")
    }
    await r.memory.previewJob("ปลุกพรุ่งนี้ตีห้าครึ่ง")
    let draft = try XCTUnwrap(r.memory.preview, r.memory.notice ?? "")
    XCTAssertEqual(draft.kind, "alarm")
    XCTAssertEqual(r.memory.jobs?.jobs.count ?? 0, 0, "a preview adds nothing")
    let added = await r.memory.confirmPreview()
    XCTAssertTrue(added, r.memory.notice ?? "")
    let job = try XCTUnwrap(r.memory.jobs?.jobs.first)
    XCTAssertEqual(job.kind, "alarm"); XCTAssertEqual(job.when, draft.when, "adds what was previewed"); XCTAssertEqual(job.at, draft.at.map { ($0 / 60000).rounded(.down) * 60000 })
    // a sentence neo cannot read: its message, no preview
    await r.memory.previewJob("บลาบลา")
    XCTAssertNil(r.memory.preview)
    XCTAssertNotNil(r.memory.notice)
  }

  func testDreamsAndJournalListShowDeleteAndFollowFileChanges() async throws {
    let r = try await rig()
    defer { r.console.stop() }
    _ = await r.terminal.run(["settings", "set", "requireName", "false"])
    await r.memory.addMemory("ชอบกาแฟ", section: "ผู้ใช้")
    let said = await r.terminal.run(["say", "ฝนตกไหม"])
    XCTAssertTrue(said.ok, said.failureMessage)
    await settle((r.console.fileStamps["journal"] ?? 0) > 0)
    await r.memory.sync(r.console.fileStamps)
    XCTAssertEqual(r.memory.journalDays.count, 1)
    XCTAssertEqual(r.memory.journalDoc?.entries.first?.q, "ฝนตกไหม")

    await r.memory.dreamNow()
    XCTAssertNil(r.memory.notice, r.memory.notice ?? "")
    XCTAssertEqual(r.memory.dreams.count, 1)
    XCTAssertEqual(r.memory.dreamDoc?.dream, "ฝันถึงปลาทอง")
    XCTAssertTrue(r.memory.memory?.items.contains { $0.text == "ชอบแมวทดสอบระบบ" && $0.from != nil } == true, "the dream's additions are marked: \(String(describing: r.memory.memory?.items))")
    let id = try XCTUnwrap(r.memory.dreamDoc?.id)
    XCTAssertTrue(FileManager.default.fileExists(atPath: r.memory.url(.dream(id)).path), "the open-in-editor button points at a real file")
    XCTAssertTrue(FileManager.default.fileExists(atPath: r.memory.url(.memory).path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: r.memory.url(.journal(try XCTUnwrap(r.memory.journalDoc?.day))).path))

    await r.memory.setDreamEnabled(false)
    XCTAssertEqual(r.memory.dreamStatus?.enabled, false)
    await r.memory.setDreamEnabled(true)

    await r.memory.forgetTurn(try XCTUnwrap(r.memory.journalDoc?.entries.first))
    XCTAssertNil(r.memory.notice, r.memory.notice ?? "")
    XCTAssertEqual(r.memory.journalDays.count, 0)
    await r.memory.removeDream(id)
    XCTAssertEqual(r.memory.dreams.count, 0)
    XCTAssertNil(r.memory.dreamDoc)
  }
}
