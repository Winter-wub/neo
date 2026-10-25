import NeoConsoleKit
import SwiftUI

let mint = Color(hex: "#7fffd4")

extension Color {
  init(hex: String) {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
  }
}

struct ConsoleView: View {
  @EnvironmentObject var model: ConsoleModel
  @Environment(\.openWindow) var openWindow
  @State private var input = ""

  var body: some View {
    VStack(spacing: 0) {
      DaemonBar()
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 10) {
            if model.items.isEmpty {
              Text("ยังไม่มีบทสนทนา — เรียกชื่อ Neo ที่มือถือ หรือพิมพ์ด้านล่าง").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 40)
            }
            ForEach(model.items) { EventRow(item: $0).id($0.id) }
          }.padding(16)
        }
        .onChange(of: model.items.count) { _ in if let last = model.items.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } } }
      }
      if let notice = model.notice {
        Text(notice).font(.callout).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.top, 6)
      }
      Divider()
      HStack {
        TextField("พิมพ์สั่ง Neo เหมือนพูด เช่น Neo ค่าเงินดอลลาร์วันนี้ / ตกลง / ยกเลิก", text: $input).textFieldStyle(.roundedBorder).onSubmit(send)
        Button("ส่ง", action: send).keyboardShortcut(.return, modifiers: [.command]).disabled(input.isEmpty || !model.isConnected)
      }.padding(12).disabled(!model.isConnected)
    }
    .toolbar {
      ToolbarItem { Button { openWindow(id: "memory") } label: { Label("ความจำ & งาน", systemImage: "brain") }.help("ความจำ & งาน") }
    }
    .navigationTitle(Brand.windowTitle)
    .navigationSubtitle(model.status.map { $0.phone ? "มือถือเชื่อมต่ออยู่" : "มือถือยังไม่เชื่อมต่อ" } ?? "")
  }

  func send() {
    let text = input
    guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    input = ""
    Task { await model.say(text) }
  }
}

/// The only place the daemon's absence shows: a bar, never a modal alert.
struct DaemonBar: View {
  @EnvironmentObject var model: ConsoleModel

  var body: some View {
    switch model.link {
    case .connected: if model.updatePending { bar("กำลังรอให้งานเสร็จก่อนอัปเดต Neo…", tint: .secondary) }
    case .starting: bar("กำลังเชื่อมต่อ Neo…", tint: .secondary)
    case .updating: bar("กำลังอัปเดต Neo…", tint: .secondary)
    case .down:
      bar("Neo ไม่ทำงาน", tint: .orange) {
        Button("เริ่ม Neo") { Task { await model.startDaemon() } }
        Button("เปิด log") { NSWorkspace.shared.open(URL(fileURLWithPath: model.logPath)) }
      }
    case .notInstalled:
      bar("ยังไม่ได้ติดตั้ง Neo", tint: .orange) // onboarding normally replaces this window; this is only a fallback
    }
  }

  func bar<Actions: View>(_ text: String, tint: Color, @ViewBuilder actions: () -> Actions = { EmptyView() }) -> some View {
    HStack { Text(text); Spacer(); actions() }
      .font(.callout).padding(8).frame(maxWidth: .infinity).background(tint.opacity(0.15))
  }
}

struct EventRow: View {
  @EnvironmentObject var model: ConsoleModel
  let item: LogItem
  /// The log follows the face theme chosen in Settings.
  var tint: Color { Color(hex: model.face.fg) }
  var time: some View { Text(item.at, style: .time).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary) }

  var body: some View {
    switch item.kind {
    case .heard(let text), .ignored(let text):
      let heard: Bool = { if case .heard = item.kind { return true } else { return false } }()
      HStack(alignment: .bottom) {
        Spacer(minLength: 80); time
        VStack(alignment: .leading, spacing: 2) {
          Text(heard ? "คุณพูด" : "ไม่รับระหว่างทำงาน").font(.caption2).foregroundStyle(.secondary)
          Text(text).strikethrough(!heard).textSelection(.enabled)
        }.padding(.horizontal, 12).padding(.vertical, 8).background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 14))
      }
    case .card(let card):
      HStack(alignment: .top) { time; CardView(card: card, face: model.face); Spacer() }
    default:
      let (text, color) = chip
      HStack { time; Text(text).font(.callout).lineLimit(2).foregroundStyle(color).padding(.horizontal, 10).padding(.vertical, 4).overlay(Capsule().stroke(color.opacity(0.4))); Spacer() }
    }
  }

  var chip: (String, Color) {
    switch item.kind {
    case .thinking(let text): return ("กำลังทำ: " + text, tint)
    case .tool(let name, let input): return ("⚙ \(name) \(input)", Color(hex: "#b9c7ff"))
    case .session(let fresh, let turn, let provider): return ((provider.isEmpty ? "" : provider + " · ") + (fresh ? "เริ่มบทสนทนาใหม่" : "คุยต่อ (รอบที่ \(turn))"), .secondary)
    case .armed: return ("เรียกชื่อแล้ว — รอฟังคำสั่ง (เงียบ 3 วิ = จบ)", tint)
    case .cancelled: return ("ยกเลิกแล้ว", .orange)
    case .askerr(let error): return ("ทำไม่สำเร็จ: " + error, .orange)
    case .nothing: return ("ได้ยินเสียง แต่ไม่ใช่คำพูด", .secondary)
    case .stterr: return ("ถอดเสียงไม่สำเร็จ", .orange)
    case .settings(let s): return ("ตั้งค่า: " + (s.requireName ? "ต้องเรียกชื่อ" : "ไม่ต้องเรียกชื่อ") + (s.bypass ? " · ข้ามการขออนุญาต" : " · ขออนุญาตก่อน"), .secondary)
    case .paired(let name): return ("จับคู่กับ \(name) แล้ว", tint)
    case .unknown(let type): return (type, .secondary)
    case .heard, .ignored, .card, .status, .devices, .changed, .state, .face: return ("", .secondary)
    }
  }
}

/// Card like on the phone: text / list / big + emotion. (Pixel pictures arrive with the screens ticket.)
struct CardView: View {
  let card: Card
  let face: Face

  var body: some View {
    let fg = Color(hex: face.fg)
    VStack(alignment: .leading, spacing: 4) {
      Text([card.icon, card.layout != "text" ? card.layout : nil, "อารมณ์ " + card.emotion].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ").uppercased())
        .font(.caption2).foregroundStyle(fg.opacity(0.6))
      if card.layout == "pixel", !(card.frames ?? []).isEmpty {
        PixelArtView(card: card, bg: face.bg).frame(maxWidth: 320).clipShape(RoundedRectangle(cornerRadius: 6))
      }
      if card.layout == "big", let big = card.big, !big.isEmpty { Text(big).font(.system(size: 32, weight: .bold)) }
      Text(card.title).font(.title3.bold())
      if card.layout == "list" && !card.items.isEmpty {
        Grid(alignment: .leading, verticalSpacing: 2) {
          ForEach(card.items.indices, id: \.self) { i in GridRow { Text(card.items[i].t); Text(card.items[i].v).bold().gridColumnAlignment(.trailing) } }
        }
        ForEach(card.lines.prefix(2), id: \.self) { Text($0).font(.caption).foregroundStyle(fg.opacity(0.7)) }
      } else {
        ForEach(card.lines.indices, id: \.self) { Text(card.lines[$0]) }
      }
    }
    .foregroundStyle(fg).textSelection(.enabled)
    .padding(14).frame(minWidth: 280, maxWidth: 560, alignment: .leading)
    .background(Color(hex: face.bg), in: RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(fg.opacity(0.25)))
  }
}
