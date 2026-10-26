package com.mochi.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.random.Random

class ToolAnimationTest {
    private val host = FakeHost()
    private var t = 1_000_000L
    private val brain = Brain(host, Envelopes.parse(File("src/main/assets/envelopes.json").readText()), t, Random(42))
    private fun run(ms: Long) { val end = t + ms; while (t < end) { t += 100; brain.tick(t) } }
    private fun send(json: String) = brain.onServer(JSONObject(json), t)

    private fun anim(tool: String = "WebSearch") = """{"tool":"$tool","label":"ค้นเว็บ","w":4,"h":4,"palette":{"a":"#ff0000","b":"#00ff00"},
        "frames":[["aaaa","a..a","a..a","aaaa"],["bbbb","b..b","b..b","bbbb"]],"fps":2,"createdBy":"x","at":1}"""
    private fun tool(name: String, animation: String? = null) =
        """{"type":"tool","name":"$name","key":"$name","animation":${animation ?: "null"}}"""

    @Test fun toolWithAnimationShowsItWhileThinking() {
        send("""{"type":"thinking"}"""); assertNull(brain.toolArt)
        send(tool("WebSearch", anim()))
        val art = brain.toolArt!!
        assertEquals(4, art.w); assertEquals(2, art.frames.size); assertEquals(2, art.fps)
        assertEquals(0xFFFF0000.toInt(), art.frames[0][0]); assertEquals(0, art.frames[0][5]) // "." = โปร่งใส
        assertTrue(brain.thinking)
    }

    @Test fun toolWithoutAnimationFallsBackToTextLabel() {
        send("""{"type":"thinking"}"""); send(tool("WebSearch", anim()))
        send(tool("Bash"))
        assertNull(brain.toolArt); run(200)
        assertTrue(brain.sub, brain.sub.startsWith("กำลังรันคำสั่ง"))
    }

    @Test fun animationArrivingMidRunAppearsForTheCurrentTool() {
        send("""{"type":"thinking"}"""); send(tool("WebSearch"))
        assertNull(brain.toolArt)
        send("""{"type":"animation","tool":"Other","animation":${anim("Other")}}"""); assertNull(brain.toolArt)
        send("""{"type":"animation","tool":"WebSearch","animation":${anim()}}"""); assertNotNull(brain.toolArt)
        send("""{"type":"animation","tool":"WebSearch","animation":null}"""); assertNull(brain.toolArt)
    }

    @Test fun clearedByCardErrorCancelOfflineAndNewAsk() {
        fun start() { send("""{"type":"thinking"}"""); send(tool("WebSearch", anim())); assertNotNull(brain.toolArt) }
        start(); send("""{"type":"card","card":null}"""); assertNull(brain.toolArt)
        start(); send("""{"type":"askerr"}"""); assertNull(brain.toolArt)
        start(); send("""{"type":"cancelled"}"""); assertNull(brain.toolArt)
        start(); brain.micState("offline", t); assertNull(brain.toolArt)
        start(); send("""{"type":"thinking"}"""); assertNull(brain.toolArt)
    }

    @Test fun toolEventOutsideAnAskIsIgnored() {
        send(tool("WebSearch", anim())); assertNull(brain.toolArt); assertFalse(brain.thinking)
    }

    @Test fun artFramesLoopAtItsFps() {
        send("""{"type":"thinking"}"""); send(tool("WebSearch", anim()))
        val art = brain.toolArt!!
        assertEquals(0, brain.toolFrame(t + 0)); assertEquals(1, brain.toolFrame(t + 500)); assertEquals(0, brain.toolFrame(t + 1000))
        assertEquals(2, art.frames.size)
    }
}
