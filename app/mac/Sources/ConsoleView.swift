// หน้าต่าง Neo Console: สิ่งที่ได้ยิน / Neo ทำอะไร / การ์ดที่ขึ้นจอมือถือ + เลือกสมอง/โมเดล + พิมพ์สั่ง
import SwiftUI

let mint = Color(hex: "#7fffd4")

struct ConsoleView: View {
  @EnvironmentObject var store: Store
  @Environment(\.openWindow) var openWindow
  @State private var input = ""

  var body: some View {
    VStack(spacing: 0) {
      if !store.connected { Text("กำลังเปิด Neo server…").font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(6).background(.orange.opacity(0.15)) }
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 10) {
            if store.items.isEmpty { Text("ยังไม่มีบทสนทนา — เรียก \"\(store.wakeName)\" ที่มือถือ หรือพิมพ์ด้านล่าง").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 40) }
            ForEach(store.items) { EventRow(item: $0).id($0.id) }
          }.padding(16)
        }
        .onChange(of: store.items.count) { _ in if let last = store.items.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } } }
      }
      Divider()
      HStack {
        TextField("พิมพ์สั่ง Neo เหมือนพูด เช่น \(store.wakeName) ค่าเงินดอลลาร์วันนี้ / ตกลง / ยกเลิก", text: $input).textFieldStyle(.roundedBorder).onSubmit(send)
        Button("ส่ง", action: send).keyboardShortcut(.return, modifiers: [.command]).disabled(input.isEmpty)
      }.padding(12)
    }
    .toolbar {
      ToolbarItemGroup {
        Picker("สมอง", selection: Binding(get: { store.current }, set: { store.useProvider($0) })) {
          ForEach(store.providers.indices, id: \.self) { i in let p = store.providers[i]; Text(p["label"] as? String ?? "").tag(p["name"] as? String ?? "") }
        }.frame(width: 190).help("สมองของ Neo")
        ModelPicker().frame(width: 230)
        Menu {
          Button("ปลา") { store.feed("fish") }; Button("ขนม") { store.feed("cookie") }; Button("นม") { store.feed("milk") }
        } label: { Label(store.petText ?? "ให้อาหาร", systemImage: "fork.knife") } primaryAction: { store.feed() }
          .help("ให้อาหาร Neo (หรือพูด \"\(store.wakeName) กินข้าว\" / แตะชามบนจอมือถือ) — ยิ่งหิวยิ่งรักเพิ่ม")
        Button { openWindow(id: "memory") } label: { Label("ความจำ & งาน", systemImage: "brain") }.help("ดู/จัดการสิ่งที่จำไว้ ความฝัน บันทึกสนทนา และงานตั้งเวลา")
        Toggle("ต้องเรียกชื่อ", isOn: Binding(get: { store.settings["requireName"] as? Bool ?? true }, set: { store.set("requireName", $0) })).help("ต้องเรียก \"\(store.wakeName)\" ก่อนถาม")
        Toggle("ข้ามการขออนุญาต", isOn: Binding(get: { store.settings["bypass"] as? Bool ?? true }, set: { store.set("bypass", $0) })).help("AI รันคำสั่ง/แก้ไฟล์ได้โดยไม่ถาม")
      }
    }
    .navigationTitle("Neo Console")
    .navigationSubtitle(store.phone ? "มือถือเชื่อมต่ออยู่" : "มือถือยังไม่เชื่อมต่อ")
  }

  func send() { let t = input.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { return }; store.say(t); input = "" }
}

struct ModelPicker: View {
  @EnvironmentObject var store: Store
  var body: some View {
    Picker("โมเดล", selection: Binding(get: { store.model ?? "" }, set: { store.useModel($0) })) {
      Text("ค่าเริ่มต้น").tag("")
      if !store.mapped.isEmpty { Section("ชื่อที่ตั้งเอง") { ForEach(store.mapped.indices, id: \.self) { i in let m = store.mapped[i]; Text("\(m["alias"] as? String ?? "") → \(m["id"] as? String ?? "")").tag(m["alias"] as? String ?? "") } } }
      Section("ทั้งหมด (\(store.models.count))") { ForEach(store.models.prefix(500).indices, id: \.self) { i in let m = store.models[i]; Text(m["name"] as? String ?? "").tag(m["id"] as? String ?? "") } }
      if let m = store.model, !m.isEmpty, !store.models.contains(where: { $0["id"] as? String == m }), !store.mapped.contains(where: { $0["alias"] as? String == m }) { Text(m).tag(m) }
    }.help(store.modelError ?? "โมเดลของสมองนี้")
  }
}

