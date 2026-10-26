package com.mochi.companion

import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// คุยกับ Neo บน Mac ด้วย device token: ยิงคำสั่งตั้งค่า + ฟัง event สด (GET /api/events) ขณะหน้าตั้งค่าเปิดอยู่
// callback เรียกจาก thread ของตัวเอง ผู้เรียกต้อง post กลับ main thread เอง
class NeoRemote(
    private val base: String,
    token: String,
    private val onEvent: (ServerEvent) -> Unit,
    private val onUnpaired: () -> Unit,
) {
    @Volatile private var running = false
    @Volatile private var events: HttpURLConnection? = null
    private val auth = mapOf("Authorization" to "Bearer $token")

    /** ส่ง [call] แล้วคืน (status, body); status 0 = ติดต่อ Mac ไม่ได้. เรียกจาก thread พื้นหลังเท่านั้น */
    fun send(call: Call): Pair<Int, String> =
        if (call.method == "GET") Net.get("$base${call.path}", 8000, auth)
        else Net.post("$base${call.path}", "application/json", (call.body ?: "{}").toByteArray(), call.timeoutMs, auth)

    fun start() {
        running = true
        thread(name = "neo-settings-events") { loop() }
    }

    fun stop() { running = false; events?.disconnect() }

    private fun loop() {
        while (running) {
            try {
                val c = URL("$base/api/events").openConnection() as HttpURLConnection
                events = c
                c.connectTimeout = 3000; c.readTimeout = 40000
                for ((k, v) in auth) c.setRequestProperty(k, v)
                if (c.responseCode == 401) { onUnpaired(); return }
                c.inputStream.bufferedReader().use { r ->
                    while (running) {
                        val ev = ServerEvent.parseLine(r.readLine() ?: break) ?: continue
                        try { onEvent(ev) } catch (_: Exception) {}
                    }
                }
            } catch (_: Exception) {}
            if (running) try { Thread.sleep(2000) } catch (_: InterruptedException) {}
        }
    }
}
