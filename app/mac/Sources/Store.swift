// สถานะทั้งหมดของแอป (SwiftUI อ่านจากที่นี่) — อัปเดตจาก event สด + API
import AppKit
import SwiftUI

typealias JSON = [String: Any]

struct FaceTheme: Equatable {
  var fg = "#7fffd4", accent = "#ff7aa8", cheek = "#ff9a9a", bg = "#000000"
  init() {}
  init(_ j: JSON?) { if let j { fg = j["fg"] as? String ?? fg; accent = j["accent"] as? String ?? accent; cheek = j["cheek"] as? String ?? cheek; bg = j["bg"] as? String ?? bg } }
  var json: JSON { ["fg": fg, "accent": accent, "cheek": cheek, "bg": bg] }
  // ธีมสำเร็จ (เลือกในหน้าตา)
  static let presets: [(String, FaceTheme)] = [("มิ้นต์", .init("#7fffd4", "#ff7aa8", "#ff9a9a", "#000000")), ("อำพัน", .init("#ffb347", "#ff5e5e", "#ff9a76", "#000000")),
    ("ฟ้าน้ำแข็ง", .init("#7fd4ff", "#ff8ac2", "#ffaacc", "#000814")), ("ซากุระ", .init("#ffb7d5", "#ff4f8b", "#ff9ab8", "#120008")),
    ("คลาสสิก", .init("#f2f2f2", "#ff6b81", "#ff9aa8", "#000000")), ("จอเขียวยุค 80", .init("#39ff14", "#ffd400", "#ff8c42", "#001100")),
    ("ลาเวนเดอร์", .init("#c3a6ff", "#ff7ab8", "#ffa3c9", "#0b0614")), ("มะนาว", .init("#d4ff4f", "#ff6f91", "#ffb199", "#0a0f00"))]
  init(_ fg: String, _ accent: String, _ cheek: String, _ bg: String) { self.fg = fg; self.accent = accent; self.cheek = cheek; self.bg = bg }
}

extension Color {
  init(hex: String) {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
  }
  var hex: String {
    let c = NSColor(self).usingColorSpace(.sRGB) ?? .black
    return String(format: "#%02x%02x%02x", Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
  }
}

struct LogItem: Identifiable { let id = UUID(); let type: String; let at: Date; let j: JSON }

@MainActor final class Store: ObservableObject {
  @Published var items: [LogItem] = []
  @Published var connected = false
  @Published var status: JSON = [:]
  @Published var providers: [JSON] = []
  @Published var current = ""
  @Published var mapped: [JSON] = []
  @Published var models: [JSON] = []
  @Published var model: String? = nil
  @Published var modelError: String? = nil
  @Published var settings: JSON = [:]
  @Published var face = FaceTheme()
  @Published var wakeName = ""
  @Published var wakeVariants: [String] = []
  @Published var training: [String]? = nil
  @Published var devices: [JSON] = []
  @Published var pair: JSON? = nil
  @Published var pairedName: String? = nil
  @Published var doctor: [JSON] = []
  @Published var onboarded = true
  @Published var config: JSON = [:] // providers.json + ที่หาเจอ (หน้าจัดการสมอง)
  @Published var jobs: [JSON] = []   // ปลุก / เตือน / งานตั้งเวลา
  @Published var ringing: JSON? = nil
  @Published var dream: JSON = [:]   // ความจำ + ความฝัน + ช่วงที่ผู้ใช้ไม่อยู่
  @Published var fullDisk = hasFullDiskAccess()

  let stream = EventStream()
  var phone: Bool { status["phone"] as? Bool ?? false }

  func start() {
    stream.onState = { [weak self] on in self?.connected = on; if on { Task { await self?.refreshAll() } } }
    stream.onEvent = { [weak self] e in self?.handle(e) }
    stream.run()
    Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in Task { await self?.refreshStatus() } }
  }

  func refreshAll() async {
    await refreshStatus(); await refreshProviders(); await refreshSettings()
    face = FaceTheme(await API.dict("/api/face"))
    await refreshWake(); await refreshDevices()
    onboarded = (await API.dict("/api/onboard"))?["done"] as? Bool ?? true
    if items.isEmpty, let h = await API.call("/api/history") as? [JSON] { items = h.compactMap(item) }
  }
  func refreshStatus() async { if let s = await API.dict("/api/status", timeout: 3) { status = s } }
  func refreshSettings() async { settings = await API.dict("/api/settings") ?? settings }
  func refreshProviders() async {
    guard let r = await API.dict("/api/provider") else { return }
    providers = r["list"] as? [JSON] ?? []; current = r["current"] as? String ?? ""
    await refreshModels()
  }
  func refreshModels() async {
    guard !current.isEmpty, let r = await API.dict("/api/models?name=" + (current.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""), timeout: 30) else { return }
    mapped = r["mapped"] as? [JSON] ?? []; models = r["list"] as? [JSON] ?? []; model = r["current"] as? String; modelError = r["error"] as? String
  }
  func refreshWake() async {
    guard let w = await API.dict("/api/wake") else { return }
    wakeName = w["name"] as? String ?? ""; wakeVariants = w["variants"] as? [String] ?? []
  }
  func refreshDevices() async { devices = await API.list("/api/devices") }
  func refreshDoctor() async { doctor = (await API.call("/api/doctor", timeout: 20) as? [JSON]) ?? [] }
  func refreshJobs() async { if let r = await API.dict("/api/schedule") { jobs = r["jobs"] as? [JSON] ?? []; ringing = r["ringing"] as? JSON } }
  func refreshDream() async { dream = await API.dict("/api/dream") ?? dream }
  func refreshConfig() async { config = await API.dict("/api/providers/config", timeout: 20) ?? [:] }

