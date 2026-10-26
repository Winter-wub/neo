package com.mochi.companion

import org.json.JSONObject
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

// ด้านที่ต้องคุยกับ Android (เสียง/เครือข่าย/ไมค์) — แยกออกเพื่อให้ Brain ทดสอบบน Mac ได้
interface Host {
    /** เล่นเสียง คืน id (0 = เล่นไม่ได้ เช่นยังโหลดไม่เสร็จ) */
    fun play(name: String, loop: Boolean, rate: Float, volume: Float): Int
    fun stop(id: Int)
    fun setVolume(id: Int, volume: Float)
    /** Neo กำลังร้อง → มือถือส่งเสียงเงียบไป Mac แทน (กันถอดเสียงตัวเอง) */
    fun setSelfSound(on: Boolean)
    /** แตะหน้า Neo → บอก Mac ให้ฟังประโยคถัดไปโดยไม่ต้องเรียกชื่อ */
    fun arm()
    /** แตะปิดนาฬิกาปลุก */
    fun alarmStop() {}
    /** เล่าความฝันให้ฟังแล้ว (Mac ไม่ต้องส่งซ้ำ) */
    fun dreamSeen() {}
    /** ความหิว/ความรักเปลี่ยน → จำไว้ในเครื่อง + บอก Mac (แสดงใน Neo.app) */
    fun petStats(hunger: Float, affection: Float) {}
    /** หลับเป็นตาย: ปิด/เปิดไมค์จริง (หยุดอัดเสียง) */
    fun setMic(on: Boolean) {}
    /** ตื่นจากหลับเป็นตาย (แตะ) → บอก Mac ยกเลิกการฝันที่รออยู่ */
    fun wokeUp() {}
}

enum class Mood { IDLE, HAPPY, STARTLE, CURIOUS, LISTEN, SLEEPY, SAD, ANGRY, LOVE, EXCITED, CONFUSED, SHY, PROUD, DIZZY;
    companion object { fun of(s: String?) = entries.firstOrNull { it.name.equals(s, true) } ?: HAPPY }
}

