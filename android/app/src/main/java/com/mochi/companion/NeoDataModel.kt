package com.mochi.companion

import org.json.JSONObject

// สถานะ + การกระทำของหน้า งานตั้งเวลา / ความจำ / ความฝัน / บันทึก (journal) ที่เปิดจากส่วน "Neo" ในหน้าตั้งค่า
// ไม่แตะ Android UI เพื่อเทสต์ได้; ทุกการกระทำคืน Call ให้ NeoRemote ส่งไป และ [onReply]/[onEvent] บอกว่าต้องโหลดอะไรใหม่
class NeoDataModel {
    enum class Page { JOBS, MEMORY, DREAMS, JOURNAL }
    /** [MAC_CHANGED]: Mac แก้ความจำหลังจากที่เราเริ่มแก้ (ข้อความของเรายังอยู่ ยังไม่ได้ทับอะไร) */
    enum class Conflict { NONE, MAC_CHANGED }
    sealed class Step {
        data class Send(val call: Call) : Step()
        /** ต้องถามผู้ใช้ก่อน; ถ้าตกลงค่อยส่ง [call] */
        data class Confirm(val message: String, val call: Call) : Step()
    }
    /** [message] ว่าง = ไม่มีอะไรต้องบอก; [reload] = สิ่งที่ต้องโหลดใหม่ */
    data class Result(val message: String = "", val reload: List<Call> = emptyList())

    // jobs
    var jobs = NeoJobList(); private set
    var draft: NeoJobDraft? = null; private set
    // memory: [memory] = ฉบับที่เราเริ่มแก้ (ใช้เป็น since), [latest] = ฉบับล่าสุดบน Mac, [edit] = ข้อความที่กำลังแก้ (null = ไม่ได้แก้)
    var memory: NeoMemoryDoc? = null; private set
    var latest: NeoMemoryDoc? = null; private set
    var edit: String? = null
    var conflict = Conflict.NONE; private set
    // dreams
    var dreams: List<NeoDreamInfo> = emptyList(); private set
    var dreamStatus = NeoDreamStatus(); private set
    var dream: NeoDreamDoc? = null; private set
    var dreamError = ""; private set
    // journal
    var journalDays: List<NeoJournalDay> = emptyList(); private set
    var journal: NeoJournalDoc? = null; private set

    fun loadCalls(page: Page): List<Call> = when (page) {
        Page.JOBS -> listOf(Call("GET", "/api/jobs"))
        Page.MEMORY -> listOf(Call("GET", "/api/memory"))
        Page.DREAMS -> listOf(Call("GET", "/api/dream"), Call("GET", "/api/dreams"))
        Page.JOURNAL -> listOf(Call("GET", "/api/journal"))
    }

    fun onReply(call: Call, code: Int, body: String): Result {
        if (code == 0) {
            if (call.path == "/api/dream/now") { dreamStatus = dreamStatus.copy(running = true); return Result("ยังฝันอยู่ — เสร็จแล้วจะขึ้นเอง") }
            return Result("ติดต่อ Mac ไม่ได้")
        }
        if (code == 404) return Result("Neo บน Mac เป็นรุ่นเก่า ยังไม่รองรับการตั้งค่าจากมือถือ")
        if (code !in 200..299) {
            if (call.path == "/api/memory" && call.method == "POST" && code == 409)
                return Result("Mac แก้ความจำไปก่อนแล้ว — ข้อความของคุณยังอยู่ เลือกได้ว่าจะทับด้วยของคุณหรือใช้ของ Mac", loadCalls(Page.MEMORY))
            return Result(errorOf(body) ?: "ทำไม่สำเร็จ ($code)")
        }
        val reloadJobs = listOf(Call("GET", "/api/jobs"))
        return when (call.path) {
            "/api/jobs" -> { jobs = NeoJobList.parse(body); Result() }
            "/api/jobs/parse" -> {
                draft = JobParseResponse.parse(body).draft
                if (draft == null) Result("ไม่เข้าใจว่าจะตั้งเมื่อไหร่") else Result()
            }
            "/api/jobs/add" -> { draft = null; Result(reload = reloadJobs) }
            "/api/jobs/enable", "/api/jobs/remove", "/api/jobs/edit" -> Result(reload = reloadJobs)
            "/api/memory" -> if (call.method == "GET") { applyMemory(NeoMemoryDoc.parse(body)); Result() } else saved(NeoMemoryDoc.parse(body))
            "/api/memory/add" -> saved(NeoMemoryDoc.parse(body))
            "/api/memory/forget" -> Result(reload = loadCalls(Page.MEMORY))
            "/api/dream" -> { dreamStatus = NeoDreamStatus.parse(body); Result() }
            "/api/dream/enable" -> { dreamStatus = NeoDreamStatus.parse(body); Result() }
            "/api/dream/now" -> { dream = NeoDreamDoc.parse(body); Result(reload = loadCalls(Page.DREAMS)) }
            "/api/dreams" -> { dreams = NeoDreamInfo.parseList(body); Result() }
            "/api/dreams/show" -> { dream = NeoDreamDoc.parse(body); Result() }
            "/api/dreams/rm" -> { if (dream?.id == DreamRemoveResponse.parse(body).removed?.id) dream = null; Result(reload = listOf(Call("GET", "/api/dreams"))) }
            "/api/journal" -> { journalDays = NeoJournalDay.parseList(body); Result() }
            "/api/journal/show" -> { journal = NeoJournalDoc.parse(body); Result() }
            "/api/journal/forget" -> Result(reload = listOf(Call("GET", "/api/journal")) + listOfNotNull(journal?.let { showDay(it.day) }))
            else -> Result()
        }
    }

