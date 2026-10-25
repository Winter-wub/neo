// "ความจำ & งาน": everything Neo keeps (memory, dreams, journal) and everything it will do at a time (jobs).
// Every control is one `neo …` call through MemoryModel; what is shown is what neo reports, and it re-reads by itself
// when the daemon says memory.md / jobs.md / a dream / a journal day changed (an edit in an editor shows up here).
// The same panes are the "ตั้งเวลา" and "ความจำ" tabs of Settings.
import AppKit
import NeoConsoleKit
import SwiftUI

enum MemoryTab: String, CaseIterable, Identifiable {
  case facts = "ความจำ", dreams = "ความฝัน", journal = "บันทึกสนทนา", jobs = "งานตั้งเวลา"
  var id: String { rawValue }
  var icon: String {
    switch self {
    case .facts: return "brain"
    case .dreams: return "moon.zzz"
    case .journal: return "text.bubble"
    case .jobs: return "alarm"
    }
  }
}

struct MemoryWindow: View {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var memory: MemoryModel
  @EnvironmentObject var settings: SettingsModel
  @State private var tab: MemoryTab = .facts

  var body: some View {
    VStack(spacing: 0) {
      DaemonBar()
      HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 2) {
          ForEach(MemoryTab.allCases) { t in
            Button { tab = t; memory.notice = nil } label: {
              HStack {
                Label(t.rawValue, systemImage: t.icon)
                Spacer()
                Text("\(count(t))").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 6).background(.quaternary, in: Capsule())
              }.padding(.vertical, 5).padding(.horizontal, 8).contentShape(Rectangle())
                .background(tab == t ? Color.accentColor.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: 6))
            }.buttonStyle(.plain)
          }
          Spacer()
        }.padding(8).frame(width: 190)
        Divider()
        Group {
          switch tab {
          case .facts: FactsPane()
          case .dreams: DreamsPane()
          case .journal: JournalPane()
          case .jobs: JobsPane()
          }
        }.disabled(!model.isConnected) // the data stays readable while the daemon is down; the actions wait
      }
    }
    .navigationTitle("ความจำของ \(settings.wake?.name ?? "Neo")")
    .refreshesMemory()
  }

  func count(_ t: MemoryTab) -> Int {
    switch t {
    case .facts: return memory.memory?.items.count ?? 0
    case .dreams: return memory.dreams.count
    case .journal: return memory.journalDays.reduce(0) { $0 + $1.entries }
    case .jobs: return memory.jobs?.jobs.count ?? 0
    }
  }
}

/// Reads everything when the window or tab opens, then only what the daemon says changed.
struct RefreshesMemory: ViewModifier {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var memory: MemoryModel
  @EnvironmentObject var settings: SettingsModel
  func body(content: Content) -> some View {
    content
      .task { await memory.refresh(stamps: model.fileStamps); await settings.refreshName() }
      .onChange(of: model.fileStamps) { stamps in Task { await memory.sync(stamps) } }
      .onChange(of: model.link) { link in if link == .connected { Task { await memory.refresh(stamps: model.fileStamps) } } }
      .onChange(of: model.revision) { _ in Task { await settings.refreshName() } }
  }
}
extension View { func refreshesMemory() -> some View { modifier(RefreshesMemory()) } }

private func shortTime(_ ms: Double?) -> String {
  ms.map { Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened) } ?? ""
}

/// "เปิดไฟล์ในโปรแกรมแก้ไข": the file in the default app for .md. neo watches the file, so what is saved there comes back here.
struct OpenFileButton: View {
  @EnvironmentObject var memory: MemoryModel
  let file: MemoryModel.File
  var title = "เปิดไฟล์ในโปรแกรมแก้ไข"
  var body: some View {
    Button {
      if !NSWorkspace.shared.open(memory.url(file)) { memory.notice = "เปิด \(memory.url(file).lastPathComponent) ไม่ได้ (ยังไม่มีไฟล์นี้?)" }
    } label: { Label(title, systemImage: "square.and.pencil") }
      .help(memory.url(file).path)
  }
}

