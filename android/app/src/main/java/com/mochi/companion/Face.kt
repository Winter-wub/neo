package com.mochi.companion

// หน้า pixel 32x18 — วาดลง IntArray (ARGB) แบบเดียวกับ draw()/eye()/mouth() ใน app/index.html
enum class Eye { OPEN, BIG, BLINK, HAPPY, CLOSE, UP, SLEEPY, SAD, ANGRY, HEART, STAR, CONFUSED, SMUG, DIZZY, DIZZY2 }
enum class Mouth { LINE, O, BIG, TINY, TALK0, TALK1, TALK2, YAWN, FROWN, GRR, WAVY, SMIRK }

data class FaceFrame(
    val eye: Eye,
    val mouth: Mouth,
    val dx: Int = 0,
    val cheeks: Boolean = false,
    val hearts: List<Pair<Int, Int>> = emptyList(),
    val zs: List<Triple<Int, Int, Boolean>> = emptyList(), // zZz ตอนหลับ (x, y, ตัวใหญ่)
    val bug: Triple<Int, Int, Boolean>? = null,            // แมลงบินผ่าน (x, y, ปีกกาง)
    val dream: Int = -1,                                     // >=0 = กำลังฝัน (เฟรม) → ฟองความฝัน
    val food: Triple<Int, Int, Food>? = null,                // อาหารที่กำลังป้อน (x, y)
    val bowl: Boolean = false,                               // หิว → ชามอาหารมุมขวาล่าง (แตะเพื่อให้อาหาร)
)

object Face {
    const val W = 32
    const val H = 18
    // สีตามธีมที่เลือกใน Neo.app (event "face") — ค่าเริ่มต้นมิ้นต์บนดำ
    var BG = 0xFF000000.toInt()
    var FG = 0xFF7FFFD4.toInt()
    var HT = 0xFFFF7AA8.toInt()
    var CK = 0xFFFF9A9A.toInt()
    /** ใส่ธีมจาก JSON {fg, accent, cheek, bg} ("#rrggbb") คืน true ถ้าเปลี่ยน */
    fun applyTheme(o: FaceTheme?): Boolean {
        if (o == null) return false
        fun c(v: String, d: Int) = v.let { if (Regex("#[0-9a-fA-F]{6}").matches(it)) (0xFF000000.toInt() or it.substring(1).toInt(16)) else d }
        val n = listOf(c(o.fg, FG), c(o.accent, HT), c(o.cheek, CK), c(o.bg, BG))
        val changed = n != listOf(FG, HT, CK, BG)
        FG = n[0]; HT = n[1]; CK = n[2]; BG = n[3]
        return changed
    }

    fun render(f: FaceFrame, out: IntArray = IntArray(W * H)): IntArray {
        out.fill(BG)
        val c = Canvas(out, W, H)
        eye(c, 9, f.eye, f.dx, true); eye(c, 23, f.eye, f.dx, false); mouth(c, f.mouth)
        if (f.cheeks) { c.rect(4, 11, 3, 1, CK); c.rect(25, 11, 3, 1, CK) }
        for ((x, y) in f.hearts) heart(c, x, y)
        for ((x, y, big) in f.zs) z(c, x, y, big)
        f.bug?.let { (x, y, up) -> c.px(x, y, HT); c.px(x + 1, y, HT); c.px(x, if (up) y - 1 else y + 1, CK); c.px(x + 1, if (up) y - 1 else y + 1, CK) }
        if (f.dream >= 0) dreamBubble(c, f.dream)
        f.food?.let { (x, y, k) -> sprite(c, FOOD.getValue(k), x, y) }
        if (f.bowl) { sprite(c, FOOD.getValue(Food.FISH), BOWL_X, BOWL_Y - 2); c.rect(BOWL_X - 1, BOWL_Y + 1, 7, 1, CK); c.rect(BOWL_X, BOWL_Y + 2, 5, 1, CK) }
        return out
    }

    class Canvas(val px: IntArray, val w: Int, val h: Int) {
        fun px(x: Int, y: Int, color: Int = FG) { if (x in 0 until w && y in 0 until h) px[y * w + x] = color }
        fun rect(x: Int, y: Int, rw: Int, rh: Int, color: Int = FG) {
            for (j in y until y + rh) for (i in x until x + rw) px(i, j, color)
        }
    }

