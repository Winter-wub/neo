// Six-step first run. Shown instead of the Console until the daemon is installed and `onboarded` is true.
// Steps reuse the Settings panes; only "ตรวจเครื่อง" and "เสร็จ" are their own.
import AppKit
import NeoConsoleKit
import SwiftUI

struct OnboardingView: View {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var settings: SettingsModel
  @State private var step = 0
  let steps = ["ตรวจเครื่อง", "ชื่อเรียก", "หน้าตา", "สมอง", "มือถือ", "เสร็จ"]
  /// Steps after the first need a running Neo to talk to.
  var ready: Bool { model.link == .connected }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 6) {
        ForEach(steps.indices, id: \.self) { i in
          Button("\(i + 1). \(steps[i])") { step = i }.buttonStyle(.borderless).padding(.horizontal, 10).padding(.vertical, 4)
            .foregroundStyle(i == step ? mint : i < step ? .primary : .secondary).overlay(Capsule().stroke(i == step ? mint : .gray.opacity(0.3)))
            .disabled(i > 0 && !ready)
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
        if step == steps.count - 1 {
          Button("เริ่มใช้ Neo") { Task { await settings.finishOnboarding() } }.keyboardShortcut(.defaultAction).disabled(!ready)
        } else {
          Button("ต่อไป") { step += 1 }.keyboardShortcut(.defaultAction).disabled(!ready)
        }
      }.padding(14)
    }
    .navigationTitle("ตั้งค่า Neo")
    .refreshesSettings()
  }
}

struct CheckStep: View {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var settings: SettingsModel

  var body: some View {
    Pane(title: "ยินดีต้อนรับสู่ Neo", subtitle: "สัตว์เลี้ยงบนจอมือถือที่ฟังคุณพูด แล้วให้ AI บน Mac ช่วยหาคำตอบ — เริ่มจากติดตั้งตัว Neo และตรวจว่า Mac พร้อมไหม") {
      GroupBox("Neo ที่ทำงานเบื้องหลัง") { InstallRow().frame(maxWidth: .infinity, alignment: .leading).padding(4) }
      if model.link == .connected {
        if settings.doctor == nil { ProgressView("กำลังตรวจ…") }
        ForEach(settings.doctor ?? []) { DoctorRowView(row: $0) }
        HStack {
          Button("ตรวจใหม่") { Task { await settings.runDoctor() } }
          if settings.doctor?.contains(where: { $0.id == "fda" && !$0.ok }) == true {
            Button("รีสตาร์ท Neo (หลังให้สิทธิ์ Full Disk Access)") { Task { await model.restartDaemon(); await settings.runDoctor() } }
          }
        }
        NoticeText(text: settings.notice)
      }
    }
    .task(id: model.link) { if model.link == .connected { await settings.runDoctor() } }
  }
}

/// `neo daemon install` and its result: where it went, and the PATH line when ~/.local/bin isn't on PATH.
struct InstallRow: View {
  @EnvironmentObject var model: ConsoleModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      switch model.link {
      case .notInstalled:
        Text("ยังไม่ได้ติดตั้ง — Neo จะรันเบื้องหลังด้วย launchd แม้ปิดแอปนี้ และเปิดเองตอนเข้าสู่ระบบ").foregroundStyle(.secondary)
        Button("ติดตั้ง Neo") { Task { await model.install() } }.keyboardShortcut(.defaultAction)
        NoticeText(text: model.notice)
      case .starting, .updating:
        HStack { ProgressView().controlSize(.small); Text(model.installing ? "กำลังติดตั้ง…" : "กำลังเชื่อมต่อ Neo…") }
      case .down:
        Label("ติดตั้งแล้ว แต่ Neo ไม่ทำงาน", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        Button("เริ่ม Neo") { Task { await model.startDaemon() } }
      case .connected:
        Label("ติดตั้งแล้วและทำงานอยู่", systemImage: "checkmark.circle.fill").foregroundStyle(mint)
        if let d = model.daemon { Text("LaunchAgent: \(d.plist.path)\nคำสั่ง neo: \(d.symlink.path)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
      }
      if let hint = model.installResult?.pathHint {
        VStack(alignment: .leading, spacing: 4) {
          Text(hint).font(.caption.monospaced()).textSelection(.enabled)
          Button("คัดลอกบรรทัดนี้") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(hint.components(separatedBy: ": ").last ?? hint, forType: .string)
          }
        }.padding(8).background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
      }
    }
  }
}

struct DoctorRowView: View {
  @EnvironmentObject var settings: SettingsModel
  let row: DoctorRow

  var body: some View {
    let optional = row.optional == true
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: row.ok ? "checkmark.circle.fill" : optional ? "circle" : "xmark.circle.fill").foregroundStyle(row.ok ? mint : optional ? .gray : .red)
      VStack(alignment: .leading, spacing: 2) {
        Text(row.label)
        if let detail = row.detail { Text(detail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
        switch DoctorFix.forRow(row) {
        case .openFullDiskAccess:
          Button("เปิด System Settings › Full Disk Access") { openFullDiskAccessSettings() }
        case .speech:
          Button("ขอสิทธิ์ Speech Recognition") { Task { await settings.fixSpeech() } }.disabled(settings.busy)
        case .none:
          if !row.ok, let fix = row.fix { Text(fix).font(.caption.monospaced()).foregroundStyle(.orange).textSelection(.enabled) }
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct DoneStep: View {
  @EnvironmentObject var model: ConsoleModel
  @EnvironmentObject var settings: SettingsModel

  var body: some View {
    Pane(title: "พร้อมแล้ว", subtitle: "เรียก \"\(settings.wake?.name ?? "Neo")\" ที่มือถือได้เลย — ดูสิ่งที่ได้ยินและสิ่งที่ Neo ทำได้ในหน้า Console") {
      HStack { FacePixels(theme: settings.face ?? model.face, bliss: true).frame(height: 120).clipShape(RoundedRectangle(cornerRadius: 10)); Spacer() }
      Text("สมอง: \(model.status.map { $0.provider.isEmpty ? "—" : $0.provider } ?? "—")" + (model.status?.model.map { " · \($0)" } ?? ""))
      if let d = settings.devices.first { Label("มือถือที่จับคู่แล้ว: \(d.name)", systemImage: "checkmark.circle.fill").foregroundStyle(mint) }
      else { Text("ยังไม่ได้จับคู่มือถือ — จับคู่ทีหลังได้ใน ตั้งค่า → มือถือ").foregroundStyle(.orange) }
      Text(model.status?.phone == true ? "มือถือ: เชื่อมต่ออยู่" : "มือถือ: ยังไม่เชื่อมต่อ")
    }
  }
}