// MARK: ความจำทีละข้อ

struct FactsPane: View {
  @EnvironmentObject var settings: SettingsModel
  var body: some View {
    Pane(title: "สิ่งที่ \(settings.wake?.name ?? "Neo") จำไว้", subtitle: "ความจำระยะยาวที่ใช้ประกอบทุกคำตอบ ส่วนใหญ่ได้จากการ \"ฝัน\" (จัดระเบียบบทสนทนาตอนคุณไม่อยู่) แก้ ลบ หรือเพิ่มเองได้ทีละข้อ — เก็บบน Mac เครื่องนี้เท่านั้น") {
      FactsContent()
    }
  }
}

struct FactsContent: View {
  @EnvironmentObject var memory: MemoryModel
  @EnvironmentObject var settings: SettingsModel
  @State private var filter = "ทั้งหมด"
  @State private var editing: String?
  @State private var editBase: MemoryDoc?
  @State private var draft = ""
  @State private var newSection = ""
  @State private var newText = ""
  @State private var confirmClear = false

  var items: [MemoryDoc.Item] { memory.memory?.items ?? [] }
  var sections: [String] { var s: [String] = []; for i in items where !s.contains(i.section) { s.append(i.section) }; return s }
  var shown: [MemoryDoc.Item] { items.filter { filter == "ทั้งหมด" || (filter == "จากความฝัน") == ($0.from != nil) } }
  var name: String { settings.wake?.name ?? "Neo" }
  /// memory.md changed under an open edit: saving would be refused.
  var stale: Bool { editBase != nil && editBase?.version != memory.memory?.version }

  var body: some View {
    HStack {
      Picker("", selection: $filter) { ForEach(["ทั้งหมด", "จากความฝัน", "เขียนเอง"], id: \.self) { Text($0) } }.pickerStyle(.segmented).labelsHidden().frame(width: 300)
      Spacer()
      OpenFileButton(file: .memory)
      Button("ล้างทั้งหมด", role: .destructive) { confirmClear = true }.disabled(items.isEmpty)
    }
    .confirmationDialog("ล้างความจำทั้งหมด?", isPresented: $confirmClear) {
      Button("ล้างความจำ", role: .destructive) { Task { await memory.clearMemory() } }
    }
    if items.isEmpty { Text("ยังไม่มีความจำ — คุยกับ \(name) แล้วรอให้ฝัน หรือเพิ่มเองด้านล่าง").foregroundStyle(.secondary) }
    ForEach(sections, id: \.self) { sec in
      let rows = shown.filter { $0.section == sec }
      if !rows.isEmpty {
        GroupBox(sec.isEmpty ? "ทั่วไป" : sec) {
          VStack(alignment: .leading, spacing: 6) { ForEach(rows) { item in row(item); if item.id != rows.last?.id { Divider() } } }
            .frame(maxWidth: .infinity, alignment: .leading).padding(4)
        }
      }
    }
    GroupBox("เพิ่มความจำ") {
      HStack {
        TextField("หัวข้อ", text: $newSection).textFieldStyle(.roundedBorder).frame(width: 150)
        Menu { ForEach(sections.filter { !$0.isEmpty }, id: \.self) { s in Button(s) { newSection = s } } } label: { Image(systemName: "chevron.down") }.menuStyle(.borderlessButton).fixedSize()
        TextField("เช่น ชอบให้ตอบสั้น ๆ / แพ้กุ้ง / ทำงานที่ CPN", text: $newText).textFieldStyle(.roundedBorder).onSubmit(add)
        Button("เพิ่ม", action: add).disabled(newText.trimmingCharacters(in: .whitespaces).isEmpty)
      }.padding(4)
    }
    NoticeText(text: memory.notice)
  }

