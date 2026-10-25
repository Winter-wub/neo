// Neo Console: a window, a menu bar item, and nothing else. All of Neo lives in the daemon;
// every action here is a `neo …` call and all live state comes from one `neo events --json --history`.
import AppKit
import NeoConsoleKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
  static var model: ConsoleModel?
  func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false } // closing the window keeps the menu bar item
  /// Quitting only ends this app and its events stream. The daemon keeps running under launchd.
  func applicationWillTerminate(_ n: Notification) { Self.model?.stop() }
}

@main
struct NeoConsoleApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
  @StateObject private var model: ConsoleModel
  @StateObject private var settings: SettingsModel
  @StateObject private var memory: MemoryModel

  init() {
    let config = NeoConfig.fromBundle()
    let runner = ProcessRunner(config: config)
    let model = ConsoleModel(runner: runner, config: config)
    AppDelegate.model = model
    model.start()
    _model = StateObject(wrappedValue: model)
    _settings = StateObject(wrappedValue: SettingsModel(runner: runner))
    _memory = StateObject(wrappedValue: MemoryModel(runner: runner, home: config.home))
  }

  var body: some Scene {
    Window(Brand.windowTitle, id: "console") {
      Group { if model.needsOnboarding { OnboardingView() } else { ConsoleView() } }
        .environmentObject(model).environmentObject(settings).environmentObject(memory).frame(minWidth: 640, minHeight: 480)
    }
    .commands { CommandGroup(replacing: .newItem) {} }

    Window("ความจำ & งาน", id: "memory") {
      MemoryWindow().environmentObject(model).environmentObject(settings).environmentObject(memory).frame(minWidth: 760, minHeight: 520)
    }

    Settings { SettingsView().environmentObject(model).environmentObject(settings).environmentObject(memory) }

    MenuBarExtra { MenuContent().environmentObject(model) } label: {
      Image(nsImage: menuIcon(phone: model.status?.phone ?? false, dimmed: model.link != .connected))
    }
  }
}

enum Brand {
  static let windowTitle = (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? "Neo Console"
}

struct MenuContent: View {
  @EnvironmentObject var model: ConsoleModel
  @Environment(\.openWindow) var openWindow

  var body: some View {
    Text(statusLine)
    if let s = model.status {
      Text("สมอง: \(s.provider.isEmpty ? "—" : s.provider)" + (s.model.map { " · \($0)" } ?? ""))
      Text(s.phone ? "มือถือ: เชื่อมต่ออยู่" : "มือถือ: ยังไม่เชื่อมต่อ")
      if s.thinking { Text("กำลังทำงาน…") }
    }
    Divider()
    Button("เปิด Neo Console") { openWindow(id: "console"); NSApp.activate(ignoringOtherApps: true) }.keyboardShortcut("o")
    Button("ความจำ & งาน…") { openWindow(id: "memory"); NSApp.activate(ignoringOtherApps: true) }.keyboardShortcut("m")
    Button("ตั้งค่า…") { openSettingsWindow() }.keyboardShortcut(",")
    Menu("Neo") {
      Text(statusLine)
      Divider()
      Button("เริ่ม Neo") { Task { await model.startDaemon() } }.disabled(model.link == .connected || model.link == .updating)
      Button("หยุด Neo") { Task { await model.stopDaemon() } }.disabled(model.link != .connected)
      Button("รีสตาร์ท Neo") { Task { await model.restartDaemon() } }.disabled(model.link != .connected)
      Divider()
      Button("เปิด log") { NSWorkspace.shared.open(URL(fileURLWithPath: model.logPath)) }
    }
    Divider()
    // quits this app only; Neo keeps running
    Button("ออกจาก Neo Console") { NSApp.terminate(nil) }.keyboardShortcut("q")
  }

  var statusLine: String {
    switch model.link {
    case .starting: return "Neo: กำลังเชื่อมต่อ…"
    case .connected: return "Neo: ทำงานอยู่"
    case .down: return "Neo: ไม่ทำงาน"
    case .notInstalled: return "Neo: ยังไม่ได้ติดตั้ง"
    case .updating: return "Neo: กำลังอัปเดต…"
    }
  }
}

/// Menu bar icon: Neo's face. Green dot = phone connected. Dimmed = daemon not reachable.
func menuIcon(phone: Bool, dimmed: Bool) -> NSImage {
  let img = NSImage(size: NSSize(width: 22, height: 16), flipped: true) { _ in
    NSColor.black.withAlphaComponent(dimmed ? 0.3 : 1).setFill()
    for r in [NSRect(x: 4, y: 3, width: 4, height: 6), NSRect(x: 14, y: 3, width: 4, height: 6), NSRect(x: 8, y: 12, width: 6, height: 1.6), NSRect(x: 7, y: 10.6, width: 1.4, height: 1.6), NSRect(x: 13.6, y: 10.6, width: 1.4, height: 1.6)] { r.fill() }
    if phone && !dimmed { NSColor.systemGreen.setFill(); NSBezierPath(ovalIn: NSRect(x: 18, y: 11, width: 4, height: 4)).fill() }
    return true
  }
  img.isTemplate = !(phone && !dimmed)
  return img
}
