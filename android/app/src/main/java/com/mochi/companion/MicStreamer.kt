package com.mochi.companion

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import kotlin.math.sqrt

// อัดเสียง 16kHz mono ดิบ → ตัดช่วงที่มีคนพูด (VAD ง่าย ๆ) → ส่งให้ Mac ถอดเสียง (whisper) → ส่งข้อความกลับหน้าเว็บ
class MicStreamer(
    private val base: String,
    private val onLevel: (Float) -> Unit,
    private val onState: (String) -> Unit,
    private val onText: (String) -> Unit,
    private val onLoud: () -> Unit,
) {
    @Volatile private var running = false
    @Volatile private var selfSound = false
    @Volatile private var quietUntil = 0L
    private var th: Thread? = null

    fun setSelfSound(on: Boolean) { selfSound = on; if (!on) quietUntil = System.currentTimeMillis() + 700 }
    fun start() { running = true; th = thread(name = "mochi-mic") { loop() } }
    fun stop() { running = false; th?.join(500) }

    private fun loop() {
        val rate = 16000; val chunk = 1600 // 100 มิลลิวินาที
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try { AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, chunk * 4)) }
                  catch (e: Exception) { onState("error"); return }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { onState("error"); rec.release(); return }
        rec.startRecording()
        val buf = ShortArray(chunk)
        val pre = ArrayDeque<ShortArray>()
        var seg: ArrayList<ShortArray>? = null
        var quiet = 0; var floor = 0.01f; var lastLoud = 0L
        while (running) {
            val n = rec.read(buf, 0, chunk); if (n <= 0) continue
            var s = 0.0; for (i in 0 until n) { val v = buf[i] / 32768.0; s += v * v }
            val rms = sqrt(s / n).toFloat()
            val copy = buf.copyOf(n)
            onLevel(rms)
            if (selfSound || System.currentTimeMillis() < quietUntil) { seg = null; pre.clear(); quiet = 0; continue }
            if (rms < floor * 1.5f + 0.01f) floor += (rms - floor) * 0.02f
            val now = System.currentTimeMillis()
            if (rms - floor > 0.35f && now - lastLoud > 3000) { lastLoud = now; onLoud() }
            val loud = rms > floor + 0.02f
            if (seg == null) {
                pre.addLast(copy); if (pre.size > 6) pre.removeFirst()
                if (loud) { seg = ArrayList(pre); pre.clear(); quiet = 0; onState("rec") }
            } else {
                seg.add(copy); quiet = if (rms > floor + 0.012f) 0 else quiet + 1
                if (seg.size >= 120 || quiet >= 9) {
                    val done = seg; seg = null; quiet = 0
                    if (done.size > 12) send(done) else onState("idle")
                }
            }
        }
        rec.stop(); rec.release()
    }

    private fun send(chunks: List<ShortArray>) {
        onState("sending")
        thread {
            try {
                val pcm = ByteArrayOutputStream()
                for (c in chunks) for (v in c) { pcm.write(v.toInt() and 0xff); pcm.write((v.toInt() shr 8) and 0xff) }
                val data = pcm.toByteArray()
                val wav = ByteArrayOutputStream()
                fun i32(x: Int) { wav.write(x and 0xff); wav.write((x shr 8) and 0xff); wav.write((x shr 16) and 0xff); wav.write((x shr 24) and 0xff) }
                fun i16(x: Int) { wav.write(x and 0xff); wav.write((x shr 8) and 0xff) }
                wav.write("RIFF".toByteArray()); i32(36 + data.size); wav.write("WAVEfmt ".toByteArray())
                i32(16); i16(1); i16(1); i32(16000); i32(32000); i16(2); i16(16); wav.write("data".toByteArray()); i32(data.size); wav.write(data)
                val body = wav.toByteArray()
                val c = URL("$base/api/stt").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 5000; c.readTimeout = 30000
                c.setRequestProperty("Content-Type", "audio/wav"); c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { it.write(body) }
                val text = JSONObject(c.inputStream.bufferedReader().readText()).optString("text", "")
                onState("idle"); onText(text)
            } catch (e: Exception) { onState("neterr") }
        }
    }
}
