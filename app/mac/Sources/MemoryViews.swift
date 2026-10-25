import SwiftUI

// หน้าต่าง "ความจำ & งาน" (เปิดจาก Console): ดู/จัดการทุกอย่างที่ Neo จำไว้ — ความจำทีละข้อ, สิ่งที่ความฝันจัดระเบียบ,
// บันทึกบทสนทนาที่รอฝัน, งานตั้งเวลา (cron)

enum MemoryTab: String, CaseIterable, Identifiable {
  case facts = "ความจำ", dreams = "ความฝัน", journal = "บันทึกสนทนา", jobs = "งานตั้งเวลา"
  var id: String { rawValue }
  var icon: String { switch self { case .facts: return "brain"; case .dreams: return "moon.zzz"; case .journal: return "text.bubble"; case .jobs: return "alarm" } }
}

struct MemoryWindow: View {
  @EnvironmentObject var store: Store
  @State private var tab: MemoryTab? = .facts
  var body: some View {
    NavigationSplitView {
      List(MemoryTab.allCases, selection: $tab) { t in
        Label(t.rawValue, systemImage: t.icon).badge(count(t)).tag(t)
      }.navigationSplitViewColumnWidth(min: 170, ideal: 190)
    } detail: {
      switch tab ?? .facts {
      case .facts: FactsPane()
      case .dreams: DreamsPane()
      case .journal: JournalPane()
      case .jobs: SchedulePane()
      }
    }
    .task { await store.refreshDream(); await store.refreshJobs() }
    .navigationTitle("ความจำของ \(store.wakeName.isEmpty ? "Neo" : store.wakeName)")
  }
  func count(_ t: MemoryTab) -> Int {
    switch t {
    case .facts: return (store.dream["facts"] as? [JSON])?.count ?? 0
    case .dreams: return (store.dream["dreams"] as? [JSON])?.count ?? 0
    case .journal: return store.dream["journal"] as? Int ?? 0
    case .jobs: return store.jobs.count
    }
  }
}

private func when(_ t: Double?) -> String { t.map { Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened) } ?? "" }

// ---------- ความจำทีละข้อ ----------
struct Fact: Identifiable, Equatable { let id = UUID(); var section: String; var text: String; var from: Double?; var dream: String? }

struct FactsPane: View {
  @EnvironmentObject var store: Store
  @State private var facts: [Fact] = []
  @State private var editing: UUID? = nil
  @State private var draft = ""
  @State private var newSection = ""
  @State private var newText = ""
  @State private var filter = "ทั้งหมด"
  var name: String { store.wakeName.isEmpty ? "Neo" : store.wakeName }
  var sections: [String] { var s: [String] = []; for f in facts where !s.contains(f.section) { s.append(f.section) }; return s }
  var shown: [Fact] { facts.filter { filter == "ทั้งหมด" || filter == "จากความฝัน" && $0.from != nil || filter == "เขียนเอง" && $0.from == nil } }

  var body: some View {
    Pane(title: "สิ่งที่ \(name) จำไว้", subtitle: "ความจำระยะยาวที่ใช้ประกอบทุกคำตอบ ส่วนใหญ่ได้จากการ \"ฝัน\" (จัดระเบียบบทสนทนาตอนคุณไม่อยู่) แก้ ลบ หรือเพิ่มเองได้ทีละข้อ — เก็บบน Mac เครื่องนี้เท่านั้น") {
      HStack {
        Picker("", selection: $filter) { ForEach(["ทั้งหมด", "จากความฝัน", "เขียนเอง"], id: \.self) { Text($0) } }.pickerStyle(.segmented).labelsHidden().frame(width: 300)
        Spacer()
        Text("\(store.dream["memory"] as? String ?? "")".count.description + "/3000 ตัวอักษร").font(.caption).foregroundStyle(.secondary)
        Button("ล้างทั้งหมด", role: .destructive) { facts = []; save() }.disabled(facts.isEmpty)
      }
      if facts.isEmpty { Text("ยังไม่มีความจำ — คุยกับ \(name) แล้วรอให้ฝัน หรือเพิ่มเองด้านล่าง").foregroundStyle(.secondary) }
      ForEach(sections, id: \.self) { sec in
        let rows = shown.filter { $0.section == sec }
        if !rows.isEmpty {
          GroupBox(sec.isEmpty ? "ทั่วไป" : sec) {
            VStack(alignment: .leading, spacing: 6) { ForEach(rows) { f in row(f); if f.id != rows.last?.id { Divider() } } }
              .frame(maxWidth: .infinity, alignment: .leading).padding(4)
          }
        }
      }
      GroupBox("เพิ่มความจำ") {
        HStack {
          TextField("หัวข้อ", text: $newSection).textFieldStyle(.roundedBorder).frame(width: 150)
          Menu { ForEach(sections, id: \.self) { s in Button(s) { newSection = s } } } label: { Image(systemName: "chevron.down") }.menuStyle(.borderlessButton).fixedSize()
          TextField("เช่น ชอบให้ตอบสั้น ๆ / แพ้กุ้ง / ทำงานที่ CPN", text: $newText).textFieldStyle(.roundedBorder).onSubmit(add)
          Button("เพิ่ม", action: add).disabled(newText.trimmingCharacters(in: .whitespaces).isEmpty)
        }.padding(4)
      }
    }
    .onAppear(perform: load)
    .onChange(of: store.dream["memory"] as? String ?? "") { _ in if editing == nil { load() } }
  }

