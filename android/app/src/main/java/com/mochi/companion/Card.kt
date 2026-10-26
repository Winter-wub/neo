package com.mochi.companion

import org.json.JSONObject

// การ์ดของแอป: สร้างจาก WireCard (Protocol.kt, gen จาก protocol.ts) แล้วทำความสะอาดข้อความ/จำกัดจำนวน/ถอดภาพ pixel
// ไฟล์นี้เขียนมือ — โครงสร้าง JSON อยู่ที่ WireCard เท่านั้น

/** การ์ดจาก Mac (หลัง cards.humanize) */
data class Card(
    val kind: String,
    val icon: String,
    val title: String,
    val lines: List<String>,
    val emotion: String,
    val sounds: List<String>,
    val seconds: Int,
    val layout: String = "text", // text | list | big
    val big: String = "",
    val items: List<Pair<String, String>> = emptyList(),
    val pixel: PixelArt? = null, // layout "pixel": ภาพที่ AI วาด
) {
    companion object {
        fun parse(json: String): Card = fromJson(JSONObject(json))

        fun fromJson(o: JSONObject): Card = from(WireCard.fromJson(o))

        fun from(w: WireCard): Card = Card(
            kind = w.kind,
            icon = w.icon,
            title = Speech.clean(w.title),
            lines = w.lines.take(14).map { Speech.clean(it) },
            emotion = w.emotion,
            sounds = w.sounds,
            seconds = w.seconds,
            layout = w.layout.takeIf { it == "list" || it == "big" || it == "pixel" } ?: "text",
            big = Speech.clean(w.big),
            items = w.items.take(14).map { Speech.clean(it.t) to Speech.clean(it.v) },
            pixel = if (w.layout == "pixel") PixelArt.from(w) else null,
        ).let { if (it.layout == "pixel" && it.pixel == null) it.copy(layout = "text") else it }
    }
}

/** ภาพ pixel ที่ Mac ตรวจแล้ว (app/cards.js): แต่ละเฟรมเป็น ARGB w*h, "." = สีพื้นหลังของธีม (0) */
class PixelArt(val w: Int, val h: Int, val fps: Int, val frames: List<IntArray>) {
    companion object {
        fun from(c: WireCard): PixelArt? = of(c.w, c.h, c.fps, c.palette, c.frames)

        /** ภาพวนของเครื่องมือ (NeoToolAnimation จาก Neo) */
        fun from(a: NeoToolAnimation): PixelArt? = of(a.w, a.h, a.fps, a.palette, a.frames)

        fun of(w: Int, h: Int, fps: Int, palette: Map<String, String>, rows: List<List<String>>): PixelArt? {
            if (w !in 4..64 || h !in 4..48) return null
            val pal = HashMap<Char, Int>()
            for ((k, v) in palette) if (k.length == 1 && Regex("#[0-9a-fA-F]{6}").matches(v)) pal[k[0]] = (0xFF000000.toInt() or v.substring(1).toInt(16))
            val frames = rows.take(12).map { f -> IntArray(w * h) { k -> f.getOrNull(k / w)?.getOrNull(k % w)?.let { pal[it] } ?: 0 } }
            return if (frames.isEmpty()) null else PixelArt(w, h, fps.coerceIn(1, 12), frames)
        }
    }
}