struct EventRow: View {
  @EnvironmentObject var store: Store
  let item: LogItem
  var j: JSON { item.j }
  var time: some View { Text(item.at, style: .time).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary) }

  var body: some View {
    switch item.type {
    case "heard", "ignored":
      HStack(alignment: .bottom) {
        Spacer(minLength: 80); time
        VStack(alignment: .leading, spacing: 2) {
          Text(item.type == "heard" ? "คุณพูด" : "ไม่รับระหว่างทำงาน").font(.caption2).foregroundStyle(.secondary)
          Text(j["text"] as? String ?? "").strikethrough(item.type == "ignored").textSelection(.enabled)
        }.padding(.horizontal, 12).padding(.vertical, 8).background(Color(hex: "#1d3a32"), in: RoundedRectangle(cornerRadius: 14))
      }
    case "card":
      HStack(alignment: .top) { time; CardView(card: j["card"] as? JSON ?? [:], theme: store.face); Spacer() }
    default:
      HStack { time; chip; Spacer() }
    }
  }

  @ViewBuilder var chip: some View {
    let (t, c): (String, Color) = {
      switch item.type {
      case "thinking": return ("กำลังทำ: " + (j["text"] as? String ?? ""), mint)
      case "tool": return ("⚙ " + (j["name"] as? String ?? "") + " " + (j["input"] as? String ?? ""), Color(hex: "#b9c7ff"))
      case "session":
        let who = (j["provider"] as? String).map { $0 + " · " } ?? "", turn = j["turn"] as? Int ?? 0
        return (who + ((j["fresh"] as? Bool ?? true) ? "เริ่มบทสนทนาใหม่" : "คุยต่อ (รอบที่ \(turn))"), .secondary)
      case "armed": return ("เรียกชื่อแล้ว — รอฟังคำสั่ง (เงียบ 3 วิ = จบ)", mint)
      case "cancelled": return ("ยกเลิกแล้ว", .orange)
      case "askerr": return ("ทำไม่สำเร็จ: " + (j["error"] as? String ?? ""), .orange)
      case "nothing": return ("ได้ยินเสียง แต่ไม่ใช่คำพูด", .secondary)
      case "stterr": return ("ถอดเสียงไม่สำเร็จ", .orange)
      case "provider": return ("สมอง: " + (j["label"] as? String ?? ""), mint)
      case "model": return ("โมเดล: " + (j["model"] as? String ?? "ค่าเริ่มต้น"), mint)
      case "settings": return ("ตั้งค่า: " + ((j["requireName"] as? Bool ?? true) ? "ต้องเรียกชื่อ" : "ไม่ต้องเรียกชื่อ") + ((j["bypass"] as? Bool ?? true) ? " · ข้ามการขออนุญาต" : " · ขออนุญาตก่อน"), .secondary)
      case "paired": return ("จับคู่กับ " + (j["name"] as? String ?? "") + " แล้ว", mint)
      case "face": return ("เปลี่ยนหน้าตาแล้ว", mint)
      case "wake": return ("ชื่อเรียก: " + (j["name"] as? String ?? ""), mint)
      case "alarm": return ("⏰ ปลุก: " + (j["title"] as? String ?? ""), .orange)
      case "alarm_off": return ("ปิดปลุก (\(j["why"] as? String ?? ""))" + ((j["snooze"] as? Int).map { " · อีก \($0) นาทีปลุกใหม่" } ?? ""), .secondary)
      case "job": return ("⏱ งานตั้งเวลา: " + (j["title"] as? String ?? ""), mint)
      case "schedule": return ("ตั้งเวลา: " + (j["title"] as? String ?? "") + " — " + (j["when"] as? String ?? ""), mint)
      case "idle": return ("พักหน้าจอ: หลับหลัง \(j["sleepAfter"] as? Int ?? 0) วิ" + ((j["clock"] as? Bool ?? true) ? " · หน้าปัดนาฬิกา" : ""), .secondary)
      case "dreaming": return ("💤 เริ่มฝัน (\(j["reason"] as? String ?? "")) — ทบทวน \(j["entries"] as? Int ?? 0) บทสนทนา", Color(hex: "#b9a6ff"))
      case "dream_done": return ("💭 ฝันว่า: " + (j["dream"] as? String ?? "") + " · ค้นพบ \(j["insights"] as? Int ?? 0) เรื่อง", Color(hex: "#b9a6ff"))
      case "dream_fail": return ("ฝันไม่สำเร็จ: " + (j["error"] as? String ?? ""), .orange)
      case "feed": return ("🍽 ให้อาหาร: " + (["fish": "ปลา", "cookie": "ขนม", "milk": "นม"][j["food"] as? String ?? ""] ?? "ปลา"), mint)
      case "sleep": return ("😴 หลับเป็นตาย — ปิดไมค์แล้ว แตะจอมือถือเพื่อปลุก · 15 นาทีแล้วจะฝัน", Color(hex: "#b9a6ff"))
      case "wakeup": return ("ตื่นแล้ว (แตะปลุก)" + ((j["dreamCancelled"] as? Bool ?? false) ? " · ยกเลิกการฝันที่รออยู่" : ""), mint)
      case "pet_ask": return ("ถามว่าหิวไหม", .secondary)
      case "train": return ("ฝึกชื่อ \(j["n"] as? Int ?? 0)/3: " + (j["text"] as? String ?? ""), mint)
      default: return (item.type, .secondary)
      }
    }()
    Text(t).font(.callout).lineLimit(2).foregroundStyle(c).padding(.horizontal, 10).padding(.vertical, 4).overlay(Capsule().stroke(c.opacity(0.4)))
  }
}

