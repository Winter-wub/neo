package com.mochi.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import org.json.JSONObject
import kotlin.random.Random

class FakeHost : Host {
    data class Played(val id: Int, val name: String, val loop: Boolean)
    val played = ArrayList<Played>()
    val stopped = ArrayList<Int>()
    val volumes = HashMap<Int, Float>()
    var arms = 0
    val self = ArrayList<Boolean>()
    private var next = 1
    override fun play(name: String, loop: Boolean, rate: Float, volume: Float): Int { val id = next++; played.add(Played(id, name, loop)); volumes[id] = volume; return id }
    override fun stop(id: Int) { stopped.add(id) }
    override fun setVolume(id: Int, volume: Float) { volumes[id] = volume }
    override fun setSelfSound(on: Boolean) { self.add(on) }
    override fun arm() { arms++ }
    var alarmStops = 0; var dreamSeen = 0
    override fun alarmStop() { alarmStops++ }
    override fun dreamSeen() { dreamSeen++ }
    var stats = 0; val mic = ArrayList<Boolean>(); var woke = 0
    override fun setMic(on: Boolean) { mic.add(on) }
    override fun wokeUp() { woke++ }
    override fun petStats(hunger: Float, affection: Float) { stats++ }
}

private val ENV = Envelopes.parse(File("src/main/assets/envelopes.json").readText())

class EnvelopeTest {
    @Test fun allSoundsHaveEnvelopes() {
        for (n in Sounds.NAMES) { assertTrue(n, ENV.has(n)); assertTrue(n, ENV.durationMs(n) in 200..3000) }
        for ((_, list) in Sounds.CATEGORIES) for (n in list) assertTrue(n, n in Sounds.NAMES)
        for (n in Sounds.NAMES) assertTrue("missing asset $n", File("src/main/assets/sounds/$n.mp3").isFile)
    }
    @Test fun peakOutOfRangeIsZero() { assertEquals(0f, ENV.peak("cat_purr_long", 999_999), 0f); assertEquals(0f, ENV.peak("nope", 0), 0f) }
}

class FaceTest {
    private fun at(px: IntArray, x: Int, y: Int) = px[y * Face.W + x]

    @Test fun idleFaceMatchesWebLayout() {
        val px = Face.render(FaceFrame(Eye.OPEN, Mouth.LINE))
        // ตาซ้าย rect(6,4,6,8) มีจุดสะท้อนดำที่ (7,5); ตาขวาเริ่ม x=20
        assertEquals(Face.FG, at(px, 6, 4)); assertEquals(Face.FG, at(px, 11, 11)); assertEquals(Face.BG, at(px, 7, 5))
        assertEquals(Face.BG, at(px, 12, 4)); assertEquals(Face.FG, at(px, 20, 4)); assertEquals(Face.FG, at(px, 25, 11))
        // ปาก line: rect(13,14,6,1) + มุม (12,13),(19,13)
        for (x in 13..18) assertEquals(Face.FG, at(px, x, 14))
        assertEquals(Face.FG, at(px, 12, 13)); assertEquals(Face.FG, at(px, 19, 13))
        assertEquals(8 * 6 * 2 - 2 + 8, px.count { it == Face.FG })
    }

    @Test fun everyStateDrawsWithinGrid() {
        for (e in Eye.entries) for (m in Mouth.entries) for (dx in -1..1) {
            val px = Face.render(FaceFrame(e, m, dx, cheeks = true, hearts = listOf(12 to 3, 19 to -3, 30 to 16)))
            assertTrue(px.count { it != Face.BG } > 0)
        }
        val bliss = Face.render(FaceFrame(Eye.CLOSE, Mouth.TINY, cheeks = true))
        assertEquals(Face.CK, at(bliss, 4, 11)); assertEquals(Face.CK, at(bliss, 27, 11))
    }