    private val SPIRAL = arrayOf("######", ".....#", ".###.#", ".#.#.#", ".#...#", ".#####")
    private val HEART_EYE = arrayOf(".##.##.", "#######", "#######", ".#####.", "..###..", "...#...")

    /** left = ตาซ้ายของจอ (คิ้วเอียงสะท้อนกันซ้าย-ขวา) */
    private fun eye(c: Canvas, cx: Int, kind: Eye, dx: Int, left: Boolean) {
        val x = cx - 3 + dx; val y = 4
        // คิ้ว 6 จุด: rise = ด้านในสูงกว่า (เศร้า), ด้านในต่ำกว่า (โกรธ)
        fun brow(inner: Int, outer: Int) { for (i in 0 until 6) { val t = if (left) i else 5 - i; c.px(x + i, y + outer + (inner - outer) * t / 5) } }
        when (kind) {
            Eye.OPEN -> { c.rect(x, y, 6, 8); c.rect(x + 1, y + 1, 1, 1, BG) }
            Eye.BIG -> { c.rect(x - 1, y - 1, 8, 10); c.px(x + 1, y + 1, BG); c.px(x + 2, y + 1, BG) }
            Eye.BLINK -> c.rect(x, y + 4, 6, 1)
            Eye.HAPPY -> { c.px(x, y + 5); c.px(x + 1, y + 4); c.px(x + 2, y + 3); c.px(x + 3, y + 3); c.px(x + 4, y + 4); c.px(x + 5, y + 5) }
            Eye.CLOSE -> { c.px(x, y + 3); c.px(x + 1, y + 4); c.px(x + 2, y + 5); c.px(x + 3, y + 5); c.px(x + 4, y + 4); c.px(x + 5, y + 3) }
            Eye.UP -> { c.rect(x, y, 6, 7); c.rect(x + 2, y, 2, 2, BG) }
            Eye.SLEEPY -> { c.rect(x, y + 5, 6, 3); c.rect(x, y + 5, 6, 1) }
            Eye.SAD -> { brow(0, 2); c.rect(x, y + 4, 6, 4); c.px(if (left) x + 1 else x + 4, y + 5, BG); c.px(if (left) x + 1 else x + 4, y + 6, BG) }
            Eye.ANGRY -> { brow(2, 0); c.rect(x, y + 4, 6, 4); c.px(if (left) x + 4 else x + 1, y + 5, BG) }
            Eye.HEART -> for (j in HEART_EYE.indices) for (i in 0 until 7) if (HEART_EYE[j][i] == '#') c.px(x - 1 + i + (if (left) 0 else 1), y + 1 + j, HT)
            Eye.STAR -> { c.rect(x + 2, y, 2, 8); c.rect(x, y + 3, 6, 2); c.px(x + 1, y + 2); c.px(x + 4, y + 2); c.px(x + 1, y + 5); c.px(x + 4, y + 5) } // ประกาย ✦
            Eye.CONFUSED -> if (left) { c.rect(x - 1, y - 1, 8, 10); c.px(x + 2, y + 3, BG); c.px(x + 3, y + 3, BG) } else { c.rect(x, y + 5, 6, 1); c.px(x, y + 4); c.px(x + 5, y + 6) }
            Eye.DIZZY, Eye.DIZZY2 -> { // ตาก้นหอย (มึน) หมุน: DIZZY2 = กลับหัว 180°
                val r = kind == Eye.DIZZY2
                for (j in 0 until 6) for (i in 0 until 6) if (SPIRAL[j][i] == '#') c.px(x + (if (r) 5 - i else i), y + 1 + (if (r) 5 - j else j))
            }
            Eye.SMUG -> { c.rect(x, y + 4, 6, 4); c.rect(x, y + 4, 6, 1); c.rect(if (left) x + 3 else x + 1, y + 5, 2, 2, BG) }
        }
    }

