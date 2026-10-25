import Foundation

/// What the "ความจำ & งาน" window and the ตั้งเวลา / ความจำ settings tabs show and change: jobs, memory, dreams, journal.
/// Holds no Neo logic. Every value is read with a `neo … --json` call and every control is one `neo …` call.
/// The daemon says when a file changed (`ConsoleModel.fileStamps`); `sync` re-reads just that part.
@MainActor
public final class MemoryModel: ObservableObject {
  @Published public private(set) var jobs: JobsList?
  @Published public private(set) var memory: MemoryDoc?
  @Published public private(set) var dreams: [DreamInfo] = []
  @Published public private(set) var dreamStatus: DreamStatus?
  @Published public private(set) var dreamDoc: DreamDoc?
  @Published public private(set) var journalDays: [JournalDay] = []
  @Published public private(set) var journalDoc: JournalDoc?
  /// What a typed sentence would add; shown for the user to confirm.
  @Published public private(set) var preview: JobDraft?
  /// `neo dream now` is running (it returns when the dream is over).
  @Published public private(set) var dreamingNow = false
  /// Last action error (Thai); shown inline in the pane, never as an alert.
  @Published public var notice: String?

  private let runner: NeoRunner
  private let home: String
  private var seen: [String: Int] = [:]
  private var selectedDream: String?
  private var selectedDay: String?

  public init(runner: NeoRunner, home: String) { self.runner = runner; self.home = home }

  // MARK: files (for the "open in editor" buttons)

  public enum File: Equatable {
    case memory, jobs, dream(String), journal(String), dreamsFolder, journalFolder
  }

  public func url(_ file: File) -> URL {
    let base = URL(fileURLWithPath: home)
    switch file {
    case .memory: return base.appendingPathComponent("memory.md")
    case .jobs: return base.appendingPathComponent("jobs.md")
    case .dream(let id): return base.appendingPathComponent("dreams/\(id).md")
    case .journal(let day): return base.appendingPathComponent("journal/\(day).md")
    case .dreamsFolder: return base.appendingPathComponent("dreams")
    case .journalFolder: return base.appendingPathComponent("journal")
    }
  }

  // MARK: reading

  public func refresh() async {
    async let j: Void = refreshJobs()
    async let m: Void = refreshMemory()
    async let d: Void = refreshDreams()
    async let y: Void = refreshJournal()
    _ = await (j, m, d, y)
  }

  /// First read: everything, and remember the stamps so only later changes trigger a re-read.
  public func refresh(stamps: [String: Int]) async {
    seen = stamps
    await refresh()
  }

  /// The daemon reported a file change (`ConsoleModel.fileStamps` moved): re-read what changed.
  public func sync(_ stamps: [String: Int]) async {
    let moved = Set(stamps.filter { seen[$0.key] != $0.value }.map(\.key))
    seen = stamps
    if moved.contains("jobs") { await refreshJobs() }
    if moved.contains("memory") { await refreshMemory() }
    if moved.contains("dream") { await refreshDreams() }
    if moved.contains("journal") { await refreshJournal() }
  }

  public func refreshJobs() async {
    if let v = await runner.run(["jobs", "list"]).decode(JobsList.self) { jobs = v }
  }

  public func refreshMemory() async {
    if let v = await runner.run(["memory", "show"]).decode(MemoryDoc.self) { memory = v }
  }

  public func refreshDreams() async {
    async let l = runner.run(["dream", "list"])
    async let s = runner.run(["dream", "status"])
    let (rl, rs) = await (l, s)
    if let v = rl.decode([DreamInfo].self) { dreams = v }
    if let v = rs.decode(DreamStatus.self) { dreamStatus = v }
    // keep the open dream if it still exists; otherwise the newest
    let id = dreams.contains { $0.id == selectedDream } ? selectedDream : dreams.first?.id
    await showDream(id)
  }

  public func showDream(_ id: String?) async {
    selectedDream = id
    guard let id else { dreamDoc = nil; return }
    if let v = await runner.run(["dream", "show", id]).decode(DreamDoc.self) { dreamDoc = v }
  }

  public func refreshJournal() async {
    if let v = await runner.run(["journal", "list"]).decode([JournalDay].self) { journalDays = v }
    let day = journalDays.contains { $0.day == selectedDay } ? selectedDay : journalDays.first?.day
    await showDay(day)
  }

  public func showDay(_ day: String?) async {
    selectedDay = day
    guard let day else { journalDoc = nil; return }
    if let v = await runner.run(["journal", "show", day]).decode(JournalDoc.self) { journalDoc = v }
  }

  // MARK: jobs