    @Test fun iconsAre16x16() {
        for ((k, rows) in Icons.ALL) { assertEquals(k, 16, rows.size); for (r in rows) assertEquals(k, 16, r.length) }
        val c = Card("weather", "rain", "28°C", listOf(), "happy", listOf(), 15)
        assertTrue(Icons.forCard(c) === Icons.ALL["rain"])
        assertTrue(Icons.forCard(c.copy(icon = "unknown")) === Icons.ALL["text"])
        assertTrue(Icons.forCard(c.copy(kind = "text", icon = "task")) === Icons.ALL["task"]) // การ์ดทั่วไปเลือกไอคอนได้
        assertTrue(Icons.forCard(c.copy(kind = "text", icon = "")) === Icons.ALL["text"])
    }
}

class SpeechTest {
    @Test fun cleanStripsEmoji() {
        assertEquals("สวัสดี", Speech.clean("สวัสดี 😺"))
        assertEquals("ร้อน", Speech.clean("☀️ร้อน"))
        assertEquals("", Speech.clean(null))
    }

    @Test fun parseServerCards() {
        val w = Card.parse("""{"kind":"weather","icon":"cloudsun","title":"31°C","lines":["กรุงเทพฯ · มีเมฆบางส่วน","b","c","d"],"emotion":"happy","sounds":["greet","happy"],"seconds":15}""")
        assertEquals("weather", w.kind); assertEquals("31°C", w.title); assertEquals(4, w.lines.size); assertEquals(listOf("greet", "happy"), w.sounds)
        val t = Card.parse("""{"kind":"text","title":"ไม่รู้ 🤔","lines":["ข่าววันนี้ไม่รู้"],"emotion":"curious"}""")
        assertEquals("ไม่รู้", t.title); assertEquals(15, t.seconds); assertTrue(t.sounds.isEmpty())
        assertEquals(Mood.CURIOUS, Mood.of(t.emotion)); assertEquals(Mood.HAPPY, Mood.of("weird"))
        assertEquals("text", t.layout)
        val l = Card.parse("""{"layout":"list","icon":"task","title":"งานของฉัน","items":[{"t":"CPN-12 แก้แผนที่","v":"In Progress"},{"t":"CPN-15 โลโก้ 😺","v":"To Do"}],"seconds":40}""")
        assertEquals("list", l.layout); assertEquals(listOf("CPN-12 แก้แผนที่" to "In Progress", "CPN-15 โลโก้" to "To Do"), l.items)
        val b = Card.parse("""{"layout":"big","icon":"money","title":"USD → THB","big":"36.42","lines":["ธปท. 24 ต.ค."]}""")
        assertEquals("big", b.layout); assertEquals("36.42", b.big)
        assertEquals("text", Card.parse("""{"layout":"weird","lines":[]}""").layout)
        assertEquals(14, Card.parse("""{"lines":[${(1..20).joinToString(",") { "\"$it\"" }}]}""").lines.size)
    }
}

class BrainTest {
    private val host = FakeHost()
    private var t = 1_000_000L
    private val brain = Brain(host, ENV, t, Random(42))
    private fun run(ms: Long) { val end = t + ms; while (t < end) { t += 100; brain.tick(t) } }

    /** ลากไปมาที่ความเร็ว v dp/s เป็นเวลา ms */
    private fun stroke(ms: Long, v: Float) {
        var x = 100f; var dir = 1f
        brain.down(x, 100f, t)
        val end = t + ms
        while (t < end) {
            t += 16; x += dir * v * 0.016f; if (x > 300 || x < 100) dir = -dir
            brain.move(x, 100f, t)
            if (t % 100 < 16) brain.tick(t)
        }
        brain.up(t)
    }

