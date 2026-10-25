// Settings (⌘,): seven tabs. Every control is one `neo …` call through SettingsModel; the values shown are what neo reports,
// so a change made in Terminal (or on the phone) appears here by itself. The same panes are reused in onboarding.
import NeoConsoleKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
  var body: some View {
    TabView {
      GeneralPane().tabItem { Label("ทั่วไป", systemImage: "gearshape") }
      BrainPane().tabItem { Label("สมอง", systemImage: "brain") }
      NamePane().tabItem { Label("ชื่อเรียก", systemImage: "waveform") }
      FacePane().tabItem { Label("หน้าตา", systemImage: "face.smiling") }
      JobsPane().tabItem { Label("ตั้งเวลา", systemImage: "alarm") }
      MemoryPane().tabItem { Label("ความจำ", systemImage: "moon.zzz") }
      PhonePane().tabItem { Label("มือถือ", systemImage: "iphone.gen1") }
    }
    .frame(width: 680, height: 620)
    .refreshesSettings()
    .refreshesMemory()
  }
}

// MARK: ทั่วไป

struct GeneralPane: View {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var settings: SettingsModel
  @State private var login = SMAppService.mainApp.status == .enabled
  @State private var loginError: String?
  @State private var configDir = ""
  @State private var configDirEdited = false

  var s: NeoSettings { settings.settings ?? NeoSettings() }
  func flag(_ key: String, _ value: Bool) -> Binding<Bool> { Binding(get: { value }, set: { v in Task { await settings.set(key, v) } }) }

