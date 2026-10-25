package com.mochi.companion

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import kotlin.math.sqrt

// ช่องทางคุยกับ Mac: มือถือแค่สตรีมเสียงไมค์ดิบขึ้นไป (POST /api/audio) และรับ event กลับ (GET /api/events)
// การตัดช่วงพูด ถอดเสียง ตรวจชื่อ ยกเลิก ค้นหา อยู่บน Mac ทั้งหมด (app/voice.js) — จูนได้โดยไม่ต้องติดตั้งแอปใหม่
// callback เรียกจาก thread ของตัวเอง ผู้เรียกต้อง post กลับ main thread เอง
class Link(
    private val base: String,
    private val token: String, // จากการจับคู่ (Tailscale) — ว่าง = ต่อผ่าน adb reverse
    private val source: Int,
    private val onLevel: (Float) -> Unit,
    private val onEvent: (ServerEvent) -> Unit,
    private val onProblem: (String) -> Unit, // "error" = เปิดไมค์ไม่ได้, "offline" = ต่อ Mac ไม่ได้
) {
    @Volatile private var running = false
    @Volatile private var selfSound = false
    @Volatile private var quietUntil = 0L
    @Volatile private var upload: HttpURLConnection? = null
    @Volatile private var events: HttpURLConnection? = null
    private val threads = ArrayList<Thread>()

    /** Neo กำลังร้อง → ส่งเสียงเงียบแทน; หยุดร้องแล้วรออีก 0.3 วิ กันเสียงก้อง */
    fun setSelfSound(on: Boolean) { selfSound = on; if (!on) quietUntil = System.currentTimeMillis() + 300 } // สั้นพอให้พูดต่อได้ทันทีหลังร้องตอบ

    fun start() {
        running = true
        threads += thread(name = "neo-audio") { audioLoop() }
        threads += thread(name = "neo-events") { eventLoop() }
    }

    fun stop() {
        running = false
        upload?.disconnect(); events?.disconnect()
        threads.forEach { it.join(800) }; threads.clear()
    }

    private val auth = if (token.isNotEmpty()) mapOf("Authorization" to "Bearer $token") else emptyMap()
    fun arm() = post("/api/arm")
    fun alarmStop() = post("/api/alarm/stop")
    fun wokeUp() = post("/api/wakeup")
    /** ปิดไมค์จริง (หลับเป็นตาย): หยุดอัดเสียงและปิดสตรีมเสียง แต่ยังรับ event จาก Mac */
    @Volatile private var micOn = true
    fun setMic(on: Boolean) { micOn = on; if (!on) upload?.disconnect() }
    fun dreamSeen() = post("/api/dream/seen")
    fun petStats(hunger: Float, affection: Float) = post("/api/pet", PetRequest(hunger, affection).toJson())
    private fun post(path: String, body: String = "{}") { thread(name = "neo-post") { Net.post("$base$path", "application/json", body.toByteArray(), 5000, auth) } }

    @SuppressLint("MissingPermission") // MainActivity เช็คสิทธิ์ก่อน start; ถ้าโดนถอนสิทธิ์ try ข้างล่างจับ SecurityException
    private fun audioLoop() {
        while (running) {
            if (!micOn) { onLevel(0f); try { Thread.sleep(300) } catch (_: InterruptedException) {}; continue }
            if (!recordUntilMicOff()) return // เปิดไมค์ไม่ได้: หยุดแค่เสียง (ยังรับ event)
        }
    }

    @SuppressLint("MissingPermission")
    private fun recordUntilMicOff(): Boolean {
        val rate = 16000; val chunk = 1600 // 100 ms
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try { AudioRecord(source, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, chunk * 8)) }
                  catch (e: Exception) { onProblem("error"); return false }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { onProblem("error"); rec.release(); return false }
        rec.startRecording()
        val buf = ShortArray(chunk); val bytes = ByteArray(chunk * 2)
        try {
            while (running && micOn) {
                var c: HttpURLConnection? = null
                try {
                    c = (URL("$base/api/audio").openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"; doOutput = true; connectTimeout = 3000
                        setRequestProperty("Content-Type", "application/octet-stream")
                        for ((k, v) in auth) setRequestProperty(k, v)
                        setChunkedStreamingMode(bytes.size)
                    }
                    upload = c
                    val out = c.outputStream
                    while (running && micOn) {
                        val n = rec.read(buf, 0, chunk); if (n <= 0) continue
                        var s = 0.0
                        for (i in 0 until n) { val x = buf[i] / 32768.0; s += x * x }
                        onLevel(sqrt(s / n).toFloat())
                        val mute = selfSound || System.currentTimeMillis() < quietUntil
                        for (i in 0 until n) { val v = if (mute) 0 else buf[i].toInt(); bytes[2 * i] = v.toByte(); bytes[2 * i + 1] = (v shr 8).toByte() }
                        out.write(bytes, 0, n * 2); out.flush()
                    }
                    out.close(); c.responseCode
                } catch (e: Exception) {
                    if (running && micOn) { onProblem("offline"); drain(rec, buf, 2000) } // รอแล้วต่อใหม่ (ทิ้งเสียงระหว่างรอ)
                } finally { c?.disconnect() }
            }
        } finally { rec.stop(); rec.release() }
        return true
    }

    private fun drain(rec: AudioRecord, buf: ShortArray, ms: Long) {
        val end = System.currentTimeMillis() + ms
        while (running && System.currentTimeMillis() < end) if (rec.read(buf, 0, buf.size) > 0) onLevel(0f)
    }

    private fun eventLoop() {
        while (running) {
            try {
                val c = URL("$base/api/events").openConnection() as HttpURLConnection
                events = c
                c.connectTimeout = 3000; c.readTimeout = 40000 // Mac ส่ง ping ทุก 15 วิ
                for ((k, v) in auth) c.setRequestProperty(k, v)
                if (c.responseCode == 401) { onProblem("unpaired"); return } // ถูกยกเลิกการจับคู่ → ต้องจับคู่ใหม่
                c.inputStream.bufferedReader().use { r ->
                    while (running) {
                        val line = r.readLine() ?: break
                        val ev = ServerEvent.parseLine(line) ?: continue
                        try { onEvent(ev) } catch (_: Exception) {}
                    }
                }
            } catch (e: Exception) { if (running) onProblem("offline") }
            if (running) try { Thread.sleep(2000) } catch (_: InterruptedException) {}
        }
    }
}