    @Test fun slowStrokeGivesBlissPurrAndHearts() {
        stroke(1500, 150f) // ลูบช้า 1.5 วิ: ยังไม่หลับตา (เหมือนเว็บ ต้องลูบ ~4 วิที่ความเร็วนี้)
        assertTrue(brain.pleasure in 0.15f..0.5f); assertEquals(Eye.HAPPY, brain.frame(t).eye)
        stroke(2500, 300f)
        assertTrue(brain.pleasure > 0.5f)
        val f = brain.frame(t)
        assertEquals(Eye.CLOSE, f.eye); assertTrue(f.cheeks)
        val purr = host.played.single { it.loop }
        assertEquals(Sounds.PURR, purr.name)
        assertEquals(0.9f, host.volumes[purr.id]!!, 0.001f) // ค่อย ๆ ดังขึ้นจนถึง 0.9
        run(1500)
        assertTrue(brain.frame(t).hearts.isNotEmpty() || brain.pleasure < 0.5f)
        run(9000) // หยุดลูบ → ระดับเคลิ้มลดเอง → ครางเบาลงแล้วหยุด
        assertTrue(brain.pleasure < 0.12f)
        assertTrue(purr.id in host.stopped)
        assertTrue(brain.frame(t).eye != Eye.CLOSE)
    }

    @Test fun fastFlickIsNotStroke() {
        stroke(1500, 2000f)
        assertEquals(0f, brain.pleasure, 0.0001f)
        assertTrue(host.played.none { it.loop })
    }

    @Test fun quickTapStartlesOrGreets() {
        brain.down(50f, 50f, t); t += 120; brain.up(t)
        val p = host.played.single()
        assertTrue(p.name in Sounds.CATEGORIES["startle"]!! + Sounds.CATEGORIES["greet"]!!)
        assertTrue(brain.frame(t).mood().let { it == Eye.BIG || it == Eye.HAPPY })
        assertEquals(listOf(true), host.self.also { run(100) }) // กำลังร้อง → บอกไมค์ให้หยุดฟัง
        run(1500)
        assertEquals(listOf(true, false), host.self)
    }

    @Test fun mouthFollowsSoundEnvelope() {
        brain.down(50f, 50f, t); t += 100; brain.up(t)
        val levels = (0 until 3).map { brain.frame(t + it * 40L).mouth }
        assertTrue(levels.all { it == Mouth.TALK0 || it == Mouth.TALK1 || it == Mouth.TALK2 })
        assertTrue(levels.any { it != Mouth.TALK0 })
        run(3000)
        assertNotEquals(Mouth.TALK2, brain.frame(t).mouth)
    }

    @Test fun fallsAsleepThenWakesOnTouch() {
        run(151_000)
        assertTrue(brain.asleep)
        assertTrue(host.played.any { it.name == Sounds.SLEEPY })
        assertEquals(Eye.SLEEPY, brain.frame(t).eye)
        val before = host.played.size
        brain.down(10f, 10f, t); t += 100; brain.up(t)
        assertFalse(brain.asleep)
        assertEquals(before + 1, host.played.size) // ทักตอนตื่นครั้งเดียว ไม่นับเป็นแตะ
    }

    @Test fun idleChirpsByItself() {
        run(19_000); assertTrue(host.played.isEmpty())
        run(52_000); assertTrue(host.played.isNotEmpty())
        assertFalse(brain.asleep)
    }

    private fun ev(type: String, vararg kv: Pair<String, Any>) = brain.onServer(JSONObject().put("type", type).also { o -> kv.forEach { o.put(it.first, it.second) } }, t)
    private fun cardJson(title: String, lines: Int = 3, sounds: List<String> = listOf("greet", "happy"), seconds: Int = 15) =
        JSONObject().put("kind", "text").put("title", title).put("lines", org.json.JSONArray(List(lines) { "บรรทัด $it" }))
            .put("emotion", "happy").put("sounds", org.json.JSONArray(sounds)).put("seconds", seconds)