  @ViewBuilder func row(_ item: MemoryDoc.Item) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: item.from != nil ? "moon.stars.fill" : "pencil").foregroundStyle(item.from != nil ? Color.indigo : .secondary).frame(width: 16)
        .help(item.from.map { "ได้จากความฝัน \(shortTime($0.at)) — \($0.dream)" } ?? "เขียน/แก้เอง หรือมีมาก่อนเริ่มบันทึกที่มา")
      if editing == item.id {
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            TextField("", text: $draft).textFieldStyle(.roundedBorder).onSubmit { commit(item) }
            Button("บันทึก") { commit(item) }.keyboardShortcut(.defaultAction)
            Button("ยกเลิก") { editing = nil; editBase = nil; memory.notice = nil }
          }
          if stale { Text("memory.md ถูกแก้จากที่อื่นระหว่างที่คุณแก้ — ถ้าบันทึก Neo จะปฏิเสธ").font(.caption).foregroundStyle(.orange) }
        }
      } else {
        VStack(alignment: .leading, spacing: 1) {
          Text(item.text).textSelection(.enabled)
          if let from = item.from { Text("จากความฝัน \(shortTime(from.at))" + (from.dream.isEmpty ? "" : " · \(from.dream)")).font(.caption2).foregroundStyle(.secondary) }
        }
        Spacer()
        Button { draft = item.text; editBase = memory.memory; editing = item.id; memory.notice = nil } label: { Image(systemName: "square.and.pencil") }.help("แก้")
        Button(role: .destructive) { Task { await memory.forgetMemory(item) } } label: { Image(systemName: "trash") }.help("ลืมเรื่องนี้")
      }
    }.buttonStyle(.borderless)
  }

  func commit(_ item: MemoryDoc.Item) {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    Task {
      if text.isEmpty { await memory.forgetMemory(item); editing = nil; editBase = nil; return }
      guard text != item.text, let base = editBase else { editing = nil; editBase = nil; return }
      // refused (changed elsewhere): stay in the edit so the typed text is not lost, but against the newest file
      if await memory.editMemory(item, to: text, base: base) { editing = nil; editBase = nil }
      else { editBase = memory.memory }
    }
  }

  func add() {
    let text = newText
    guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    Task { await memory.addMemory(text, section: newSection); if memory.notice == nil { newText = "" } }
  }
}

// MARK: ความฝัน

struct DreamsPane: View {
  @EnvironmentObject var memory: MemoryModel
  @State private var confirmClear = false
  var running: Bool { memory.dreamingNow || memory.dreamStatus?.running == true }

  var body: some View {
    Pane(title: "ความฝัน", subtitle: "ทุกครั้งที่หลับลึก AI จะทบทวนบทสนทนาที่ยังไม่ได้ฝัน: รวม/ตัดความจำซ้ำ (+ เพิ่ม, − ลืม), ค้นเรื่องที่เคยขอให้ลึกขึ้น และจับรูปแบบการใช้งาน") {
      DreamControls()
      if memory.dreams.isEmpty { Text("ยังไม่เคยฝัน").foregroundStyle(.secondary) }
      ForEach(memory.dreams) { DreamCard(info: $0) }
      HStack {
        OpenFileButton(file: memory.dreamDoc.map { .dream($0.id) } ?? .dreamsFolder)
        Spacer()
        Button("ลบประวัติฝันทั้งหมด", role: .destructive) { confirmClear = true }.disabled(memory.dreams.isEmpty).help("ลบเฉพาะประวัติ — ความจำที่จัดไว้แล้วยังอยู่")
      }
      .confirmationDialog("ลบประวัติฝันทั้งหมด?", isPresented: $confirmClear) {
        Button("ลบทั้งหมด", role: .destructive) { Task { await memory.clearDreams() } }
      }
      NoticeText(text: memory.notice)
    }
  }
}

