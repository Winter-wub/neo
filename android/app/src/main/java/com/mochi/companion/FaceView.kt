package com.mochi.companion

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import kotlin.math.max
import kotlin.math.min

// วาดหน้า 32x18 ขยายแบบจำนวนเต็ม (ไม่เบลอ) + การ์ดคำตอบ + ซับไตเติล + แถบระดับไมค์ — ผังเดียวกับ CSS ของ index.html
class FaceView(ctx: Context, private val brain: Brain, private val debug: Boolean, private val onLongPress: () -> Unit = {}) : View(ctx) {
    private val faceBmp = Bitmap.createBitmap(Face.W, Face.H, Bitmap.Config.ARGB_8888)
    private val facePx = IntArray(Face.W * Face.H)
    private val iconBmp = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)
    private val iconPx = IntArray(16 * 16)
    private var iconFor: Card? = null
    private val pixel = Paint().apply { isFilterBitmap = false; isAntiAlias = false; isDither = false }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Face.FG; textAlign = Paint.Align.CENTER }
    private val bold = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bar = Paint().apply { color = 0xFF22AA66.toInt() }
    private val dbg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Face.FG; typeface = Typeface.MONOSPACE }
    private val dst = Rect()
    private val src = Rect()
    private val density = resources.displayMetrics.density

    init { setBackgroundColor(Face.BG); isHapticFeedbackEnabled = false }
    /** สีธีมเปลี่ยน (จาก Mac) */
    fun themeChanged() { setBackgroundColor(Face.BG); iconFor = null; invalidate() }
    // กดค้าง 3 วิโดยไม่ลาก = เปิดหน้าตั้งค่า (จับคู่ใหม่)
    private val longPress = Runnable { onLongPress() }
    private var downX = 0f; private var downY = 0f
    // ตำแหน่ง grid หน้า Neo บนจอ (ไว้ตรวจว่าแตะโดนชามอาหารไหม)
    private var gridX = 0; private var gridY = 0; private var gridS = 1; private var gridOn = false
    private fun onBowl(x: Float, y: Float): Boolean {
        if (!gridOn || !brain.hungry || brain.eating || brain.asleep) return false
        val gx = (x - gridX) / gridS; val gy = (y - gridY) / gridS
        return gx >= Face.BOWL_X - 3 && gx <= Face.BOWL_X + 8 && gy >= Face.BOWL_Y - 4 && gy <= Face.H + 1
    }

    override fun onDraw(c: Canvas) {
        val now = SystemClock.uptimeMillis()
        val w = width.toFloat(); val h = height.toFloat(); val vmin = min(w, h) / 100f
        val port = h > w
        val card = brain.card
        text.color = Face.FG; dbg.color = Face.FG
        if (card?.pixel != null) { drawPixel(c, card, w, h, vmin, port, brain.cardAge(now)); overlays(c, now, w, h, vmin); return }

        // หน้า: ถ้ามีการ์ด หน้าอยู่ซ้าย 44% (แนวตั้ง: บนครึ่งจอ)
        val art = if (card == null && brain.thinking) brain.toolArt else null // ท่าเครื่องมือ: หน้าคิดอยู่ + ภาพวนในพื้นที่การ์ด
        val aw = if ((card != null || art != null) && !port) w * 0.44f else w
        val ah = if ((card != null || art != null) && port) h * 0.5f else h
        // แนวตั้ง: ตัดขอบว่างซ้าย-ขวา (คอลัมน์ 4..27 ยังมีแก้ม/หัวใจครบ) ให้หน้าใหญ่ขึ้น
        val cols = if (port) PORT_COLS else Face.W; val x0 = (Face.W - cols) / 2
        val s = max(1, min(aw / cols, ah / Face.H).toInt())
        val fw = cols * s; val fh = Face.H * s
        val fx = ((aw - fw) / 2).toInt(); val fy = ((ah - fh) / 2).toInt()
        val watch = card == null && brain.watch(now)
        if (watch) Clock.render(java.util.Calendar.getInstance(), brain.frame(now), facePx) else Face.render(brain.frame(now), facePx)
        faceBmp.setPixels(facePx, 0, Face.W, 0, 0, Face.W, Face.H)
        src.set(x0, 0, x0 + cols, Face.H)
        dst.set(fx, fy, fx + fw, fy + fh); c.drawBitmap(faceBmp, src, dst, pixel)
        gridX = fx - x0 * s; gridY = fy; gridS = s; gridOn = card == null && art == null && !watch

        if (card != null) drawCard(c, card, if (port) 0f else aw, if (port) ah else 0f, w, h, vmin, port, brain.cardAge(now))
        if (art != null) drawToolArt(c, art, brain.toolFrame(now), if (port) 0f else aw, if (port) ah else 0f, w, h)
        if (watch) { // วันที่ใต้เวลา (แถว 11-12 ของหน้าปัด)
            text.typeface = bold; text.color = Clock.DIM; text.textAlign = Paint.Align.CENTER
            fitLine(c, Clock.date(java.util.Calendar.getInstance()), fx + fw / 2f, fy + 12.6f * s, fw * 0.9f, 1.7f * s)
            text.color = Face.FG
        }
        overlays(c, now, w, h, vmin)
    }

    private fun overlays(c: Canvas, now: Long, w: Float, h: Float, vmin: Float) {
        // ซับไตเติลสิ่งที่ได้ยิน
        if (brain.sub.isNotEmpty()) {
            text.typeface = bold; text.textSize = 4.2f * vmin
            text.setShadowLayer(6f, 0f, 0f, Face.BG)
            fitLine(c, brain.sub, w / 2, h - 5f * h / 100f, w * 0.92f, 4.2f * vmin)
            text.clearShadowLayer()
        }
        // แถบระดับเสียงไมค์
        val lw = min(1f, brain.micLevel * 6f) * w
        if (lw > 0f) c.drawRect(0f, h - 1.2f * vmin, lw, h, bar)
        if (debug) { dbg.textSize = 11f * density; c.drawText(brain.debug(now), 6f * density, 14f * density, dbg) }
    }

    // การ์ด 3 แบบ: text (บรรทัดกึ่งกลาง), list (ซ้ายข้อความ ขวาค่า), big (ค่าเดียวตัวใหญ่) — เกิน 7 แถวแบ่งหน้า สลับเองทุก 8 วิ
    private fun drawCard(c: Canvas, card: Card, x0: Float, y0: Float, w: Float, h: Float, vmin: Float, port: Boolean, age: Long) {
        val cw = w - x0; val ch = h - y0; val cx = x0 + cw / 2; val margin = 3f * vmin
        if (iconFor !== card) { Icons.render(Icons.forCard(card), iconPx); iconBmp.setPixels(iconPx, 0, 16, 0, 0, 16, 16); iconFor = card }
        val list = card.layout == "list"; val big = card.layout == "big"
        val rows = if (list) card.items.size else card.lines.size
        val pages = (rows + PER_PAGE - 1) / PER_PAGE
        val page = if (pages > 1) ((age / PAGE_MS) % pages).toInt() else 0
        val shown = min(rows, PER_PAGE)
        val many = shown > 3 || list
        val iconSize = ((if (many) 12f else if (port) 22f else 26f) * vmin / 16).toInt().coerceAtLeast(1) * 16
        val headSize = (if (big || !many) 11f else 7f) * vmin
        val subSize = 5f * vmin // หัวข้อรองของการ์ด big
        val lineSize = (if (many) 4.3f else 4.8f) * vmin
        val lineH = lineSize * 1.25f + (if (many) 0.9f else 1.6f) * vmin
        val dots = if (pages > 1) 3f * vmin else 0f
        val notes = if (list) card.lines.take(2) else emptyList() // หมายเหตุ/ที่มาใต้รายการ
        val noteSize = 3.4f * vmin
        val total = iconSize + 2f * vmin + headSize * 1.15f + (if (big) subSize * 1.3f else 0f) + shown * lineH + notes.size * noteSize * 1.4f + dots
        var y = y0 + (ch - total) / 2
        dst.set((cx - iconSize / 2).toInt(), y.toInt(), (cx + iconSize / 2).toInt(), y.toInt() + iconSize)
        c.drawBitmap(iconBmp, null, dst, pixel)
        y += iconSize + vmin
        text.typeface = bold
        y += headSize; fitLine(c, if (big && card.big.isNotEmpty()) card.big else card.title, cx, y, cw * 0.92f, headSize)
        if (big && card.big.isNotEmpty()) { y += subSize * 1.3f; fitLine(c, card.title, cx, y, cw * 0.92f, subSize) }
        y += 0.15f * headSize + vmin
        val from = page * PER_PAGE; val to = min(rows, from + PER_PAGE)
        for (i in from until to) {
            y += lineH; val base = y - (lineH - lineSize)
            if (list) {
                val (t, v) = card.items[i]
                text.typeface = bold; text.textAlign = Paint.Align.RIGHT; text.textSize = lineSize
                val vw = if (v.isEmpty()) 0f else min(text.measureText(v), cw * 0.4f)
                fitLine(c, v, x0 + cw - margin, base, cw * 0.4f, lineSize)
                text.typeface = Typeface.SANS_SERIF; text.textAlign = Paint.Align.LEFT
                fitLine(c, t, x0 + margin, base, cw - 2 * margin - vw - 2f * vmin, lineSize)
                text.textAlign = Paint.Align.CENTER
            } else { text.typeface = Typeface.SANS_SERIF; fitLine(c, card.lines[i], cx, base, cw - 4f * w / 100f, lineSize) }
        }
        if (notes.isNotEmpty()) { text.typeface = Typeface.SANS_SERIF; text.color = NOTE; y += 0.5f * vmin; for (n in notes) { y += noteSize * 1.4f; fitLine(c, n, cx, y, cw - 2 * margin, noteSize) }; text.color = Face.FG }
        if (pages > 1) { // จุดบอกหน้า
            val r = 0.8f * vmin; val gap = 3f * r; val sx = cx - (pages - 1) * gap / 2; val dy = y + dots * 0.6f
            for (i in 0 until pages) { dot.color = if (i == page) Face.FG else 0xFF2F5F52.toInt(); c.drawCircle(sx + i * gap, dy, r, dot) }
        }
    }

    // ภาพ pixel ที่ AI วาด: เต็มจอ ขยายแบบจำนวนเต็ม เล่นเฟรมตาม fps + ชื่อภาพด้านล่าง
    private var artBmp: Bitmap? = null
    private fun drawPixel(c: Canvas, card: Card, w: Float, h: Float, vmin: Float, port: Boolean, age: Long) {
        val art = card.pixel ?: return
        val bmp = artBmp?.takeIf { it.width == art.w && it.height == art.h } ?: Bitmap.createBitmap(art.w, art.h, Bitmap.Config.ARGB_8888).also { artBmp = it }
        val f = art.frames[((age * art.fps / 1000) % art.frames.size).toInt()]
        val px = IntArray(f.size) { if (f[it] == 0) Face.BG else f[it] }
        bmp.setPixels(px, 0, art.w, 0, 0, art.w, art.h)
        val titleH = if (card.title.isNotEmpty()) 7f * vmin else 0f
        val s = max(1, min(w * 0.96f / art.w, (h - titleH) * 0.94f / art.h).toInt())
        val aw = art.w * s; val ah = art.h * s
        val x = ((w - aw) / 2).toInt(); val y = ((h - titleH - ah) / 2).toInt()
        dst.set(x, y, x + aw, y + ah); c.drawBitmap(bmp, null, dst, pixel)
        if (titleH > 0) { text.typeface = bold; text.textAlign = Paint.Align.CENTER; fitLine(c, card.title, w / 2, h - 2.5f * vmin, w * 0.9f, 4.5f * vmin) }
    }

    // ท่าเครื่องมือในพื้นที่ที่การ์ดจะอยู่ (ขวา/ล่างของหน้า) ขยายแบบจำนวนเต็ม; ป้ายอยู่ที่ซับด้านล่างจอ
    private fun drawToolArt(c: Canvas, art: PixelArt, frame: Int, x0: Float, y0: Float, w: Float, h: Float) {
        val bmp = artBmp?.takeIf { it.width == art.w && it.height == art.h } ?: Bitmap.createBitmap(art.w, art.h, Bitmap.Config.ARGB_8888).also { artBmp = it }
        val f = art.frames[frame % art.frames.size]
        bmp.setPixels(IntArray(f.size) { if (f[it] == 0) Face.BG else f[it] }, 0, art.w, 0, 0, art.w, art.h)
        val rw = w - x0; val rh = (h - y0) * 0.86f // เผื่อที่ให้ซับ
        val s = max(1, min(rw * 0.9f / art.w, rh * 0.9f / art.h).toInt())
        val aw = art.w * s; val ah = art.h * s
        val x = (x0 + (rw - aw) / 2).toInt(); val y = (y0 + (rh - ah) / 2).toInt()
        dst.set(x, y, x + aw, y + ah); c.drawBitmap(bmp, null, dst, pixel)
    }

    /** วาดข้อความบรรทัดเดียว (ตาม textAlign ปัจจุบัน) ย่อขนาดถ้ายาวเกินกว้าง */
    private fun fitLine(c: Canvas, t: String, x: Float, baseline: Float, maxW: Float, size: Float) {
        text.textSize = size
        val tw = text.measureText(t)
        if (tw > maxW && maxW > 0f) text.textSize = max(size * 0.5f, size * maxW / tw)
        c.drawText(t, x, baseline, text)
    }

    companion object { const val PORT_COLS = 24; const val PER_PAGE = 7; const val PAGE_MS = 8000L; const val NOTE = 0xFF5FBFA0.toInt() }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val d = density
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { brain.down(e.x / d, e.y / d, e.eventTime); downX = e.x; downY = e.y; postDelayed(longPress, 3000) }
            MotionEvent.ACTION_MOVE -> {
                // จอเก่า touch หยาบ: ใช้จุดย่อยทุกจุดในก้อนเดียว
                for (i in 0 until e.historySize) brain.move(e.getHistoricalX(i) / d, e.getHistoricalY(i) / d, e.getHistoricalEventTime(i))
                brain.move(e.x / d, e.y / d, e.eventTime)
                if (kotlin.math.hypot(e.x - downX, e.y - downY) > 30 * d) removeCallbacks(longPress)
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(longPress)
                if (onBowl(e.x, e.y) && kotlin.math.hypot(e.x - downX, e.y - downY) < 30 * d) { brain.cancelTouch(); brain.feed(Food.FISH, e.eventTime) } // แตะชาม = ให้อาหาร
                else brain.up(e.eventTime)
            }
            MotionEvent.ACTION_CANCEL -> { removeCallbacks(longPress); brain.cancelTouch() }
        }
        invalidate()
        return true
    }
}