    /** event จาก Mac; คืนสิ่งที่ต้องโหลดใหม่ */
    fun onEvent(ev: ServerEvent): List<Call> = when (ev) {
        is ServerEvent.JobsChanged -> listOf(Call("GET", "/api/jobs"))
        is ServerEvent.JobsWarning -> { jobs = jobs.copy(problems = ev.problems); emptyList() }
        is ServerEvent.Dreaming -> { dreamError = ""; dreamStatus = dreamStatus.copy(running = true); emptyList() }
        is ServerEvent.DreamDone -> loadCalls(Page.DREAMS)
        is ServerEvent.DreamFail -> { dreamError = "ฝันไม่สำเร็จ"; listOf(Call("GET", "/api/dream")) }
        is ServerEvent.FileChanged -> when (ev.file) {
            "memory" -> loadCalls(Page.MEMORY)
            "journal" -> loadCalls(Page.JOURNAL) + listOfNotNull(journal?.takeIf { ev.day.isEmpty() || ev.day == it.day }?.let { showDay(it.day) })
            "dream" -> listOf(Call("GET", "/api/dreams"))
            else -> emptyList()
        }
        else -> emptyList()
    }

    // ---- jobs ----
    fun parseJob(speech: String) = Call("POST", "/api/jobs/parse", JobParseRequest(speech.trim()).toJson())
    fun draftPreview(): String? = draft?.let { d -> listOf(d.title, d.`when`).filter { it.isNotEmpty() }.joinToString(" · ") }
    fun cancelDraft() { draft = null }
    /** เพิ่มได้ก็ต่อเมื่อมีตัวอย่างให้ดูแล้ว */
    fun addDraft(): Call? = draft?.let { d ->
        Call("POST", "/api/jobs/add", JobAddRequest(d.kind, d.title.ifEmpty { null }, d.prompt, d.at, d.cron).toJson())
    }
    fun setJobEnabled(job: NeoJob, on: Boolean) = Call("POST", "/api/jobs/enable", JobEnableRequest(job.id, on).toJson())
    fun testJob(job: NeoJob) = Call("POST", "/api/jobs/test", JobRefRequest(job.id).toJson())
    fun removeJob(job: NeoJob): Step = Step.Confirm("ลบงาน \"${job.title}\" (${job.`when`})?", Call("POST", "/api/jobs/remove", JobRefRequest(job.id).toJson()))

    // ---- memory ----
    fun startEdit() { edit = latest?.text ?: memory?.text ?: ""; memory = latest ?: memory; conflict = Conflict.NONE }
    fun saveMemory(): Call? = edit?.let { Call("POST", "/api/memory", MemorySaveRequest(it, memory?.version.orEmpty()).toJson()) }
    /** ผู้ใช้เห็นว่า Mac แก้อะไรแล้วเลือกทับ: ใช้ version ล่าสุดเป็น since */
    fun overwriteWithMine(): Call? { memory = latest ?: memory; conflict = Conflict.NONE; return saveMemory() }
    fun useMacVersion() { edit = null; memory = latest ?: memory; conflict = Conflict.NONE }
    fun cancelEdit() = useMacVersion()
    fun forgetMemory(item: NeoMemoryItem): Step = Step.Confirm("ลืม \"${item.text}\"?", Call("POST", "/api/memory/forget", ForgetRequest(item.text).toJson()))

    private fun applyMemory(doc: NeoMemoryDoc) {
        latest = doc
        if (edit == null || memory == null) { memory = doc; conflict = Conflict.NONE }
        else conflict = if (doc.version != memory?.version) Conflict.MAC_CHANGED else Conflict.NONE
    }
    private fun saved(doc: NeoMemoryDoc): Result { memory = doc; latest = doc; edit = null; conflict = Conflict.NONE; return Result("บันทึกความจำแล้ว") }

    // ---- dreams ----
    fun showDream(info: NeoDreamInfo) = Call("POST", "/api/dreams/show", DreamIdRequest(info.id).toJson())
    fun closeDream() { dream = null }
    fun removeDream(info: NeoDreamInfo): Step = Step.Confirm("ลบความฝัน ${info.id}?", Call("POST", "/api/dreams/rm", DreamIdRequest(info.id).toJson()))
    /** ฝันตอนนี้: daemon ตอบเมื่อฝันจบ (อาจนานหลายนาที) */
    fun dreamNow() = Call("POST", "/api/dream/now", "{}", timeoutMs = 600_000)
    fun setDreamEnabled(on: Boolean) = Call("POST", "/api/dream/enable", DreamEnableRequest(on).toJson())

    // ---- journal ----
    fun showDay(day: String) = Call("POST", "/api/journal/show", JournalShowRequest(day).toJson())
    fun closeDay() { journal = null }
    /** ลบทีละรายการ: daemon ลบตามคำถาม; ถ้ามีหลายรายการที่ตรงกันจะปฏิเสธและไม่ลบอะไร */
    fun forgetEntry(e: NeoJournalEntry): Step = Step.Confirm("ลบรายการ ${e.time} \"${e.q}\" ออกจากบันทึก?", Call("POST", "/api/journal/forget", ForgetRequest(e.q).toJson()))

    private fun errorOf(body: String): String? = try { JSONObject(body).optString("error").ifEmpty { null } } catch (_: Exception) { null }
}