    private fun mouth(c: Canvas, kind: Mouth) {
        val cx = 16; val y = 14
        when (kind) {
            Mouth.LINE -> { c.rect(cx - 3, y, 6, 1); c.px(cx - 4, y - 1); c.px(cx + 3, y - 1) }
            Mouth.O -> c.rect(cx - 1, y - 1, 3, 3)
            Mouth.BIG -> { c.rect(cx - 4, y - 1, 8, 1); c.rect(cx - 3, y, 6, 2) }
            Mouth.TINY -> { c.rect(cx - 2, y, 4, 1); c.px(cx - 3, y - 1); c.px(cx + 2, y - 1) }
            Mouth.TALK0 -> c.rect(cx - 3, y, 6, 1)
            Mouth.TALK1 -> c.rect(cx - 3, y - 1, 6, 3)
            Mouth.TALK2 -> c.rect(cx - 4, y - 1, 8, 4)
            Mouth.YAWN -> c.rect(cx - 2, y - 1, 4, 4)
            Mouth.FROWN -> { c.rect(cx - 2, y - 1, 4, 1); c.px(cx - 3, y); c.px(cx + 2, y); c.px(cx - 4, y + 1); c.px(cx + 3, y + 1) }
            Mouth.GRR -> { c.rect(cx - 4, y - 1, 8, 3); c.rect(cx - 3, y, 6, 1, BG); c.px(cx - 2, y, FG); c.px(cx + 1, y, FG) }
            Mouth.WAVY -> for (i in 0 until 6) c.px(cx - 2 + i, if (i % 2 == 0) y else y - 1)
            Mouth.SMIRK -> { c.rect(cx - 3, y, 5, 1); c.px(cx + 2, y - 1) }
        }
    }

    /** ตัว z (3x3) / Z (4x4) */
    private fun z(c: Canvas, x: Int, y: Int, big: Boolean) {
        val n = if (big) 4 else 3
        for (i in 0 until n) { c.px(x + i, y); c.px(x + i, y + n - 1); c.px(x + n - 1 - i, y + i) }
    }
    /** ฟองความฝันเหนือตาซ้าย (ตอนหลับตาอยู่ต่ำ แถว 0-7 ว่าง): ข้างในสลับหัวใจ/ดาว/พระจันทร์ = ความจำที่กำลังเรียง */
    private val DREAMS = arrayOf(arrayOf(".#.#.", "#####", ".###.", "..#.."), arrayOf("..#..", "#####", ".###.", ".#.#."), arrayOf("..##.", ".#...", ".#...", "..##."))
    private fun dreamBubble(c: Canvas, frame: Int) {
        c.rect(5, 0, 7, 1); c.rect(5, 6, 7, 1); c.rect(4, 1, 1, 5); c.rect(12, 1, 1, 5) // กรอบมุมมน 9x7
        c.px(13, 8); c.px(15, 9) // จุดต่อลงมาที่หัว
        val k = (frame / 12) % DREAMS.size; val g = DREAMS[k]; val col = arrayOf(HT, FG, CK)[k]
        val bob = if ((frame / 6) % 2 == 0) 0 else 1
        for (j in g.indices) for (i in 0 until 5) if (g[j][i] == '#') c.px(6 + i, 1 + j + bob, col)
    }

    // อาหาร 5x4: ตัวอักษร f = สีตา, h = สีหัวใจ, c = สีแก้ม
    private val FOOD = mapOf(
        Food.FISH to arrayOf("..ff.", ".fffh", "fffff", "..ff."),
        Food.COOKIE to arrayOf(".ccc.", "cfccc", "cccfc", ".ccc."),
        Food.MILK to arrayOf(".hh..", ".ff..", "ffff.", "ffff."),
    )
    /** ชามอาหาร (แถว 15-17 มุมขวาล่าง ยังอยู่ในจอแนวตั้ง) — FaceView ใช้ตรวจการแตะ */
    const val BOWL_X = 21; const val BOWL_Y = 15
    private fun sprite(c: Canvas, g: Array<String>, x: Int, y: Int) {
        for (j in g.indices) for (i in g[j].indices) when (g[j][i]) { 'f' -> c.px(x + i, y + j, FG); 'h' -> c.px(x + i, y + j, HT); 'c' -> c.px(x + i, y + j, CK) }
    }

    private val HEART = arrayOf(1 to 0, 3 to 0, 0 to 1, 1 to 1, 2 to 1, 3 to 1, 4 to 1, 1 to 2, 2 to 2, 3 to 2, 2 to 3)
    private fun heart(c: Canvas, x: Int, y: Int) { for ((i, j) in HEART) c.px(x + i, y + j, HT) }
}

