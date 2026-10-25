// หน้า "ตั้งเวลา" (ปลุก/เตือน/งาน cron), "ความจำ" (ฝัน), สิทธิ์เข้าถึงไฟล์ทั้งหมด
import AppKit
import SwiftUI

// ---------- Full Disk Access: ให้ AI ที่ Neo เปิด (claude/agent) อ่าน-เขียนไฟล์ได้ทุกที่ ----------
// macOS นับสิทธิ์ตามแอปที่เปิด process → อนุญาต Neo.app ครั้งเดียว ครอบคลุม node/claude/agent ข้างใน
func hasFullDiskAccess() -> Bool {
  let probe = ["/Library/Application Support/com.apple.TCC/TCC.db", NSHomeDirectory() + "/Library/Safari/Bookmarks.plist", NSHomeDirectory() + "/Library/Mail"]
  return probe.contains { p in
    var d: ObjCBool = false
    guard FileManager.default.fileExists(atPath: p, isDirectory: &d) else { return false }
    if d.boolValue { return (try? FileManager.default.contentsOfDirectory(atPath: p)) != nil }
    return FileHandle(forReadingAtPath: p) != nil
  }
}
func openFullDiskSettings() { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!) }

struct FullDiskBox: View {
  @EnvironmentObject var store: Store
  var body: some View {
    GroupBox {
      HStack(alignment: .top, spacing: 10) {
        Image(systemName: store.fullDisk ? "checkmark.circle.fill" : "exclamationmark.triangle.fill").foregroundStyle(store.fullDisk ? mint : .orange)
        VStack(alignment: .leading, spacing: 4) {
          Text(store.fullDisk ? "เข้าถึงไฟล์ได้ทั้งหมด (Full Disk Access)" : "ยังไม่ได้ให้สิทธิ์เข้าถึงไฟล์ทั้งหมด").bold()
          Text("ให้ AI ของ Neo อ่าน/แก้ไฟล์ได้ทุกโฟลเดอร์ (Documents, Desktop, Downloads, iCloud, Mail…) — ระบบ → ความเป็นส่วนตัว → การเข้าถึงดิสก์เต็มรูปแบบ → เปิด Neo แล้วเปิด Neo ใหม่").font(.caption).foregroundStyle(.secondary)
          HStack {
            Button(store.fullDisk ? "เปิดหน้าตั้งค่า" : "ให้สิทธิ์…") { openFullDiskSettings() }
            Button("ตรวจใหม่") { store.fullDisk = hasFullDiskAccess() }
            if !store.fullDisk { Button("เปิด Neo ใหม่") { relaunch() } }
          }
        }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
    }
  }
}
func relaunch() {
  let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/sh"); p.arguments = ["-c", "sleep 1; open \"\(Bundle.main.bundlePath)\""]
  try? p.run(); NSApp.terminate(nil)
}

