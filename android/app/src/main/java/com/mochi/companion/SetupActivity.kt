package com.mochi.companion

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

// หน้าตั้งค่าครั้งแรก / จับคู่ใหม่ (กดค้างที่หน้า Neo 3 วิ): ใส่ที่อยู่ Mac (วิธีไหนก็ได้: Tailscale/VPN, IP ใน Wi-Fi, URL tunnel ของผู้ใช้)
// + รหัส 6 หลักจาก Neo.app → ได้ token; หรือ "ใช้สาย USB" = adb reverse (localhost ไม่ต้องจับคู่)
class SetupActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var host: EditText
    private lateinit var code: EditText
    private lateinit var pairBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cfg = Config.load(this, null)
        Face.applyTheme(FaceTheme.parse(cfg.face))
        val d = resources.displayMetrics.density
        fun dp(x: Int) = (x * d).toInt()
        fun text(t: String, size: Float, color: Int = Face.FG, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(6), 0, dp(6))
        }
        fun box() = GradientDrawable().apply { setColor(0xFF131715.toInt()); setStroke(dp(1), 0xFF2E3A35.toInt()); cornerRadius = dp(10).toFloat() }
        fun field(hint: String) = EditText(this).apply {
            this.hint = hint; setHintTextColor(0xFF6B7772.toInt()); setTextColor(0xFFE4EBE8.toInt()); textSize = 17f; background = box(); setPadding(dp(14), dp(12), dp(14), dp(12)); isSingleLine = true
        }
        fun button(t: String, primary: Boolean) = Button(this).apply {
            text = t; isAllCaps = false; textSize = 16f
            setTextColor(if (primary) Face.BG else Face.FG)
            background = GradientDrawable().apply { setColor(if (primary) Face.FG else 0x00000000); setStroke(dp(1), Face.FG); cornerRadius = dp(10).toFloat() }
        }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(28), dp(24), dp(28)); setBackgroundColor(Face.BG) }
        col.addView(text("ตั้งค่า Neo", 26f, bold = true))
        intent.getStringExtra("why")?.let { col.addView(text(it, 15f, 0xFFFFB38A.toInt())) }
        col.addView(text("1. บน Mac เปิด Neo.app แล้วกด \"จับคู่มือถือ\" — จะขึ้นรหัส 6 หลักและที่อยู่ที่ใช้ได้\n2. ใส่ที่อยู่แบบไหนก็ได้ที่มือถือนี้ไปถึง Mac:\n   • Tailscale/VPN: my-mac.tailnet.ts.net หรือ 100.x.x.x\n   • Wi-Fi เดียวกัน: 192.168.x.x (เปิดใน Neo.app ก่อน)\n   • URL ของคุณเอง: https://neo.example.com\n3. ใส่รหัส แล้วกดจับคู่", 15f, 0xFFB9C4BF.toInt()))
        col.addView(text("ที่อยู่ของ Mac", 14f, 0xFF86928D.toInt()))
        host = field("ชื่อเครื่อง, IP หรือ URL").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(cfg.base.takeIf { it.isNotEmpty() && !it.contains("localhost") }?.removePrefix("http://")?.removeSuffix(":8000") ?: "")
        }
        col.addView(host)
        col.addView(text("รหัสจับคู่ 6 หลัก", 14f, 0xFF86928D.toInt()))
        code = field("123456").apply { inputType = InputType.TYPE_CLASS_NUMBER; textSize = 24f; letterSpacing = 0.3f; gravity = Gravity.CENTER }
        col.addView(code)
        pairBtn = button("จับคู่", true).apply { setOnClickListener { pair() } }
        col.addView(pairBtn, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(18) })
        status = text("", 15f, 0xFFB9C4BF.toInt())
        col.addView(status)
        col.addView(button("ใช้สาย USB (adb reverse) แทน", false).apply {
            setOnClickListener { Config.savePairing(this@SetupActivity, Config.DEFAULT_BASE, ""); done() }
        }, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(24) })
        setContentView(ScrollView(this).apply { setBackgroundColor(Face.BG); addView(col) })
        window.decorView.setBackgroundColor(Face.BG)
    }

    private fun say(t: String) = runOnUiThread { status.text = t }

    private fun pair() {
        val h = host.text.toString().trim().trimEnd('/'); val c = code.text.toString().trim()
        if (h.isEmpty() || c.length != 6) { say("ใส่ชื่อ Mac และรหัส 6 หลัก"); return }
        val base = if (h.startsWith("http")) h else if (Regex(":\\d+$").containsMatchIn(h)) "http://$h" else "http://$h:8000"
        pairBtn.isEnabled = false; say("กำลังติดต่อ $base …")
        thread(name = "neo-pair") {
            val (hc, hb) = Net.get("$base/api/hello")
            if (hc != 200 || !hb.contains("\"neo\"")) {
                say(if (hc == 0) "ติดต่อ $base ไม่ได้ — Neo.app เปิดอยู่ไหม และมือถือไปถึง Mac ทางนี้ได้ไหม (VPN/Wi-Fi/tunnel)" else "ที่อยู่นี้ไม่ใช่ Neo ($hc)")
                runOnUiThread { pairBtn.isEnabled = true }; return@thread
            }
            val body = PairRequest(c, Build.MANUFACTURER + " " + Build.MODEL).toJson().toByteArray()
            val (pc, pb) = Net.post("$base/api/pair", "application/json", body, 8000)
            val j = PairResponse.parse(pb)
            if (pc == 200 && j.token.isNotEmpty()) {
                Config.savePairing(this, base, j.token)
                say("จับคู่กับ ${j.name} แล้ว")
                runOnUiThread { done() }
            } else { say(j.error ?: "จับคู่ไม่สำเร็จ ($pc)"); runOnUiThread { pairBtn.isEnabled = true } }
        }
    }

    private fun done() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE }
}