    @Test fun serverFlowHeardThinkingCardExpires() {
        ev("rec"); assertEquals("ได้ยินเสียง…", brain.sub); assertEquals(Eye.BIG, brain.frame(t).eye)
        ev("stt"); assertEquals("กำลังฟัง…", brain.sub)
        ev("heard", "text" to "นี่โอ อากาศเป็นไง"); assertEquals("“นี่โอ อากาศเป็นไง”", brain.sub)
        ev("thinking", "text" to "อากาศเป็นไง")
        run(500); assertTrue(brain.thinking); assertTrue(brain.sub.startsWith("กำลังค้นหา")); assertEquals(Eye.UP, brain.frame(t).eye)
        ev("tool", "name" to "mcp__neo-agents__browser_search"); run(200); assertTrue(brain.sub, brain.sub.startsWith("กำลังเปิดเบราว์เซอร์"))
        ev("tool", "name" to "Bash"); run(200); assertTrue(brain.sub.startsWith("กำลังรันคำสั่ง"))
        ev("card", "card" to cardJson("33°C"))
        assertEquals("33°C", brain.card!!.title); assertFalse(brain.thinking); assertEquals("", brain.sub)
        val n = host.played.size
        run(2500); assertEquals(n + 2, host.played.size) // ร้อง 2 ครั้งตาม sounds
        run(12_000); assertNotNull(brain.card)
        run(1000); assertNull(brain.card) // การ์ดหาย 15 วิ
    }

    @Test fun shortOrEmptySpeechClearsListening() {
        ev("rec"); ev("short"); assertEquals("", brain.sub)
        ev("rec"); ev("stt"); ev("nothing"); assertEquals("(ไม่ได้ยินเป็นคำพูด)", brain.sub)
    }

    @Test fun tapClosesCardAndNewThinkingReplaces() {
        ev("thinking"); ev("card", "card" to cardJson("1"))
        ev("thinking"); assertNull(brain.card) // คำถามใหม่ล้างการ์ดเดิม
        ev("card", "card" to cardJson("2", sounds = listOf()))
        val n = host.played.size
        brain.down(5f, 5f, t); t += 100; brain.up(t)
        assertNull(brain.card); assertEquals(n, host.played.size); assertEquals(0, host.arms) // แตะปิดการ์ด ไม่ร้อง ไม่ฟัง
    }

    @Test fun cancelledAndErrors() {
        ev("thinking"); run(20_000); assertTrue(brain.thinking) // ค้นนานได้
        ev("cancelled"); assertFalse(brain.thinking); assertEquals("ยกเลิกแล้ว", brain.sub)
        ev("thinking"); ev("askerr"); assertFalse(brain.thinking); assertEquals(Eye.CONFUSED, brain.frame(t).eye) // ทำไม่ได้ = งง
        ev("thinking"); brain.micState("offline", t); assertFalse(brain.thinking); assertEquals(Brain.OFFLINE, brain.sub)
        ev("hello", "thinking" to false); assertEquals("", brain.sub)
    }

    @Test fun longInfoCardStaysLonger() {
        ev("thinking"); ev("card", "card" to cardJson("เชียงใหม่ 3 วัน", lines = 7, seconds = 60))
        assertEquals(7, brain.card!!.lines.size)
        run(59_000); assertNotNull(brain.card)
        run(1_500); assertNull(brain.card)
    }

    @Test fun tapArmsListeningExceptWhileSearching() {
        brain.down(5f, 5f, t); t += 100; brain.up(t)
        assertEquals(1, host.arms); assertEquals(Brain.LISTENING, brain.sub)
        run(10_000); assertEquals(Brain.LISTENING, brain.sub); assertEquals(Eye.BIG, brain.frame(t).eye) // ยังรอคำสั่งอยู่
        ev("listen_end"); assertEquals("", brain.sub)
        ev("thinking"); t += 1000
        brain.down(5f, 5f, t); t += 100; brain.up(t)
        assertEquals(1, host.arms)
    }

    @Test fun nameOnlyAndLoud() {
        ev("armed"); assertEquals(1, host.played.size); assertEquals(Eye.BIG, brain.frame(t).eye); assertEquals(Brain.LISTENING, brain.sub)
        ev("rec"); assertEquals(Brain.LISTENING, brain.sub) // กำลังพูดคำสั่ง ซับยังบอกว่าฟังอยู่
        ev("stt"); assertEquals("กำลังฟัง…", brain.sub)
        ev("loud"); t += 500; ev("loud")
        assertEquals(2, host.played.size) // สะดุ้งครั้งเดียวใน 3 วิ
    }