// สมองของ Neo: state machine เดียวกับ app/index.html (tick 10 fps), เวลาเป็นมิลลิวินาทีจากนาฬิกาเดียว
class Brain(
    private val host: Host, private val env: Envelopes, start: Long, private val rnd: Random = Random.Default,
    private val hour: () -> Int = { 12 }, // ชั่วโมงตอนนี้ (กลางคืนง่วงเร็ว)
) {
    /* ---------- อารมณ์ภายใน (เปลี่ยนช้า ๆ ตามการเล่นด้วย) ---------- */
    /** ความผูกพัน 0..1: ลูบ/คุย/ชม = เพิ่ม, ว่า = ลด, ค่อย ๆ จางเอง */
    var affection = 0.4f; private set
    private val pokes = ArrayList<Long>() // เวลาที่โดนจิ้ม (จิ้มรัวแล้วงอน)
    private var lonelyShown = false
    private fun like(d: Float) { affection = (affection + d).coerceIn(0f, 1f) }

    /* ---------- ความหิว (แบบทามาก็อตจิ ไม่มีเก็บขี้): หิวขึ้นเรื่อย ๆ ให้อาหาร = อิ่ม + รักมากขึ้น ---------- */
    /** 0 = อิ่มแปล้, 1 = หิวมาก — เพิ่ม ~0.12/ชม. (หลับครึ่งเดียว) อิ่ม→หิว (0.6) ประมาณ 5 ชม. */
    var hunger = 0.3f; private set
    val hungry get() = hunger >= HUNGRY
    private var nextHungry = 0L
    private class Meal(val food: Food, val start: Long, val good: Boolean)
    private var meal: Meal? = null
    val eating get() = meal != null
    private var lastStats = 0L
    /** โหลดจากเครื่อง: away = เวลาที่ปิดแอปไป (ms) หิวเพิ่มตามเวลาจริง */
    fun restorePet(h: Float, a: Float, away: Long) {
        affection = a.coerceIn(0.2f, 1f)
        hunger = (h + away.coerceAtLeast(0) / 3_600_000f * HUNGER_PER_HOUR * 0.6f).coerceIn(0f, 1f)
    }
    /** ให้อาหาร (เสียง/Mac/แตะชาม): หิวมาก = ดีใจมาก รักเพิ่มเยอะ; อิ่มอยู่แล้ว = ไม่เอา */
    fun feed(food: Food, now: Long): Boolean {
        if (meal != null || ringing) return false
        wake(now, quiet = true); lastTouch = now
        if (hunger < FULL) { setMood(Mood.CONFUSED, 1500, now); play(pick(Sounds.CATEGORIES.getValue("confused")), false, now); showSub("อิ่มแล้ว~ ไว้ทีหลังนะ", 2500, now); return false }
        meal = Meal(food, now, true); hideCard(); sub = ""; subUntil = 0L
        setMood(Mood.EXCITED, 700, now); play(pick(Sounds.CATEGORIES.getValue("excited")), false, now)
        return true
    }
    private fun eat(now: Long) {
        val m = meal ?: return
        val t = now - m.start
        if (t < EAT_MS) return
        meal = null
        val before = hunger
        hunger = max(0f, hunger - 0.45f)
        like(0.04f + before * 0.12f) // ยิ่งหิวยิ่งซึ้ง
        repeat(3) { hearts.add(Heart(10 + rnd.nextFloat() * 12, 3f + it * 2)) }
        say("love", if (affection > 0.6f) Mood.LOVE else Mood.HAPPY, 2200, now)
        showSub(if (hunger < 0.1f) "อิ่มแปล้เลย ขอบคุณนะ" else "อร่อย! ขอบคุณนะ", 3000, now)
        stats(now, true)
    }
    private fun stats(now: Long, force: Boolean = false) { if (force || now - lastStats > 60_000) { lastStats = now; host.petStats(hunger, affection) } }
    /* ---------- เขย่ามือถือ: สั้น ๆ = สะดุ้ง, เขย่านาน (> 2 วิ) = มึน ตาก้นหอย หน้าโยก ---------- */
    private var shakeStart = 0L; private var lastShake = 0L; private var dizzyUntil = 0L
    val dizzy get() = dizzyUntil > 0L
    /** a = แรงเขย่า (m/s² ที่เกินแรงโน้มถ่วง) จาก accelerometer ~50 ครั้ง/วิ */
    fun shake(a: Float, now: Long) {
        if (deep) return
        if (a < SHAKE_MIN) { if (shakeStart != 0L && now - lastShake > 500) shakeStart = 0L; return }
        if (asleep) { wake(now, quiet = true); say("startle", Mood.STARTLE, 900, now) }
        lastTouch = now; lastShake = now
        if (shakeStart == 0L) { shakeStart = now; if (!dizzy && meal == null && !ringing) say("startle", Mood.STARTLE, 900, now); return }
        if (now - shakeStart > DIZZY_AFTER) {
            if (!dizzy) { play(pick(Sounds.CATEGORIES.getValue("confused")), false, now); like(-0.02f); showSub("มึนนน…", 0, now) }
            dizzyUntil = now + DIZZY_MS; setMood(Mood.DIZZY, DIZZY_MS, now) // เขย่าต่อ = มึนนานขึ้น
        }
    }

    /** ผู้ใช้ถาม "หิวไหม" */
    private fun answerHunger(now: Long) {
        wake(now, quiet = true)
        when {
            hunger >= 0.85f -> { say("sad", Mood.SAD, 2500, now); showSub("หิวมาก… ขอปลาหน่อย", 4000, now) }
            hungry -> { say("curious", Mood.CURIOUS, 2000, now); showSub("หิวนิดหน่อย ขอขนมได้ไหม", 4000, now) }
            else -> { say("happy", Mood.HAPPY, 1500, now); showSub("ยังอิ่มอยู่เลย", 3000, now) }
        }
    }
    private val night get() = hour().let { it >= 22 || it < 6 }
    private class Voice(val id: Int, val name: String, val start: Long, val rate: Float, val loop: Boolean, var vol: Float)

    var mood = Mood.IDLE; private set
    private var moodUntil = 0L
    private var frame = 0
    private var blinkAt = 40; private var blinkT = 0
    private var lookX = 0; private var lookAt = 60
    var pleasure = 0f; private set
    private class Heart(val x: Float, var y: Float)
    private val hearts = ArrayList<Heart>()
    private var lastTouch = start
    private var nextIdleSound = start + 20000
    var asleep = false; private set
    /* ---------- พักหน้าจอ / ฝัน / ปลุก / เล่น ---------- */
    /** ไม่มีใครเล่นด้วยนานเท่านี้ = หลับ (ตั้งใน Neo.app → ทั่วไป); กลางคืนหลับเร็วสุด 60 วิ */
    var sleepAfterMs = 150000L
    /** หลับแล้วสักพักขึ้นหน้าปัดนาฬิกา */
    var clockOn = true
    private var sleptAt = 0L
    private class Z(var x: Float, var y: Float, val big: Boolean)
    private val zs = ArrayList<Z>()
    /** Mac กำลังให้ Neo ฝัน (จัดความจำ/ค้นเรื่องค้าง) → ฟองความฝันเหนือหัว */
    var dreaming = false; private set
    private var dreamCard: Card? = null // เล่าตอนตื่น
    var ringing = false; private set
    private var ringNext = 0L
    private var bug: Pair<Float, Float>? = null; private var bugV = 0f // แมลงบินผ่าน ตาตาม (เล่นเองตอนว่าง)
    /** สั่งให้นอน ("นีโอ ไปนอน"): หลับเป็นตาย ปิดไมค์ ไม่ตื่นเพราะเสียง/เขย่า/งานใด ๆ — แตะเท่านั้น (นาฬิกาปลุกที่ตั้งไว้ยังปลุกได้) */
    var deep = false; private set
    fun sleepNow(now: Long) {
        if (ringing) return
        hideCard(); thinking = false; meal = null; dizzyUntil = 0L; pleasure = 0f
        purr?.let { fading.add(it) }; purr = null
        play(Sounds.SLEEPY, false, now); showSub("ฝันดีนะ…", 3000, now)
        asleep = true; deep = true; sleptAt = now; bug = null
        host.setMic(false); micLevel = 0f
    }
    /** หน้าปัดนาฬิกา: หลับเกิน 12 วิ ไม่มีการ์ด ไม่ได้ทำงาน ไม่ได้ปลุก */
    fun watch(now: Long) = clockOn && asleep && !ringing && card == null && !thinking && now - sleptAt > CLOCK_DELAY

    private val playing = ArrayList<Voice>()
    private var purr: Voice? = null
    private val fading = ArrayList<Voice>()
    private var lastSelf = false
    val voices get() = playing.count { !it.loop }

    // ซับไตเติล / การ์ด / คำถาม
    var sub = ""; private set
    private var subUntil = 0L // 0 = ค้างไว้
    var card: Card? = null; private set
    private var cardUntil = 0L
    private var cardAt = 0L
    /** การ์ดแสดงมานานเท่าไร (ใช้สลับหน้า) */
    fun cardAge(now: Long) = now - cardAt
    private class Later(val at: Long, val run: () -> Unit)
    private val later = ArrayList<Later>()
    var thinking = false; private set
    private var spikeCool = 0L
    var micLevel = 0f

    private fun <T> pick(a: List<T>) = a[rnd.nextInt(a.size)]

    /* ---------- เสียง ---------- */
    private fun play(name: String, loop: Boolean, now: Long): Voice? {
        val rate = if (loop) 1f else 0.95f + rnd.nextFloat() * 0.1f // pitch ต่างกันนิดหน่อยไม่ให้ซ้ำ
        val vol = if (loop) 0f else 1f
        val id = host.play(name, loop, rate, vol)
        if (id == 0) return null
        return Voice(id, name, now, rate, loop, vol).also { playing.add(it) }
    }

    /** ระดับปาก 0..2 จากความดังของเสียงที่กำลังเล่น (envelope คำนวณล่วงหน้า) */
    fun level(now: Long): Int {
        var m = 0f
        for (v in playing) {
            var t = ((now - v.start) * v.rate).toLong()
            if (v.loop) t %= max(1L, env.durationMs(v.name))
            m = max(m, env.peak(v.name, t) * v.vol)
        }
        return if (m > 0.25f) 2 else if (m > 0.07f) 1 else 0
    }

    private fun expire(now: Long) {
        playing.removeAll { !it.loop && now - it.start >= env.durationMs(it.name) / it.rate }
    }

    private fun updatePurr(now: Long) {
        if (pleasure > 0.5f && purr == null) purr = play(Sounds.PURR, true, now)
        val p = purr
        if (pleasure < 0.12f && p != null) { purr = null; fading.add(p); setMood(if (affection > 0.6f) Mood.LOVE else Mood.HAPPY, 1800, now) }
        purr?.let { if (it.vol < 0.9f) { it.vol = min(0.9f, it.vol + 0.15f); host.setVolume(it.id, it.vol) } } // ค่อย ๆ ดังใน 0.6 วิ
        val it = fading.iterator()
        while (it.hasNext()) { // ค่อย ๆ เบาลงใน 0.4 วิ แล้วหยุด
            val f = it.next(); f.vol -= 0.225f
            if (f.vol <= 0f) { host.stop(f.id); playing.remove(f); it.remove() } else host.setVolume(f.id, f.vol)
        }
    }

    fun setMood(m: Mood, ms: Long, now: Long) { mood = m; moodUntil = now + ms }
    private fun say(cat: String, m: Mood, ms: Long, now: Long) { play(pick(Sounds.CATEGORIES.getValue(cat)), false, now); setMood(m, ms, now) }

    /* ---------- พฤติกรรม ---------- */
    fun greet(now: Long) { lastTouch = now; say("greet", Mood.HAPPY, 1500, now) }

    /** คืน true ถ้าเพิ่งตื่นจากหลับ */
    /** quiet = ตื่นเพราะได้ยินเสียง: ไม่ร้องทัก (ร้อง = ปิดไมค์ชั่วคราว จะตัดเสียงคนที่กำลังพูด) */
    fun wake(now: Long, quiet: Boolean = false, touch: Boolean = false): Boolean {
        if (deep && !touch) return false // หลับเป็นตาย: ปลุกได้ด้วยการแตะเท่านั้น
        if (deep) { deep = false; host.setMic(true); host.wokeUp() }
        lonelyShown = false
        lastTouch = now; nextIdleSound = now + 20000 + (rnd.nextFloat() * 30000).toLong()
        if (asleep) { asleep = false; zs.clear(); if (quiet) setMood(Mood.STARTLE, 800, now) else say("greet", Mood.HAPPY, 1500, now); tellDream(now); return true }
        return false
    }

    fun tick(now: Long) {
        frame++
        if (frame >= blinkAt) { blinkT = 2; blinkAt = frame + 30 + rnd.nextInt(50) }
        if (blinkT > 0) blinkT--
        if (frame >= lookAt) { lookX = rnd.nextInt(3) - 1; lookAt = frame + 40 + rnd.nextInt(60) }
        pleasure = max(0f, pleasure - 0.012f)
        if (pleasure > 0.5f && frame % 14 == 0 && hearts.size < 3) hearts.add(Heart(12 + rnd.nextFloat() * 8, 3f))
        for (h in hearts) h.y -= 0.12f
        hearts.removeAll { it.y <= -4f }
        expire(now); updatePurr(now)
        val self = voices > 0 || purr != null
        if (self != lastSelf) { lastSelf = self; host.setSelfSound(self) }
        if (pleasure > 0.5f) like(0.004f) // ลูบนาน ๆ = ผูกพัน (+0.04/วินาทีตอนเคลิ้ม)
        affection = max(0.2f, affection - 0.00002f) // จางเองช้า ๆ (~0.012/นาที)
        hunger = min(1f, hunger + HUNGER_PER_HOUR / 36000f * (if (asleep) 0.5f else 1f)) // tick = 0.1 วิ
        if (hunger >= 0.9f) affection = max(0.2f, affection - 0.00002f) // หิวจัดนาน ๆ งอนนิด ๆ
        eat(now); stats(now)
        if (dizzy && now >= dizzyUntil) { dizzyUntil = 0L; if (sub.startsWith("มึน")) { sub = ""; subUntil = 0L }; say("confused", Mood.CONFUSED, 1500, now); showSub("หัวหมุนเลย อย่าเขย่าแรงสิ", 2500, now) }
        if (hungry && !asleep && meal == null && !thinking && card == null && !ringing && now > nextHungry) { // บ่นหิวเป็นพัก ๆ
            nextHungry = now + if (hunger >= 0.85f) 60_000 else 150_000
            if (rnd.nextFloat() < 0.8f) { say("sad", Mood.SAD, 2000, now); showSub(if (hunger >= 0.85f) "หิวมากเลย…" else "หิวจัง…", 3000, now) }
        }
        if (!asleep && pleasure < 0.15f) {
            val idle = now - lastTouch
            val limit = if (night) min(60000L, sleepAfterMs) else sleepAfterMs
            if (idle > limit && !ringing && !thinking) { asleep = true; sleptAt = now; lonelyShown = false; bug = null; play(Sounds.SLEEPY, false, now) }
            else if (limit >= 120000 && idle > limit * 6 / 10 && !lonelyShown && !thinking) { lonelyShown = true; say("sad", Mood.SAD, 2500, now) } // เหงา ไม่มีใครเล่นด้วย
            else if (bug == null && !thinking && card == null && now > nextIdleSound && rnd.nextFloat() < 0.3f) { // แมลงบินผ่าน
                bugV = if (rnd.nextBoolean()) 0.35f else -0.35f; bug = (if (bugV > 0) -2f else 33f) to (2f + rnd.nextFloat() * 4)
                nextIdleSound = now + 25000 + (rnd.nextFloat() * 35000).toLong(); setMood(Mood.CURIOUS, 6000, now)
            }
            else if (now > nextIdleSound) {
                val r = rnd.nextFloat()
                when {
                    affection > 0.7f && r < 0.35f -> say("love", Mood.LOVE, 1500, now)
                    r < 0.4f -> say("curious", Mood.CURIOUS, 1400, now)
                    r < 0.75f -> say("greet", Mood.HAPPY, 1000, now)
                    else -> say("happy", if (affection > 0.6f) Mood.EXCITED else Mood.HAPPY, 1000, now)
                }
                nextIdleSound = now + 25000 + (rnd.nextFloat() * 35000).toLong()
            }
        }
        // zZz ลอยขึ้นจากหัวตอนหลับ
        if (asleep && frame % 14 == 0 && zs.size < 3) zs.add(Z(22f, 7f, zs.size % 2 == 1))
        for (z in zs) { z.y -= 0.09f; z.x += 0.05f }
        zs.removeAll { it.y < -3f }
        bug?.let { (x, y) ->
            val nx = x + bugV; val ny = y + kotlin.math.sin(frame * 0.5).toFloat() * 0.3f
            bug = if (nx < -3 || nx > 34) null else nx to ny.coerceIn(0f, 8f)
            if (bug == null && rnd.nextFloat() < 0.5f) say("excited", Mood.EXCITED, 900, now) // จับไม่ได้ ตื่นเต้น
        }
        if (ringing && now >= ringNext) { play(pick(Sounds.CATEGORIES.getValue(if (frame % 2 == 0) "excited" else "greet")), false, now); setMood(Mood.EXCITED, 1500, now); ringNext = now + 1300 }
        if (thinking) { sub = "กำลัง" + doing + ".".repeat(1 + (frame / 5) % 3); subUntil = 0L; if (now > moodUntil) setMood(Mood.CURIOUS, 1000, now) }
        if (card != null && now >= cardUntil) hideCard()
        if (subUntil != 0L && now >= subUntil) { sub = ""; subUntil = 0L }
        if (later.isNotEmpty()) { val due = later.filter { now >= it.at }; later.removeAll(due); due.forEach { it.run() } }
    }

    fun frame(now: Long): FaceFrame {
        var e = Eye.OPEN; var m = Mouth.LINE; var dx = 0
        val lv = if (voices > 0) level(now) else -1
        val talk = arrayOf(Mouth.TALK0, Mouth.TALK1, Mouth.TALK2)
        val md = if (now > moodUntil && !asleep) Mood.IDLE else mood
        val bliss = pleasure > 0.15f
        if (bliss) { e = if (pleasure > 0.5f) Eye.CLOSE else Eye.HAPPY; m = if (lv >= 0) talk[lv] else Mouth.TINY }
        else if (asleep) { e = Eye.SLEEPY; m = if ((frame shr 4) and 1 == 1) Mouth.YAWN else Mouth.TINY }
        else {
            when (md) {
                Mood.IDLE -> { dx = lookX; if (blinkT > 0) e = Eye.BLINK }
                Mood.HAPPY -> { e = Eye.HAPPY; m = Mouth.BIG }
                Mood.STARTLE, Mood.LISTEN -> { e = Eye.BIG; m = Mouth.O }
                Mood.CURIOUS -> { e = Eye.UP; bug?.let { dx = ((it.first - 16) / 10).toInt().coerceIn(-1, 1) } }
                Mood.SLEEPY -> { e = Eye.SLEEPY; m = Mouth.TINY }
                Mood.SAD -> { e = Eye.SAD; m = Mouth.FROWN }
                Mood.ANGRY -> { e = Eye.ANGRY; m = Mouth.GRR }
                Mood.LOVE -> { e = Eye.HEART; m = Mouth.LINE }
                Mood.EXCITED -> { e = Eye.STAR; m = Mouth.BIG }
                Mood.CONFUSED -> { e = Eye.CONFUSED; m = Mouth.WAVY }
                Mood.SHY -> { e = Eye.HAPPY; m = Mouth.TINY; dx = -1 }
                Mood.PROUD -> { e = Eye.SMUG; m = Mouth.SMIRK }
                Mood.DIZZY -> { e = if ((frame / 3) % 2 == 0) Eye.DIZZY else Eye.DIZZY2; m = Mouth.WAVY; dx = if ((frame / 2) % 2 == 0) -1 else 1 } // ตาหมุน หน้าโยก
            }
            if (lv >= 0) m = talk[lv]
        }
        val blush = (bliss && pleasure > 0.5f) || (!bliss && !asleep && (md == Mood.SHY || md == Mood.LOVE))
        if (asleep && dreaming && (frame / 3) % 2 == 0) e = Eye.BLINK // ตากระตุกตอนฝัน (REM)
        var food: Triple<Int, Int, Food>? = null
        meal?.let { ml ->
            val t = now - ml.start
            if (t < 600) food = Triple(16 - 2, (2 + t * 10 / 600).toInt(), ml.food) // อาหารตกลงมาที่ปาก
            e = Eye.HAPPY; m = if ((frame / 2) % 2 == 0) Mouth.O else Mouth.TINY // ง่ำ ๆ
        }
        return FaceFrame(e, m, dx, blush, hearts.map { it.x.toInt() to it.y.toInt() },
            zs = if (asleep) zs.map { Triple(it.x.toInt(), it.y.toInt(), it.big) } else emptyList(),
            bug = bug?.let { Triple(it.first.toInt(), it.second.toInt(), frame % 4 < 2) },
            dream = if (asleep && dreaming) frame else -1,
            food = food, bowl = hungry && meal == null && !asleep)
    }

    fun debug(now: Long) = "mood:${if (now > moodUntil && !asleep) Mood.IDLE else mood} asleep:$asleep pleasure:${"%.2f".format(pleasure)} " +
        "voices:$voices purr:${purr != null} mic:${"%.3f".format(micLevel)} thinking:$thinking dream:$dreaming ring:$ringing"

    /* ---------- สัมผัส (หน่วย dp เพื่อให้เกณฑ์เท่ากับ CSS px ของเว็บ) ---------- */
    private class Pt(val x: Float, val y: Float, val t: Long)
    private var last: Pt? = null
    private var startPt: Pt? = null
    private var moved = 0f

    fun down(x: Float, y: Float, t: Long) {
        last = Pt(x, y, t); startPt = last; moved = 0f
        if (wake(t, touch = true)) startPt = null // ปลุกอยู่ ไม่นับเป็นแตะ
    }

    fun move(x: Float, y: Float, t: Long) {
        val l = last ?: return
        val dt = ((t - l.t) / 1000f).let { if (it <= 0f) 0.016f else it }
        val d = hypot(x - l.x, y - l.y); val v = d / dt
        moved += d
        if (v > 20 && v < 500 && moved > 12) { pleasure = min(1f, pleasure + d / 600); lastTouch = t; asleep = false } // ลากช้า = ลูบ
        last = Pt(x, y, t)
    }

    fun up(t: Long) {
        val s = startPt
        val tap = s != null && moved < 12 && t - s.t < 350
        if (ringing && (tap || s == null)) { stopRing(t); host.alarmStop(); last = null; startPt = null; return }
        if (tap && card != null) hideCard()
        else if (tap && pleasure < 0.15f) {
            pokes.add(t); pokes.removeAll { t - it > 3000 }
            if (pokes.size >= 4) { pokes.clear(); like(-0.05f); say("angry", Mood.ANGRY, 2500, t); last = null; startPt = null; return } // จิ้มรัว = งอน
            if (rnd.nextFloat() < 0.5f) say("startle", Mood.STARTLE, 700, t) else say("greet", Mood.HAPPY, 1000, t) // แตะเร็ว = สะดุ้ง/ทัก
            if (!thinking) { host.arm(); listening(t) } // แตะแทนการเรียกชื่อ
        }
        last = null; startPt = null
    }

    fun cancelTouch() { last = null; startPt = null }

    /* ---------- ซับ / การ์ด ---------- */
    fun showSub(t: String, ms: Long, now: Long) { sub = t; subUntil = if (ms > 0) now + ms else 0L }

    fun hideCard() { card = null; cardUntil = 0L }

    fun showCard(c: Card, now: Long) {
        hideCard()
        card = c; lastTouch = now; cardAt = now
        cardUntil = now + min(90, if (c.seconds > 0) c.seconds else 15) * 1000L
        val cats = c.sounds.ifEmpty { listOf("greet") }.take(3)
        cats.forEachIndexed { i, cat -> // ร้องเบา ๆ เหมือนอ่านให้ฟัง
            later.add(Later(now + i * 1100L) {
                val list = Sounds.CATEGORIES[cat]
                if (card === c && list != null) { play(pick(list), false, now + i * 1100L); setMood(Mood.of(c.emotion), 1200, now + i * 1100L) }
            })
        }
    }

    /* ---------- event จาก Mac (ตัดช่วงพูด/ถอดเสียง/ตัดสินใจทำบน Mac ทั้งหมด ดู app/voice.js) ---------- */
    /** รับ JSON ดิบ (เช่นจากเทสต์) ผ่านชั้นโปรโตคอล */
    fun onServer(ev: JSONObject, now: Long) = onServer(ServerEvent.fromJson(ev), now)

    fun onServer(ev: ServerEvent, now: Long) {
        if (deep && ev.type !in DEEP_OK) return // หลับเป็นตาย: ไม่สนอะไรนอกจากปลุก/ฝัน/ตั้งค่า
        when (ev) {
            is ServerEvent.Sleep -> sleepNow(now)
            is ServerEvent.Hello -> { thinking = ev.thinking; if (!thinking) clearToolArt(); if (sub == OFFLINE) sub = ""; ev.idle?.let { idle(it) } }
            is ServerEvent.Idle -> idle(ev.idle)
            is ServerEvent.Alarm -> {
                if (deep) { deep = false; host.setMic(true); host.wokeUp() } // นาฬิกาปลุกที่ผู้ใช้ตั้งเองปลุกได้
                wake(now); ringing = true; ringNext = now
                ev.card?.let { showCard(it, now) }
                cardUntil = now + 125000 // ปลุกค้างได้ 2 นาที
            }
            is ServerEvent.AlarmOff -> { if (ringing) { stopRing(now); if (ev.snooze > 0) showSub("อีก ${ev.snooze} นาทีปลุกใหม่นะ", 4000, now) } }
            is ServerEvent.Dreaming -> dreaming = true
            is ServerEvent.Job -> { wake(now); say("excited", Mood.EXCITED, 1500, now); showSub("ถึงเวลา: ${ev.title}", 4000, now) } // งานตั้งเวลา: ร้องเรียกก่อนไปทำ
            is ServerEvent.Feed -> feed(Food.of(ev.food), now)
            is ServerEvent.PetAsk -> answerHunger(now)
            is ServerEvent.DreamDone -> dreamEnded(ev.card, now)
            is ServerEvent.DreamFail -> dreamEnded(null, now) // dream_fail ไม่มีการ์ด (protocol.ts: มีแค่ error)
            is ServerEvent.Short -> if (!thinking && subUntil == 0L && sub == "ได้ยินเสียง…") sub = ""
            is ServerEvent.Stt -> if (!thinking) { showSub("กำลังฟัง…", 0, now); setMood(Mood.CURIOUS, 8000, now) }
            is ServerEvent.Rec -> if (!thinking) { wake(now, quiet = true) // ได้ยินเสียงพูด = ตื่น (เลิกหน้าปัดนาฬิกา)
                 if (sub != LISTENING) showSub("ได้ยินเสียง…", 0, now); setMood(Mood.LISTEN, if (sub == LISTENING) 30000 else 600, now) }
            is ServerEvent.Nothing -> if (!thinking) { moodUntil = 0; showSub("(ไม่ได้ยินเป็นคำพูด)", 2500, now) }
            is ServerEvent.Stterr -> if (!thinking) { moodUntil = 0; showSub("ถอดเสียงไม่สำเร็จ", 2500, now) }
            is ServerEvent.Heard -> { wake(now, quiet = true); moodUntil = 0; showSub("\u201c${ev.text}\u201d", 6000, now); feel(ev.text, now) }
            is ServerEvent.Armed -> { wake(now); listening(now); play(pick(Sounds.CATEGORIES.getValue("greet")), false, now) } // เรียกชื่อ → ร้องตอบ แล้วรอคำสั่ง (เงียบ 3 วิ = จบ)
            is ServerEvent.ListenEnd -> if (sub == LISTENING) { sub = ""; subUntil = 0L; moodUntil = 0 } // ไม่ได้พูดอะไร เลิกรอ
            is ServerEvent.Thinking -> { thinking = true; doing = "ค้นหา"; clearToolArt(); hideCard(); wake(now); setMood(Mood.CURIOUS, 20000, now) }
            is ServerEvent.Tool -> if (thinking) { doing = toolLabel(ev.name); toolKey = ev.key.ifEmpty { ev.name }; setToolArt(ev.animation, now) }
            is ServerEvent.CardShown -> {
                thinking = false; sub = ""; subUntil = 0L; clearToolArt()
                val c = ev.card
                if (c != null) showCard(c, now) else say("curious", Mood.CURIOUS, 1200, now)
            }
            is ServerEvent.Askerr -> { thinking = false; clearToolArt(); sub = ""; subUntil = 0L; say("confused", Mood.CONFUSED, 2000, now) } // ทำไม่ได้ = งง
            is ServerEvent.Cancelled -> { thinking = false; clearToolArt(); showSub("ยกเลิกแล้ว", 2500, now); say("sad", Mood.SAD, 1500, now) } // อ้าว ไม่เอาแล้วเหรอ
            is ServerEvent.Loud -> if (now > spikeCool) { wake(now); say("startle", Mood.STARTLE, 900, now); spikeCool = now + 3000 }
            is ServerEvent.Ping, is ServerEvent.Face, is ServerEvent.Unknown -> {}
            // event สำหรับหน้าตั้งค่า Neo (ดู NeoSettingsModel) — Brain ไม่ต้องทำอะไร
            is ServerEvent.SettingsChanged, is ServerEvent.ProviderChanged, is ServerEvent.ModelChanged, is ServerEvent.WakeChanged, is ServerEvent.Training,
            is ServerEvent.DevicesChanged, is ServerEvent.JobsChanged, is ServerEvent.JobsWarning, is ServerEvent.FileChanged -> {}
            // ท่าที่ Neo เพิ่งวาดเสร็จระหว่างที่เครื่องมือนั้นยังทำงานอยู่ → เริ่มเล่นเลย (ไม่ต้องรอถามรอบหน้า)
            is ServerEvent.AnimationChanged -> if (thinking && ev.tool == toolKey) setToolArt(ev.animation, now)
        }
    }

    private fun dreamEnded(c: Card?, now: Long) {
        dreaming = false
        if (c != null) { dreamCard = c; if (!asleep) tellDream(now) }
    }

    private fun idle(o: IdleSettings) {
        sleepAfterMs = (o.sleepAfter ?: (sleepAfterMs / 1000)).coerceIn(15, 3600) * 1000
        clockOn = o.clock ?: clockOn
    }

    private fun stopRing(now: Long) { ringing = false; hideCard(); moodUntil = 0; lastTouch = now }
    /** ตื่นแล้วเล่าความฝัน (หลังทัก 1.5 วิ) */
    private fun tellDream(now: Long) {
        val c = dreamCard ?: return; dreamCard = null
        later.add(Later(now + 1500) { if (card == null && !thinking) { showCard(c, now + 1500); host.dreamSeen() } else dreamCard = c })
    }

    private var doing = "ค้นหา"

    /* ---------- ท่าเครื่องมือ (ticket 28): หน้าคิดอยู่ + ภาพวนใต้หน้า แทนข้อความ ---------- */
    private var toolKey = ""
    private var toolAt = 0L
    var toolArt: PixelArt? = null; private set
    private fun setToolArt(a: NeoToolAnimation?, now: Long) { toolArt = a?.let { PixelArt.from(it) }; toolAt = now }
    private fun clearToolArt() { toolArt = null; toolKey = "" }
    /** เฟรมที่กำลังเล่น (วนตาม fps) */
    fun toolFrame(now: Long): Int { val a = toolArt ?: return 0; return (((now - toolAt) * a.fps / 1000) % a.frames.size).toInt() }
    /** ชื่อเครื่องมือของ Claude → คำที่คนอ่านเข้าใจ (ซับระหว่างทำงาน) */
    private fun toolLabel(n: String) = when {
        n == "Bash" -> "รันคำสั่ง"
        n == "Skill" -> "อ่านวิธีใช้ skill"
        n.contains("browser", true) -> "เปิดเบราว์เซอร์"
        n.contains("jira", true) -> "ดู Jira"
        n.contains("confluence", true) -> "อ่าน Confluence"
        n.contains("orca", true) -> "ดู agent ใน Orca"
        n.contains("search", true) || n.contains("tavily", true) || n == "WebFetch" -> "ค้นเว็บ"
        n == "Read" || n == "Grep" || n == "Glob" -> "อ่านไฟล์"
        n == "Write" || n == "Edit" -> "เขียนไฟล์"
        else -> "ทำงาน"
    }

    /** รอคำสั่ง: หน้าตั้งใจฟังค้างไว้ + ซับ จนเริ่มถอดเสียง/หมดเวลา (Mac ส่ง listen_end) */
    private fun listening(now: Long) { showSub(LISTENING, 0, now); setMood(Mood.LISTEN, 30000, now) }

    /** อารมณ์จากคำพูดของผู้ใช้: ชม = เขิน/ภูมิใจ, ว่า = เศร้า, คุยด้วย = ผูกพันขึ้นนิด */
    private fun feel(t: String, now: Long) {
        like(0.01f)
        when {
            NEG.containsMatchIn(t) -> { like(-0.15f); say("sad", Mood.SAD, 2500, now) }
            SMART.containsMatchIn(t) -> { like(0.08f); say("happy", Mood.PROUD, 2200, now) }
            CUTE.containsMatchIn(t) -> { like(0.1f); say("love", if (affection > 0.7f) Mood.LOVE else Mood.SHY, 2200, now) }
        }
    }

    /** ปัญหาฝั่งมือถือ: denied/error = ไมค์, offline = ต่อ Mac ไม่ได้ */
    fun micState(s: String, now: Long) {
        when (s) {
            "denied" -> showSub("ไม่ได้รับสิทธิ์ไมค์", 6000, now)
            "error" -> showSub("เปิดไมค์ไม่ได้", 6000, now)
            "offline" -> { clearToolArt(); if (thinking) { thinking = false; moodUntil = 0 }; showSub(OFFLINE, 4000, now) }
        }
    }

    companion object {
        const val OFFLINE = "ติดต่อ Mac ไม่ได้"
        const val LISTENING = "ฟังอยู่… พูดได้เลย"
        const val CLOCK_DELAY = 12000L
        private val DEEP_OK = setOf("alarm", "dreaming", "dream_done", "dream_fail", "idle", "hello", "face")
        const val HUNGER_PER_HOUR = 0.12f
        const val HUNGRY = 0.6f
        const val FULL = 0.15f // ต่ำกว่านี้ = อิ่ม ไม่กิน
        const val EAT_MS = 2200L
        const val SHAKE_MIN = 6f      // m/s² เกินแรงโน้มถ่วง = กำลังเขย่า
        const val DIZZY_AFTER = 2000L // เขย่าต่อเนื่องนานเท่านี้ = มึน
        const val DIZZY_MS = 4000L    // มึนค้างหลังหยุดเขย่า
        private val CUTE = Regex("น่ารัก|รักนะ|รักเธอ|ชอบเธอ|คิดถึง|ขอบคุณ|ขอบใจ|cute|love you")
        private val SMART = Regex("เก่ง|ฉลาด|เยี่ยม|สุดยอด|ดีมาก|good job")
        private val NEG = Regex("โง่|แย่|เกลียด|น่ารำคาญ|ไม่ได้เรื่อง|ห่วย|เงียบไป|หุบปาก")
    }
}

/** อาหารของ Neo — รูป pixel 5x4 ใน Face.kt */
enum class Food { FISH, COOKIE, MILK;
    companion object { fun of(s: String?) = entries.firstOrNull { it.name.equals(s, true) } ?: FISH }
}
