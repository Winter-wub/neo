package com.mochi.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NeoDataModelTest {
    private fun model() = NeoDataModel()
    private fun ev(s: String) = ServerEvent.fromJson(JSONObject(s))
    private fun paths(calls: List<Call>) = calls.map { "${it.method} ${it.path}" }
    private fun body(c: Call) = JSONObject(c.body ?: "{}")
    private fun assertJson(expected: String, c: Call) = assertTrue("expected $expected but was ${c.body}", JSONObject(expected).similar(body(c)))

    private val jobsJson = """{"jobs":[{"id":"a1","kind":"alarm","title":"ปลุก","enabled":true,"at":1790000000000,"next":1790000000000,"when":"พรุ่งนี้ 07:00"},{"id":"b2","kind":"task","title":"สรุปข่าว","enabled":false,"cron":"0 8 * * *","next":null,"when":"ทุกวัน 08:00","prompt":"สรุปข่าว"}],"ringing":null,"problems":[]}"""
    private fun memoryJson(text: String, version: String) = JSONObject().put("text", text).put("version", version).put("items", org.json.JSONArray()).toString()

    // ---- load ----
    @Test fun eachPageAsksForItsOwnData() {
        val m = model()
        assertEquals(listOf("GET /api/jobs"), paths(m.loadCalls(NeoDataModel.Page.JOBS)))
        assertEquals(listOf("GET /api/memory"), paths(m.loadCalls(NeoDataModel.Page.MEMORY)))
        assertEquals(listOf("GET /api/dream", "GET /api/dreams"), paths(m.loadCalls(NeoDataModel.Page.DREAMS)))
        assertEquals(listOf("GET /api/journal"), paths(m.loadCalls(NeoDataModel.Page.JOURNAL)))
    }

    // ---- jobs ----
    @Test fun jobListFillsAndAnErrorKeepsIt() {
        val m = model()
        m.onReply(Call("GET", "/api/jobs"), 200, jobsJson)
        assertEquals(listOf("a1", "b2"), m.jobs.jobs.map { it.id })
        val r = m.onReply(Call("GET", "/api/jobs"), 500, """{"error":"พัง","code":1}""")
        assertEquals("พัง", r.message)
        assertEquals(2, m.jobs.jobs.size)
    }

    @Test fun addBySentencePreviewsFirstAndOnlyThenAdds() {
        val m = model()
        val parse = m.parseJob("  ปลุกพรุ่งนี้ 7 โมง ")
        assertEquals("POST /api/jobs/parse", "${parse.method} ${parse.path}")
        assertEquals("ปลุกพรุ่งนี้ 7 โมง", body(parse).getString("speech"))
        assertNull(m.addDraft()) // ยังไม่มีตัวอย่าง = ยังเพิ่มไม่ได้
        m.onReply(parse, 200, """{"draft":{"kind":"alarm","title":"ปลุก","at":1790000000000,"when":"พรุ่งนี้ 07:00"}}""")
        assertEquals("ปลุก · พรุ่งนี้ 07:00", m.draftPreview())
        val add = m.addDraft()!!
        assertEquals("/api/jobs/add", add.path)
        assertEquals(JSONObject("""{"kind":"alarm","title":"ปลุก","at":1790000000000}""").toString(), body(add).toString())
        val r = m.onReply(add, 200, """{"id":"c3","kind":"alarm","title":"ปลุก","enabled":true,"next":1,"when":"พรุ่งนี้ 07:00"}""")
        assertNull(m.draft)
        assertEquals(listOf("GET /api/jobs"), paths(r.reload))
    }

    @Test fun aSentenceItCannotUnderstandSaysSoAndKeepsNoDraft() {
        val m = model()
        val r = m.onReply(m.parseJob("blah"), 400, """{"error":"ไม่เข้าใจว่าจะตั้งเมื่อไหร่","code":1}""")
        assertEquals("ไม่เข้าใจว่าจะตั้งเมื่อไหร่", r.message)
        assertNull(m.draft)
    }

    @Test fun cancellingThePreviewDropsIt() {
        val m = model()
        m.onReply(m.parseJob("x"), 200, """{"draft":{"kind":"alarm","title":"ปลุก","at":1,"when":"w"}}""")
        m.cancelDraft()
        assertNull(m.addDraft())
    }

    @Test fun jobActionsUseTheJobId() {
        val m = model(); m.onReply(Call("GET", "/api/jobs"), 200, jobsJson)
        val on = m.setJobEnabled(m.jobs.jobs[1], true)
        assertEquals("/api/jobs/enable", on.path); assertJson("""{"ref":"b2","enabled":true}""", on)
        assertJson("""{"ref":"a1"}""", m.testJob(m.jobs.jobs[0]))
        val rm = m.removeJob(m.jobs.jobs[0]) as NeoDataModel.Step.Confirm
        assertTrue(rm.message.contains("ปลุก"))
        assertEquals("/api/jobs/remove", rm.call.path)
    }

    @Test fun jobEventsRefreshOrShowTheProblem() {
        val m = model(); m.onReply(Call("GET", "/api/jobs"), 200, jobsJson)
        assertEquals(listOf("GET /api/jobs"), paths(m.onEvent(ev("""{"type":"jobs"}"""))))
        assertTrue(m.onEvent(ev("""{"type":"jobs_warning","problems":[{"line":4,"text":"??","error":"อ่านไม่ออก"}]}""")).isEmpty())
        assertEquals(4, m.jobs.problems.single().line)
        assertEquals(2, m.jobs.jobs.size)
    }

    // ---- memory ----
    @Test fun savingSendsTheVersionThatWasRead() {
        val m = model(); m.onReply(Call("GET", "/api/memory"), 200, memoryJson("## ฉัน\n- ชอบกาแฟ\n", "v1"))
        m.startEdit(); m.edit = "## ฉัน\n- ชอบชา\n"
        val save = m.saveMemory()!!
        assertJson("""{"text":"## ฉัน\n- ชอบชา\n","since":"v1"}""", save)
        val r = m.onReply(save, 200, memoryJson("## ฉัน\n- ชอบชา\n", "v2"))
        assertNull(m.edit); assertEquals("v2", m.memory?.version); assertEquals("บันทึกความจำแล้ว", r.message)
    }

    @Test fun macEditingMeanwhileIsRefusedClearlyAndNothingIsLost() {
        val m = model(); m.onReply(Call("GET", "/api/memory"), 200, memoryJson("A", "v1"))
        m.startEdit(); m.edit = "A phone"
        val save = m.saveMemory()!!
        // the Mac saved "A mac" first → the daemon refuses with 409
        val r = m.onReply(save, 409, """{"error":"ความจำถูกแก้ไปแล้ว","code":409}""")
        assertTrue(r.message.contains("Mac"))
        assertEquals("A phone", m.edit) // ข้อความของมือถือยังอยู่
        assertEquals(listOf("GET /api/memory"), paths(r.reload))
        assertEquals(NeoDataModel.Conflict.NONE, m.conflict) // ยังไม่รู้ว่า Mac เขียนอะไร จนกว่าจะโหลด
        m.onReply(Call("GET", "/api/memory"), 200, memoryJson("A mac", "v2"))
        assertEquals(NeoDataModel.Conflict.MAC_CHANGED, m.conflict)
        assertEquals("A mac", m.latest?.text)
        assertEquals("A phone", m.edit)
        // ทับด้วยของมือถือ = ตั้งใจ: ส่ง version ล่าสุด
        assertJson("""{"text":"A phone","since":"v2"}""", m.overwriteWithMine()!!)
    }

    @Test fun macChangeWhileEditingWarnsBeforeSavingAndKeepsTheDraft() {
        val m = model(); m.onReply(Call("GET", "/api/memory"), 200, memoryJson("A", "v1"))
        m.startEdit(); m.edit = "A phone"
        assertEquals(listOf("GET /api/memory"), paths(m.onEvent(ev("""{"type":"changed","file":"memory"}"""))))
        m.onReply(Call("GET", "/api/memory"), 200, memoryJson("A mac", "v2"))
        assertEquals(NeoDataModel.Conflict.MAC_CHANGED, m.conflict)
        assertEquals("A phone", m.edit)
        assertEquals("v1", JSONObject(m.saveMemory()!!.body).getString("since")) // ยังเป็น v1 → daemon จะปฏิเสธ ไม่ทับเงียบ ๆ
    }

    @Test fun takingTheMacsVersionDropsTheDraft() {
        val m = model(); m.onReply(Call("GET", "/api/memory"), 200, memoryJson("A", "v1"))
        m.startEdit(); m.edit = "A phone"
        m.onReply(Call("GET", "/api/memory"), 200, memoryJson("A mac", "v2"))
        m.useMacVersion()
        assertNull(m.edit); assertEquals("A mac", m.memory?.text); assertEquals(NeoDataModel.Conflict.NONE, m.conflict)
    }

    @Test fun memoryChangesWhenNotEditingJustShow() {
        val m = model(); m.onReply(Call("GET", "/api/memory"), 200, memoryJson("A", "v1"))
        m.onReply(Call("GET", "/api/memory"), 200, memoryJson("B", "v2"))
        assertEquals("B", m.memory?.text); assertEquals(NeoDataModel.Conflict.NONE, m.conflict)
    }

    @Test fun forgettingAnItemSendsItsText() {
        val m = model()
        val f = m.forgetMemory(NeoMemoryItem("ฉัน", "ชอบกาแฟ")) as NeoDataModel.Step.Confirm
        assertEquals("/api/memory/forget", f.call.path); assertJson("""{"text":"ชอบกาแฟ"}""", f.call)
        val r = m.onReply(f.call, 200, """{"removed":[{"section":"ฉัน","text":"ชอบกาแฟ"}]}""")
        assertEquals(listOf("GET /api/memory"), paths(r.reload))
    }

    // ---- dreams ----
    @Test fun dreamListStatusAndShow() {
        val m = model()
        m.onReply(Call("GET", "/api/dreams"), 200, """[{"id":"2026-10-25-0300.md","at":1,"reason":"idle","took":5,"entries":3,"dream":"ฝัน","insights":1,"undelivered":false}]""")
        m.onReply(Call("GET", "/api/dream"), 200, """{"enabled":true,"running":false,"newEntries":2,"idleMinutes":3.5,"quietNow":false,"quietHours":[],"activity":[]}""")
        assertEquals(1, m.dreams.size); assertTrue(m.dreamStatus.enabled)
        val show = m.showDream(m.dreams[0])
        assertJson("""{"id":"2026-10-25-0300.md"}""", show)
        m.onReply(show, 200, """{"id":"2026-10-25-0300.md","text":"t","version":"v","at":1,"dream":"ฝันดี","insights":[],"patterns":[],"added":["+ a"],"removed":["- b"]}""")
        assertEquals("ฝันดี", m.dream?.dream)
        m.closeDream(); assertNull(m.dream)
    }

    @Test fun deletingADreamAsksFirstThenReloads() {
        val m = model()
        m.onReply(Call("GET", "/api/dreams"), 200, """[{"id":"d.md","at":1}]""")
        val rm = m.removeDream(m.dreams[0]) as NeoDataModel.Step.Confirm
        assertEquals("/api/dreams/rm", rm.call.path)
        assertEquals(listOf("GET /api/dreams"), paths(m.onReply(rm.call, 200, """{"removed":{"id":"d.md"}}""").reload))
    }

    @Test fun dreamNowWaitsLongAndNothingNewIsExplained() {
        val m = model()
        val now = m.dreamNow()
        assertEquals("/api/dream/now", now.path)
        assertTrue(now.timeoutMs >= 300_000)
        val r = m.onReply(now, 409, """{"error":"ไม่มีอะไรใหม่ใน journal","code":409}""")
        assertEquals("ไม่มีอะไรใหม่ใน journal", r.message)
        // ตอบไม่ทัน (timeout) ไม่ใช่ error: ฝันยังเดินอยู่ รอ event
        assertEquals("ยังฝันอยู่ — เสร็จแล้วจะขึ้นเอง", m.onReply(now, 0, "").message)
        assertTrue(m.dreamStatus.running)
    }

    @Test fun dreamEventsShowRunningAndReload() {
        val m = model()
        assertTrue(m.onEvent(ev("""{"type":"dreaming","reason":"manual","entries":2}""")).isEmpty())
        assertTrue(m.dreamStatus.running)
        val done = m.onEvent(ev("""{"type":"dream_done","card":{"title":"ฝัน","lines":[]}}"""))
        assertEquals(listOf("GET /api/dream", "GET /api/dreams"), paths(done))
        m.onEvent(ev("""{"type":"dreaming","reason":"manual","entries":2}"""))
        assertEquals(listOf("GET /api/dream"), paths(m.onEvent(ev("""{"type":"dream_fail","error":"x"}"""))))
        assertEquals(listOf("GET /api/dreams"), paths(m.onEvent(ev("""{"type":"changed","file":"dream","id":"d.md"}"""))))
    }

    @Test fun dreamEnableToggle() {
        val c = model().setDreamEnabled(false)
        assertEquals("/api/dream/enable", c.path); assertJson("""{"enabled":false}""", c)
    }

    // ---- journal ----
    @Test fun journalDaysShowAndDeleteAnEntry() {
        val m = model()
        m.onReply(Call("GET", "/api/journal"), 200, """[{"day":"2026-10-26","entries":2},{"day":"2026-10-25","entries":1}]""")
        assertEquals(listOf("2026-10-26", "2026-10-25"), m.journalDays.map { it.day })
        val show = m.showDay("2026-10-26")
        assertJson("""{"day":"2026-10-26"}""", show)
        m.onReply(show, 200, """{"day":"2026-10-26","text":"t","version":"v","entries":[{"day":"2026-10-26","time":"09:00","q":"ถามอะไร","a":"ตอบ","ok":true}]}""")
        val e = m.journal!!.entries[0]
        val del = m.forgetEntry(e) as NeoDataModel.Step.Confirm
        assertEquals("/api/journal/forget", del.call.path); assertJson("""{"text":"ถามอะไร"}""", del.call)
        assertEquals(listOf("GET /api/journal", "POST /api/journal/show"), paths(m.onReply(del.call, 200, """{"removed":[]}""").reload))
        assertJson("""{"day":"2026-10-26"}""", m.onReply(del.call, 200, """{"removed":[]}""").reload[1])
    }

    @Test fun deletingAmbiguousEntrySaysSeveralMatched() {
        val m = model()
        val r = m.onReply(Call("POST", "/api/journal/forget", "{}"), 409, """{"error":"ตรงกัน 2 รายการ","code":409}""")
        assertEquals("ตรงกัน 2 รายการ", r.message)
        assertTrue(r.reload.isEmpty())
    }

    @Test fun journalChangeReloadsListAndOpenDay() {
        val m = model()
        m.onReply(m.showDay("2026-10-26"), 200, """{"day":"2026-10-26","text":"","version":"v","entries":[]}""")
        assertEquals(listOf("GET /api/journal", "POST /api/journal/show"), paths(m.onEvent(ev("""{"type":"changed","file":"journal","day":"2026-10-26"}"""))))
        m.closeDay()
        assertEquals(listOf("GET /api/journal"), paths(m.onEvent(ev("""{"type":"changed","file":"journal","day":"2026-10-26"}"""))))
    }

    @Test fun unreachableMacSaysSo() {
        assertEquals("ติดต่อ Mac ไม่ได้", model().onReply(Call("GET", "/api/jobs"), 0, "").message)
        assertEquals("Neo บน Mac เป็นรุ่นเก่า ยังไม่รองรับการตั้งค่าจากมือถือ", model().onReply(Call("GET", "/api/jobs"), 404, "").message)
    }
}