    @Test fun pokingTooMuchMakesNeoAngry() {
        repeat(3) { brain.down(5f, 5f, t); t += 100; brain.up(t); t += 400 }
        assertTrue(brain.frame(t).eye != Eye.ANGRY)
        brain.down(5f, 5f, t); t += 100; brain.up(t)
        assertEquals(Eye.ANGRY, brain.frame(t).eye)
        run(1200); assertEquals(Mouth.GRR, brain.frame(t).mouth) // เห่าจบแล้ว ปากยังงอน
    }

    @Test fun complimentsAndInsultsChangeMood() {
        val a0 = brain.affection
        ev("heard", "text" to "นีโอน่ารักจัง"); assertEquals(Eye.HAPPY, brain.frame(t).eye); assertTrue(brain.frame(t).cheeks) // เขิน
        assertTrue(brain.affection > a0)
        t += 3000; ev("heard", "text" to "เก่งมากเลย"); assertEquals(Eye.SMUG, brain.frame(t).eye) // ภูมิใจ
        t += 3000; val a1 = brain.affection; ev("heard", "text" to "โง่จริง"); assertEquals(Eye.SAD, brain.frame(t).eye)
        assertTrue(brain.affection < a1)
    }

    @Test fun lonelyThenSleepsSoonerAtNight() {
        run(91_000); assertEquals(Eye.SAD, brain.frame(t).eye) // เหงา
        run(60_000); assertTrue(brain.asleep)
        val night = Brain(host, ENV, t, Random(1), hour = { 23 }); var u = t
        repeat(610) { u += 100; night.tick(u) }
        assertTrue(night.asleep) // กลางคืนหลับใน 1 นาที
    }

    @Test fun longPettingBuildsAffectionAndLove() {
        stroke(8000, 300f)
        assertTrue(brain.affection > 0.6f)
        run(9000) // หยุดลูบ → ครางหยุด → ตาหัวใจ
        assertTrue(brain.pleasure < 0.12f)
    }

    @Test fun answerEmotionAndErrors() {
        ev("thinking"); ev("card", "card" to cardJson("ข่าวดี").put("emotion", "excited").put("sounds", org.json.JSONArray(listOf("excited"))))
        run(200); assertEquals(Eye.STAR, brain.frame(t).eye)
        ev("thinking"); ev("askerr"); assertEquals(Eye.CONFUSED, brain.frame(t).eye)
        run(1100); assertEquals(Mouth.WAVY, brain.frame(t).mouth)
        ev("thinking"); ev("cancelled"); assertEquals(Eye.SAD, brain.frame(t).eye)
    }

    private fun FaceFrame.mood() = eye
}

class IdleTest {
    private val host = FakeHost()
    private var t = 1_000_000L
    private val brain = Brain(host, ENV, t, Random(7))
    private fun ev(o: JSONObject) = brain.onServer(o, t)
    private fun run(ms: Long) { val end = t + ms; while (t < end) { t += 100; brain.tick(t) } }

    @Test fun sleepsAfterConfiguredIdleThenShowsClock() {
        ev(JSONObject().put("type", "hello").put("idle", JSONObject().put("sleepAfter", 20).put("clock", true)))
        run(19_000); assertFalse(brain.asleep)
        run(2_000); assertTrue(brain.asleep); assertFalse(brain.watch(t))
        run(5_000); assertTrue(brain.frame(t).zs.isNotEmpty()) // zZz ลอย
        run(Brain.CLOCK_DELAY); assertTrue(brain.watch(t))
        val px = Clock.render(java.util.Calendar.getInstance(), brain.frame(t), IntArray(Face.W * Face.H))
        assertTrue(px.count { it == Clock.DIM } > 30)
        ev(JSONObject().put("type", "idle").put("sleepAfter", 600).put("clock", false)); assertFalse(brain.watch(t))
        brain.down(10f, 10f, t); assertFalse(brain.asleep)
    }

