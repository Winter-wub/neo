package com.mochi.companion

import org.json.JSONObject

// คลังเสียงร้อง (ตรงกับ SND/NAMES ใน app/index.html)
object Sounds {
    val CATEGORIES: Map<String, List<String>> = mapOf(
        "greet" to listOf("cat_chirp_short", "cat_meow_short_happy", "mouse_squeak_short"),
        "happy" to listOf("cat_trill_med", "dog_bark_short", "cat_meow_short_happy"),
        "curious" to listOf("cat_meow_med_curious", "mouse_squeak_med"),
        "startle" to listOf("cat_meow_short_startled", "dog_bark_short"),
        "sleepy" to listOf("cat_meow_long_sleepy"),
        "sad" to listOf("cat_meow_long_sleepy", "mouse_squeak_long"),
        "angry" to listOf("dog_bark_short", "dog_bark_med"),
        "love" to listOf("cat_trill_med", "cat_purr_med"),
        "excited" to listOf("cat_chirp_short", "cat_meow_short_happy", "dog_bark_short"),
        "confused" to listOf("cat_meow_med_curious", "mouse_squeak_med"),
        "other" to listOf("dog_bark_med", "dog_yelp_long", "mouse_squeak_long"),
    )
    val NAMES = listOf(
        "cat_chirp_short", "cat_meow_long_sleepy", "cat_meow_med_curious", "cat_meow_short_happy", "cat_meow_short_startled",
        "cat_purr_long", "cat_purr_med", "cat_trill_med", "dog_bark_med", "dog_bark_short", "dog_yelp_long",
        "mouse_squeak_long", "mouse_squeak_med", "mouse_squeak_short",
    )
    const val PURR = "cat_purr_long"
    const val SLEEPY = "cat_meow_long_sleepy"
}

// ความดังสูงสุด (0..1) ของแต่ละเสียงทุก stepMs — คำนวณล่วงหน้าด้วย tools/make_envelopes.py
class Envelopes(private val stepMs: Int, private val peaks: Map<String, FloatArray>) {
    fun has(name: String) = peaks.containsKey(name)
    fun durationMs(name: String): Long = peaks[name]?.let { it.size.toLong() * stepMs } ?: 1000L
    fun peak(name: String, tMs: Long): Float {
        val p = peaks[name] ?: return 0f
        val i = (tMs / stepMs).toInt()
        return if (i in p.indices) p[i] else 0f
    }

    companion object {
        fun parse(json: String): Envelopes {
            val o = JSONObject(json)
            val s = o.getJSONObject("sounds")
            val m = HashMap<String, FloatArray>()
            for (k in s.keys()) {
                val a = s.getJSONArray(k)
                m[k] = FloatArray(a.length()) { a.getInt(it) / 100f }
            }
            return Envelopes(o.getInt("stepMs"), m)
        }
    }
}
