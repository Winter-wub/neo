package com.mochi.companion

import org.json.JSONArray
import org.json.JSONObject

/** One HTTP call to the Neo daemon on port 8000 (the path already starts with /api). */
data class Call(val method: String, val path: String, val body: String? = null, val timeoutMs: Int = 30000)

// สถานะ + การกระทำของส่วน "Neo" ในหน้าตั้งค่า (กดค้างหน้า Neo 3 วิ) — ไม่แตะ Android UI เพื่อเทสต์ได้
// อ่านค่าจาก Mac (settings/providers/name/face/models) แล้วอัปเดตสดจาก event; ทุกการกระทำคืน Call ให้ NeoRemote ส่งไป
class NeoSettingsModel {
    sealed class Step {
        data class Send(val call: Call) : Step()
        /** ต้องถามผู้ใช้ก่อน; ถ้าตกลงค่อยส่ง [call] */
        data class Confirm(val message: String, val call: Call) : Step()
    }

    var settings = NeoSettings(); private set
    var providers = NeoProviderList(); private set
    var wake = NeoWakeInfo(); private set
    var face = FaceTheme(); private set
    var models: NeoModelList? = null; private set
    var trainingCount = 0; private set
    var loaded = false; private set
    var modelQuery = ""
    var freeOnly = false
    private var config = NeoProviderConfigView()

    fun loadCalls() = listOf(
        Call("GET", "/api/settings"), Call("GET", "/api/providers"), Call("GET", "/api/name"), Call("GET", "/api/face"),
        Call("POST", "/api/models/list", "{}"),
    )

    /** โหลดตอนเปิดหน้าเพิ่ม/แก้ผู้ให้บริการ */
    fun configCall() = Call("GET", "/api/providers/config")

    /** ใส่คำตอบของ [path] เข้าสถานะ; คำตอบที่เป็น error ไม่ทับของเดิม */
    fun applyReply(path: String, body: String) {
        val o = try { JSONObject(body) } catch (_: Exception) { return }
        if (o.has("error") && o.has("code")) return
        when (path) {
            "/api/settings", "/api/settings/set" -> { settings = NeoSettings.fromJson(o); loaded = true }
            "/api/providers" -> providers = NeoProviderList.fromJson(o)
            "/api/name", "/api/name/set", "/api/name/train", "/api/name/train/cancel" -> {
                wake = NeoWakeInfo.fromJson(o); trainingCount = wake.training?.got?.size ?: 0
            }
            "/api/face" -> face = FaceTheme.fromJson(o)
            "/api/models/list" -> models = NeoModelList.fromJson(o)
            "/api/providers/config" -> if (o.has("providers")) config = NeoProviderConfigView.fromJson(o)
        }
    }

    /** event จาก Mac; คืนสิ่งที่ต้องโหลดใหม่ */
    fun onEvent(ev: ServerEvent): List<Call> {
        when (ev) {
            is ServerEvent.SettingsChanged -> { settings = ev.settings; loaded = true }
            is ServerEvent.Idle -> settings = settings.copy(idle = ev.idle)
            is ServerEvent.ProviderChanged -> {
                providers = providers.copy(current = ev.name)
                return listOf(Call("GET", "/api/providers"), Call("POST", "/api/models/list", "{}"))
            }
            is ServerEvent.ModelChanged -> models = models?.copy(current = ev.model ?: ev.id)
            is ServerEvent.WakeChanged -> wake = wake.copy(name = ev.name, variants = ev.variants)
            is ServerEvent.Face -> face = ev.theme
            is ServerEvent.Training -> trainingCount = ev.n
            else -> {}
        }
        return emptyList()
    }

    // ---- brain / model ----
    fun useBrain(name: String) = Call("POST", "/api/providers/use", ProviderUseRequest(name).toJson())
    /** [id] null = ตัวเริ่มต้นของผู้ให้บริการ */
    fun useModel(id: String?) = Call("POST", "/api/models/use", ModelUseRequest(model = id).toJson())

    fun visibleModels(): List<NeoModelEntry> {
        val q = modelQuery.trim().lowercase()
        return models?.list.orEmpty().filter { m ->
            (!freeOnly || isFree(m)) && (q.isEmpty() || m.id.lowercase().contains(q) || m.name.lowercase().contains(q))
        }
    }

    // ---- settings ----
    fun toggle(name: String, on: Boolean): Step {
        val call = set(name, on.toString())
        return if (name == "bypass" && on) Step.Confirm(BYPASS_WARNING, call) else Step.Send(call)
    }
    fun setSleepAfter(seconds: Int) = set("idle.sleepAfter", seconds.toString())
    fun setClock(on: Boolean) = set("idle.clock", on.toString())
    private fun set(name: String, vararg args: String) = Call("POST", "/api/settings/set", SettingSetRequest(name, args.toList()).toJson())

    // ---- name / face ----
    fun setName(name: String) = Call("POST", "/api/name/set", NameSetRequest(name).toJson())
    fun train(name: String) = Call("POST", "/api/name/train", NameRequest(name).toJson())
    fun cancelTrain() = Call("POST", "/api/name/train/cancel", "{}")
    fun setFaceColour(which: String, hex: String) = Call("POST", "/api/face", JSONObject().put(which, hex).toString())

    // ---- custom providers ----
    /** [apiKey] ว่าง = ไม่ส่ง (คงกุญแจเดิมไว้); กุญแจส่งขึ้นไปทางเดียว ไม่เคยอ่านกลับ */
    fun saveProvider(name: String, cfg: NeoProviderConfig, apiKey: String) =
        Call("POST", "/api/providers/config", ProviderConfigSave(name, cfg, apiKey.ifEmpty { null }).toJson())
    fun removeProvider(name: String) = Call("POST", "/api/providers/config", ProviderConfigSave(name, remove = true).toJson())
    fun hasKey(name: String) = config.keys[name] == true
    fun customProviders() = config.overrides.keys.toList()
    fun configOf(name: String) = config.overrides[name]

    companion object {
        const val BYPASS_WARNING = "Bypass ให้ Neo ทำอะไรบน Mac ก็ได้โดยไม่ถามก่อน (รันคำสั่ง แก้ไฟล์ ลบไฟล์) เปิดเฉพาะเมื่อไว้ใจทุกคนที่คุยกับ Neo ได้"
        fun isFree(m: NeoModelEntry) = m.id.endsWith(":free") || m.name.contains("free", ignoreCase = true) || m.name.contains("ฟรี")
        fun secondsLabel(s: Int): String = when {
            s <= 0 -> "ไม่ได้ตั้ง"
            s < 60 -> "$s วิ"
            s % 60 == 0 -> "${s / 60} นาที"
            else -> "${s / 60} นาที ${s % 60} วิ"
        }
    }
}