  /// "ปลุกพรุ่งนี้ตีห้าครึ่ง": ask neo what that means (`neo jobs parse`) and keep it as `preview` for the user to confirm.
  public func previewJob(_ speech: String) async {
    let text = speech.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    let result = await runner.run(["jobs", "parse", text])
    if let parsed = result.decode(JobParse.self) { preview = parsed.draft; notice = nil; return }
    preview = nil
    if result.code == 2 {
      // this neo has no `jobs parse` yet: add straight away rather than leave the box dead, and say so
      let added = await act(["jobs", "add", text, "--yes"])
      if added { notice = "neo รุ่นนี้ยังดูตัวอย่างก่อนเพิ่มไม่ได้ — เพิ่มให้เลยแล้ว"; await refreshJobs() }
    } else {
      notice = result.failureMessage
    }
  }

  public func cancelPreview() { preview = nil }

  /// Add exactly what the preview showed.
  @discardableResult
  public func confirmPreview() async -> Bool {
    guard let draft = preview else { return false }
    let ok = await addJob(kind: draft.kind, title: draft.title, prompt: draft.prompt, atMs: draft.at, cron: draft.cron)
    if ok { preview = nil }
    return ok
  }

  @discardableResult
  public func addJob(kind: String, title: String, prompt: String?, at: Date? = nil, cron: String? = nil) async -> Bool {
    await addJob(kind: kind, title: title, prompt: prompt, atMs: at.map { $0.timeIntervalSince1970 * 1000 }, cron: cron)
  }

  @discardableResult
  func addJob(kind: String, title: String, prompt: String?, atMs: Double?, cron: String?) async -> Bool {
    var args = ["jobs", "add", "--kind", kind, "--title", title]
    if let prompt, !prompt.isEmpty { args += ["--prompt", prompt] }
    args += when(atMs: atMs, cron: cron)
    guard await act(args) else { return false }
    await refreshJobs()
    return true
  }

  @discardableResult
  public func editJob(_ id: String, title: String, prompt: String?, at: Date? = nil, cron: String? = nil) async -> Bool {
    var args = ["jobs", "edit", id, "--title", title]
    if let prompt, !prompt.isEmpty { args += ["--prompt", prompt] }
    args += when(atMs: at.map { $0.timeIntervalSince1970 * 1000 }, cron: cron)
    guard await act(args) else { return false }
    await refreshJobs()
    return true
  }

  /// `--at "YYYY-MM-DD HH:mm"` (local time) or `--cron`.
  private func when(atMs: Double?, cron: String?) -> [String] {
    if let atMs { return ["--at", Self.atFormatter.string(from: Date(timeIntervalSince1970: atMs / 1000))] }
    if let cron, !cron.isEmpty { return ["--cron", cron] }
    return []
  }