/// Whether Neo dreams by itself, dream now, and why a dream would or would not run now.
struct DreamControls: View {
  @EnvironmentObject var memory: MemoryModel
  @EnvironmentObject var settings: SettingsModel
  var running: Bool { memory.dreamingNow || memory.dreamStatus?.running == true }
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        if running { ProgressView().controlSize(.small); Text("กำลังฝัน…").foregroundStyle(mint) }
        else { Text(memory.dreamStatus?.last.map { "ฝันล่าสุด " + shortTime($0.at) } ?? "ยังไม่เคยฝัน").foregroundStyle(.secondary) }
        Spacer()
        Toggle("ฝันเองเมื่อไม่อยู่", isOn: Binding(get: { memory.dreamStatus?.enabled ?? settings.settings?.dream ?? true }, set: { v in Task { await memory.setDreamEnabled(v) } }))
        Button("ฝันเดี๋ยวนี้") { Task { await memory.dreamNow() } }.disabled(running).help("ใช้ AI ทบทวนบทสนทนาที่ยังไม่ได้ฝัน (ใช้ quota)")
      }
      if let status = memory.dreamStatus, let line = status.why ?? status.blocked {
        Text((status.why != nil ? "ตอนนี้ฝันได้: " : "ตอนนี้ยังไม่ฝัน: ") + line).font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}

struct DreamCard: View {
  @EnvironmentObject var memory: MemoryModel
  let info: DreamInfo
  var open: Bool { memory.dreamDoc?.id == info.id }

  var body: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text("💤 " + info.dream).bold()
          if info.undelivered { Text("ยังไม่เล่าให้มือถือ").font(.caption2).padding(.horizontal, 5).background(.indigo.opacity(0.2), in: Capsule()) }
          Spacer()
          Text(shortTime(info.at)).font(.caption).foregroundStyle(.secondary)
          Button { Task { await memory.showDream(open ? nil : info.id) } } label: { Image(systemName: open ? "chevron.up" : "chevron.down") }.help(open ? "ย่อ" : "ดูรายละเอียด")
          Button(role: .destructive) { Task { await memory.removeDream(info.id) } } label: { Image(systemName: "trash") }.help("ลบความฝันนี้ออกจากประวัติ")
        }.buttonStyle(.borderless)
        Text("\(info.reason) · ทบทวน \(info.entries) บทสนทนา · ใช้เวลา \(Int(info.took / 1000)) วิ").font(.caption).foregroundStyle(.secondary)
        if open, let doc = memory.dreamDoc { detail(doc) }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
    }
  }

  @ViewBuilder func detail(_ doc: DreamDoc) -> some View {
    if doc.added.isEmpty && doc.removed.isEmpty { Text("ความจำไม่เปลี่ยน").font(.caption).foregroundStyle(.secondary) }
    ForEach(doc.added, id: \.self) { Text("+ " + $0).font(.callout).foregroundStyle(.green).textSelection(.enabled) }
    ForEach(doc.removed, id: \.self) { Text("− " + $0).font(.callout).foregroundStyle(.red.opacity(0.8)).strikethrough().textSelection(.enabled) }
    if !doc.insights.isEmpty { Text("ค้นเพิ่ม").font(.caption.bold()).padding(.top, 2) }
    ForEach(Array(doc.insights.enumerated()), id: \.offset) { Text("• \($0.element.q): \($0.element.finding)").font(.callout).textSelection(.enabled) }
    ForEach(doc.patterns, id: \.self) { Text("↻ " + $0).font(.caption).foregroundStyle(mint) }
  }
}

// MARK: บันทึกสนทนา

struct JournalPane: View {
  @EnvironmentObject var memory: MemoryModel
  @State private var query = ""
  @State private var confirmClear = false

  var entries: [JournalEntry] {
    let all = memory.journalDoc?.entries ?? []
    return query.isEmpty ? all : all.filter { ($0.q + $0.a).localizedCaseInsensitiveContains(query) }
  }

