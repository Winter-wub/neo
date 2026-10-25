package com.mochi.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import kotlin.concurrent.thread

// Neo แบบ native: หน้า pixel + เสียงร้อง + ลูบ ทำงานบนเครื่องเอง ไม่ต้องติดต่อ Mac;
// เสียงไมค์สตรีมไปให้ Mac ประมวลผลทั้งหมด แล้วรับ event กลับมาแสดง (ดู Link.kt, app/voice.js)
class MainActivity : Activity(), Host, android.hardware.SensorEventListener {
    companion object { const val REQ_MIC = 7; const val TICK_MS = 100L } // 10 fps

    private val main = Handler(Looper.getMainLooper())
    private lateinit var cfg: Config.Values
    private lateinit var sounds: SoundBank
    private lateinit var brain: Brain
    private lateinit var view: FaceView
    private var link: Link? = null
    private var resumed = false
    private var askedMic = false // ขอสิทธิ์ครั้งเดียว ไม่เด้งถามวนทุกครั้งที่กลับมา
    private val now get() = SystemClock.uptimeMillis()

    private val ticker = object : Runnable {
        override fun run() { brain.tick(now); dim(brain.watch(now)); view.invalidate(); main.postDelayed(this, TICK_MS) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        cfg = Config.load(this, intent)
        if (!cfg.paired) { openSetup(null); return } // ครั้งแรก: ตั้งค่า/จับคู่ก่อน
        Face.applyTheme(FaceTheme.parse(cfg.face))
        requestedOrientation = cfg.orientation
        sounds = SoundBank(this)
        val env = Envelopes.parse(assets.open("envelopes.json").bufferedReader().use { it.readText() })
        brain = Brain(this, env, now, hour = { java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY) })
        Config.loadPet(this)?.let { (h, a, at) -> brain.restorePet(h, a, System.currentTimeMillis() - at) } // หิวต่อจากที่ปิดแอปไป
        view = FaceView(this, brain, cfg.debug) { openSetup(null) } // กดค้าง 3 วิ = หน้าตั้งค่า
        setContentView(view)
        main.postDelayed({ brain.greet(now) }, 800) // รอเสียงโหลด แล้วทัก
        askFromIntent(intent)
    }

    // ทดสอบการ์ดโดยไม่ต้องพูด (เหมือน ?ask= ของเว็บ): am start ... --es ask "อากาศเป็นไง"
    private fun askFromIntent(i: Intent?) {
        val q = i?.getStringExtra("ask")?.trim().orEmpty()
        if (q.isEmpty()) return
        val url = "${cfg.base}/api/ask"
        main.postDelayed({
            brain.onServer(ServerEvent.Thinking(q), now)
            thread(name = "neo-ask") {
                val (code, body) = Net.post(url, "application/json", AskRequest(q).toJson().toByteArray(), 130000)
                val ev = if (code == 200) ServerEvent.CardShown(try { Card.parse(body) } catch (_: Exception) { null }) else ServerEvent.Askerr
                ui { brain.onServer(ev, now) }
            }
        }, 2500)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); cfg = Config.load(this, intent); requestedOrientation = cfg.orientation; askFromIntent(intent) }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!::view.isInitialized) return
        @Suppress("DEPRECATION")
        if (hasFocus) window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onResume() { super.onResume(); if (!::view.isInitialized) return; resumed = true; sounds.resume(); main.post(ticker); beginMic(); listenShake(true) }
    override fun onPause() { if (!::view.isInitialized) { super.onPause(); return }; listenShake(false); Config.savePet(this, brain.hunger, brain.affection); resumed = false; main.removeCallbacks(ticker); link?.stop(); link = null; sounds.pause(); super.onPause() }
    override fun onDestroy() { main.removeCallbacksAndMessages(null); link?.stop(); if (::sounds.isInitialized) sounds.release(); super.onDestroy() }

    private fun ui(f: () -> Unit) = main.post { f(); view.invalidate() }

    private fun beginMic() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            if (!askedMic) { askedMic = true; requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC) }
            return
        }
        if (link != null || !resumed) return
        link = Link(cfg.base, cfg.token, cfg.source,
            onLevel = { l -> main.post { brain.micLevel = l } },
            onEvent = { ev -> ui { theme(ev); brain.onServer(ev, now) } },
            onProblem = { s -> ui { if (s == "unpaired") openSetup("Mac ยกเลิกการจับคู่เครื่องนี้แล้ว — จับคู่ใหม่") else brain.micState(s, now) } }).also { it.start() }
        if (brain.deep) link?.setMic(false) // กลับมาจากพักหน้าจอระหว่างหลับเป็นตาย: ไมค์ยังปิด
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        if (code != REQ_MIC) return
        if (res.firstOrNull() == PackageManager.PERMISSION_GRANTED) beginMic() else brain.micState("denied", now)
    }

    /** ธีมสีจาก Mac (event face / hello) → เปลี่ยนสีหน้าทันที และจำไว้ใช้ตอนไม่ได้ต่อ */
    private fun theme(ev: ServerEvent) {
        val f = when (ev) { is ServerEvent.Face -> ev.theme; is ServerEvent.Hello -> ev.face; else -> null } ?: return
        if (Face.applyTheme(f)) { Config.saveFace(this, f.toJson().toString()); view.themeChanged() }
    }

    /* ---------- เขย่ามือถือ (accelerometer) ---------- */
    private val sensors by lazy { getSystemService(SENSOR_SERVICE) as android.hardware.SensorManager }
    private fun listenShake(on: Boolean) {
        val acc = sensors.getDefaultSensor(android.hardware.Sensor.TYPE_ACCELEROMETER) ?: return
        if (on) sensors.registerListener(this, acc, android.hardware.SensorManager.SENSOR_DELAY_GAME) else sensors.unregisterListener(this)
    }
    override fun onSensorChanged(e: android.hardware.SensorEvent) {
        val (x, y, z) = Triple(e.values[0], e.values[1], e.values[2])
        brain.shake(kotlin.math.abs(kotlin.math.sqrt(x * x + y * y + z * z) - android.hardware.SensorManager.GRAVITY_EARTH), now)
    }
    override fun onAccuracyChanged(s: android.hardware.Sensor?, a: Int) {}

    /** หน้าปัดนาฬิกา: หรี่จอ (ประหยัดไฟ/ถนอมจอ) — ตื่นแล้วกลับสว่างตามระบบ */
    private var dimmed = false
    private fun dim(on: Boolean) {
        if (on == dimmed) return; dimmed = on
        window.attributes = window.attributes.apply { screenBrightness = if (on) 0.08f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
    }

    private fun openSetup(why: String?) {
        startActivity(android.content.Intent(this, SetupActivity::class.java).apply { if (why != null) putExtra("why", why) })
        finish()
    }

    /* ---------- Host ---------- */
    override fun play(name: String, loop: Boolean, rate: Float, volume: Float) = sounds.play(name, loop, rate, volume)
    override fun stop(id: Int) = sounds.stop(id)
    override fun setVolume(id: Int, volume: Float) = sounds.setVolume(id, volume)
    override fun setSelfSound(on: Boolean) { link?.setSelfSound(on) }
    override fun arm() { link?.arm() }
    override fun alarmStop() { link?.alarmStop() }
    override fun dreamSeen() { link?.dreamSeen() }
    override fun setMic(on: Boolean) { link?.setMic(on) }
    override fun wokeUp() { link?.wokeUp() }
    override fun petStats(hunger: Float, affection: Float) { Config.savePet(this, hunger, affection); link?.petStats(hunger, affection) }
}