  // ---------- คำสั่ง ----------
  func sleep() { Task { _ = await API.call("/api/sleep", [:]) } }
  func feed(_ food: String = "fish") { Task { _ = await API.call("/api/feed", ["food": food]) } }
  /** "อิ่ม 70% · รัก 55%" จากที่มือถือรายงานล่าสุด */
  var petText: String? {
    guard let p = status["pet"] as? JSON, let h = p["hunger"] as? Double, let a = p["affection"] as? Double else { return nil }
    return (h >= 0.6 ? "หิว" : "อิ่ม") + " \(Int((1 - h) * 100))% · รัก \(Int(a * 100))%"
  }
  func say(_ t: String) { Task { _ = await API.call("/api/say", ["text": t]) } }
  func useProvider(_ n: String) { Task { _ = await API.call("/api/provider", ["name": n]); await refreshProviders() } }
  func useModel(_ m: String) { Task { _ = await API.call("/api/model", ["name": current, "model": m]); await refreshModels() } }
  func setIdle(_ k: String, _ v: Any) { var i = settings["idle"] as? JSON ?? [:]; i[k] = v; settings["idle"] = i; Task { _ = await API.call("/api/settings", ["idle": [k: v]]); await refreshSettings() } }
  /** ส่งคำสั่งไป /api/schedule คืนข้อความผิดพลาด (ถ้ามี) */
  @discardableResult func schedule(_ body: JSON) async -> JSON { let r = await API.dict("/api/schedule", body) ?? ["error": "ติดต่อ server ไม่ได้"]; await refreshJobs(); return r }
  func dreamCmd(_ body: JSON) { Task { _ = await API.call("/api/dream", body); try? await Task.sleep(nanoseconds: 300_000_000); await refreshDream() } }
  func set(_ k: String, _ v: Bool) { settings[k] = v; Task { _ = await API.call("/api/settings", [k: v]); await refreshSettings() } }
  func saveFace(_ f: FaceTheme) { Task { face = FaceTheme(await API.dict("/api/face", f.json)) } }
  func train(_ name: String) { training = []; Task { _ = await API.call("/api/wake", ["name": name]) } }
  func setName(_ name: String) { Task { _ = await API.call("/api/wake", ["name": name, "variants": [name]]); await refreshWake() } }
  func startPair() { pairedName = nil; Task { pair = await API.dict("/api/pair/start", [:]) } }
  func revoke(_ id: String) { Task { _ = await API.call("/api/devices", ["id": id]); await refreshDevices() } }
  func finishOnboarding() { onboarded = true; Task { _ = await API.call("/api/onboard", ["done": true]) } }
  func saveProvider(_ name: String, _ cfg: JSON, apiKey: String) async -> String? {
    let r = await API.dict("/api/providers/config", ["name": name, "cfg": cfg, "apiKey": apiKey])
    await refreshConfig(); await refreshProviders(); return r?["error"] as? String
  }
  func removeProvider(_ name: String) async -> String? {
    let r = await API.dict("/api/providers/config", ["name": name, "remove": true]); await refreshConfig(); await refreshProviders(); return r?["error"] as? String
  }
  func rediscover() async { _ = await API.call("/api/discover", [:], timeout: 30); await refreshConfig(); await refreshProviders() }
  func modelsFor(_ name: String) async -> [JSON] { (await API.dict("/api/models?name=" + (name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""), timeout: 30))?["list"] as? [JSON] ?? [] }

  // ---------- event สด ----------
  private func item(_ e: JSON) -> LogItem? {
    guard let t = e["type"] as? String, !["rec", "short", "loud", "ping", "hello", "stt", "listen_end", "devices"].contains(t) else { return nil }
    return LogItem(type: t, at: Date(timeIntervalSince1970: (e["at"] as? Double ?? Date().timeIntervalSince1970 * 1000) / 1000), j: e)
  }
  func handle(_ e: JSON) {
    switch e["type"] as? String ?? "" {
    case "provider": Task { await refreshProviders() }
    case "model": Task { await refreshModels() }
    case "settings": Task { await refreshSettings() }
    case "face": face = FaceTheme(e)
    case "wake": training = nil; Task { await refreshWake() }
    case "train": if let t = e["text"] as? String { training = (training ?? []) + [t] }
    case "schedule", "alarm_off", "job": Task { await refreshJobs() }
    case "dreaming", "dream_done", "dream_fail", "card", "askerr": Task { await refreshDream() } // card/askerr = บันทึกสนทนาเพิ่ม
    case "alarm": NSSound(named: "Glass")?.play(); Task { await refreshJobs() } // มือถือไม่ได้ต่อก็ยังได้ยินจาก Mac
    case "pet": status["pet"] = e
    case "paired": pair = nil; pairedName = e["name"] as? String; Task { await refreshDevices() }
    default: break
    }
    if let i = item(e) { items.append(i); if items.count > 500 { items.removeFirst(items.count - 500) } }
  }
}