// ไอคอนการ์ด 16x16 (อากาศตรง ICONS ใน index.html + cloudsun และไอคอนสำหรับคำตอบทั่วไปที่ Claude เลือก)
object Icons {
    val ALL: Map<String, Array<String>> = mapOf(
        "sun" to arrayOf("................", ".......#........", "...#...#...#....", "....#.....#.....", ".......##.......", "..#...####...#..", ".....######.....", ".##..######..##.", ".....######.....", "..#...####...#..", ".......##.......", "....#.....#.....", "...#...#...#....", ".......#........", "................", "................"),
        "cloudsun" to arrayOf("................", ".....#..........", "..#.....#.......", "....###.........", "...#####........", "#..#####........", "...####..###....", "..#.....####.##.", ".....#######.###", "....############", "...#############", "...#############", "....###########.", "................", "................", "................"),
        "cloud" to arrayOf("................", "................", "......###.......", ".....#####..##..", "....#######.###.", "...############.", "..##############", "..##############", "..##############", "...############.", "................", "................", "................", "................", "................", "................"),
        "rain" to arrayOf("................", "......###.......", ".....#####..##..", "....#######.###.", "...############.", "..##############", "..##############", "...############.", "................", "...#...#...#....", "..#...#...#.....", ".#...#...#......", "................", "................", "................", "................"),
        "storm" to arrayOf("................", "......###.......", ".....#####..##..", "....#######.###.", "...############.", "..##############", "...############.", ".......##.......", "......##........", ".....####.......", ".......##.......", "......##........", ".....#..........", "................", "................", "................"),
        "fog" to arrayOf("................", "................", "................", "..############..", "................", "....#########...", "................", "..############..", "................", "....#########...", "................", "..############..", "................", "................", "................", "................"),
        "search" to arrayOf("................", "....#####.......", "...#.....#......", "..#.......#.....", "..#.......#.....", "..#.......#.....", "..#.......#.....", "...#.....#......", "....#####.......", ".........##.....", "..........##....", "...........##...", "............##..", ".............#..", "................", "................"),
        "task" to arrayOf("................", "................", ".####...........", ".####.########..", ".####...........", "................", ".####...........", ".#..#.########..", ".####...........", "................", ".####...........", ".#..#.######....", ".####...........", "................", "................", "................"),
        "doc" to arrayOf("................", "...#######......", "...#.....##.....", "...#.....#.#....", "...#.....####...", "...#........#...", "...#.######.#...", "...#........#...", "...#.######.#...", "...#........#...", "...#.####...#...", "...#........#...", "...##########...", "................", "................", "................"),
        "pin" to arrayOf("................", ".....######.....", "....##....##....", "...##......##...", "...#...##...#...", "...#..####..#...", "...#...##...#...", "...##......##...", "....##....##....", ".....##..##.....", "......####......", ".......##.......", "................", "................", "................", "................"),
        "clock" to arrayOf("................", ".....######.....", "....#......#....", "...#...#....#...", "..#....#.....#..", "..#....#.....#..", "..#....#.....#..", "..#....####..#..", "..#..........#..", "..#..........#..", "...#........#...", "....#......#....", ".....######.....", "................", "................", "................"),
        "calendar" to arrayOf("................", "....#....#......", "..############..", "..############..", "..#..........#..", "..#.##.##.##.#..", "..#..........#..", "..#.##.##.##.#..", "..#..........#..", "..#.##.##....#..", "..#..........#..", "..############..", "................", "................", "................", "................"),
        "money" to arrayOf("................", ".....######.....", "....#......#....", "...#..###...#...", "..#...#..#...#..", "..#...#..#...#..", "..#...###....#..", "..#...#..#...#..", "..#...#..#...#..", "...#..###...#...", "....#......#....", ".....######.....", "................", "................", "................", "................"),
        "text" to arrayOf("................", "................", "..############..", "..#..........#..", "..#.########.#..", "..#..........#..", "..#.########.#..", "..#..........#..", "..#.#####....#..", "..#..........#..", "..############..", ".......##.......", "......##........", ".....##.........", "................", "................"),
    )

    fun forCard(c: Card): Array<String> = ALL[c.icon] ?: ALL.getValue("text")