  var body: some View {
    Pane(title: "ทั่วไป", subtitle: "วิธีที่ Neo ฟังและทำงาน") {
      GroupBox {
        VStack(alignment: .leading, spacing: 8) {
          Toggle("ต้องเรียกชื่อก่อนถาม", isOn: flag("requireName", s.requireName))
          Toggle("คุยต่อได้ 45 วิหลังตอบโดยไม่ต้องเรียกชื่อ", isOn: flag("followUp", s.followUp))
          Toggle("ข้ามการขออนุญาต (AI รันคำสั่ง/แก้ไฟล์บน Mac ได้โดยไม่ถาม)", isOn: flag("bypass", s.bypass))
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("พักหน้าจอ") {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Text("หลับ (zZz) เมื่อไม่มีใครเล่นด้วย")
            Picker("", selection: Binding(get: { s.idle.sleepAfter }, set: { v in Task { await settings.setSetting("idle.sleepAfter", String(v)) } })) {
              ForEach(Array(Set([15, 30, 60, 120, 150, 300, 600, 1800, 3600, s.idle.sleepAfter])).sorted(), id: \.self) { sec in
                Text(sec < 60 ? "\(sec) วิ" : "\(sec / 60) นาที" + (sec % 60 > 0 ? " \(sec % 60) วิ" : "")).tag(sec)
              }
            }.labelsHidden().frame(width: 120)
            Text("(กลางคืนหลับเร็วสุด 1 นาที)").font(.caption).foregroundStyle(.secondary)
          }
          Toggle("หลับแล้วขึ้นหน้าปัดนาฬิกา (เวลา + วันที่ หรี่จอ ขยับกันจอค้างภาพ)", isOn: flag("idle.clock", s.idle.clock))
          Text("ว่าง ๆ Neo จะเล่นเอง (มองแมลงบินผ่าน) · แตะหน้าจอ / เรียกชื่อ = ตื่น").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("Claude Code") {
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            TextField("โฟลเดอร์ config ของ Claude Code (เว้นว่าง = ค่าปกติของ claude)", text: $configDir).textFieldStyle(.roundedBorder)
              .onChange(of: configDir) { _ in configDirEdited = true }
            Button("บันทึก") { Task { await settings.setSetting("claudeConfigDir", configDir.trimmingCharacters(in: .whitespaces).isEmpty ? "unset" : configDir.trimmingCharacters(in: .whitespaces)); configDirEdited = false } }.disabled(!configDirEdited)
          }
          Text("ใช้เมื่อ claude อยู่ใน config คนละโฟลเดอร์กับ ~/.claude (neo doctor จะเตือนถ้าโฟลเดอร์ไม่มีอยู่)").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      FullDiskBox()
      GroupBox {
        VStack(alignment: .leading, spacing: 8) {
          Toggle("เปิด Neo Console เมื่อเข้าสู่ระบบ", isOn: Binding(get: { login }, set: { on in
            do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }; loginError = nil } catch { loginError = "ตั้งค่าไม่สำเร็จ: \(error.localizedDescription)" }
            login = SMAppService.mainApp.status == .enabled
          }))
          Text("Neo เองทำงานอยู่เบื้องหลังตลอดโดยไม่ต้องเปิดแอปนี้ — แอปนี้เป็นแค่ตัวควบคุม").font(.caption).foregroundStyle(.secondary)
          NoticeText(text: loginError)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      HStack {
        Button("เปิด log") { NSWorkspace.shared.open(URL(fileURLWithPath: model.logPath)) }
        Button("เปิดโฟลเดอร์ข้อมูล") { if let home = model.daemon?.home { NSWorkspace.shared.open(URL(fileURLWithPath: home)) } }.disabled(model.daemon == nil)
        Button("ตั้งค่าครั้งแรกใหม่") { Task { await settings.restartOnboarding() } }
      }
      NoticeText(text: settings.notice)
    }
    .onAppear { configDir = s.claudeConfigDir ?? "" }
    .onChange(of: s.claudeConfigDir) { v in if !configDirEdited { configDir = v ?? "" } }
  }
}

/// Full Disk Access as `neo doctor` sees it (the daemon is what needs it). The grant happens in System Settings.
struct FullDiskBox: View {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var settings: SettingsModel
  var row: DoctorRow? { settings.doctor?.first { $0.id == "fda" } }

  var body: some View {
    let granted = row?.ok == true
    GroupBox {
      HStack(alignment: .top, spacing: 10) {
        Image(systemName: granted ? "checkmark.circle.fill" : "exclamationmark.triangle.fill").foregroundStyle(granted ? mint : .orange)
        VStack(alignment: .leading, spacing: 4) {
          Text(granted ? "เข้าถึงไฟล์ได้ทั้งหมด (Full Disk Access)" : "ยังไม่ได้ให้สิทธิ์เข้าถึงไฟล์ทั้งหมด").bold()
          Text("ให้ AI ของ Neo อ่าน/แก้ไฟล์ได้ทุกโฟลเดอร์ (Documents, Desktop, Downloads, iCloud, Mail…) — ระบบ → ความเป็นส่วนตัว → การเข้าถึงดิสก์เต็มรูปแบบ → เปิด Neo Console แล้วกด \"รีสตาร์ท Neo\"").font(.caption).foregroundStyle(.secondary)
          HStack {
            Button(granted ? "เปิดหน้าตั้งค่า" : "ให้สิทธิ์…") { openFullDiskAccessSettings() }
            Button("ตรวจใหม่") { Task { await settings.runDoctor() } }
            if !granted { Button("รีสตาร์ท Neo") { Task { await model.restartDaemon(); await settings.runDoctor() } }.disabled(!model.isConnected) }
          }
        }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
    }
    .task { if settings.doctor == nil { await settings.runDoctor() } }
  }
}

// MARK: สมอง

struct BrainPane: View {
  @EnvironmentObject var settings: SettingsModel
  @State private var pick = ""
  @State private var name = ""
  @State private var label = ""
  @State private var type = "openai"
  @State private var baseUrl = ""
  @State private var url = ""
  @State private var command = ""
  @State private var args = ""
  @State private var apiKey = ""
  @State private var model = ""
  @State private var aliases = ""
  @State private var rows: [(String, String)] = []
  @State private var msg = ""

  var configs: [String: JSONValue] { settings.providerConfig?.providers ?? [:] }
  var discovered: [DiscoveredAgent] { settings.providerConfig?.discovered ?? [] }
  var found: DiscoveredAgent? { discovered.first { $0.name == pick && $0.available } }
  var current: String { settings.providers?.current ?? "" }

  var body: some View {
    Pane(title: "สมอง", subtitle: "agent ในเครื่องหาเจอเอง — เพิ่ม endpoint ของคุณเองได้ (OpenAI-compatible, HTTP, ACP)") {
      GroupBox("ใช้อยู่") {
        HStack {
          Picker("สมอง", selection: Binding(get: { current }, set: { v in Task { await settings.useProvider(v) } })) {
            ForEach(settings.providers?.list ?? []) { Text($0.label + ($0.found ? "" : " (ไม่พบ)")).tag($0.name) }
          }
          Picker("โมเดล", selection: Binding(get: { settings.models?.current ?? "" }, set: { v in Task { await settings.useModel(v.isEmpty ? "default" : v, provider: current) } })) {
            Text("ค่าเริ่มต้น").tag("")
            if let m = settings.models, !m.mapped.isEmpty { Section("ชื่อที่ตั้งเอง") { ForEach(m.mapped, id: \.alias) { Text("\($0.alias) → \($0.id)").tag($0.alias) } } }
            if let m = settings.models { Section("ทั้งหมด (\(m.list.count))") { ForEach(m.list.prefix(500)) { Text($0.name).tag($0.id) } } }
            if let c = settings.models?.current, !c.isEmpty, settings.models?.list.contains(where: { $0.id == c }) != true, settings.models?.mapped.contains(where: { $0.alias == c }) != true { Text(c).tag(c) }
          }
        }.padding(4)
      }
      GroupBox("หาเจอในเครื่อง") {
        VStack(alignment: .leading, spacing: 4) {
          Text(discovered.filter(\.available).map(\.label).joined(separator: " · ")).foregroundStyle(mint)
          Text("ยังไม่ได้ติดตั้ง: " + discovered.filter { !$0.available }.map(\.name).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
          Button("หาใหม่") { Task { await settings.discover() } }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("แก้ / เพิ่ม") {
        VStack(alignment: .leading, spacing: 8) {
          Picker("แก้ตัวไหน", selection: $pick) {
            ForEach(configs.keys.sorted(), id: \.self) { Text((configs[$0]?["label"]?.string ?? $0) + " · " + (configs[$0]?["type"]?.string ?? "")).tag($0) }
            Text("+ เพิ่ม custom endpoint").tag("")
          }.onChange(of: pick) { _ in fill() }
          if let f = found { Text("พบในเครื่อง: \(f.via ?? "") — แก้ได้เฉพาะชื่อ/โมเดล/ชื่อเรียก").font(.caption).foregroundStyle(.secondary) }
          Grid(alignment: .leading) {
            GridRow { Text("ชื่อ"); TextField("a-z 0-9 - _", text: $name).disabled(configs[pick] != nil) }
            GridRow { Text("ชื่อที่แสดง"); TextField("", text: $label) }
            GridRow { Text("ชนิด"); Picker("", selection: $type) { Text("openai — OpenRouter, Ollama, LM Studio…").tag("openai"); Text("http — endpoint ของคุณ").tag("http"); Text("acp — agent").tag("acp"); Text("claude-code").tag("claude-code") }.labelsHidden().disabled(found != nil) }
            if type == "openai" { GridRow { Text("Base URL"); TextField("https://openrouter.ai/api/v1", text: $baseUrl) } }
            if type == "http" { GridRow { Text("URL"); TextField("https://…/neo", text: $url) } }
            if type == "acp" && found == nil { GridRow { Text("คำสั่ง"); TextField("opencode", text: $command) }; GridRow { Text("อาร์กิวเมนต์"); TextField("acp", text: $args) } }
            if type == "openai" || type == "http" {
              GridRow { Text("API key"); SecureField(settings.providerConfig?.keys?[pick] == true ? "มี key แล้ว — เว้นว่างถ้าไม่เปลี่ยน" : "เก็บใน Application Support ไม่อยู่ใน config", text: $apiKey) }
            }
            GridRow { Text("โมเดลเริ่มต้น"); TextField("ชื่อที่ตั้งเอง หรือ id", text: $model) }
            GridRow { Text("ชื่อเรียกด้วยเสียง"); TextField("คั่นด้วย ,", text: $aliases) }
          }
          Text("ตั้งชื่อโมเดลเอง (พูด \"ใช้โมเดล <ชื่อ>\" ได้)").font(.headline).padding(.top, 4)
          ForEach(rows.indices, id: \.self) { i in
            HStack {
              TextField("ชื่อเล่น เช่น เร็ว", text: Binding(get: { rows[i].0 }, set: { rows[i].0 = $0 }))
              TextField("id โมเดล", text: Binding(get: { rows[i].1 }, set: { rows[i].1 = $0 }))
              if let list = settings.models?.list, !list.isEmpty, settings.models?.name == pick {
                Menu("เลือก") { ForEach(list.prefix(300)) { m in Button(m.name) { rows[i].1 = m.id } } }.frame(width: 70)
              }
              Button(role: .destructive) { rows.remove(at: i) } label: { Image(systemName: "xmark") }
            }
          }
          HStack {
            Button("+ ชื่อโมเดล") { rows.append(("", "")) }
            Button("ดึงรายชื่อโมเดล") { Task { await settings.loadModels(pick); msg = "ได้ \(settings.models?.list.count ?? 0) โมเดล" } }.disabled(configs[pick] == nil)
            Spacer(); Text(msg).font(.caption).foregroundStyle(.secondary)
          }
          HStack {
            Button("บันทึก") { save() }.keyboardShortcut(.defaultAction)
            if configs[pick] != nil { Button("ลบ", role: .destructive) { Task { let ok = await settings.removeProvider(pick); msg = ok ? "ลบแล้ว" : ""; if ok { pick = "" } } } }
          }
          NoticeText(text: settings.notice)
        }.padding(4)
      }
    }
    .onAppear { if pick.isEmpty, configs[current] != nil { pick = current }; fill() }
    .onChange(of: settings.providerConfig) { _ in if rows.isEmpty && name.isEmpty { fill() } }
  }

  func fill() {
    let c = configs[pick]?.object ?? [:]
    name = configs[pick] != nil ? pick : ""
    label = c["label"]?.string ?? ""; type = c["type"]?.string ?? "openai"
    baseUrl = c["baseUrl"]?.string ?? ""; url = c["url"]?.string ?? ""; command = c["command"]?.string ?? ""
    args = (c["args"]?.array ?? []).compactMap(\.string).joined(separator: " ")
    model = c["model"]?.string ?? ""
    aliases = (c["aliases"]?.array ?? []).compactMap(\.string).joined(separator: ", ")
    apiKey = ""; msg = ""
    rows = (c["models"]?.object ?? [:]).compactMap { k, v in v.string.map { (k, $0) } }.sorted { $0.0 < $1.0 }
    if !pick.isEmpty { Task { await settings.loadModels(pick) } }
  }

  func save() {
    var c: [String: JSONValue] = ["type": .string(type)]
    for (k, v) in [("label", label), ("baseUrl", baseUrl), ("url", url), ("command", command), ("model", model)] {
      let t = v.trimmingCharacters(in: .whitespaces)
      if !t.isEmpty { c[k] = .string(t) }
    }
    if !args.isEmpty { c["args"] = .array(args.split(separator: " ").map { .string(String($0)) }) }
    c["aliases"] = .array(aliases.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { .string($0) })
    c["models"] = .object(Dictionary(rows.filter { !$0.0.isEmpty && !$0.1.isEmpty }.map { ($0.0, JSONValue.string($0.1)) }, uniquingKeysWith: { a, _ in a }))
    let base = settings.providerConfig?.overrides?[pick] ?? configs[pick]
    for k in ["headers", "apiKeyEnv", "apiKeyFile", "config"] { if let v = base?[k] { c[k] = v } }
    let n = name.trimmingCharacters(in: .whitespaces)
    Task {
      let ok = await settings.saveProvider(name: n, config: c, apiKey: apiKey)
      msg = ok ? "บันทึกแล้ว" : ""
      if ok { pick = n; fill(); msg = "บันทึกแล้ว" }
    }
  }
}

// MARK: ชื่อเรียก

struct NamePane: View {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var settings: SettingsModel
  @State private var name = ""
  @State private var edited = false
  var training: NameInfo.Training? { settings.wake?.training }
  var phone: Bool { model.status?.phone ?? false }

  var body: some View {
    Pane(title: "ชื่อเรียก", subtitle: "เรียกชื่อแล้ว Neo ร้องตอบและรอฟังคำสั่ง (เงียบ 3 วิ = จบ)") {
      TextField("เช่น นีโอ, โมจิ, Luna", text: Binding(get: { name }, set: { name = $0; edited = true })).textFieldStyle(.roundedBorder).font(.title3)
      Text("ฝึกเสียงชื่อ: กดเริ่ม แล้วพูดชื่อใส่มือถือ 3 ครั้ง (เว้นสักวินาที) — Neo จะจำว่าตัวถอดเสียงเขียนชื่อนี้แบบไหนบ้าง").foregroundStyle(.secondary)
      HStack(spacing: 8) { ForEach(0..<3, id: \.self) { i in Circle().fill((training?.got.count ?? 0) > i ? mint : .clear).overlay(Circle().stroke(mint)).frame(width: 14, height: 14) } }
      if let t = training, !t.got.isEmpty { Text("ได้ยิน: " + t.got.joined(separator: " · ")).foregroundStyle(mint) }
      HStack {
        if training != nil {
          Text("กำลังฟัง… พูดชื่อใส่มือถือ")
          Button("เลิกฝึก") { Task { await settings.cancelTraining() } }
        } else {
          Button("เริ่มฝึก (ต้องต่อมือถือแล้ว)") { Task { await settings.train(name); edited = false } }.disabled(name.isEmpty || !phone).keyboardShortcut(.defaultAction)
        }
        Button("ใช้ชื่อนี้เลย ไม่ฝึก") { Task { await settings.setName(name); edited = false } }.disabled(name.isEmpty)
      }
      if !phone { Text("มือถือยังไม่เชื่อมต่อ — จับคู่ในหน้ามือถือก่อน หรือกด \"ใช้ชื่อนี้เลย\"").font(.caption).foregroundStyle(.orange) }
      NoticeText(text: settings.notice)
      GroupBox("คำที่จำไว้ตอนนี้") { Text((settings.wake?.variants ?? []).joined(separator: " · ")).frame(maxWidth: .infinity, alignment: .leading).padding(4) }
    }
    .onAppear { if name.isEmpty { name = settings.wake?.name ?? "" } }
    .onChange(of: settings.wake?.name) { v in if !edited { name = v ?? "" } }
  }
}

// MARK: หน้าตา

struct FacePane: View {
  @EnvironmentObject var settings: SettingsModel
  @State private var f = Face.mint
  @State private var dirty = false
  @State private var saved = false

  var body: some View {
    Pane(title: "หน้าตา", subtitle: "เลือกธีมหรือปรับสีเอง — จอมือถือเปลี่ยนตามเมื่อกดบันทึก") {
      HStack(spacing: 10) { FacePixels(theme: f); FacePixels(theme: f, bliss: true) }.frame(height: 130).clipShape(RoundedRectangle(cornerRadius: 10))
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 10) {
        ForEach(Face.presets, id: \.name) { p in
          Button { f = p.face; dirty = true; saved = false } label: {
            VStack(spacing: 4) { FacePixels(theme: p.face).clipShape(RoundedRectangle(cornerRadius: 6)); Text(p.name).font(.caption) }.padding(6)
              .overlay(RoundedRectangle(cornerRadius: 10).stroke(f == p.face ? mint : .gray.opacity(0.3), lineWidth: 2))
          }.buttonStyle(.plain)
        }
      }
      HStack(spacing: 18) {
        ColorPicker("ตา/ปาก", selection: Binding(get: { Color(hex: f.fg) }, set: { f.fg = $0.hex; dirty = true; saved = false }))
        ColorPicker("หัวใจ", selection: Binding(get: { Color(hex: f.accent) }, set: { f.accent = $0.hex; dirty = true; saved = false }))
        ColorPicker("แก้ม", selection: Binding(get: { Color(hex: f.cheek) }, set: { f.cheek = $0.hex; dirty = true; saved = false }))
        ColorPicker("พื้นหลัง", selection: Binding(get: { Color(hex: f.bg) }, set: { f.bg = $0.hex; dirty = true; saved = false }))
      }
      HStack {
        Button("บันทึกหน้าตา") { Task { await settings.saveFace(f); if settings.notice == nil { saved = true; dirty = false } } }.keyboardShortcut(.defaultAction)
        if saved { Text("บันทึกแล้ว — จอมือถือเปลี่ยนตาม").foregroundStyle(.secondary) }
      }
      NoticeText(text: settings.notice)
    }
    .onAppear { if let v = settings.face { f = v } }
    .onChange(of: settings.face) { v in if !dirty, let v { f = v } }
  }
}

// MARK: ความจำ (the memory & jobs panes themselves are in MemoryWindow.swift; "ตั้งเวลา" is JobsPane)

struct MemoryPane: View {
  @EnvironmentObject var settings: SettingsModel
  @EnvironmentObject var memory: MemoryModel
  @Environment(\.openWindow) var openWindow

  var body: some View {
    Pane(title: "ความจำ & ความฝัน", subtitle: "Neo เรียนรู้ว่าช่วงไหนคุณมักไม่อยู่ แล้วหลับลึกและ \"ฝัน\" — จัดระเบียบความจำจากบทสนทนา ตื่นมาจะเล่าให้ฟัง ความจำนี้ใช้ประกอบทุกคำตอบ (เก็บบน Mac เครื่องนี้เท่านั้น)") {
      GroupBox {
        VStack(alignment: .leading, spacing: 8) {
          DreamControls()
          if let pet = settings.pet, pet.sleeping { Text("Neo หลับลึกอยู่").font(.caption).foregroundStyle(mint) }
          Text("ฝันเองเมื่อเงียบเกิน 45 นาทีในช่วงที่ปกติไม่อยู่ หรือไม่อยู่เกิน 3 ชม.").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      FactsContent()
      Button("เปิดหน้าต่าง ความจำ & งาน (ความฝัน · บันทึกสนทนา)") { openWindow(id: "memory"); NSApp.activate(ignoringOtherApps: true) }
    }
  }
}

// MARK: มือถือ

struct PhonePane: View {
  @EnvironmentObject var settings: SettingsModel
  @State private var now = Date()
  let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
  var s: NeoSettings { settings.settings ?? NeoSettings() }
  func flag(_ key: String, _ value: Bool) -> Binding<Bool> { Binding(get: { value }, set: { v in Task { await settings.set(key, v) } }) }

  var body: some View {
    Pane(title: "มือถือ", subtitle: "ติดตั้งแอป Neo บน Android แล้วเชื่อมกับ Mac ด้วยวิธีไหนก็ได้ที่มือถือไปถึง Mac") {
      GroupBox("ช่องทางที่เปิดให้มือถือต่อ") {
        VStack(alignment: .leading, spacing: 6) {
          Toggle("Tailscale / VPN (100.x.x.x) — เข้ารหัสโดย VPN", isOn: flag("tailscale", s.tailscale))
          Toggle("Wi-Fi เดียวกัน — สะดวก แต่ข้อมูลในวง Wi-Fi ไม่เข้ารหัส", isOn: flag("lan", s.lan))
          Text("USB (adb reverse) และ tunnel/URL ของคุณเองใช้ได้เสมอ").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox {
        VStack(alignment: .leading, spacing: 10) {
          HStack { Button("จับคู่มือถือ") { Task { await settings.startPair() } }.keyboardShortcut(.defaultAction); Text("รหัสใช้ได้ 5 นาที ครั้งเดียว").foregroundStyle(.secondary) }
          if let p = settings.pair {
            let left = Int((p.expiresAt / 1000 - now.timeIntervalSince1970).rounded())
            Text(p.code).font(.system(size: 52, weight: .bold, design: .monospaced)).kerning(10).foregroundStyle(mint).frame(maxWidth: .infinity)
            Text(left > 0 ? "เหลือ \(left / 60):\(String(format: "%02d", left % 60))" : "หมดเวลา — กดจับคู่ใหม่").foregroundStyle(.secondary).frame(maxWidth: .infinity)
            ForEach(p.addresses, id: \.url) { a in
              VStack(alignment: .leading, spacing: 1) {
                HStack { Text(a.method).bold(); Text(a.url).foregroundStyle(mint).textSelection(.enabled) }
                Text(a.note).font(.caption).foregroundStyle(.secondary)
              }
            }
            if let apk = settings.apkURL {
              VStack(alignment: .leading, spacing: 1) {
                HStack { Text("แอป Android").bold(); Text(apk).foregroundStyle(mint).textSelection(.enabled) }
                Text("เปิดในเบราว์เซอร์มือถือเพื่อดาวน์โหลด (ต้องอนุญาตติดตั้งแอปจากแหล่งอื่น)").font(.caption).foregroundStyle(.secondary)
              }
            }
          }
          if let d = settings.pairedDevice { Label("จับคู่กับ \(d.name) แล้ว", systemImage: "checkmark.circle.fill").foregroundStyle(mint) }
          NoticeText(text: settings.notice)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("เครื่องที่จับคู่แล้ว") {
        VStack(alignment: .leading) {
          if settings.devices.isEmpty { Text("ยังไม่มี").foregroundStyle(.secondary) }
          ForEach(settings.devices) { d in
            HStack {
              Text(d.name)
              Text(d.lastSeen.map { "ออนไลน์ล่าสุด " + $0.prefix(16).replacingOccurrences(of: "T", with: " ") } ?? "ยังไม่เคยต่อ").font(.caption).foregroundStyle(.secondary)
              Spacer()
              Button("ยกเลิกการจับคู่") { Task { await settings.revoke(d.id) } }
            }
          }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
    }.onReceive(tick) { now = $0 }
  }
}