  static let atFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd HH:mm"
    return f
  }()

  public func setJob(_ id: String, enabled: Bool) async {
    guard await act(["jobs", enabled ? "on" : "off", id]) else { return }
    await refreshJobs()
  }
  public func testJob(_ id: String) async { await act(["jobs", "test", id]) }
  public func removeJob(_ id: String) async {
    guard await act(["jobs", "rm", id]) else { return }
    await refreshJobs()
  }
  public func stopAlarm() async { await act(["alarm", "stop"]) }

  // MARK: memory

  public func addMemory(_ text: String, section: String) async {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines), s = section.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty else { return }
    guard await act(["memory", "add", t] + (s.isEmpty ? [] : ["--section", s])) else { return }
    await refreshMemory()
  }

  /// `neo memory forget "<text>"`: neo refuses and lists them when several items match.
  public func forgetMemory(_ item: MemoryDoc.Item) async {
    guard await act(["memory", "forget", item.text]) else { await refreshMemory(); return }
    await refreshMemory()
  }

  public func clearMemory() async {
    guard await act(["memory", "clear"]) else { return }
    await refreshMemory()
  }

  /// Change one item's text. The whole of memory.md is saved through `neo memory edit` with a one-shot editor, so
  /// it is the same conflict-checked save a person gets in $EDITOR: if the file is no longer the one `base` was read
  /// from, nothing is written and `notice` says so.
  @discardableResult
  public func editMemory(_ item: MemoryDoc.Item, to newText: String, base: MemoryDoc) async -> Bool {
    guard let text = MemoryText.replacing(item, with: newText, in: base.text) else {
      notice = "ไม่พบข้อความเดิมในความจำ — โหลดใหม่แล้ว ลองอีกครั้ง"
      await refreshMemory()
      return false
    }
    return await saveMemory(text, base: base)
  }

  @discardableResult
  public func saveMemory(_ text: String, base: MemoryDoc) async -> Bool {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("neo-console-edit-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let editor = dir.appendingPathComponent("editor.sh")
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try Data(base.text.utf8).write(to: dir.appendingPathComponent("base"))
      try Data(text.utf8).write(to: dir.appendingPathComponent("new"))
      // neo gives the editor a copy of the file as it is NOW. If that is not what the user started from, refuse (exit 42);
      // otherwise put the new text there. neo then saves it with `since` = the version it just read.
      let script = "#!/bin/sh\ncmp -s \"$1\" \"$NEO_CONSOLE_BASE\" || exit \(Self.staleExit)\ncp \"$NEO_CONSOLE_NEW\" \"$1\"\n"
      try Data(script.utf8).write(to: editor)
      try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: editor.path)
    } catch {
      notice = "เตรียมไฟล์ชั่วคราวสำหรับบันทึกไม่ได้"
      return false
    }
    let quoted = "'" + editor.path.replacingOccurrences(of: "'", with: "'\\''") + "'"
    let result = await runner.run(["memory", "edit"], stdin: nil, env: [
      "EDITOR": quoted, "VISUAL": quoted,
      "NEO_CONSOLE_BASE": dir.appendingPathComponent("base").path, "NEO_CONSOLE_NEW": dir.appendingPathComponent("new").path,
    ])
    if result.ok {
      notice = nil
      if let doc = result.decode(MemoryDoc.self) { memory = doc } else { await refreshMemory() }
      return true
    }
    let message = result.failureMessage
    notice = message.contains("code \(Self.staleExit)")
      ? "memory.md ถูกแก้จากที่อื่นระหว่างที่คุณแก้ — ไม่ได้บันทึก โหลดฉบับล่าสุดให้แล้ว ลองแก้อีกครั้ง"
      : Self.dropLeftoverCopy(message)
    await refreshMemory()
    return false
  }

  static let staleExit = 42

  /// neo keeps a refused edit in a temp copy and names it in the message; the window still has the text, so tidy it up.
  static func dropLeftoverCopy(_ message: String) -> String {
    var lines = message.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    if let i = lines.lastIndex(where: { $0.contains("ยังอยู่ที่ ") }) {
      let path = lines[i].components(separatedBy: "ยังอยู่ที่ ").last?.trimmingCharacters(in: .whitespaces) ?? ""
      let dir = URL(fileURLWithPath: path).deletingLastPathComponent()
      if dir.lastPathComponent.hasPrefix("neo-edit-") { try? FileManager.default.removeItem(at: dir) }
      lines.remove(at: i)
    }
    return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  // MARK: dreams

  /// `neo dream now`: uses the Brain (Claude quota); returns when the dream is over.
  public func dreamNow() async {
    dreamingNow = true; defer { dreamingNow = false }
    guard await act(["dream", "now"]) else { await refreshDreams(); return }
    await refreshDreams()
    await refreshMemory()
  }

  public func setDreamEnabled(_ on: Bool) async {
    guard await act(["dream", on ? "on" : "off"]) else { return }
    if let v = await runner.run(["dream", "status"]).decode(DreamStatus.self) { dreamStatus = v }
  }

  public func removeDream(_ id: String) async {
    guard await act(["dream", "rm", id]) else { return }
    await refreshDreams()
  }

  public func clearDreams() async {
    guard await act(["dream", "clear"]) else { return }
    await refreshDreams()
  }

  // MARK: journal

  /// `neo journal forget "<question>"`: neo refuses and lists them when several turns match.
  public func forgetTurn(_ entry: JournalEntry) async {
    guard await act(["journal", "forget", entry.q]) else { return }
    await refreshJournal()
  }

  public func clearJournal() async {
    guard await act(["journal", "clear"]) else { return }
    await refreshJournal()
  }

  // MARK: plumbing

  @discardableResult
  private func act(_ args: [String]) async -> Bool {
    let result = await runner.run(args)
    notice = result.ok ? nil : result.failureMessage
    return result.ok
  }
}

/// The one text edit Neo Console does to memory.md itself: change a `- item` line, leaving everything else as it is.
/// (Same reading of the file as NeoCli: `#` headings start a section, `- ` / `* ` lines at column 0 are items.)
public enum MemoryText {
  public static func replacing(_ item: MemoryDoc.Item, with newText: String, in text: String) -> String? {
    let clean = newText.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    guard !clean.isEmpty else { return nil }
    var lines = text.components(separatedBy: "\n")
    var section = ""
    for (i, line) in lines.enumerated() {
      if let heading = headingText(line) { section = heading; continue }
      if let (marker, content) = bullet(line), section == item.section, content == item.text {
        lines[i] = "\(marker) \(clean)"
        return lines.joined(separator: "\n")
      }
    }
    return nil
  }

  static func headingText(_ line: String) -> String? {
    let hashes = line.prefix { $0 == "#" }
    guard (1...6).contains(hashes.count) else { return nil }
    let rest = line.dropFirst(hashes.count)
    guard let first = rest.first, first.isWhitespace else { return nil }
    return rest.trimmingCharacters(in: .whitespaces)
  }

  static func bullet(_ line: String) -> (Character, String)? {
    guard let marker = line.first, marker == "-" || marker == "*" else { return nil }
    let rest = line.dropFirst()
    guard let first = rest.first, first.isWhitespace else { return nil }
    let content = rest.trimmingCharacters(in: .whitespaces)
    return content.isEmpty ? nil : (marker, content)
  }
}