  @ViewBuilder func row(_ f: Fact) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: f.from != nil ? "moon.stars.fill" : "pencil").foregroundStyle(f.from != nil ? Color.indigo : .secondary).frame(width: 16)
        .help(f.from != nil ? "ได้จากความฝัน \(when(f.from)) — \(f.dream ?? "")" : "เขียน/แก้เอง หรือมีมาก่อนเริ่มบันทึกที่มา")
      if editing == f.id {
        TextField("", text: $draft).textFieldStyle(.roundedBorder).onSubmit { commit(f) }
        Button("บันทึก") { commit(f) }.keyboardShortcut(.defaultAction)
        Button("ยกเลิก") { editing = nil }
      } else {
        VStack(alignment: .leading, spacing: 1) {
          Text(f.text).textSelection(.enabled)
          if f.from != nil { Text("จากความฝัน \(when(f.from))" + (f.dream.map { " · \($0)" } ?? "")).font(.caption2).foregroundStyle(.secondary) }
        }
        Spacer()
        Button { draft = f.text; editing = f.id } label: { Image(systemName: "square.and.pencil") }.help("แก้")
        Button(role: .destructive) { facts.removeAll { $0.id == f.id }; save() } label: { Image(systemName: "trash") }.help("ลืมเรื่องนี้")
      }
    }.buttonStyle(.borderless)
  }

  func load() {
    facts = ((store.dream["facts"] as? [JSON]) ?? []).map { j in
      let from = j["from"] as? JSON
      return Fact(section: j["section"] as? String ?? "", text: j["text"] as? String ?? "", from: from?["at"] as? Double, dream: from?["dream"] as? String)
    }
  }
  func commit(_ f: Fact) {
    let t = draft.trimmingCharacters(in: .whitespaces)
    if let i = facts.firstIndex(where: { $0.id == f.id }) { if t.isEmpty { facts.remove(at: i) } else if t != f.text { facts[i].text = t; facts[i].from = nil } }
    editing = nil; save()
  }
  func add() {
    let t = newText.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { return }
    let s = newSection.trimmingCharacters(in: .whitespaces)
    let sec = s.isEmpty ? (sections.first ?? "ผู้ใช้") : s
    if let last = facts.lastIndex(where: { $0.section == sec }) { facts.insert(Fact(section: sec, text: t), at: last + 1) } else { facts.append(Fact(section: sec, text: t)) }
    newText = ""; save()
  }
  func save() { store.dreamCmd(["facts": facts.map { ["section": $0.section, "text": $0.text] }]) }
}

// ---------- ความฝัน: จัดระเบียบอะไรไปบ้าง ----------
struct DreamsPane: View {
  @EnvironmentObject var store: Store
  var d: JSON { store.dream }
  var body: some View {
    let ds = d["dreams"] as? [JSON] ?? []
    Pane(title: "ความฝัน", subtitle: "ทุกครั้งที่หลับลึก AI จะทบทวนบทสนทนาที่ยังไม่ได้ฝัน: รวม/ตัดความจำซ้ำ (+ เพิ่ม, − ลืม), ค้นเรื่องที่เคยขอให้ลึกขึ้น และจับรูปแบบการใช้งาน") {
      HStack {
        if d["running"] as? Bool == true { ProgressView().controlSize(.small); Text("กำลังฝัน…").foregroundStyle(mint) }
        else { Text(((d["lastDream"] as? Double).flatMap { $0 > 0 ? $0 : nil }).map { "ฝันล่าสุด " + when($0) } ?? "ยังไม่เคยฝัน").foregroundStyle(.secondary) }
        Spacer()
        Toggle("ฝันเองเมื่อไม่อยู่", isOn: Binding(get: { d["enabled"] as? Bool ?? true }, set: { v in store.dream["enabled"] = v; store.set("dream", v) }))
        Button("ฝันเดี๋ยวนี้") { store.dreamCmd(["now": true]) }.disabled(d["running"] as? Bool == true).help("ใช้ AI ทบทวนบทสนทนาที่ยังไม่ได้ฝัน (ใช้ quota)")
        Button("ลบประวัติฝันทั้งหมด", role: .destructive) { store.dreamCmd(["clearDreams": true]) }.disabled(ds.isEmpty).help("ลบเฉพาะประวัติ — ความจำที่จัดไว้แล้วยังอยู่")
      }
      if ds.isEmpty { Text("ยังไม่เคยฝัน").foregroundStyle(.secondary) }
      ForEach(ds.indices, id: \.self) { i in DreamCard(d: ds[i]) }
    }
  }
}

