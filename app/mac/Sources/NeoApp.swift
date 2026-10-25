// Neo.app — SwiftUI: หน้าต่าง Console, ตั้งค่าครั้งแรก, Settings (⌘,), ไอคอนแถบเมนู
// เปิดแอป = เปิด server (node ในแอป) + ตัวถอดเสียงของ Apple เอง; ลากลง /Applications แล้วใช้ได้เลย
import AppKit
import ServiceManagement
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
  let server = ServerSupervisor()
  let speech = SpeechService()
  func applicationDidFinishLaunching(_ n: Notification) {
    Paths.prepare()
    API.token = server.token
    speech.start(); server.start()
    Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in if UserDefaults.standard.bool(forKey: "adbReverse") { adbReverse() } }
  }
  func applicationWillTerminate(_ n: Notification) { server.stop() }
  func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false } // ปิดหน้าต่าง = อยู่แถบเมนูต่อ
}

@main
struct NeoApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var app
  @StateObject var store = Store()

  var body: some Scene {
    Window("Neo Console", id: "console") {
      Group { if store.onboarded { ConsoleView() } else { OnboardingView() } }
        .environmentObject(store).frame(minWidth: 760, minHeight: 560)
        .task { store.start() }
    }
    .commands { CommandGroup(replacing: .newItem) {} }

    Window("ความจำ & งาน", id: "memory") { MemoryWindow().environmentObject(store).frame(minWidth: 760, minHeight: 520) }

    Settings { SettingsView().environmentObject(store) }

    MenuBarExtra { MenuContent().environmentObject(store) } label: {
      Image(nsImage: menuIcon(phone: store.phone))
    }
  }
}

struct MenuContent: View {
  @EnvironmentObject var store: Store
  @Environment(\.openWindow) var openWindow
  var body: some View {
    Text("สมอง: \(store.status["provider"] as? String ?? "—")" + ((store.status["model"] as? String).map { " · \($0)" } ?? ""))
    Text(store.phone ? "มือถือ: เชื่อมต่ออยู่" : "มือถือ: ยังไม่เชื่อมต่อ")
    if let p = store.petText { Text((store.wakeName.isEmpty ? "Neo" : store.wakeName) + ": " + p) }
    Button("ให้อาหาร Neo") { store.feed() }.disabled(!store.phone)
    Button("สั่งให้ Neo นอน (ปิดไมค์ แตะจอเพื่อปลุก)") { store.sleep() }.disabled(!store.phone)
    if store.status["thinking"] as? Bool == true { Text("กำลังทำงาน…") }
    Divider()
    Button("เปิด Neo Console") { openWindow(id: "console"); NSApp.activate(ignoringOtherApps: true) }.keyboardShortcut("o")
    Button("ความจำ & งานตั้งเวลา…") { openWindow(id: "memory"); NSApp.activate(ignoringOtherApps: true) }.keyboardShortcut("m", modifiers: [.command, .shift])
    if #available(macOS 14.0, *) { SettingsLink { Text("ตั้งค่า…") }.keyboardShortcut(",") }
    else { Button("ตั้งค่า…") { NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil); NSApp.activate(ignoringOtherApps: true) }.keyboardShortcut(",") }
    Button("รีสตาร์ท server") { (NSApp.delegate as? AppDelegate)?.server.restart() }
    Button("เปิด log") { NSWorkspace.shared.open(Paths.serverLog) }
    Divider()
    Button("ออกจาก Neo") { NSApp.terminate(nil) }.keyboardShortcut("q")
  }
}

/// ไอคอนแถบเมนู: หน้า Neo (ตา+ปาก) — จุดเขียว = มือถือเชื่อมต่ออยู่
func menuIcon(phone: Bool) -> NSImage {
  let img = NSImage(size: NSSize(width: 22, height: 16), flipped: true) { _ in
    NSColor.black.setFill()
    for r in [NSRect(x: 4, y: 3, width: 4, height: 6), NSRect(x: 14, y: 3, width: 4, height: 6), NSRect(x: 8, y: 12, width: 6, height: 1.6), NSRect(x: 7, y: 10.6, width: 1.4, height: 1.6), NSRect(x: 13.6, y: 10.6, width: 1.4, height: 1.6)] { r.fill() }
    if phone { NSColor.systemGreen.setFill(); NSBezierPath(ovalIn: NSRect(x: 18, y: 11, width: 4, height: 4)).fill() }
    return true
  }
  img.isTemplate = !phone
  return img
}