    fun render(rows: Array<String>, out: IntArray = IntArray(16 * 16)): IntArray {
        for (y in 0 until 16) for (x in 0 until 16) out[y * 16 + x] = if (rows[y][x] == '#') Face.FG else Face.BG
        return out
    }
}

// หน้าปัดนาฬิกาตอนหลับ: HH:MM ตัวเลข pixel 4x7 กลางจอ + Neo หลับตัวจิ๋วด้านล่าง + z ลอย
// ขยับทั้งภาพทีละ pixel ทุกนาที กันจอค้างภาพ (burn-in)
object Clock {
    private val DIGITS = arrayOf(
        arrayOf("####", "#..#", "#..#", "#..#", "#..#", "#..#", "####"), arrayOf("..#.", ".##.", "..#.", "..#.", "..#.", "..#.", ".###"),
        arrayOf("####", "...#", "...#", "####", "#...", "#...", "####"), arrayOf("####", "...#", "...#", ".###", "...#", "...#", "####"),
        arrayOf("#..#", "#..#", "#..#", "####", "...#", "...#", "...#"), arrayOf("####", "#...", "#...", "####", "...#", "...#", "####"),
        arrayOf("####", "#...", "#...", "####", "#..#", "#..#", "####"), arrayOf("####", "...#", "...#", "..#.", ".#..", ".#..", ".#.."),
        arrayOf("####", "#..#", "#..#", "####", "#..#", "#..#", "####"), arrayOf("####", "#..#", "#..#", "####", "...#", "...#", "####"),
    )
    /** สีหน้าปัด: สีธีมหรี่ลงครึ่งหนึ่ง (จอหรี่อยู่แล้ว) */
    val DIM get() = mix(Face.FG, Face.BG, 0.45f)
    private fun mix(a: Int, b: Int, t: Float): Int {
        fun ch(sh: Int) = (((a shr sh) and 255) * (1 - t) + ((b shr sh) and 255) * t).toInt() shl sh
        return (0xFF shl 24) or ch(16) or ch(8) or ch(0)
    }
    private val DAY = arrayOf("อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.")
    private val MON = arrayOf("ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.")
    fun date(cal: java.util.Calendar) = "${DAY[cal.get(java.util.Calendar.DAY_OF_WEEK) - 1]} ${cal.get(java.util.Calendar.DAY_OF_MONTH)} ${MON[cal.get(java.util.Calendar.MONTH)]}"

    fun render(cal: java.util.Calendar, f: FaceFrame, out: IntArray): IntArray {
        out.fill(Face.BG)
        val c = Face.Canvas(out, Face.W, Face.H); val col = DIM
        val min = cal.get(java.util.Calendar.MINUTE); val hr = cal.get(java.util.Calendar.HOUR_OF_DAY); val sec = cal.get(java.util.Calendar.SECOND)
        val ox = min % 3 - 1; val oy = (min / 3) % 2 // ขยับกัน burn-in
        val x0 = 5 + ox; val y0 = 2 + oy
        fun digit(d: Int, x: Int) { val g = DIGITS[d]; for (j in 0 until 7) for (i in 0 until 4) if (g[j][i] == '#') c.px(x + i, y0 + j, col) }
        digit(hr / 10, x0); digit(hr % 10, x0 + 5)
        if (sec % 2 == 0) { c.px(x0 + 10, y0 + 2, col); c.px(x0 + 10, y0 + 4, col) } // โคลอนกะพริบ
        digit(min / 10, x0 + 12); digit(min % 10, x0 + 17)
        // Neo หลับจิ๋ว: ตาปิด 2 ขีด + ปากเล็ก
        val fy = 14 + oy
        c.rect(12 + ox, fy, 2, 1, col); c.rect(18 + ox, fy, 2, 1, col); c.px(15 + ox, fy + 2, col); c.px(16 + ox, fy + 2, col)
        for ((x, y, big) in f.zs) { val zx = x - 1 + ox; val zy = 13 + (y + 3) / 4 + oy; val n = if (big) 3 else 2; for (i in 0 until n) { c.px(zx + i, zy, col); c.px(zx + i, zy + n - 1, col); c.px(zx + n - 1 - i, zy + i, col) } }
        return out
    }
}
