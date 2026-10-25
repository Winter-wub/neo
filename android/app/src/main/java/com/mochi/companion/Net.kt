package com.mochi.companion

import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.media.MediaRecorder
import java.net.HttpURLConnection
import java.net.URL

// ที่อยู่ backend บน Mac: ค่าเริ่มต้น localhost:8000 (ผ่าน `adb reverse tcp:8000 tcp:8000`)
// เปลี่ยนได้ด้วย `am start -n com.mochi.companion/.MainActivity --es base http://...` (จำไว้ใน SharedPreferences)
object Config {
    const val DEFAULT_BASE = "http://localhost:8000"
    private const val PREFS = "neo"
    // แหล่งเสียงไมค์ ลองเทียบบนเครื่องจริงได้ด้วย --es mic vr|mic|vc|raw (จำไว้)
    private val SOURCES = mapOf(
        "vr" to MediaRecorder.AudioSource.VOICE_RECOGNITION, "mic" to MediaRecorder.AudioSource.MIC,
        "vc" to MediaRecorder.AudioSource.VOICE_COMMUNICATION, "raw" to MediaRecorder.AudioSource.UNPROCESSED,
    )

    // การหมุนจอ: auto = ตามการวางเครื่องจริง (ไม่สนล็อกหมุนจอ), portrait/landscape = ล็อก — ตั้งด้วย --es orient …
    private val ORIENT = mapOf(
        "auto" to ActivityInfo.SCREEN_ORIENTATION_SENSOR,
        "portrait" to ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT,
        "landscape" to ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
    )

    data class Values(val base: String, val debug: Boolean, val mic: String, val orient: String, val token: String, val face: String) {
        val paired get() = base.isNotEmpty()
        val orientation get() = ORIENT[orient] ?: ActivityInfo.SCREEN_ORIENTATION_SENSOR
        val source get() = SOURCES[mic] ?: MediaRecorder.AudioSource.VOICE_RECOGNITION
    }

    fun load(ctx: Context, intent: Intent?): Values {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val e = p.edit()
        intent?.getStringExtra("base")?.trim()?.trimEnd('/')?.takeIf { it.startsWith("http") }?.let { e.putString("base", it) }
        if (intent?.hasExtra("debug") == true) e.putBoolean("debug", intent.getBooleanExtra("debug", false))
        intent?.getStringExtra("mic")?.takeIf { it in SOURCES }?.let { e.putString("mic", it) }
        intent?.getStringExtra("orient")?.takeIf { it in ORIENT }?.let { e.putString("orient", it) }
        e.apply()
        return Values(p.getString("base", "") ?: "", p.getBoolean("debug", false), p.getString("mic", "vr") ?: "vr", p.getString("orient", "auto") ?: "auto",
            p.getString("token", "") ?: "", p.getString("face", "") ?: "")
    }

    /** หลังจับคู่สำเร็จ (หน้า SetupActivity) */
    fun savePairing(ctx: Context, base: String, token: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("base", base).putString("token", token).apply()
    }
    /** ความหิว/ความรัก + เวลาที่บันทึก (เวลาจริง) */
    fun savePet(ctx: Context, hunger: Float, affection: Float) { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putFloat("hunger", hunger).putFloat("affection", affection).putLong("petAt", System.currentTimeMillis()).apply() }
    fun loadPet(ctx: Context): Triple<Float, Float, Long>? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return if (p.contains("petAt")) Triple(p.getFloat("hunger", 0.3f), p.getFloat("affection", 0.4f), p.getLong("petAt", 0)) else null
    }
    fun saveFace(ctx: Context, json: String) { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("face", json).apply() }
}

object Net {
    /** GET แล้วคืน (status, body); status 0 = ติดต่อไม่ได้ */
    fun get(url: String, timeoutMs: Int = 6000, headers: Map<String, String> = emptyMap()): Pair<Int, String> = try {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs; for ((k, v) in headers) c.setRequestProperty(k, v)
            val code = c.responseCode
            code to ((if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "")
        } finally { c.disconnect() }
    } catch (e: Exception) { 0 to "" }

    /** POST แล้วคืน (status, body); status 0 = ติดต่อไม่ได้ */
    fun post(url: String, type: String, body: ByteArray, readTimeoutMs: Int, headers: Map<String, String> = emptyMap()): Pair<Int, String> = try {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 5000; c.readTimeout = readTimeoutMs
            c.setRequestProperty("Content-Type", type); c.setFixedLengthStreamingMode(body.size)
            for ((k, v) in headers) c.setRequestProperty(k, v)
            c.outputStream.use { it.write(body) }
            val code = c.responseCode
            val s = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            code to s
        } finally { c.disconnect() }
    } catch (e: Exception) { 0 to "" }
}
