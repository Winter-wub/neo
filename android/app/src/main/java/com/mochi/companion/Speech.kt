package com.mochi.companion

// ข้อความบนการ์ดจาก Mac (schema ตาม app/server.js) — ชื่อเรียก/คำยกเลิก/คำเรื่องอากาศย้ายไปตัดสินบน Mac (app/voice.js)
object Speech {
    // ตัดอีโมจิ/สัญลักษณ์ที่ฟอนต์ไม่มี
    private val JUNK = Regex("""[\x{10000}-\x{10FFFF}\u2600-\u27BF\uFE0F]""")
    fun clean(t: String?): String = (t ?: "").replace(JUNK, "").trim()
}