    @Test fun voiceWakesQuietly() {
        ev(JSONObject().put("type", "hello").put("idle", JSONObject().put("sleepAfter", 20)))
        run(40_000); assertTrue(brain.watch(t)); val n = host.played.size
        ev(JSONObject().put("type", "rec")); assertFalse(brain.asleep); assertFalse(brain.watch(t))
        assertEquals(n, host.played.size) // ไม่ร้องทับคนพูด
    }

    @Test fun alarmRingsUntilTapped() {
        val card = JSONObject().put("layout", "big").put("big", "07:00").put("title", "ปลุก")
        ev(JSONObject().put("type", "alarm").put("title", "ปลุก").put("card", card))
        assertTrue(brain.ringing); val n = host.played.size
        run(3_000); assertTrue(host.played.size > n) // ร้องซ้ำ
        brain.down(10f, 10f, t); brain.up(t + 50)
        assertFalse(brain.ringing); assertEquals(1, host.alarmStops); assertNull(brain.card)
    }

    @Test fun dreamBubbleThenToldOnWake() {
        ev(JSONObject().put("type", "hello").put("idle", JSONObject().put("sleepAfter", 20)))
        run(25_000); assertTrue(brain.asleep)
        ev(JSONObject().put("type", "dreaming")); run(500); assertTrue(brain.frame(t).dream >= 0)
        ev(JSONObject().put("type", "dream_done").put("card", JSONObject().put("title", "ฝันว่า…").put("lines", org.json.JSONArray().put("กองทอง"))))
        assertNull(brain.card)
        brain.down(10f, 10f, t); run(2_000)
        assertEquals("ฝันว่า…", brain.card?.title); assertEquals(1, host.dreamSeen)
    }

    @Test fun pixelArtCard() {
        val o = JSONObject("""{"layout":"pixel","title":"ต้นไม้","w":4,"h":4,"fps":2,"palette":{"g":"#00ff00","y":"#ffff00"},"frames":[["..y.",".gg.","gggg","..g."],["....",".gg.","gggg","..g."]]}""")
        val c = Card.parse(o.toString())
        assertEquals("pixel", c.layout); assertEquals(2, c.pixel!!.frames.size)
        assertEquals(0xFFFFFF00.toInt(), c.pixel!!.frames[0][2]); assertEquals(0, c.pixel!!.frames[0][0])
        assertEquals("text", Card.parse("""{"layout":"pixel","w":2}""").layout)
    }
}

class HungerTest {
    private val host = FakeHost()
    private var t = 1_000_000L
    private val brain = Brain(host, ENV, t, Random(3))
    private fun run(ms: Long) { val end = t + ms; while (t < end) { t += 100; brain.tick(t) } }

    @Test fun getsHungryOverTimeAndAway() {
        brain.restorePet(0.3f, 0.5f, 0); assertFalse(brain.hungry)
        brain.restorePet(0.3f, 0.5f, 5 * 3_600_000L); assertTrue(brain.hungry) // ปิดแอปไป 5 ชม.
        brain.restorePet(0.58f, 0.5f, 0); run(30 * 60_000); assertTrue(brain.hungry) // เปิดทิ้งไว้ครึ่งชั่วโมง
        assertFalse(brain.frame(t).bowl) // หลับอยู่ ไม่โชว์ชาม
        brain.wake(t, quiet = true); assertTrue(brain.frame(t).bowl)
    }

    @Test fun feedingWhenHungryRaisesLoveMore() {
        brain.restorePet(0.9f, 0.4f, 0)
        assertTrue(brain.feed(Food.COOKIE, t)); assertTrue(brain.eating)
        assertEquals(Food.COOKIE, brain.frame(t + 100).food?.third)
        run(Brain.EAT_MS + 200)
        assertFalse(brain.eating); assertTrue(brain.hunger < 0.5f)
        assertTrue("affection ${brain.affection}", brain.affection > 0.5f)
        assertTrue(host.stats > 0)
    }