struct DreamCard: View {
  @EnvironmentObject var store: Store
  let d: JSON
  var body: some View {
    let added = d["added"] as? [String] ?? [], removed = d["removed"] as? [String] ?? [], insights = d["insights"] as? [JSON] ?? [], patterns = d["patterns"] as? [String] ?? []
    GroupBox {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text("💤 " + (d["dream"] as? String ?? "")).bold()
          Spacer()
          Text(when(d["at"] as? Double)).font(.caption).foregroundStyle(.secondary)
          Button(role: .destructive) { store.dreamCmd(["forgetDream": d["at"] as? Double ?? 0]) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("ลบความฝันนี้ออกจากประวัติ")
        }
        Text("\(d["reason"] as? String ?? "") · ทบทวน \(d["entries"] as? Int ?? 0) บทสนทนา · ใช้เวลา \(Int((d["took"] as? Double ?? 0) / 1000)) วิ").font(.caption).foregroundStyle(.secondary)
        if d["added"] == nil { Text("(ฝันก่อนมีบันทึกว่าความจำเปลี่ยนอะไร)").font(.caption).foregroundStyle(.secondary) }
        else if added.isEmpty && removed.isEmpty { Text("ความจำไม่เปลี่ยน").font(.caption).foregroundStyle(.secondary) }
        ForEach(added, id: \.self) { Text("+ " + $0).font(.callout).foregroundStyle(.green).textSelection(.enabled) }
        ForEach(removed, id: \.self) { Text("− " + $0).font(.callout).foregroundStyle(.red.opacity(0.8)).strikethrough().textSelection(.enabled) }
        if !insights.isEmpty { Text("ค้นเพิ่ม").font(.caption.bold()).padding(.top, 2) }
        ForEach(insights.indices, id: \.self) { i in Text("• \(insights[i]["q"] as? String ?? ""): \(insights[i]["finding"] as? String ?? "")").font(.callout).textSelection(.enabled) }
        ForEach(patterns, id: \.self) { Text("↻ " + $0).font(.caption).foregroundStyle(mint) }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
    }
  }
}

// ---------- บันทึกบทสนทนา (วัตถุดิบของความฝัน) ----------
struct JournalPane: View {
  @EnvironmentObject var store: Store
  @State private var query = ""
  var body: some View {
    let all = store.dream["entries"] as? [JSON] ?? [], pending = all.filter { $0["dreamed"] as? Bool != true }.count
    let es: [JSON] = query.isEmpty ? all : all.filter { (($0["q"] as? String ?? "") + ($0["a"] as? String ?? "")).localizedCaseInsensitiveContains(query) }
    Pane(title: "บันทึกสนทนา", subtitle: "ทุกคำถาม-คำตอบถูกจดไว้ให้ความฝันครั้งถัดไปนำไปจัดระเบียบเป็นความจำ ลบเรื่องที่ไม่อยากให้จำได้ (แสดง 300 รายการล่าสุด)") {
      HStack {
        TextField("ค้นหา", text: $query).textFieldStyle(.roundedBorder).frame(width: 240)
        Text("\(store.dream["journal"] as? Int ?? 0) รายการ · รอฝัน \(pending)").font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button("ลบทั้งหมด", role: .destructive) { store.dreamCmd(["clearJournal": true]) }.disabled(all.isEmpty)
      }
      if es.isEmpty { Text(all.isEmpty ? "ยังไม่มีบันทึก" : "ไม่พบ").foregroundStyle(.secondary) }
      LazyVStack(alignment: .leading, spacing: 8) {
        ForEach(es.indices, id: \.self) { i in JournalRow(e: es[i]); Divider() }
      }
    }
  }
}

struct JournalRow: View {
  @EnvironmentObject var store: Store
  let e: JSON
  var body: some View {
    let ok = e["ok"] as? Bool != false, dreamed = e["dreamed"] as? Bool == true
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: dreamed ? "moon.stars" : "clock").foregroundStyle(dreamed ? Color.indigo : Color.orange).frame(width: 16).help(dreamed ? "ฝันถึงแล้ว" : "รอฝัน")
      VStack(alignment: .leading, spacing: 2) {
        Text(e["q"] as? String ?? "").bold().textSelection(.enabled)
        Text(e["a"] as? String ?? "").font(.callout).foregroundStyle(ok ? Color.secondary : Color.orange).lineLimit(3).textSelection(.enabled)
        Text(when(e["at"] as? Double)).font(.caption2).foregroundStyle(.tertiary)
      }
      Spacer()
      Button(role: .destructive) { store.dreamCmd(["forgetJournal": e["at"] as? Double ?? 0]) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("ลบบทสนทนานี้")
    }
  }
}
