package com.mochi.companion

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool

// เล่นเสียงร้องจาก assets/sounds ด้วย SoundPool (โหลดครั้งเดียว latency ต่ำ)
class SoundBank(ctx: Context) {
    private val pool = SoundPool.Builder().setMaxStreams(6).setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    ).build()
    private val ids = HashMap<String, Int>()
    private val ready = HashSet<Int>()

    init {
        pool.setOnLoadCompleteListener { _, id, status -> if (status == 0) synchronized(ready) { ready.add(id) } }
        for (n in Sounds.NAMES) ctx.assets.openFd("sounds/$n.mp3").use { ids[n] = pool.load(it, 1) }
    }

    val loaded get() = synchronized(ready) { ready.size }

    fun play(name: String, loop: Boolean, rate: Float, volume: Float): Int {
        val id = ids[name] ?: return 0
        if (!synchronized(ready) { id in ready }) return 0
        return pool.play(id, volume, volume, 1, if (loop) -1 else 0, rate)
    }

    fun stop(stream: Int) = pool.stop(stream)
    fun setVolume(stream: Int, v: Float) = pool.setVolume(stream, v, v)
    fun pause() = pool.autoPause()
    fun resume() = pool.autoResume()
    fun release() = pool.release()
}
