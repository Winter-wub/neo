package com.mochi.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NeoSettingsModelTest {
    private fun model() = NeoSettingsModel()
    private fun ev(s: String) = ServerEvent.fromJson(JSONObject(s))
    private val settingsJson = """{"requireName":true,"followUp":true,"bypass":false,"tailscale":true,"lan":false,"idle":{"sleepAfter":150,"clock":true},"dream":true,"onboarded":true,"claudeConfigDir":null,"home":{"city":"x","lat":1,"lon":2},"mcpServers":null}"""

    @Test fun loadAsksForEverythingTheScreenShows() {
        val calls = model().loadCalls()
        assertEquals(
            listOf("GET /api/settings", "GET /api/providers", "GET /api/name", "GET /api/face", "POST /api/models/list"),
            calls.map { "${it.method} ${it.path}" },
        )
        assertEquals("{}", calls.last().body)
    }

    @Test fun repliesFillTheScreenState() {
        val m = model()
        m.applyReply("/api/settings", settingsJson)
        m.applyReply("/api/providers", """{"current":"claude","list":[{"name":"claude","label":"Claude","type":"claude","found":true,"model":"sonnet"}]}""")
        m.applyReply("/api/name", """{"name":"โมจิ","variants":["โมจิ"],"training":null}""")
        m.applyReply("/api/face", """{"fg":"#fff","accent":"#a","cheek":"#c","bg":"#000"}""")
        assertTrue(m.loaded)
        assertTrue(m.settings.requireName)
        assertEquals(150L, m.settings.idle?.sleepAfter)
        assertEquals("claude", m.providers.current)
        assertEquals("โมจิ", m.wake.name)
        assertEquals("#a", m.face.accent)
    }

    @Test fun anErrorReplyKeepsWhatWeHad() {
        val m = model()
        m.applyReply("/api/settings", settingsJson)
        m.applyReply("/api/settings", """{"error":"nope","code":1}""")
        assertTrue(m.settings.requireName)
    }

    // ---- live updates from events ----
    @Test fun settingsEventReplacesSettingsWithoutReloading() {
        val m = model(); m.applyReply("/api/settings", settingsJson)
        val calls = m.onEvent(ev("""{"type":"settings","bypass":true,"requireName":false,"followUp":true,"dream":false,"idle":{"sleepAfter":60,"clock":false}}"""))
        assertTrue(calls.isEmpty())
        assertTrue(m.settings.bypass); assertFalse(m.settings.requireName); assertEquals(60L, m.settings.idle?.sleepAfter)
    }

    @Test fun idleEventUpdatesOnlyIdle() {
        val m = model(); m.applyReply("/api/settings", settingsJson)
        m.onEvent(ev("""{"type":"idle","sleepAfter":300,"clock":false}"""))
        assertEquals(300L, m.settings.idle?.sleepAfter); assertEquals(false, m.settings.idle?.clock)
        assertTrue(m.settings.requireName)
    }

    @Test fun providerEventSwitchesBrainAndReloadsItsModels() {
        val m = model()
        m.applyReply("/api/providers", """{"current":"claude","list":[{"name":"claude","label":"Claude"},{"name":"openrouter","label":"OpenRouter"}]}""")
        val calls = m.onEvent(ev("""{"type":"provider","name":"openrouter","label":"OpenRouter"}"""))
        assertEquals("openrouter", m.providers.current)
        assertEquals(listOf("GET /api/providers", "POST /api/models/list"), calls.map { "${it.method} ${it.path}" })
    }

    @Test fun modelEventSetsCurrentModel() {
        val m = model()
        m.applyReply("/api/models/list", """{"name":"openrouter","mapped":[],"list":[{"id":"a","name":"A"}],"current":"a"}""")
        m.onEvent(ev("""{"type":"model","name":"openrouter","model":"b","id":"b"}"""))
        assertEquals("b", m.models?.current)
    }

    @Test fun wakeFaceDevicesEvents() {
        val m = model()
        m.onEvent(ev("""{"type":"wake","name":"มะลิ","variants":["มะลิ","มะลิน"]}"""))
        assertEquals("มะลิ", m.wake.name); assertEquals(2, m.wake.variants.size)
        m.onEvent(ev("""{"type":"face","fg":"#1","accent":"#2","cheek":"#3","bg":"#4"}"""))
        assertEquals("#2", m.face.accent)
        m.onEvent(ev("""{"type":"train","name":"มะลิ","n":2,"text":"มะลิ"}"""))
        assertEquals(2, m.trainingCount)
    }

    @Test fun unrelatedEventsDoNothing() {
        assertTrue(model().onEvent(ev("""{"type":"rec"}""")).isEmpty())
    }

    // ---- brain / model ----
    @Test fun switchingBrainAndModelBuildTheRightCalls() {
        val m = model()
        val b = m.useBrain("openrouter")
        assertEquals("POST", b.method); assertEquals("/api/providers/use", b.path); assertEquals("""{"name":"openrouter"}""", b.body)
        val u = m.useModel("x/y:free")
        assertEquals("/api/models/use", u.path); assertEquals("x/y:free", JSONObject(u.body!!).getString("model"))
        assertTrue(JSONObject(m.useModel(null).body!!).isNull("model") || !JSONObject(m.useModel(null).body!!).has("model"))
    }

    @Test fun modelsCanBeSearchedAndFreeOnesFound() {
        val m = model()
        m.applyReply("/api/models/list", """{"name":"openrouter","mapped":[],"current":null,"list":[
            {"id":"meta/llama-3:free","name":"Llama 3"},{"id":"openai/gpt-5","name":"GPT-5"},{"id":"google/gemma:free","name":"Gemma (free)"}]}""")
        assertEquals(3, m.visibleModels().size)
        m.freeOnly = true
        assertEquals(listOf("meta/llama-3:free", "google/gemma:free"), m.visibleModels().map { it.id })
        m.modelQuery = "gemma"
        assertEquals(listOf("google/gemma:free"), m.visibleModels().map { it.id })
        m.freeOnly = false; m.modelQuery = "GPT"
        assertEquals(listOf("openai/gpt-5"), m.visibleModels().map { it.id })
    }

    // ---- toggles ----
    @Test fun togglesSendSettingsSet() {
        val m = model()
        val r = m.toggle("followUp", false) as NeoSettingsModel.Step.Send
        assertEquals("/api/settings/set", r.call.path)
        val j = JSONObject(r.call.body!!)
        assertEquals("followUp", j.getString("name")); assertEquals("false", j.getJSONArray("args").getString(0))
    }

    @Test fun bypassAsksBeforeTurningOnAndNotBeforeTurningOff() {
        val m = model()
        assertTrue(m.toggle("bypass", true) is NeoSettingsModel.Step.Confirm)
        assertTrue(m.toggle("bypass", false) is NeoSettingsModel.Step.Send)
        val c = m.toggle("bypass", true) as NeoSettingsModel.Step.Confirm
        assertTrue(c.message.isNotEmpty())
        val call = c.call
        assertEquals("true", JSONObject(call.body!!).getJSONArray("args").getString(0))
    }

    @Test fun idleSettingsUseDottedNames() {
        val m = model()
        val s = JSONObject(m.setSleepAfter(90).body!!)
        assertEquals("idle.sleepAfter", s.getString("name")); assertEquals("90", s.getJSONArray("args").getString(0))
        val c = JSONObject(m.setClock(false).body!!)
        assertEquals("idle.clock", c.getString("name")); assertEquals("false", c.getJSONArray("args").getString(0))
    }

    // ---- name, face, provider config ----
    @Test fun nameAndTrainingCalls() {
        val m = model()
        assertEquals("/api/name/set", m.setName("มะลิ").path)
        assertEquals("""{"name":"มะลิ"}""", m.setName("มะลิ").body)
        assertEquals("/api/name/train", m.train("มะลิ").path)
        assertEquals("/api/name/train/cancel", m.cancelTrain().path)
    }

    @Test fun faceColoursSendOnlyTheChangedOne() {
        val m = model()
        val c = m.setFaceColour("accent", "#ff8800")
        assertEquals("/api/face", c.path)
        assertEquals("""{"accent":"#ff8800"}""", c.body)
    }

    @Test fun customProviderKeyGoesInAndIsNeverShownBack() {
        val m = model()
        val save = m.saveProvider("mine", NeoProviderConfig(type = "openai", baseUrl = "https://x/v1", model = "m"), apiKey = "sk-123")
        assertEquals("/api/providers/config", save.path)
        val j = JSONObject(save.body!!)
        assertEquals("mine", j.getString("name")); assertEquals("sk-123", j.getString("apiKey")); assertEquals("https://x/v1", j.getJSONObject("cfg").getString("baseUrl"))
        // an edit without typing a key does not send one (keeps the stored key)
        assertFalse(JSONObject(m.saveProvider("mine", NeoProviderConfig(type = "openai"), apiKey = "").body!!).has("apiKey"))
        assertTrue(JSONObject(m.removeProvider("mine").body!!).getBoolean("remove"))
        m.applyReply("/api/providers/config", """{"default":"claude","providers":{"mine":{"type":"openai"}},"overrides":{"mine":{"type":"openai"}},"discovered":[],"keys":{"mine":true}}""")
        assertTrue(m.hasKey("mine")); assertFalse(m.hasKey("other"))
        assertEquals(listOf("mine"), m.customProviders())
    }

    @Test fun summaryTextsAreThai() {
        assertEquals("ไม่ได้ตั้ง", NeoSettingsModel.secondsLabel(0))
        assertEquals("2 นาที 30 วิ", NeoSettingsModel.secondsLabel(150))
        assertEquals("1 นาที", NeoSettingsModel.secondsLabel(60))
        assertEquals("45 วิ", NeoSettingsModel.secondsLabel(45))
        assertNull(NeoSettingsModel().models)
    }
}
