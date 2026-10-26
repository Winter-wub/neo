package com.mochi.companion

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.concurrent.thread

// ส่วน "Neo" ที่ด้านบนของหน้าตั้งค่า (เมื่อจับคู่แล้ว): คุมสมอง/โมเดล/การฟัง/หน้า/ชื่อของ Neo บน Mac
// ค่ามาจาก NeoSettingsModel และอัปเดตสดจาก event; ที่นี่มีแต่การวาด + ส่งคำสั่ง
class NeoSection(private val act: Activity, base: String, token: String, private val onUnpaired: () -> Unit) {
    val view = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL }
    private val model = NeoSettingsModel()
    private val remote = NeoRemote(base, token, { ev -> act.runOnUiThread { handle(ev) } }, { act.runOnUiThread(onUnpaired) })
    private val d = act.resources.displayMetrics.density
    private var note = "กำลังโหลดค่าจาก Mac …"
    private var stale = false // มี event เข้ามาตอนกำลังพิมพ์ → วาดใหม่ทีหลัง
    private var showAllModels = false
    @Volatile private var alive = false

    private fun dp(x: Int) = (x * d).toInt()
    private val muted = 0xFF86928D.toInt()
    private val soft = 0xFFB9C4BF.toInt()

    fun start() { alive = true; remote.start(); reload(); render() }
    fun stop() { alive = false; remote.stop() }

    private fun reload() { (model.loadCalls() + model.configCall()).forEach { run(it) } }

    /** ส่งคำสั่งที่พื้นหลัง → ใส่คำตอบเข้าโมเดล → วาดใหม่ */
    private fun run(call: Call, after: (() -> Unit)? = null) {
        thread(name = "neo-settings-call") {
            val (code, body) = remote.send(call)
            if (!alive) return@thread
            act.runOnUiThread {
                when {
                    code == 401 -> onUnpaired()
                    code == 0 -> note = "ติดต่อ Mac ไม่ได้"
                    code in 200..299 -> { model.applyReply(call.path, body); note = ""; if (call.path == "/api/providers/use" || call.path == "/api/models/use") run(Call("POST", "/api/models/list", "{}")) }
                    code == 404 -> note = "Neo บน Mac เป็นรุ่นเก่า ยังไม่รองรับการตั้งค่าจากมือถือ"
                    else -> note = try { org.json.JSONObject(body).optString("error").ifEmpty { "ทำไม่สำเร็จ ($code)" } } catch (_: Exception) { "ทำไม่สำเร็จ ($code)" }
                }
                after?.invoke(); render()
            }
        }
    }

    private fun handle(ev: ServerEvent) {
        val calls = model.onEvent(ev)
        calls.forEach { run(it) }
        render()
    }

    // ---------- วาด ----------
    private fun focusedInside() = view.findFocus() is EditText

    fun render() {
        if (focusedInside()) { stale = true; return }
        stale = false
        view.removeAllViews()
        view.addView(title("Neo บน Mac"))
        if (note.isNotEmpty()) view.addView(text(note, 14f, 0xFFFFB38A.toInt()))
        if (!model.loaded) return
        brainSection(); listeningSection(); sleepSection(); petSection(); faceSection(); dataSection()
        view.addView(text("ที่อยู่ Mac / จับคู่ใหม่", 20f, bold = true).apply { setPadding(0, dp(28), 0, dp(4)) })
    }

    private fun dataSection() {
        view.addView(heading("งาน · ความจำ · ความฝัน"))
        for ((label, p) in listOf("งานตั้งเวลา / ปลุก" to NeoDataModel.Page.JOBS, "ความจำ" to NeoDataModel.Page.MEMORY, "ความฝัน" to NeoDataModel.Page.DREAMS, "บันทึกการคุย (journal)" to NeoDataModel.Page.JOURNAL))
            view.addView(button(label, false) { act.startActivity(android.content.Intent(act, NeoDataActivity::class.java).putExtra("page", p.ordinal)) })
    }

    private fun brainSection() {
        view.addView(heading("สมอง"))
        val found = model.providers.list
        if (found.isEmpty()) view.addView(text("ไม่พบสมองที่ใช้ได้", 14f, muted))
        for (p in found) view.addView(choice(p.label.ifEmpty { p.name } + (if (!p.found) " (ยังไม่พร้อม)" else ""), p.name == model.providers.current) {
            run(model.useBrain(p.name))
        })
        view.addView(text("โมเดล: ${model.models?.current ?: "ค่าเริ่มต้น"}", 15f, soft))
        model.models?.error?.takeIf { it.isNotEmpty() }?.let { view.addView(text(it, 13f, 0xFFFFB38A.toInt())) }
        view.addView(button("ใช้โมเดลเริ่มต้น", false) { run(model.useModel(null)) })
        view.addView(switchRow("เฉพาะรุ่นฟรี", model.freeOnly) { model.freeOnly = it; render() })
        view.addView(field("ค้นหาโมเดล", model.modelQuery).apply {
            addTextChangedListener(object : android.text.TextWatcher {
                override fun afterTextChanged(s: android.text.Editable?) { model.modelQuery = s?.toString().orEmpty() }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
            setOnEditorActionListener { _, _, _ -> clearFocus(); render(); true }
        })
        val all = model.visibleModels(); val shown = if (showAllModels) all else all.take(12)
        for (m in shown) view.addView(choice(m.name.ifEmpty { m.id } + if (NeoSettingsModel.isFree(m)) "  · ฟรี" else "", m.id == model.models?.current) { run(model.useModel(m.id)) })
        if (all.size > shown.size) view.addView(button("ดูอีก ${all.size - shown.size} รุ่น", false) { showAllModels = true; render() })
        for (name in model.customProviders()) view.addView(button("แก้ $name${if (model.hasKey(name)) " (มีกุญแจ)" else ""}", false) { editProvider(name) })
        view.addView(button("เพิ่มผู้ให้บริการเอง", false) { editProvider(null) })
    }

    private fun listeningSection() {
        val s = model.settings
        view.addView(heading("การฟัง"))
        view.addView(switchRow("ต้องเรียกชื่อก่อน", s.requireName) { send(model.toggle("requireName", it)) })
        view.addView(text("ถ้าปิด Neo จะตอบทุกอย่างที่ได้ยิน", 12f, muted))
        view.addView(switchRow("คุยต่อได้ 45 วิ ไม่ต้องเรียกชื่อซ้ำ", s.followUp) { send(model.toggle("followUp", it)) })
        view.addView(switchRow("Bypass (ทำได้ทุกอย่างไม่ถาม)", s.bypass) { send(model.toggle("bypass", it)) })
        view.addView(text("อันตราย: ให้ Neo รันคำสั่งและแก้ไฟล์บน Mac ได้เอง", 12f, 0xFFFFB38A.toInt()))
    }

    private fun sleepSection() {
        val s = model.settings; val secs = (s.idle?.sleepAfter ?: 150L).toInt()
        view.addView(heading("หลับ / นาฬิกา"))
        view.addView(text("หลับหลังเงียบ ${NeoSettingsModel.secondsLabel(secs)}", 15f, soft))
        val row = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL }
        for ((label, v) in listOf("30วิ" to 30, "1น." to 60, "2.5น." to 150, "5น." to 300, "15น." to 900))
            row.addView(button(label, secs == v) { run(model.setSleepAfter(v)) }, LinearLayout.LayoutParams(0, -2, 1f))
        view.addView(row)
        view.addView(switchRow("ขึ้นหน้าปัดนาฬิกาตอนหลับ", s.idle?.clock ?: true) { run(model.setClock(it)) })
        view.addView(switchRow("ฝัน (จัดความจำตอนไม่มีใคร)", s.dream) { send(model.toggle("dream", it)) })
    }

    private fun petSection() {
        view.addView(heading("ชื่อสัตว์เลี้ยง"))
        view.addView(text("ตอนนี้: ${model.wake.name.ifEmpty { "-" }}" + if (model.wake.variants.isNotEmpty()) "  (ฟังเป็น ${model.wake.variants.joinToString(", ")})" else "", 15f, soft))
        val name = field("ชื่อใหม่", ""); view.addView(name)
        view.addView(button("ตั้งชื่อ", false) { name.text.toString().trim().takeIf { it.isNotEmpty() }?.let { run(model.setName(it)) } })
        view.addView(button("ฝึกให้ฟังชื่อนี้ (พูดชื่อหลายครั้ง)", false) { (name.text.toString().trim().ifEmpty { model.wake.name }).takeIf { it.isNotEmpty() }?.let { run(model.train(it)) } })
        model.wake.training?.let {
            view.addView(text("กำลังฝึก \"${it.name}\" — ได้ยินแล้ว ${model.trainingCount} ครั้ง", 14f, soft))
            view.addView(button("ยกเลิกการฝึก", false) { run(model.cancelTrain()) })
        }
    }

    private fun faceSection() {
        view.addView(heading("สีหน้า"))
        for ((key, label, hex) in listOf(Triple("fg", "สีหน้า", model.face.fg), Triple("accent", "สีเน้น", model.face.accent), Triple("cheek", "สีแก้ม", model.face.cheek), Triple("bg", "สีพื้น", model.face.bg))) {
            val row = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
            row.addView(View(act).apply { background = GradientDrawable().apply { setColor(parse(hex)); setStroke(dp(1), muted); cornerRadius = dp(6).toFloat() } }, LinearLayout.LayoutParams(dp(28), dp(28)).apply { rightMargin = dp(10) })
            row.addView(text(label, 15f, soft), LinearLayout.LayoutParams(0, -2, 1f))
            val f = field("#rrggbb", hex).apply { textSize = 14f; setOnEditorActionListener { _, _, _ ->
                text.toString().trim().takeIf { Regex("#[0-9a-fA-F]{6}").matches(it) }?.let { run(model.setFaceColour(key, it)) } ?: run { note = "สีต้องเป็นแบบ #rrggbb"; render() }; true } }
            row.addView(f, LinearLayout.LayoutParams(dp(130), -2))
            view.addView(row)
        }
    }

    // ---------- การกระทำ ----------
    private fun send(step: NeoSettingsModel.Step) = when (step) {
        is NeoSettingsModel.Step.Send -> run(step.call)
        is NeoSettingsModel.Step.Confirm -> {
            AlertDialog.Builder(act).setTitle("เปิด Bypass?").setMessage(step.message)
                .setPositiveButton("เปิด") { _, _ -> run(step.call) }
                .setNegativeButton("ไม่เปิด") { _, _ -> render() } // สวิตช์เด้งกลับตามค่าจริง
                .setOnCancelListener { render() }.show(); Unit
        }
    }

    private fun editProvider(existing: String?) {
        val cfg = existing?.let { model.configOf(it) }
        val col = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        val name = EditText(act).apply { hint = "ชื่อ (ตัวเล็ก ไม่มีเว้นวรรค)"; setText(existing ?: ""); isEnabled = existing == null }
        val url = EditText(act).apply { hint = "Base URL เช่น https://openrouter.ai/api/v1"; setText(cfg?.baseUrl ?: ""); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        val mdl = EditText(act).apply { hint = "โมเดลเริ่มต้น"; setText(cfg?.model ?: "") }
        val key = EditText(act).apply { hint = if (existing != null && model.hasKey(existing)) "API key (มีอยู่แล้ว — เว้นว่างเพื่อคงเดิม)" else "API key"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        listOf(name, url, mdl, key).forEach { col.addView(it) }
        val b = AlertDialog.Builder(act).setTitle(if (existing == null) "เพิ่มผู้ให้บริการ (OpenAI-compatible)" else "แก้ $existing").setView(col)
            .setPositiveButton("บันทึก") { _, _ ->
                val n = name.text.toString().trim()
                if (n.isEmpty()) { note = "ใส่ชื่อก่อน"; render(); return@setPositiveButton }
                val next = (cfg ?: NeoProviderConfig()).copy(type = "openai", baseUrl = url.text.toString().trim().ifEmpty { null }, model = mdl.text.toString().trim().ifEmpty { null })
                run(model.saveProvider(n, next, key.text.toString().trim())) { run(model.configCall()); run(Call("GET", "/api/providers")) }
            }.setNegativeButton("ยกเลิก", null)
        if (existing != null) b.setNeutralButton("ลบ") { _, _ -> run(model.removeProvider(existing)) { run(model.configCall()); run(Call("GET", "/api/providers")) } }
        b.show()
    }

    // ---------- ชิ้นส่วนหน้าตา (เหมือนหน้าตั้งค่าเดิม) ----------
    private fun parse(hex: String) = try { Color.parseColor(hex) } catch (_: Exception) { Color.GRAY }
    private fun text(t: String, size: Float, color: Int = Face.FG, bold: Boolean = false) = TextView(act).apply {
        text = t; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(4), 0, dp(4))
    }
    private fun title(t: String) = text(t, 26f, bold = true)
    private fun heading(t: String) = text(t, 18f, bold = true).apply { setPadding(0, dp(20), 0, dp(4)) }
    private fun box() = GradientDrawable().apply { setColor(0xFF131715.toInt()); setStroke(dp(1), 0xFF2E3A35.toInt()); cornerRadius = dp(10).toFloat() }
    private fun field(hint: String, value: String) = EditText(act).apply {
        this.hint = hint; setHintTextColor(0xFF6B7772.toInt()); setTextColor(0xFFE4EBE8.toInt()); textSize = 16f; background = box(); setPadding(dp(12), dp(10), dp(12), dp(10)); isSingleLine = true; setText(value)
        imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
        setOnFocusChangeListener { _, has -> if (!has && stale) post { render() } }
    }
    private fun button(t: String, primary: Boolean, onClick: () -> Unit) = Button(act).apply {
        text = t; isAllCaps = false; textSize = 14f
        setTextColor(if (primary) Face.BG else Face.FG)
        background = GradientDrawable().apply { setColor(if (primary) Face.FG else 0x00000000); setStroke(dp(1), Face.FG); cornerRadius = dp(10).toFloat() }
        setOnClickListener { onClick() }
        minHeight = dp(46); minimumHeight = dp(46); layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
    }
    private fun choice(t: String, selected: Boolean, onClick: () -> Unit) = button((if (selected) "● " else "○ ") + t, selected, onClick)
    private fun switchRow(t: String, on: Boolean, onChange: (Boolean) -> Unit) = android.widget.Switch(act).apply {
        text = t; textSize = 15f; setTextColor(soft); isChecked = on; setPadding(0, dp(8), 0, dp(8))
        setOnCheckedChangeListener { b, v -> if (v != on) { b.setOnCheckedChangeListener(null); onChange(v) } }
    }
}
