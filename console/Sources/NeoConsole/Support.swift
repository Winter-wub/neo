import AppKit
import NeoConsoleKit
import SwiftUI

extension Color {
  /// "#rrggbb" for `neo face set`.
  var hex: String {
    let c = NSColor(self).usingColorSpace(.sRGB) ?? .black
    return String(format: "#%02x%02x%02x", Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
  }
}

/// A Settings / onboarding page: title, subtitle, then the controls.
struct Pane<Content: View>: View {
  let title: String, subtitle: String
  @ViewBuilder var content: Content
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        Text(title).font(.title2.bold())
        Text(subtitle).foregroundStyle(.secondary)
        content
      }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// An inline error under the controls that caused it (never an alert).
struct NoticeText: View {
  let text: String?
  var body: some View { if let text { Text(text).font(.caption).foregroundStyle(.orange).textSelection(.enabled) } }
}

/// Re-reads everything the panes show at open and whenever Neo says something changed (Terminal, phone, another Console).
struct RefreshesSettings: ViewModifier {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var settings: SettingsModel
  func body(content: Content) -> some View {
    content
      .task { await settings.refresh() }
      .onChange(of: model.revision) { _ in Task { await settings.refresh() } }
      .onChange(of: model.link) { link in if link == .connected { Task { await settings.refresh() } } }
  }
}
extension View { func refreshesSettings() -> some View { modifier(RefreshesSettings()) } }

func openFullDiskAccessSettings() {
  if let url = URL(string: fullDiskAccessURL) { NSWorkspace.shared.open(url) }
}

func openSettingsWindow() {
  NSApp.activate(ignoringOtherApps: true)
  // showSettingsWindow: on macOS 14+, showPreferencesWindow: on 13
  if !NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) {
    NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
  }
}
typealias NeoSettings = NeoConsoleKit.Settings
