// หน้าต่างตั้งค่า (⌘,) — แต่ละหน้าใช้ซ้ำในขั้นตอน onboarding
import ServiceManagement
import SwiftUI

struct SettingsView: View {
  var body: some View {
    TabView {
      GeneralPane().tabItem { Label("ทั่วไป", systemImage: "gearshape") }
      BrainPane().tabItem { Label("สมอง", systemImage: "brain") }
      NamePane().tabItem { Label("ชื่อเรียก", systemImage: "waveform") }
      FacePane().tabItem { Label("หน้าตา", systemImage: "face.smiling") }
      SchedulePane().tabItem { Label("ตั้งเวลา", systemImage: "alarm") }
      MemoryPane().tabItem { Label("ความจำ", systemImage: "moon.zzz") }
      PhonePane().tabItem { Label("มือถือ", systemImage: "iphone.gen1") }
    }.frame(width: 680, height: 620)
  }
}

struct Pane<Content: View>: View {
  let title: String, subtitle: String
  @ViewBuilder var content: Content
  var body: some View {
    ScrollView { VStack(alignment: .leading, spacing: 14) { Text(title).font(.title2.bold()); Text(subtitle).foregroundStyle(.secondary); content }.padding(22).frame(maxWidth: .infinity, alignment: .leading) }
  }
}