/// adb reverse tcp:8000 ให้มือถือที่ต่อ adb อยู่ (เปิดในตั้งค่า — ค่าเริ่มต้นปิด)
func adbReverse() {
  let adb = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Android/sdk/platform-tools/adb").path
  guard FileManager.default.isExecutableFile(atPath: adb) else { return }
  DispatchQueue.global().async {
    func run(_ a: [String]) -> String {
      let p = Process(); p.executableURL = URL(fileURLWithPath: adb); p.arguments = a
      let o = Pipe(); p.standardOutput = o; p.standardError = FileHandle.nullDevice
      try? p.run(); p.waitUntilExit(); return String(data: o.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    }
    for line in run(["devices"]).split(separator: "\n").dropFirst() where line.hasSuffix("\tdevice") {
      let id = String(line.split(separator: "\t")[0])
      if !run(["-s", id, "reverse", "--list"]).contains("tcp:8000") { _ = run(["-s", id, "reverse", "tcp:8000", "tcp:8000"]); appLog("adb reverse → \(id)") }
    }
  }
}

// ---------- ตั้งค่าครั้งแรก ----------
struct OnboardingView: View {
  @EnvironmentObject var store: Store
  @State private var step = 0
  let steps = ["ตรวจเครื่อง", "ชื่อเรียก", "หน้าตา", "สมอง", "มือถือ", "เสร็จ"]

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 6) {
        ForEach(steps.indices, id: \.self) { i in
          Button("\(i + 1). \(steps[i])") { step = i }.buttonStyle(.borderless).padding(.horizontal, 10).padding(.vertical, 4)
            .foregroundStyle(i == step ? mint : i < step ? .primary : .secondary).overlay(Capsule().stroke(i == step ? mint : .gray.opacity(0.3)))
        }
      }.padding(14)
      Divider()
      Group {
        switch step {
        case 0: CheckStep()
        case 1: NamePane()
        case 2: FacePane()
        case 3: BrainPane()
        case 4: PhonePane()
        default: DoneStep()
        }
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
      Divider()
      HStack {
        if step > 0 { Button("ย้อนกลับ") { step -= 1 } }
        Spacer()
        Button(step == steps.count - 1 ? "เริ่มใช้ Neo" : "ต่อไป") { if step == steps.count - 1 { store.finishOnboarding() } else { step += 1 } }.keyboardShortcut(.defaultAction)
      }.padding(14)
    }.navigationTitle("ตั้งค่า Neo")
  }
}

struct CheckStep: View {
  @EnvironmentObject var store: Store
  var body: some View {
    Pane(title: "ยินดีต้อนรับสู่ Neo", subtitle: "สัตว์เลี้ยงบนจอมือถือที่ฟังคุณพูด แล้วให้ AI บน Mac ช่วยหาคำตอบ — เริ่มจากตรวจว่า Mac พร้อมไหม") {
      if store.doctor.isEmpty { ProgressView("กำลังตรวจ…") }
      ForEach(store.doctor.indices, id: \.self) { i in let c = store.doctor[i]
        let ok = c["ok"] as? Bool ?? false, opt = c["optional"] as? Bool ?? false
        HStack(alignment: .top, spacing: 10) {
          Image(systemName: ok ? "checkmark.circle.fill" : opt ? "circle" : "xmark.circle.fill").foregroundStyle(ok ? mint : opt ? .gray : .red)
          VStack(alignment: .leading, spacing: 2) {
            Text(c["label"] as? String ?? ""); Text(c["detail"] as? String ?? "").font(.caption).foregroundStyle(.secondary)
            if !ok, let f = c["fix"] as? String { Text(f).font(.caption.monospaced()).foregroundStyle(.orange).textSelection(.enabled) }
          }
        }
      }
      FullDiskBox()
      Button("ตรวจใหม่") { Task { await store.refreshDoctor() }; store.fullDisk = hasFullDiskAccess() }
    }.task { await store.refreshDoctor() }
  }
}

struct DoneStep: View {
  @EnvironmentObject var store: Store
  var body: some View {
    Pane(title: "พร้อมแล้ว", subtitle: "เรียก \"\(store.wakeName)\" ที่มือถือได้เลย — ดูสิ่งที่ได้ยินและสิ่งที่ Neo ทำได้ในหน้า Console") {
      HStack { FacePixels(theme: store.face, bliss: true).frame(height: 120).clipShape(RoundedRectangle(cornerRadius: 10)); Spacer() }
      Text("สมอง: \(store.status["provider"] as? String ?? "—")" + ((store.status["model"] as? String).map { " · \($0)" } ?? ""))
      Text(store.phone ? "มือถือ: เชื่อมต่ออยู่" : "มือถือ: ยังไม่เชื่อมต่อ (จับคู่ทีหลังได้ใน ตั้งค่า → มือถือ)")
    }
  }
}