/// การ์ดเหมือนบนจอมือถือ: text / list / big + อารมณ์
struct CardView: View {
  let card: JSON
  let theme: FaceTheme
  var body: some View {
    let fg = Color(hex: theme.fg), layout = card["layout"] as? String ?? "text", lines = card["lines"] as? [String] ?? [], items = card["items"] as? [JSON] ?? []
    if layout == "pixel" {
      VStack(alignment: .leading, spacing: 6) {
        Text("ภาพที่วาด · \((card["frames"] as? [Any])?.count ?? 1) เฟรม").font(.caption2).foregroundStyle(fg.opacity(0.6))
        PixelArtView(card: card, bg: theme.bg).frame(maxWidth: 420, maxHeight: 240)
        Text(card["title"] as? String ?? "").font(.title3.bold()).foregroundStyle(fg)
      }.padding(14).background(Color(hex: theme.bg), in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(fg.opacity(0.25)))
    } else {
    VStack(alignment: .leading, spacing: 4) {
      Text([card["icon"] as? String, layout != "text" ? layout : nil, (card["emotion"] as? String).map { "อารมณ์ " + $0 }].compactMap { $0 }.joined(separator: " · ").uppercased())
        .font(.caption2).foregroundStyle(fg.opacity(0.6))
      if layout == "big", let big = card["big"] as? String, !big.isEmpty { Text(big).font(.system(size: 32, weight: .bold)) }
      Text(card["title"] as? String ?? "").font(.title3.bold())
      if layout == "list" && !items.isEmpty {
        Grid(alignment: .leading, verticalSpacing: 2) {
          ForEach(items.indices, id: \.self) { i in GridRow { Text(items[i]["t"] as? String ?? ""); Text(items[i]["v"] as? String ?? "").bold().gridColumnAlignment(.trailing) } }
        }
        ForEach(lines.prefix(2), id: \.self) { Text($0).font(.caption).foregroundStyle(fg.opacity(0.7)) }
      } else { ForEach(lines.indices, id: \.self) { Text(lines[$0]) } }
    }
    .foregroundStyle(fg).textSelection(.enabled)
    .padding(14).frame(minWidth: 280, maxWidth: 560, alignment: .leading)
    .background(Color(hex: theme.bg), in: RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(fg.opacity(0.25)))
    }
  }
}

/// หน้า pixel ของ Neo (32×18) — idle หรือเคลิ้ม (ตาปิด แก้ม หัวใจ) ใช้แสดงตัวอย่างธีม
struct FacePixels: View {
  let theme: FaceTheme
  var bliss = false
  var body: some View {
    Canvas { ctx, size in
      let s = min(size.width / 32, size.height / 18), ox = (size.width - 32 * s) / 2, oy = (size.height - 18 * s) / 2
      func r(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ c: String) { ctx.fill(Path(CGRect(x: ox + CGFloat(x) * s, y: oy + CGFloat(y) * s, width: CGFloat(w) * s, height: CGFloat(h) * s)), with: .color(Color(hex: c))) }
      r(0, 0, 32, 18, theme.bg)
      if !bliss {
        r(6, 4, 6, 8, theme.fg); r(7, 5, 1, 1, theme.bg); r(20, 4, 6, 8, theme.fg); r(21, 5, 1, 1, theme.bg)
        r(13, 14, 6, 1, theme.fg); r(12, 13, 1, 1, theme.fg); r(19, 13, 1, 1, theme.fg)
      } else {
        for x in [6, 20] { for (dx, y) in [(0, 3), (1, 4), (2, 5), (3, 5), (4, 4), (5, 3)] { r(x + dx, 4 + y, 1, 1, theme.fg) } }
        r(14, 14, 4, 1, theme.fg); r(13, 13, 1, 1, theme.fg); r(18, 13, 1, 1, theme.fg); r(4, 11, 3, 1, theme.cheek); r(25, 11, 3, 1, theme.cheek)
        for (x, y) in [(1, 0), (3, 0), (0, 1), (1, 1), (2, 1), (3, 1), (4, 1), (1, 2), (2, 2), (3, 2), (2, 3)] { r(14 + x, y, 1, 1, theme.accent) }
      }
    }.aspectRatio(32 / 18, contentMode: .fit)
  }
}
