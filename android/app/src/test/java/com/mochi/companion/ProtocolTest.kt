package com.mochi.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EventLineTest {
    @Test fun pingLineIsDropped() {
        assertNull(ServerEvent.parseLine("""{"type":"ping"}"""))
    }
    @Test fun cardWhoseTextIsPingIsKept() {
        val e = ServerEvent.parseLine("""{"type":"card","card":{"title":"ping","lines":["ping"]}}""")
        assertTrue(e is ServerEvent.CardShown)
        assertEquals("ping", (e as ServerEvent.CardShown).card?.title)
        val h = ServerEvent.parseLine("""{"type":"heard","text":"ping"}""")
        assertEquals("ping", (h as ServerEvent.Heard).text)
    }
    @Test fun blankAndGarbageLinesAreDropped() {
        assertNull(ServerEvent.parseLine(""))
        assertNull(ServerEvent.parseLine("   "))
        assertNull(ServerEvent.parseLine("not json"))
        assertNull(ServerEvent.parseLine("[1,2]"))
    }
}

class EventParseTest {
    private fun ev(s: String) = ServerEvent.fromJson(JSONObject(s))

    @Test fun unknownTypeIsKept() {
        assertEquals(ServerEvent.Unknown("quantum"), ev("""{"type":"quantum","x":1}"""))
        assertEquals(ServerEvent.ProviderChanged("a", ""), ev("""{"type":"provider","name":"a"}"""))
    }
    @Test fun missingTypeIsUnknown() {
        assertEquals(ServerEvent.Unknown(""), ev("{}"))
    }
    @Test fun missingFieldsFallBackLikeOpt() {
        assertEquals(ServerEvent.Heard(""), ev("""{"type":"heard"}"""))
        assertEquals(ServerEvent.Tool(""), ev("""{"type":"tool"}"""))
        assertEquals(ServerEvent.Job(""), ev("""{"type":"job"}"""))
        assertEquals(ServerEvent.Feed(""), ev("""{"type":"feed"}"""))
        assertEquals(ServerEvent.AlarmOff(0), ev("""{"type":"alarm_off"}"""))
        assertEquals(ServerEvent.Hello(), ev("""{"type":"hello"}"""))
        assertEquals(ServerEvent.Idle(IdleSettings()), ev("""{"type":"idle"}"""))
        assertEquals(ServerEvent.CardShown(null), ev("""{"type":"card"}"""))
        assertEquals(ServerEvent.Alarm(null), ev("""{"type":"alarm","card":"oops"}"""))
    }
    @Test fun fieldsAreRead() {
        assertEquals(ServerEvent.Heard("สวัสดี"), ev("""{"type":"heard","text":"สวัสดี","at":5}"""))
        assertEquals(ServerEvent.AlarmOff(10), ev("""{"type":"alarm_off","id":"a","snooze":10}"""))
        assertEquals(ServerEvent.Idle(IdleSettings(600, false)), ev("""{"type":"idle","sleepAfter":600,"clock":false}"""))
        val h = ev("""{"type":"hello","thinking":true,"idle":{"sleepAfter":30},"face":{"fg":"#112233","accent":"#445566","cheek":"#778899","bg":"#000000"}}""") as ServerEvent.Hello
        assertTrue(h.thinking)
        assertEquals(IdleSettings(30, null), h.idle)
        assertEquals(FaceTheme("#112233", "#445566", "#778899", "#000000"), h.face)
        assertEquals(FaceTheme("#fff000", "", "", ""), (ev("""{"type":"face","fg":"#fff000"}""") as ServerEvent.Face).theme)
    }
    @Test fun cardsInEventsAreParsed() {
        val c = (ev("""{"type":"dream_done","card":{"title":"ฝัน","lines":["a"],"seconds":20}}""") as ServerEvent.DreamDone).card
        assertEquals("ฝัน", c?.title); assertEquals(20, c?.seconds)
        assertEquals("ฝัน", (ev("""{"type":"alarm","card":{"title":"ฝัน"}}""") as ServerEvent.Alarm).card?.title)
    }
    @Test fun noEventTypeCarriesRawJson() {
        // เหตุการณ์ที่ไม่มีฟิลด์ → object เดียวกันเสมอ
        assertTrue(ev("""{"type":"rec"}""") === ServerEvent.Rec)
    }
}

class ResponseTest {
    @Test fun pairResponse() {
        assertEquals(PairResponse("abc", "มะม่วง", null), PairResponse.parse("""{"token":"abc","id":"1","name":"มะม่วง"}"""))
        assertEquals(PairResponse("", "Neo", "รหัสผิด"), PairResponse.parse("""{"error":"รหัสผิด"}"""))
        assertEquals(PairResponse("", "Neo", null), PairResponse.parse("<html>"))
    }
    private fun same(expected: String, actual: String) = assertTrue("$actual != $expected", JSONObject(expected).similar(JSONObject(actual)))
    @Test fun requestsSerialize() {
        same("""{"code":"123456","name":"X Y"}""", PairRequest("123456", "X Y").toJson())
        same("""{"hunger":0.5,"affection":0.25}""", PetRequest(0.5f, 0.25f).toJson())
        same("""{"text":"hi"}""", AskRequest("hi").toJson())
    }
    @Test fun faceThemeStoredAndRestored() {
        val t = FaceTheme("#7fffd4", "#ff7aa8", "#ff9a9a", "#000000")
        assertEquals(t, FaceTheme.parse(t.toJson().toString()))
        assertNull(FaceTheme.parse("")); assertNull(FaceTheme.parse("{bad"))
    }
}