// ---------- ทั่วไป ----------
struct GeneralPane: View {
  @EnvironmentObject var store: Store
  @AppStorage("adbReverse") var adb = false
  @State private var login = SMAppService.mainApp.status == .enabled
  func b(_ k: String, _ d: Bool) -> Binding<Bool> { Binding(get: { store.settings[k] as? Bool ?? d }, set: { store.set(k, $0) }) }
  var body: some View {
    Pane(title: "ทั่วไป", subtitle: "วิธีที่ Neo ฟังและทำงาน") {
      GroupBox {
        VStack(alignment: .leading, spacing: 8) {
          Toggle("ต้องเรียกชื่อก่อนถาม", isOn: b("requireName", true))
          Toggle("คุยต่อได้ 45 วิหลังตอบโดยไม่ต้องเรียกชื่อ", isOn: b("followUp", true))
          Toggle("ข้ามการขออนุญาต (AI รันคำสั่ง/แก้ไฟล์บน Mac ได้โดยไม่ถาม)", isOn: b("bypass", true))
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("พักหน้าจอ") {
        VStack(alignment: .leading, spacing: 8) {
          let sec = (store.settings["idle"] as? JSON)?["sleepAfter"] as? Int ?? 150
          HStack {
            Text("หลับ (zZz) เมื่อไม่มีใครเล่นด้วย")
            Picker("", selection: Binding(get: { sec }, set: { store.setIdle("sleepAfter", $0) })) {
              ForEach(Array(Set([15, 30, 60, 120, 150, 300, 600, 1800, 3600, sec])).sorted(), id: \.self) { s in Text(s < 60 ? "\(s) วิ" : "\(s / 60) นาที" + (s % 60 > 0 ? " \(s % 60) วิ" : "")).tag(s) }
            }.labelsHidden().frame(width: 120)
            Text("(กลางคืนหลับเร็วสุด 1 นาที)").font(.caption).foregroundStyle(.secondary)
          }
          Toggle("หลับแล้วขึ้นหน้าปัดนาฬิกา (เวลา + วันที่ หรี่จอ ขยับกันจอค้างภาพ)", isOn: Binding(get: { (store.settings["idle"] as? JSON)?["clock"] as? Bool ?? true }, set: { store.setIdle("clock", $0) }))
          Text("ว่าง ๆ Neo จะเล่นเอง (มองแมลงบินผ่าน) · แตะหน้าจอ / เรียกชื่อ = ตื่น").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      FullDiskBox()
      GroupBox {
        VStack(alignment: .leading, spacing: 8) {
          Toggle("เปิด Neo เมื่อเข้าสู่ระบบ", isOn: Binding(get: { login }, set: { on in
            do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } } catch { appLog("login item: \(error)") }
            login = SMAppService.mainApp.status == .enabled
          }))
          Toggle("ตั้ง adb reverse ให้มือถือที่ต่อสาย/adb อยู่อัตโนมัติ", isOn: $adb)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      HStack { Button("เปิด log") { NSWorkspace.shared.open(Paths.serverLog) }; Button("เปิดโฟลเดอร์ข้อมูล") { NSWorkspace.shared.open(Paths.support) }; Button("ตั้งค่าครั้งแรกใหม่") { store.onboarded = false } }
    }
  }
}

// ---------- สมอง: เลือก + จัดการ provider / custom endpoint ----------
struct BrainPane: View {
  @EnvironmentObject var store: Store
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
  @State private var found: JSON? = nil
  @State private var msg = ""
  @State private var suggestions: [JSON] = []

  var providers: [String: JSON] { store.config["providers"] as? [String: JSON] ?? [:] }
  var discovered: [JSON] { store.config["discovered"] as? [JSON] ?? [] }

  var body: some View {
    Pane(title: "สมอง", subtitle: "agent ในเครื่องหาเจอเอง — เพิ่ม endpoint ของคุณเองได้ (OpenAI-compatible, HTTP, ACP)") {
      GroupBox("ใช้อยู่") {
        HStack {
          Picker("สมอง", selection: Binding(get: { store.current }, set: { store.useProvider($0) })) { ForEach(store.providers.indices, id: \.self) { i in Text(store.providers[i]["label"] as? String ?? "").tag(store.providers[i]["name"] as? String ?? "") } }
          ModelPicker()
        }.padding(4)
      }
      GroupBox("หาเจอในเครื่อง") {
        VStack(alignment: .leading, spacing: 4) {
          Text(discovered.filter { $0["available"] as? Bool == true }.map { $0["label"] as? String ?? "" }.joined(separator: " · ")).foregroundStyle(mint)
          Text("ยังไม่ได้ติดตั้ง: " + discovered.filter { $0["available"] as? Bool != true }.map { $0["name"] as? String ?? "" }.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
          Button("หาใหม่") { Task { await store.rediscover() } }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("แก้ / เพิ่ม") {
        VStack(alignment: .leading, spacing: 8) {
          Picker("แก้ตัวไหน", selection: $pick) {
            ForEach(providers.keys.sorted(), id: \.self) { Text((providers[$0]?["label"] as? String ?? $0) + " · " + (providers[$0]?["type"] as? String ?? "")).tag($0) }
            Text("+ เพิ่ม custom endpoint").tag("")
          }.onChange(of: pick) { _ in fill() }
          if let f = found { Text("พบในเครื่อง: \(f["via"] as? String ?? "") — แก้ได้เฉพาะชื่อ/โมเดล/ชื่อเรียก").font(.caption).foregroundStyle(.secondary) }
          Grid(alignment: .leading) {
            GridRow { Text("ชื่อ"); TextField("a-z 0-9 - _", text: $name).disabled(providers[pick] != nil) }
            GridRow { Text("ชื่อที่แสดง"); TextField("", text: $label) }
            GridRow { Text("ชนิด"); Picker("", selection: $type) { Text("openai — OpenRouter, Ollama, LM Studio…").tag("openai"); Text("http — endpoint ของคุณ").tag("http"); Text("acp — agent").tag("acp"); Text("claude-code").tag("claude-code") }.labelsHidden().disabled(found != nil) }
            if type == "openai" { GridRow { Text("Base URL"); TextField("https://openrouter.ai/api/v1", text: $baseUrl) } }
            if type == "http" { GridRow { Text("URL"); TextField("https://…/neo", text: $url) } }
            if type == "acp" && found == nil { GridRow { Text("คำสั่ง"); TextField("opencode", text: $command) }; GridRow { Text("อาร์กิวเมนต์"); TextField("acp", text: $args) } }
            if type == "openai" || type == "http" { GridRow { Text("API key"); SecureField((store.config["keys"] as? JSON)?[pick] as? Bool == true ? "มี key แล้ว — เว้นว่างถ้าไม่เปลี่ยน" : "เก็บใน Application Support ไม่อยู่ใน config", text: $apiKey) } }
            GridRow { Text("โมเดลเริ่มต้น"); TextField("ชื่อที่ตั้งเอง หรือ id", text: $model) }
            GridRow { Text("ชื่อเรียกด้วยเสียง"); TextField("คั่นด้วย ,", text: $aliases) }
          }
          Text("ตั้งชื่อโมเดลเอง (พูด \"ใช้โมเดล <ชื่อ>\" ได้)").font(.headline).padding(.top, 4)
          ForEach(rows.indices, id: \.self) { i in
            HStack { TextField("ชื่อเล่น เช่น เร็ว", text: Binding(get: { rows[i].0 }, set: { rows[i].0 = $0 })); TextField("id โมเดล", text: Binding(get: { rows[i].1 }, set: { rows[i].1 = $0 }))
              if !suggestions.isEmpty { Menu("เลือก") { ForEach(suggestions.prefix(300).indices, id: \.self) { k in Button(suggestions[k]["name"] as? String ?? "") { rows[i].1 = suggestions[k]["id"] as? String ?? "" } } }.frame(width: 70) }
              Button(role: .destructive) { rows.remove(at: i) } label: { Image(systemName: "xmark") } }
          }
          HStack {
            Button("+ ชื่อโมเดล") { rows.append(("", "")) }
            Button("ดึงรายชื่อโมเดล") { Task { suggestions = await store.modelsFor(pick); msg = "ได้ \(suggestions.count) โมเดล" } }.disabled(providers[pick] == nil)
            Spacer(); Text(msg).font(.caption).foregroundStyle(.secondary)
          }
          HStack {
            Button("บันทึก") { save() }.keyboardShortcut(.defaultAction)
            if providers[pick] != nil { Button("ลบ", role: .destructive) { Task { msg = await store.removeProvider(pick) ?? "ลบแล้ว"; pick = "" } } }
          }
        }.padding(4)
      }
    }
    .task { await store.refreshConfig(); pick = store.current; fill() }
  }

  func fill() {
    let c = providers[pick] ?? [:]
    found = discovered.first { $0["name"] as? String == pick && $0["available"] as? Bool == true }
    name = providers[pick] != nil ? pick : ""; label = c["label"] as? String ?? ""; type = c["type"] as? String ?? "openai"
    baseUrl = c["baseUrl"] as? String ?? ""; url = c["url"] as? String ?? ""; command = c["command"] as? String ?? ""; args = (c["args"] as? [String] ?? []).joined(separator: " ")
    model = c["model"] as? String ?? ""; aliases = (c["aliases"] as? [String] ?? []).joined(separator: ", "); apiKey = ""; msg = ""; suggestions = []
    rows = ((c["models"] as? [String: String]) ?? [:]).sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
  }

  func save() {
    var c: JSON = ["type": type]
    for (k, v) in [("label", label), ("baseUrl", baseUrl), ("url", url), ("command", command), ("model", model)] where !v.trimmingCharacters(in: .whitespaces).isEmpty { c[k] = v.trimmingCharacters(in: .whitespaces) }
    if !args.isEmpty { c["args"] = args.split(separator: " ").map(String.init) }
    c["aliases"] = aliases.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    c["models"] = Dictionary(rows.filter { !$0.0.isEmpty && !$0.1.isEmpty }.map { ($0.0, $0.1) }, uniquingKeysWith: { a, _ in a })
    for k in ["headers", "apiKeyEnv", "apiKeyFile", "config"] { if let v = providers[pick]?[k] { c[k] = v } }
    let n = name.trimmingCharacters(in: .whitespaces)
    Task { msg = await store.saveProvider(n, c, apiKey: apiKey) ?? "บันทึกแล้ว"; if msg == "บันทึกแล้ว" { pick = n; fill(); msg = "บันทึกแล้ว" } }
  }
}

// ---------- ชื่อเรียก ----------
struct NamePane: View {
  @EnvironmentObject var store: Store
  @State private var name = ""
  var body: some View {
    Pane(title: "ชื่อเรียก", subtitle: "เรียกชื่อแล้ว Neo ร้องตอบและรอฟังคำสั่ง (เงียบ 3 วิ = จบ)") {
      TextField("เช่น นีโอ, โมจิ, Luna", text: $name).textFieldStyle(.roundedBorder).font(.title3)
      Text("ฝึกเสียงชื่อ: กดเริ่ม แล้วพูดชื่อใส่มือถือ 3 ครั้ง (เว้นสักวินาที) — Neo จะจำว่าตัวถอดเสียงเขียนชื่อนี้แบบไหนบ้าง").foregroundStyle(.secondary)
      HStack(spacing: 8) { ForEach(0..<3, id: \.self) { i in Circle().fill((store.training?.count ?? 0) > i ? mint : .clear).overlay(Circle().stroke(mint)).frame(width: 14, height: 14) } }
      if let t = store.training, !t.isEmpty { Text("ได้ยิน: " + t.joined(separator: " · ")).foregroundStyle(mint) }
      HStack {
        Button(store.training != nil ? "กำลังฟัง… พูดชื่อใส่มือถือ" : "เริ่มฝึก (ต้องต่อมือถือแล้ว)") { store.train(name) }.disabled(name.isEmpty || !store.phone).keyboardShortcut(.defaultAction)
        Button("ใช้ชื่อนี้เลย ไม่ฝึก") { store.setName(name) }.disabled(name.isEmpty)
      }
      if !store.phone { Text("มือถือยังไม่เชื่อมต่อ — จับคู่ในหน้ามือถือก่อน หรือกด \"ใช้ชื่อนี้เลย\"").font(.caption).foregroundStyle(.orange) }
      GroupBox("คำที่จำไว้ตอนนี้") { Text(store.wakeVariants.joined(separator: " · ")).frame(maxWidth: .infinity, alignment: .leading).padding(4) }
    }.onAppear { if name.isEmpty { name = store.wakeName } }
  }
}

// ---------- หน้าตา ----------
struct FacePane: View {
  @EnvironmentObject var store: Store
  @State private var f = FaceTheme()
  @State private var saved = false
  var body: some View {
    Pane(title: "หน้าตา", subtitle: "เลือกธีมหรือปรับสีเอง — จอมือถือเปลี่ยนตามเมื่อกดบันทึก") {
      HStack(spacing: 10) { FacePixels(theme: f); FacePixels(theme: f, bliss: true) }.frame(height: 130).clipShape(RoundedRectangle(cornerRadius: 10))
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 10) {
        ForEach(FaceTheme.presets, id: \.0) { p in
          Button { f = p.1; saved = false } label: {
            VStack(spacing: 4) { FacePixels(theme: p.1).clipShape(RoundedRectangle(cornerRadius: 6)); Text(p.0).font(.caption) }.padding(6)
              .overlay(RoundedRectangle(cornerRadius: 10).stroke(f == p.1 ? mint : .gray.opacity(0.3), lineWidth: 2))
          }.buttonStyle(.plain)
        }
      }
      HStack(spacing: 18) {
        ColorPicker("ตา/ปาก", selection: Binding(get: { Color(hex: f.fg) }, set: { f.fg = $0.hex; saved = false }))
        ColorPicker("หัวใจ", selection: Binding(get: { Color(hex: f.accent) }, set: { f.accent = $0.hex; saved = false }))
        ColorPicker("แก้ม", selection: Binding(get: { Color(hex: f.cheek) }, set: { f.cheek = $0.hex; saved = false }))
        ColorPicker("พื้นหลัง", selection: Binding(get: { Color(hex: f.bg) }, set: { f.bg = $0.hex; saved = false }))
      }
      HStack { Button("บันทึกหน้าตา") { store.saveFace(f); saved = true }.keyboardShortcut(.defaultAction); if saved { Text("บันทึกแล้ว — จอมือถือเปลี่ยนตาม").foregroundStyle(.secondary) } }
    }.onAppear { f = store.face }
  }
}

// ---------- มือถือ: ช่องทาง + จับคู่ + เครื่องที่จับคู่แล้ว ----------
struct PhonePane: View {
  @EnvironmentObject var store: Store
  @State private var now = Date()
  let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
  func b(_ k: String, _ d: Bool) -> Binding<Bool> { Binding(get: { store.settings[k] as? Bool ?? d }, set: { store.set(k, $0) }) }
  var body: some View {
    Pane(title: "มือถือ", subtitle: "ติดตั้งแอป Neo บน Android แล้วเชื่อมกับ Mac ด้วยวิธีไหนก็ได้ที่มือถือไปถึง Mac") {
      GroupBox("ช่องทางที่เปิดให้มือถือต่อ") {
        VStack(alignment: .leading, spacing: 6) {
          Toggle("Tailscale / VPN (100.x.x.x) — เข้ารหัสโดย VPN", isOn: b("tailscale", true))
          Toggle("Wi-Fi เดียวกัน — สะดวก แต่ข้อมูลในวง Wi-Fi ไม่เข้ารหัส", isOn: b("lan", false))
          Text("USB (adb reverse) และ tunnel/URL ของคุณเองใช้ได้เสมอ").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox {
        VStack(alignment: .leading, spacing: 10) {
          HStack { Button("จับคู่มือถือ") { store.startPair() }.keyboardShortcut(.defaultAction); Text("รหัสใช้ได้ 5 นาที ครั้งเดียว").foregroundStyle(.secondary) }
          if let p = store.pair, let code = p["code"] as? String {
            let left = Int(((p["expiresAt"] as? Double ?? 0) / 1000 - now.timeIntervalSince1970).rounded())
            Text(code).font(.system(size: 52, weight: .bold, design: .monospaced)).kerning(10).foregroundStyle(mint).frame(maxWidth: .infinity)
            Text(left > 0 ? "เหลือ \(left / 60):\(String(format: "%02d", left % 60))" : "หมดเวลา — กดจับคู่ใหม่").foregroundStyle(.secondary).frame(maxWidth: .infinity)
            ForEach((p["addresses"] as? [JSON] ?? []).indices, id: \.self) { i in
              let a = (p["addresses"] as! [JSON])[i]
              VStack(alignment: .leading, spacing: 1) { HStack { Text(a["method"] as? String ?? "").bold(); Text(a["url"] as? String ?? "").foregroundStyle(mint).textSelection(.enabled) }; Text(a["note"] as? String ?? "").font(.caption).foregroundStyle(.secondary) }
            }
            if let u = (p["addresses"] as? [JSON])?.first(where: { ($0["url"] as? String ?? "").contains("://1") || $0["method"] as? String == "Tailscale" })?["url"] as? String {
              VStack(alignment: .leading, spacing: 1) { HStack { Text("แอป Android").bold(); Text(u + "/neo.apk").foregroundStyle(mint).textSelection(.enabled) }; Text("เปิดในเบราว์เซอร์มือถือเพื่อดาวน์โหลด (ต้องอนุญาตติดตั้งแอปจากแหล่งอื่น)").font(.caption).foregroundStyle(.secondary) }
            }
          }
          if let n = store.pairedName { Label("จับคู่กับ \(n) แล้ว", systemImage: "checkmark.circle.fill").foregroundStyle(mint) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
      GroupBox("เครื่องที่จับคู่แล้ว") {
        VStack(alignment: .leading) {
          if store.devices.isEmpty { Text("ยังไม่มี").foregroundStyle(.secondary) }
          ForEach(store.devices.indices, id: \.self) { i in let d = store.devices[i]
            HStack { Text(d["name"] as? String ?? ""); Text((d["lastSeen"] as? String).map { "ออนไลน์ล่าสุด " + $0.prefix(16).replacingOccurrences(of: "T", with: " ") } ?? "ยังไม่เคยต่อ").font(.caption).foregroundStyle(.secondary); Spacer(); Button("ยกเลิกการจับคู่") { store.revoke(d["id"] as? String ?? "") } }
          }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
      }
    }.onReceive(tick) { now = $0 }.task { await store.refreshDevices() }
  }
}