    @Test fun refusesWhenFull() {
        brain.restorePet(0.05f, 0.4f, 0)
        assertFalse(brain.feed(Food.FISH, t)); assertEquals(0.4f, brain.affection, 0.001f)
        assertEquals(Eye.CONFUSED, brain.frame(t).eye)
    }

    @Test fun macCanFeedAndAsk() {
        brain.restorePet(0.7f, 0.4f, 0)
        brain.onServer(JSONObject().put("type", "pet_ask"), t); assertTrue(brain.sub.contains("หิว"))
        brain.onServer(JSONObject().put("type", "feed").put("food", "milk"), t); assertTrue(brain.eating)
    }
}

class ShakeTest {
    private val host = FakeHost()
    private var t = 1_000_000L
    private val brain = Brain(host, ENV, t, Random(5))
    /** เขย่าแรง a เป็นเวลา ms (50 Hz) พร้อม tick 10 fps */
    private fun shake(ms: Long, a: Float) { val end = t + ms; while (t < end) { t += 20; brain.shake(a, t); if (t % 100 == 0L) brain.tick(t) } }
    private fun run(ms: Long) { val end = t + ms; while (t < end) { t += 100; brain.tick(t) } }

    @Test fun shortShakeStartles() {
        shake(500, 12f); assertFalse(brain.dizzy); assertEquals(Eye.BIG, brain.frame(t).eye)
    }

    @Test fun longShakeMakesDizzyThenRecovers() {
        shake(3000, 12f); assertTrue(brain.dizzy)
        val eyes = (0 until 8).map { run(100); brain.frame(t).eye }.toSet()
        assertTrue(eyes.contains(Eye.DIZZY) && eyes.contains(Eye.DIZZY2)) // ตาหมุน
        assertEquals(Mouth.WAVY, brain.frame(t).mouth)
        run(Brain.DIZZY_MS + 200); assertFalse(brain.dizzy)
    }

    @Test fun gentleMovementIgnored() { shake(5000, 2f); assertFalse(brain.dizzy); assertEquals(Eye.OPEN, brain.frame(t).eye.let { if (it == Eye.BLINK) Eye.OPEN else it }) }
}

class DeepSleepTest {
    private val host = FakeHost()
    private var t = 1_000_000L
    private val brain = Brain(host, ENV, t, Random(9))
    private fun ev(type: String) = brain.onServer(JSONObject().put("type", type), t)
    private fun run(ms: Long) { val end = t + ms; while (t < end) { t += 100; brain.tick(t) } }

    @Test fun onlyTouchWakesAndMicIsOff() {
        ev("sleep"); assertTrue(brain.asleep && brain.deep); assertEquals(listOf(false), host.mic)
        for (e in listOf("rec", "heard", "armed", "loud", "thinking", "feed", "job", "pet_ask")) ev(e)
        brain.shake(15f, t); run(30_000)
        assertTrue("still asleep", brain.asleep && brain.deep); assertFalse(brain.thinking)
        assertTrue(brain.watch(t)) // หน้าปัดนาฬิกาเหมือนหลับปกติ
        ev("dreaming"); assertTrue(brain.frame(t).dream >= 0 || brain.watch(t))
        brain.down(10f, 10f, t); brain.up(t + 50)
        assertFalse(brain.asleep); assertFalse(brain.deep); assertEquals(listOf(false, true), host.mic); assertEquals(1, host.woke)
    }

    @Test fun alarmStillRings() {
        ev("sleep")
        brain.onServer(JSONObject().put("type", "alarm").put("card", JSONObject().put("title", "ปลุก")), t)
        assertTrue(brain.ringing); assertFalse(brain.deep); assertEquals(listOf(false, true), host.mic)
    }
}
