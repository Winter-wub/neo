import NeoConsoleKit
import SwiftUI

/// The pet's face in the chosen colours (32×18 pixels), eyes open or `bliss`.
struct FacePixels: View {
  let theme: Face
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

/// A picture the AI drew (card layout "pixel"): frames play at `fps`.
struct PixelArtView: View {
  let card: Card
  let bg: String
  var body: some View {
    let w = card.w ?? 0, h = card.h ?? 0, pal = card.palette ?? [:], frames = card.frames ?? [], fps = max(1, card.fps ?? 3)
    TimelineView(.periodic(from: .now, by: 1 / Double(fps))) { tl in
      let f = frames.isEmpty ? [] : frames[Int(tl.date.timeIntervalSinceReferenceDate * Double(fps)) % frames.count]
      Canvas { ctx, size in
        let s = min(size.width / CGFloat(max(w, 1)), size.height / CGFloat(max(h, 1)))
        let ox = (size.width - CGFloat(w) * s) / 2, oy = (size.height - CGFloat(h) * s) / 2
        ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: bg)))
        for (y, row) in f.enumerated() {
          for (x, ch) in row.enumerated() {
            if let c = pal[String(ch)] { ctx.fill(Path(CGRect(x: ox + CGFloat(x) * s, y: oy + CGFloat(y) * s, width: s + 0.5, height: s + 0.5)), with: .color(Color(hex: c))) }
          }
        }
      }
    }.aspectRatio(CGFloat(max(w, 1)) / CGFloat(max(h, 1)), contentMode: .fit)
  }
}