  var body: some View {
    Pane(title: "บันทึกสนทนา", subtitle: "ทุกคำถาม-คำตอบถูกจดไว้ (วันละไฟล์) ให้ความฝันครั้งถัดไปนำไปจัดระเบียบเป็นความจำ ลบเรื่องที่ไม่อยากให้จำได้") {
      HStack {
        Picker("วัน", selection: Binding(get: { memory.journalDoc?.day ?? "" }, set: { day in Task { await memory.showDay(day) } })) {
          ForEach(memory.journalDays) { Text("\($0.day) (\($0.entries))").tag($0.day) }
        }.frame(width: 220).disabled(memory.journalDays.isEmpty)
        TextField("ค้นหา", text: $query).textFieldStyle(.roundedBorder).frame(width: 200)
        Spacer()
        OpenFileButton(file: memory.journalDoc.map { .journal($0.day) } ?? .journalFolder)
        Button("ลบทั้งหมด", role: .destructive) { confirmClear = true }.disabled(memory.journalDays.isEmpty)
      }
      .confirmationDialog("ลบบันทึกสนทนาทั้งหมด?", isPresented: $confirmClear) {
        Button("ลบทั้งหมด", role: .destructive) { Task { await memory.clearJournal() } }
      }
      if entries.isEmpty { Text(memory.journalDays.isEmpty ? "ยังไม่มีบันทึก" : "ไม่พบ").foregroundStyle(.secondary) }
      LazyVStack(alignment: .leading, spacing: 8) {
        ForEach(entries) { e in
          HStack(alignment: .top, spacing: 8) {
            Text(e.time).font(.caption.monospacedDigit()).foregroundStyle(.tertiary).frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
              Text(e.q).bold().textSelection(.enabled)
              Text(e.a).font(.callout).foregroundStyle(e.ok ? Color.secondary : Color.orange).lineLimit(3).textSelection(.enabled)
            }
            Spacer()
            Button(role: .destructive) { Task { await memory.forgetTurn(e) } } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("ลบบทสนทนานี้")
          }
          Divider()
        }
      }
      NoticeText(text: memory.notice)
    }
  }
}

// MARK: งานตั้งเวลา

