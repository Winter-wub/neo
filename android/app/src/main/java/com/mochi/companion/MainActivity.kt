package com.mochi.companion

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView

// เปลือก WebView ของโมจิ: โหลดหน้าเว็บเดิมจาก Mac (ผ่าน adb reverse) + อัดเสียงดิบจากไมค์เอง (ไม่ผ่านตัวกรองของ Chrome)
class MainActivity : Activity() {
    companion object { const val BASE = "http://localhost:8000"; const val REQ_MIC = 7 }

    private lateinit var web: WebView
    private var mic: MicStreamer? = null
    private var micWanted = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        WebView.setWebContentsDebuggingEnabled(true)
        web.webChromeClient = WebChromeClient()
        web.addJavascriptInterface(Bridge(), "Android")
        web.loadUrl("$BASE/index.html?native=1")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onPause() { super.onPause(); mic?.stop(); mic = null }
    override fun onResume() { super.onResume(); if (micWanted) beginMic() }
    override fun onDestroy() { mic?.stop(); web.destroy(); super.onDestroy() }

    private fun js(code: String) = web.post { web.evaluateJavascript(code, null) }

    private fun beginMic() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC); return
        }
        if (mic != null) return
        mic = MicStreamer(BASE,
            onLevel = { l -> js("window.onNativeLevel&&onNativeLevel($l)") },
            onState = { s -> js("window.onNativeState&&onNativeState('$s')") },
            onText = { t -> js("window.onNativeText&&onNativeText(" + org.json.JSONObject.quote(t) + ")") },
            onLoud = { js("window.onNativeLoud&&onNativeLoud()") }).also { it.start() }
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        if (code == REQ_MIC && res.firstOrNull() == PackageManager.PERMISSION_GRANTED && micWanted) beginMic()
        else if (code == REQ_MIC) js("window.onNativeState&&onNativeState('denied')")
    }

    inner class Bridge {
        @JavascriptInterface fun startMic(): Boolean { micWanted = true; runOnUiThread { beginMic() }; return true }
        @JavascriptInterface fun setSelfSound(on: Boolean) { mic?.setSelfSound(on) }
    }
}