// ---------- ตั้งเวลา ----------
struct SchedulePane: View {
  @EnvironmentObject var store: Store
  @State private var speech = ""
  @State private var preview: JSON? = nil
  @State private var error: String? = nil
  // แบบละเอียด
  @State private var kind = "alarm"
  @State private var title = ""
  @State private var prompt = ""
  @State private var repeatMode = "once"
  @State private var date = Date().addingTimeInterval(3600)
  @State private var days: Set<Int> = [1, 2, 3, 4, 5]
  @State private var cron = "0 8 * * 1-5"
  let dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]

  var body: some View {
    Pane(title: "ตั้งเวลา", subtitle: "นาฬิกาปลุก การเตือน และงานที่ให้ Neo ทำเองตามเวลา (แบบ cron) — สั่งด้วยเสียงได้ เช่น \"\(store.wakeName) ปลุก 7 โมงครึ่ง\", \"\(store.wakeName) ทุกวันธรรมดา 8 โมง สรุปข่าว\", \"\(store.wakeName) มีปลุกอะไรบ้าง\"") {
      if let r = store.ringing {
        HStack { Image(systemName: "alarm.waves.left.and.right.fill").foregroundStyle(.orange); Text("กำลังปลุก: \(r["title"] as? String ?? "")").bold(); Spacer(); Button("ปิดปลุก") { Task { await store.schedule(["stop": true]) } } }
          .padding(10).background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
      }
      GroupBox("รายการ") {
        VStack(alignment: .leading, spacing: 6) {
          if store.jobs.isEmpty { Text("ยังไม่มี").foregroundStyle(.secondary) }
          ForEach(store.jobs.indices, id: \.self) { i in JobRow(job: store.jobs[i]) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("เพิ่มแบบพิมพ์เหมือนพูด") {
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            TextField("เช่น ปลุกพรุ่งนี้ตีห้าครึ่ง / เตือนให้กินยาสองทุ่ม / ทุก 30 นาที ดูสถานะ agent", text: $speech).textFieldStyle(.roundedBorder)
              .onChange(of: speech) { _ in preview = nil; error = nil }.onSubmit(check)
            Button("ตรวจ", action: check).disabled(speech.isEmpty)
          }
          if let p = preview {
            HStack { Text("\(p["kind"] as? String == "task" ? "งาน" : "ปลุก"): \(p["title"] as? String ?? "") — \(p["when"] as? String ?? "")").foregroundStyle(mint); Spacer()
              Button("เพิ่ม") { Task { var j = p; j.removeValue(forKey: "when"); let r = await store.schedule(["add": j]); error = r["error"] as? String; if error == nil { speech = ""; preview = nil } } }.keyboardShortcut(.defaultAction) }
          }
          if let e = error { Text(e).font(.caption).foregroundStyle(.orange) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
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
            HStack { TextField("นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์", text: $cron).textFieldStyle(.roundedBorder).font(.body.monospaced()).frame(width: 220); Text("เช่น */15 9-18 * * 1-5 = ทุก 15 นาที เวลางาน").font(.caption).foregroundStyle(.secondary) }
          }
          HStack { Spacer(); Button("เพิ่ม") { Task { await addDetailed() } }.disabled(title.isEmpty && prompt.isEmpty || repeatMode == "weekly" && days.isEmpty) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
    }.task { await store.refreshJobs() }
  }

  func check() { Task { let r = await store.schedule(["speech": speech]); preview = r["preview"] as? JSON; error = r["error"] as? String } }
  func addDetailed() async {
    var j: JSON = ["kind": kind, "title": title.isEmpty ? prompt : title]
    if kind == "task" { j["prompt"] = prompt.isEmpty ? title : prompt }
    let c = Calendar.current.dateComponents([.hour, .minute], from: date)
    switch repeatMode {
    case "once": j["at"] = Int(date.timeIntervalSince1970 * 1000)
    case "weekly": j["cron"] = "\(c.minute ?? 0) \(c.hour ?? 0) * * " + (days.count == 7 ? "*" : days.sorted().map(String.init).joined(separator: ","))
    default: j["cron"] = cron
    }
    let r = await store.schedule(["add": j]); error = r["error"] as? String
    if error == nil { title = ""; prompt = "" }
  }
}

struct JobRow: View {
  @EnvironmentObject var store: Store
  let job: JSON
  @State private var edit = false
  var body: some View {
    let id = job["id"] as? String ?? "", on = job["enabled"] as? Bool ?? true, task = job["kind"] as? String == "task"
    HStack(spacing: 10) {
      Image(systemName: task ? "sparkles" : "alarm").foregroundStyle(on ? mint : .secondary).frame(width: 18)
      VStack(alignment: .leading, spacing: 1) {
        Text(job["title"] as? String ?? "").bold().foregroundStyle(on ? .primary : .secondary)
        Text((job["when"] as? String ?? "") + ((job["next"] as? Double).map { " · ครั้งถัดไป " + Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened) } ?? "")).font(.caption).foregroundStyle(.secondary)
        if task, let p = job["prompt"] as? String, p != job["title"] as? String { Text(p).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
      }
      Spacer()
      Toggle("", isOn: Binding(get: { on }, set: { v in Task { await store.schedule(["update": id, "enabled": v]) } })).toggleStyle(.switch).labelsHidden()
      Button { edit = true } label: { Image(systemName: "square.and.pencil") }.help("แก้")
      Button { Task { await store.schedule(["test": id]) } } label: { Image(systemName: "play.fill") }.help("ลองเลย")
      Button(role: .destructive) { Task { await store.schedule(["remove": id]) } } label: { Image(systemName: "trash") }.help("ลบ")
    }.buttonStyle(.borderless)
    .sheet(isPresented: $edit) { JobEditor(job: job).environmentObject(store) }
  }
}

/// แก้งานตั้งเวลา: ข้อความ, คำสั่งงาน, เวลา (ครั้งเดียว หรือ cron)
struct JobEditor: View {
  @EnvironmentObject var store: Store
  @Environment(\.dismiss) var dismiss
  let job: JSON
  @State private var title = ""
  @State private var prompt = ""
  @State private var once = true
  @State private var date = Date()
  @State private var cron = ""
  @State private var error: String? = nil
  var task: Bool { job["kind"] as? String == "task" }
  var body: some View {
    Form {
      TextField(task ? "ชื่องาน" : "ข้อความเตือน", text: $title)
      if task { TextField("ให้ทำอะไร", text: $prompt, axis: .vertical).lineLimit(2...6) }
      Picker("เวลา", selection: $once) { Text("ครั้งเดียว").tag(true); Text("ซ้ำ (cron)").tag(false) }.pickerStyle(.segmented)
      if once { DatePicker("เมื่อ", selection: $date, in: Date()...) }
      else { TextField("นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์", text: $cron).font(.body.monospaced()); Text("เช่น 30 6 * * 1-5 = 06:30 วันธรรมดา · */15 9-18 * * * = ทุก 15 นาที เวลางาน").font(.caption).foregroundStyle(.secondary) }
      if let e = error { Text(e).foregroundStyle(.orange) }
      HStack { Spacer(); Button("ยกเลิก") { dismiss() }.keyboardShortcut(.cancelAction); Button("บันทึก") { Task { await save() } }.keyboardShortcut(.defaultAction) }
    }.formStyle(.grouped).frame(width: 460).padding(8)
    .onAppear {
      title = job["title"] as? String ?? ""; prompt = job["prompt"] as? String ?? ""
      if let c = job["cron"] as? String { once = false; cron = c } else { once = true; cron = "0 8 * * *" }
      if let a = job["at"] as? Double { date = Date(timeIntervalSince1970: a / 1000) } else { date = Date().addingTimeInterval(3600) }
    }
  }
  func save() async {
    var j: JSON = ["update": job["id"] as? String ?? "", "title": title]
    if task { j["prompt"] = prompt }
    if once { j["at"] = Int(date.timeIntervalSince1970 * 1000) } else { j["cron"] = cron }
    let r = await store.schedule(j); error = r["error"] as? String
    if error == nil { dismiss() }
  }
}

// ---------- ความจำ & ความฝัน ----------
struct MemoryPane: View {
  @EnvironmentObject var store: Store
  @State private var memory = ""
  @State private var edited = false
  var d: JSON { store.dream }
  var body: some View {
    Pane(title: "ความจำ & ความฝัน", subtitle: "Neo เรียนรู้ว่าช่วงไหนคุณมักไม่อยู่ แล้วหลับลึกและ \"ฝัน\" — จัดระเบียบความจำจากบทสนทนา และค้นเรื่องที่เคยขอให้ลึกขึ้น ตื่นมาจะเล่าให้ฟัง ความจำนี้ใช้ประกอบทุกคำตอบ (เก็บบน Mac เครื่องนี้เท่านั้น)") {
      GroupBox {
        VStack(alignment: .leading, spacing: 8) {
          Toggle("ให้ Neo ฝันเองเมื่อคุณไม่อยู่ (เงียบเกิน 45 นาทีในช่วงที่ปกติไม่อยู่ หรือไม่อยู่เกิน 3 ชม.)", isOn: Binding(get: { d["enabled"] as? Bool ?? true }, set: { v in store.dream["enabled"] = v; store.set("dream", v) }))
          HStack {
            if d["running"] as? Bool == true { ProgressView().controlSize(.small); Text("กำลังฝัน…").foregroundStyle(mint) }
            else { Text(lastDreamText).foregroundStyle(.secondary) }
            Spacer()
            Button("ฝันเดี๋ยวนี้") { store.dreamCmd(["now": true]) }.disabled(d["running"] as? Bool == true).help("ใช้ Claude Code ทบทวนบทสนทนาที่ยังไม่ได้ฝัน (ใช้ quota)")
          }
          Text("บันทึกบทสนทนาไว้ \(d["journal"] as? Int ?? 0) รายการ").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("ช่วงเวลาที่คุณคุยกับ Neo (สีเข้ม = ช่วงที่ปกติไม่อยู่ — Neo ฝันได้)") {
        let p = d["profile"] as? [Double] ?? Array(repeating: 0, count: 24), quiet = Set(d["quiet"] as? [Int] ?? [])
        HStack(alignment: .bottom, spacing: 3) {
          ForEach(0..<24, id: \.self) { h in
            VStack(spacing: 2) {
              RoundedRectangle(cornerRadius: 2).fill(quiet.contains(h) ? Color.indigo.opacity(0.55) : mint.opacity(0.85)).frame(height: max(3, 60 * CGFloat(h < p.count ? p[h] : 0)))
              Text(h % 3 == 0 ? "\(h)" : " ").font(.system(size: 9).monospacedDigit()).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity)
          }
        }.frame(height: 80).padding(4)
      }
      GroupBox("ความจำระยะยาว (แก้เองได้)") {
        VStack(alignment: .leading, spacing: 6) {
          TextEditor(text: $memory).font(.body.monospaced()).frame(minHeight: 140).onChange(of: memory) { _ in edited = true }
          HStack { Text("\(memory.count)/3000 ตัวอักษร").font(.caption).foregroundStyle(memory.count > 3000 ? .orange : .secondary); Spacer()
            Button("ล้างความจำ", role: .destructive) { memory = ""; store.dreamCmd(["memory": ""]); edited = false }
            Button("บันทึก") { store.dreamCmd(["memory": memory]); edited = false }.disabled(!edited) }
        }.padding(4)
      }
      GroupBox("ความฝันล่าสุด") {
        VStack(alignment: .leading, spacing: 10) {
          let ds = d["dreams"] as? [JSON] ?? []
          if ds.isEmpty { Text("ยังไม่เคยฝัน").foregroundStyle(.secondary) }
          ForEach(ds.indices, id: \.self) { i in DreamRow(d: ds[i]) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
    }
    .task { await store.refreshDream(); if !edited { memory = d["memory"] as? String ?? "" }; edited = false }
    .onChange(of: d["memory"] as? String ?? "") { m in if !edited { memory = m; edited = false } }
  }
  var lastDreamText: String {
    guard let t = d["lastDream"] as? Double, t > 0 else { return "ยังไม่เคยฝัน" }
    return "ฝันล่าสุด " + Date(timeIntervalSince1970: t / 1000).formatted(date: .abbreviated, time: .shortened)
  }
}

struct DreamRow: View {
  let d: JSON
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack { Text("💤 " + (d["dream"] as? String ?? "")).bold(); Spacer(); if let t = d["at"] as? Double { Text(Date(timeIntervalSince1970: t / 1000).formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary) } }
      Text("\(d["reason"] as? String ?? "") · ทบทวน \(d["entries"] as? Int ?? 0) บทสนทนา · ใช้เวลา \(Int((d["took"] as? Double ?? 0) / 1000)) วิ").font(.caption).foregroundStyle(.secondary)
      ForEach(((d["insights"] as? [JSON]) ?? []).indices, id: \.self) { i in let x = (d["insights"] as? [JSON])![i]
        Text("• \(x["q"] as? String ?? ""): \(x["finding"] as? String ?? "")").font(.callout).textSelection(.enabled)
      }
      ForEach(((d["patterns"] as? [String]) ?? []), id: \.self) { Text("↻ " + $0).font(.caption).foregroundStyle(mint) }
    }
  }
}

/// ภาพ pixel ที่ AI วาด (การ์ด layout "pixel") — เล่นเฟรมตาม fps
struct PixelArtView: View {
  let card: JSON
  let bg: String
  var body: some View {
    let w = card["w"] as? Int ?? 0, h = card["h"] as? Int ?? 0, pal = card["palette"] as? [String: String] ?? [:], frames = card["frames"] as? [[String]] ?? [], fps = max(1, card["fps"] as? Int ?? 3)
    TimelineView(.periodic(from: .now, by: 1 / Double(fps))) { tl in
      let f = frames.isEmpty ? [] : frames[Int(tl.date.timeIntervalSinceReferenceDate * Double(fps)) % frames.count]
      Canvas { ctx, size in
        let s = min(size.width / CGFloat(max(w, 1)), size.height / CGFloat(max(h, 1))), ox = (size.width - CGFloat(w) * s) / 2, oy = (size.height - CGFloat(h) * s) / 2
        ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: bg)))
        for (y, row) in f.enumerated() { for (x, ch) in row.enumerated() { if let c = pal[String(ch)] { ctx.fill(Path(CGRect(x: ox + CGFloat(x) * s, y: oy + CGFloat(y) * s, width: s + 0.5, height: s + 0.5)), with: .color(Color(hex: c))) } } }
      }
    }.aspectRatio(CGFloat(max(w, 1)) / CGFloat(max(h, 1)), contentMode: .fit)
  }
}