struct JobsPane: View {
  @EnvironmentObject var memory: MemoryModel
  @EnvironmentObject var settings: SettingsModel
  @State private var speech = ""
  // detailed add
  @State private var kind = "alarm"
  @State private var title = ""
  @State private var prompt = ""
  @State private var repeatMode = "once"
  @State private var date = Date().addingTimeInterval(3600)
  @State private var days: Set<Int> = [1, 2, 3, 4, 5]
  @State private var cron = "0 8 * * 1-5"
  let dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]
  var name: String { settings.wake?.name ?? "Neo" }

  var body: some View {
    Pane(title: "ตั้งเวลา", subtitle: "นาฬิกาปลุก การเตือน และงานที่ให้ Neo ทำเองตามเวลา (แบบ cron) — สั่งด้วยเสียงได้ เช่น \"\(name) ปลุก 7 โมงครึ่ง\", \"\(name) ทุกวันธรรมดา 8 โมง สรุปข่าว\", \"\(name) มีปลุกอะไรบ้าง\"") {
      if let r = memory.jobs?.ringing {
        HStack {
          Image(systemName: "alarm.waves.left.and.right.fill").foregroundStyle(.orange)
          Text("กำลังปลุก: \(r.title)").bold(); Spacer()
          Button("ปิดปลุก") { Task { await memory.stopAlarm() } }
        }.padding(10).background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
      }
      GroupBox("รายการ") {
        VStack(alignment: .leading, spacing: 6) {
          if memory.jobs?.jobs.isEmpty ?? true { Text("ยังไม่มี").foregroundStyle(.secondary) }
          ForEach(memory.jobs?.jobs ?? []) { JobRow(job: $0) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      if let problems = memory.jobs?.problems, !problems.isEmpty {
        VStack(alignment: .leading, spacing: 2) {
          Text("jobs.md มีบรรทัดที่อ่านไม่ได้ \(problems.count) บรรทัด — Neo ใช้งานชุดเดิมไว้ก่อน").font(.caption).foregroundStyle(.orange)
          ForEach(Array(problems.enumerated()), id: \.offset) { Text("บรรทัด \($0.element.line.map(String.init) ?? "?"): \($0.element.error ?? "") \($0.element.text ?? "")").font(.caption2).foregroundStyle(.secondary) }
        }
      }
      speechBox
      detailedBox
      HStack { OpenFileButton(file: .jobs, title: "เปิด jobs.md ในโปรแกรมแก้ไข"); Spacer() }
      NoticeText(text: memory.notice)
    }
  }

  var speechBox: some View {
    GroupBox("เพิ่มแบบพิมพ์เหมือนพูด") {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          TextField("เช่น ปลุกพรุ่งนี้ตีห้าครึ่ง / เตือนให้กินยาสองทุ่ม / ทุก 30 นาที ดูสถานะ agent", text: $speech).textFieldStyle(.roundedBorder)
            .onChange(of: speech) { _ in memory.cancelPreview() }.onSubmit(check)
          Button("ตรวจ", action: check).disabled(speech.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        if let p = memory.preview {
          HStack {
            Text("\(p.kind == "task" ? "งาน" : "ปลุก"): \(p.title) — \(p.when)").foregroundStyle(mint)
            Spacer()
            Button("ไม่เอา") { memory.cancelPreview() }
            Button("เพิ่ม") { Task { if await memory.confirmPreview() { speech = "" } } }.keyboardShortcut(.defaultAction)
          }
          if let prompt = p.prompt, prompt != p.title { Text("ให้ทำ: \(prompt)").font(.caption).foregroundStyle(.secondary) }
        }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
    }
  }

  var detailedBox: some View {
    GroupBox("เพิ่มแบบละเอียด") {
      VStack(alignment: .leading, spacing: 8) {
        Picker("ชนิด", selection: $kind) { Text("ปลุก / เตือน").tag("alarm"); Text("งานให้ AI ทำ").tag("task") }.pickerStyle(.segmented)
        TextField(kind == "alarm" ? "ข้อความเตือน เช่น ประชุมทีม" : "ชื่องาน เช่น สรุปข่าวเช้า", text: $title).textFieldStyle(.roundedBorder)
        if kind == "task" { TextField("ให้ทำอะไร (ส่งให้สมองของ Neo เหมือนพูดสั่ง) เช่น สรุปข่าวเทคโนโลยี 5 ข่าว", text: $prompt, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder) }
        Picker("เวลา", selection: $repeatMode) { Text("ครั้งเดียว").tag("once"); Text("ซ้ำทุกสัปดาห์").tag("weekly"); Text("cron").tag("cron") }.pickerStyle(.segmented)
        switch repeatMode {
        case "once": DatePicker("เมื่อ", selection: $date, in: Date()...)
        case "weekly":
          HStack {
            DatePicker("เวลา", selection: $date, displayedComponents: .hourAndMinute).fixedSize()
            ForEach(0..<7, id: \.self) { d in Toggle(dayNames[d], isOn: Binding(get: { days.contains(d) }, set: { if $0 { days.insert(d) } else { days.remove(d) } })).toggleStyle(.button) }
          }
        default:
          HStack {
            TextField("นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์", text: $cron).textFieldStyle(.roundedBorder).font(.body.monospaced()).frame(width: 220)
            Text("เช่น */15 9-18 * * 1-5 = ทุก 15 นาที เวลางาน").font(.caption).foregroundStyle(.secondary)
          }
        }
        HStack { Spacer(); Button("เพิ่ม") { Task { await addDetailed() } }.disabled((title.isEmpty && prompt.isEmpty) || (repeatMode == "weekly" && days.isEmpty)) }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
    }
  }

  func check() { Task { await memory.previewJob(speech); if memory.preview == nil && memory.notice?.contains("เพิ่มให้เลย") == true { speech = "" } } }

  func addDetailed() async {
    let c = Calendar.current.dateComponents([.hour, .minute], from: date)
    let t = title.isEmpty ? prompt : title
    let p = kind == "task" ? (prompt.isEmpty ? title : prompt) : nil
    let ok: Bool
    switch repeatMode {
    case "once": ok = await memory.addJob(kind: kind, title: t, prompt: p, at: date)
    case "weekly": ok = await memory.addJob(kind: kind, title: t, prompt: p, cron: "\(c.minute ?? 0) \(c.hour ?? 0) * * " + (days.count == 7 ? "*" : days.sorted().map(String.init).joined(separator: ",")))
    default: ok = await memory.addJob(kind: kind, title: t, prompt: p, cron: cron)
    }
    if ok { title = ""; prompt = "" }
  }
}

struct JobRow: View {
  @EnvironmentObject var memory: MemoryModel
  let job: JobsList.Job
  @State private var edit = false
  var body: some View {
    let task = job.kind == "task"
    HStack(spacing: 10) {
      Image(systemName: task ? "sparkles" : "alarm").foregroundStyle(job.enabled ? mint : .secondary).frame(width: 18)
      VStack(alignment: .leading, spacing: 1) {
        Text(job.title).bold().foregroundStyle(job.enabled ? .primary : .secondary)
        Text(job.when + (job.next.map { " · ครั้งถัดไป " + shortTime($0) } ?? "")).font(.caption).foregroundStyle(.secondary)
        if task, let p = job.prompt, p != job.title { Text(p).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
      }
      Spacer()
      Toggle("", isOn: Binding(get: { job.enabled }, set: { v in Task { await memory.setJob(job.id, enabled: v) } })).toggleStyle(.switch).labelsHidden()
      Button { edit = true } label: { Image(systemName: "square.and.pencil") }.help("แก้")
      Button { Task { await memory.testJob(job.id) } } label: { Image(systemName: "play.fill") }.help("ลองเลย")
      Button(role: .destructive) { Task { await memory.removeJob(job.id) } } label: { Image(systemName: "trash") }.help("ลบ")
    }.buttonStyle(.borderless)
      .sheet(isPresented: $edit) { JobEditor(job: job).environmentObject(memory) }
  }
}

/// Edit one job: text, what to do (tasks), and the time (once or cron).
struct JobEditor: View {
  @EnvironmentObject var memory: MemoryModel
  @Environment(\.dismiss) var dismiss
  let job: JobsList.Job
  @State private var title = ""
  @State private var prompt = ""
  @State private var once = true
  @State private var date = Date()
  @State private var cron = ""
  @State private var error: String?
  var task: Bool { job.kind == "task" }

  var body: some View {
    Form {
      TextField(task ? "ชื่องาน" : "ข้อความเตือน", text: $title)
      if task { TextField("ให้ทำอะไร", text: $prompt, axis: .vertical).lineLimit(2...6) }
      Picker("เวลา", selection: $once) { Text("ครั้งเดียว").tag(true); Text("ซ้ำ (cron)").tag(false) }.pickerStyle(.segmented)
      if once { DatePicker("เมื่อ", selection: $date, in: Date()...) }
      else {
        TextField("นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์", text: $cron).font(.body.monospaced())
        Text("เช่น 30 6 * * 1-5 = 06:30 วันธรรมดา · */15 9-18 * * * = ทุก 15 นาที เวลางาน").font(.caption).foregroundStyle(.secondary)
      }
      if let e = error { Text(e).foregroundStyle(.orange) }
      HStack {
        Spacer()
        Button("ยกเลิก") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("บันทึก") { Task { await save() } }.keyboardShortcut(.defaultAction).disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    }.formStyle(.grouped).frame(width: 460).padding(8)
      .onAppear {
        title = job.title; prompt = job.prompt ?? ""
        if let c = job.cron { once = false; cron = c } else { once = true; cron = "0 8 * * *" }
        date = job.at.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date().addingTimeInterval(3600)
      }
  }

  func save() async {
    let ok = once
      ? await memory.editJob(job.id, title: title, prompt: task ? prompt : nil, at: date)
      : await memory.editJob(job.id, title: title, prompt: task ? prompt : nil, cron: cron)
    if ok { dismiss() } else { error = memory.notice }
  }
}
