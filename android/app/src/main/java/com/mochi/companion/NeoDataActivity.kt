package com.mochi.companion

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

// งานตั้งเวลา / ความจำ / ความฝัน / บันทึก ของ Neo บน Mac — เปิดจากส่วน "Neo" ในหน้าตั้งค่า
// ข้อมูลและกติกาอยู่ใน NeoDataModel; ที่นี่มีแต่การวาด + ส่งคำสั่ง (หน้าตาเหมือนหน้าตั้งค่า)
class NeoDataActivity : Activity() {
    private val model = NeoDataModel()
    private lateinit var remote: NeoRemote
    private lateinit var content: LinearLayout
    private var page = NeoDataModel.Page.JOBS
    private var note = ""
    private var stale = false
    private var speech = ""
    @Volatile private var alive = false
    private val d by lazy { resources.displayMetrics.density }
    private fun dp(x: Int) = (x * d).toInt()
    private val muted = 0xFF86928D.toInt()
    private val soft = 0xFFB9C4BF.toInt()
    private val warn = 0xFFFFB38A.toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cfg = Config.load(this, null)
        Face.applyTheme(FaceTheme.parse(cfg.face))
        if (cfg.token.isEmpty()) { finish(); return }
        speech = intent.getStringExtra("speech").orEmpty() // ใส่ประโยคให้ล่วงหน้า (ไว้เทสต์ผ่าน adb ที่พิมพ์ไทยไม่ได้)
        page = NeoDataModel.Page.entries.getOrElse(intent.getIntExtra("page", 0)) { NeoDataModel.Page.JOBS }
        remote = NeoRemote(cfg.base, cfg.token, { ev -> runOnUiThread { onEvent(ev) } }, { runOnUiThread { unpaired() } })
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(24), dp(24), dp(28)); setBackgroundColor(Face.BG) }
        setContentView(ScrollView(this).apply { setBackgroundColor(Face.BG); addView(content) })
        window.decorView.setBackgroundColor(Face.BG)
    }

    override fun onResume() { super.onResume(); alive = true; remote.start(); load(); render() }
    override fun onPause() { alive = false; remote.stop(); super.onPause() }

    private fun unpaired() { startActivity(Intent(this, SetupActivity::class.java).putExtra("why", "Mac ยกเลิกการจับคู่เครื่องนี้แล้ว — จับคู่ใหม่")); finish() }
    private fun load() = model.loadCalls(page).forEach { run(it) }

    /** ส่งที่พื้นหลัง → ใส่คำตอบเข้าโมเดล → โหลดใหม่ตามที่โมเดลบอก → วาดใหม่ */
    private fun run(call: Call) {
        thread(name = "neo-data-call") {
            val (code, body) = remote.send(call)
            if (!alive) return@thread
            runOnUiThread {
                if (code == 401) { unpaired(); return@runOnUiThread }
                val r = model.onReply(call, code, body)
                note = r.message
                r.reload.forEach { run(it) }
                render()
            }
        }
    }

    private fun onEvent(ev: ServerEvent) { model.onEvent(ev).forEach { run(it) }; render() }

    private fun go(p: NeoDataModel.Page) { page = p; note = ""; load(); render() }

    // ---------- วาด ----------
    fun render() {
        if (content.findFocus() is EditText) { stale = true; return }
        stale = false
        content.removeAllViews()
        content.addView(text("Neo บน Mac", 26f, bold = true))
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((label, p) in listOf("งาน" to NeoDataModel.Page.JOBS, "ความจำ" to NeoDataModel.Page.MEMORY, "ฝัน" to NeoDataModel.Page.DREAMS, "บันทึก" to NeoDataModel.Page.JOURNAL))
            tabs.addView(button(label, p == page) { go(p) }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(4) })
        content.addView(tabs)
        if (note.isNotEmpty()) content.addView(text(note, 14f, warn))
        when (page) {
            NeoDataModel.Page.JOBS -> jobs()
            NeoDataModel.Page.MEMORY -> memory()
            NeoDataModel.Page.DREAMS -> dreams()
            NeoDataModel.Page.JOURNAL -> journal()
        }
        content.addView(button("กลับไปหน้าตั้งค่า", false) { finish() }.also { (it.layoutParams as LinearLayout.LayoutParams).topMargin = dp(28) })
    }

    private fun jobs() {
        content.addView(heading("เพิ่มงานด้วยประโยค"))
        content.addView(field("เช่น ปลุกพรุ่งนี้ 7 โมง", speech).apply { watch { speech = it } })
        content.addView(button("ดูตัวอย่าง", false) { if (speech.isNotBlank()) run(model.parseJob(speech)) })
        model.draftPreview()?.let { p ->
            content.addView(text("จะเพิ่ม: $p", 16f, bold = true))
            content.addView(button("เพิ่ม", true) { model.addDraft()?.let { run(it); speech = "" } })
            content.addView(button("ยกเลิก", false) { model.cancelDraft(); render() })
        }
        model.jobs.ringing?.let { content.addView(text("กำลังดัง: ${it.title}", 15f, warn)) }
        content.addView(heading("งานทั้งหมด"))
        if (model.jobs.jobs.isEmpty()) content.addView(text("ยังไม่มีงาน", 14f, muted))
        for (j in model.jobs.jobs) {
            content.addView(text("${j.title}${if (j.kind == "task") "  (งาน)" else ""}", 16f, bold = true))
            content.addView(text(j.`when` + (j.next?.let { "  · ครั้งต่อไป ${fmt(it)}" } ?: ""), 13f, if (j.enabled) soft else muted))
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(button(if (j.enabled) "ปิด" else "เปิด", false) { run(model.setJobEnabled(j, !j.enabled)) }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(4) })
            row.addView(button("ทดสอบ", false) { run(model.testJob(j)) }, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(4) })
            row.addView(button("ลบ", false) { confirm(model.removeJob(j)) }, LinearLayout.LayoutParams(0, -2, 1f))
            content.addView(row)
        }
        for (p in model.jobs.problems) content.addView(text("jobs.md บรรทัด ${p.line}: ${p.error}", 13f, warn))
    }

    private fun memory() {
        val doc = model.memory
        if (doc == null) { content.addView(text("กำลังโหลด …", 14f, muted)); return }
        val editing = model.edit
        if (editing == null) {
            content.addView(heading("ความจำ"))
            if (doc.items.isEmpty()) content.addView(text("ยังไม่มีความจำ", 14f, muted))
            for (it in doc.items) {
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
                row.addView(text((if (it.section.isNotEmpty()) "[${it.section}] " else "") + it.text, 15f, soft), LinearLayout.LayoutParams(0, -2, 1f))
                row.addView(button("ลืม", false) { confirm(model.forgetMemory(it)) }.apply { layoutParams = LinearLayout.LayoutParams(dp(72), -2) })
                content.addView(row)
            }
            content.addView(button("แก้ความจำ (ทั้งไฟล์)", true) { model.startEdit(); render() })
            return
        }
        content.addView(heading("แก้ความจำ"))
        if (model.conflict == NeoDataModel.Conflict.MAC_CHANGED) {
            content.addView(text("Mac แก้ความจำไปแล้วระหว่างที่คุณแก้ — ข้อความของคุณยังอยู่ ยังไม่ได้ทับอะไร", 14f, warn))
            content.addView(text("ฉบับบน Mac ตอนนี้:", 13f, muted))
            content.addView(text(model.latest?.text.orEmpty().ifEmpty { "(ว่าง)" }, 13f, soft).apply { background = box(); setPadding(dp(12), dp(10), dp(12), dp(10)) })
            content.addView(button("ทับด้วยของฉัน", true) { model.overwriteWithMine()?.let { run(it) } })
            content.addView(button("ใช้ของ Mac (ทิ้งที่ฉันแก้)", false) { model.useMacVersion(); render() })
        }
        content.addView(field("", editing).apply {
            isSingleLine = false; minLines = 8; gravity = android.view.Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            watch { model.edit = it }
        })
        content.addView(button("บันทึก", true) { currentFocus?.clearFocus(); model.saveMemory()?.let { run(it) } })
        content.addView(button("ยกเลิก", false) { model.cancelEdit(); render() })
    }

    private fun dreams() {
        model.dream?.let { return dreamDoc(it) }
        val s = model.dreamStatus
        content.addView(heading("ความฝัน"))
        content.addView(switchRow("ฝัน (จัดความจำตอนไม่มีใคร)", s.enabled) { run(model.setDreamEnabled(it)) })
        content.addView(text(if (s.running) "กำลังฝัน …" else "มีเรื่องใหม่ ${s.newEntries} รายการ" + (s.blocked?.let { "  · $it" } ?: ""), 14f, soft))
        if (model.dreamError.isNotEmpty()) content.addView(text(model.dreamError, 14f, warn))
        content.addView(button(if (s.running) "กำลังฝัน …" else "ฝันตอนนี้", false) { if (!s.running) run(model.dreamNow()) })
        content.addView(heading("ที่ผ่านมา"))
        if (model.dreams.isEmpty()) content.addView(text("ยังไม่เคยฝัน", 14f, muted))
        for (info in model.dreams.sortedByDescending { it.id }) content.addView(button(info.id.removeSuffix(".md") + if (info.undelivered) "  · ยังไม่ได้เล่า" else "", false) { run(model.showDream(info)) })
    }

    private fun dreamDoc(doc: NeoDreamDoc) {
        content.addView(heading(doc.id.removeSuffix(".md")))
        content.addView(text(doc.dream.ifEmpty { "(ไม่มีเรื่องเล่า)" }, 16f, soft))
        for (i in doc.insights) content.addView(text("• ${i.q}: ${i.finding}", 14f, soft))
        for (p in doc.patterns) content.addView(text("แพตเทิร์น: $p", 14f, soft))
        for (a in doc.added) content.addView(text("+ ${a.removePrefix("+ ")}", 14f, 0xFF8FD6A0.toInt()))
        for (r in doc.removed) content.addView(text("− ${r.removePrefix("- ")}", 14f, warn))
        content.addView(button("ลบความฝันนี้", false) { model.dreams.firstOrNull { it.id == doc.id }?.let { confirm(model.removeDream(it)) } })
        content.addView(button("กลับไปรายการ", false) { model.closeDream(); render() })
    }

    private fun journal() {
        model.journal?.let { doc ->
            content.addView(heading(doc.day))
            if (doc.entries.isEmpty()) content.addView(text("ไม่มีรายการ", 14f, muted))
            for (e in doc.entries) {
                content.addView(text("${e.time}  ${e.q}", 15f, bold = true))
                content.addView(text(e.a.ifEmpty { "(ไม่มีคำตอบ)" }, 14f, if (e.ok) soft else warn))
                content.addView(button("ลบรายการนี้", false) { confirm(model.forgetEntry(e)) })
            }
            content.addView(button("กลับไปรายการวัน", false) { model.closeDay(); render() })
            return
        }
        content.addView(heading("บันทึกการคุย"))
        if (model.journalDays.isEmpty()) content.addView(text("ยังไม่มีบันทึก", 14f, muted))
        for (day in model.journalDays) content.addView(button("${day.day}  (${day.entries} รายการ)", false) { run(model.showDay(day.day)) })
    }

    // ---------- การกระทำ ----------
    private fun confirm(step: NeoDataModel.Step) {
        when (step) {
            is NeoDataModel.Step.Send -> run(step.call)
            is NeoDataModel.Step.Confirm -> AlertDialog.Builder(this).setMessage(step.message)
                .setPositiveButton("ตกลง") { _, _ -> run(step.call) }.setNegativeButton("ยกเลิก", null).show()
        }
    }

    private fun fmt(ms: Long) = SimpleDateFormat("d MMM HH:mm", Locale("th")).format(Date(ms))

    // ---------- ชิ้นส่วนหน้าตา (เหมือน NeoSection) ----------
    private fun text(t: String, size: Float, color: Int = Face.FG, bold: Boolean = false) = TextView(this).apply {
        text = t; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(4), 0, dp(4))
    }
    private fun heading(t: String) = text(t, 18f, bold = true).apply { setPadding(0, dp(20), 0, dp(4)) }
    private fun box() = GradientDrawable().apply { setColor(0xFF131715.toInt()); setStroke(dp(1), 0xFF2E3A35.toInt()); cornerRadius = dp(10).toFloat() }
    private fun field(hint: String, value: String) = EditText(this).apply {
        this.hint = hint; setHintTextColor(0xFF6B7772.toInt()); setTextColor(0xFFE4EBE8.toInt()); textSize = 16f; background = box(); setPadding(dp(12), dp(10), dp(12), dp(10)); isSingleLine = true; setText(value)
        imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
        setOnFocusChangeListener { _, has -> if (!has && stale) post { render() } }
    }
    private fun EditText.watch(onText: (String) -> Unit) = addTextChangedListener(object : TextWatcher {
        override fun afterTextChanged(s: Editable?) { onText(s?.toString().orEmpty()) }
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
    })
    private fun button(t: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; textSize = 14f
        setTextColor(if (primary) Face.BG else Face.FG)
        background = GradientDrawable().apply { setColor(if (primary) Face.FG else 0x00000000); setStroke(dp(1), Face.FG); cornerRadius = dp(10).toFloat() }
        setOnClickListener { onClick() }
        minHeight = dp(46); minimumHeight = dp(46); layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
    }
    private fun switchRow(t: String, on: Boolean, onChange: (Boolean) -> Unit) = android.widget.Switch(this).apply {
        text = t; textSize = 15f; setTextColor(soft); isChecked = on; setPadding(0, dp(8), 0, dp(8))
        setOnCheckedChangeListener { b, v -> if (v != on) { b.setOnCheckedChangeListener(null); onChange(v) } }
    }
}
