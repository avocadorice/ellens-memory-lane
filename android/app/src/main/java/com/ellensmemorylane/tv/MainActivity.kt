package com.ellensmemorylane.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.java_websocket.WebSocket
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

/**
 * Fullscreen WebView shell that hosts "Ellen's Memory Lane" as its own Google TV
 * launcher tile.
 *
 * It also turns the TV into a tiny game host so a phone can be used as an extra
 * controller: an HTTP server (:8080) serves a controller web page, a WebSocket
 * server (:8081) receives that page's touch inputs, and those inputs are injected
 * into the game as keyboard events. A QR overlay shows the pairing URL. The TV
 * remote keeps working the whole time — the phone is purely additive.
 */
class MainActivity : Activity(), GamepadServer.ServerListener {

    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private lateinit var overlay: View
    private lateinit var urlLabel: TextView
    private lateinit var qrImage: ImageView

    private var gamepad: GamepadServer? = null
    private var http: ControllerHttpServer? = null
    private var overlayVisible = false
    private var pairingWsUrl: String = ""

    // Co-op Player 2 routing. The game calls beginPlayer2Pairing() (via the
    // AndroidBridge JS interface) when the "2 Players" prompt opens; the next phone
    // to connect is then bound as Player 2 and its input is delivered as slot-tagged
    // 'ctrl' CustomEvents. Every other controller (and the TV remote) stays Player 1
    // and keeps driving the game + UI through synthesised key events, as before.
    @Volatile private var p2Conn: WebSocket? = null
    @Volatile private var expectingP2 = false

    companion object {
        private const val GAME_URL = "https://avocadorice.github.io/ellens-memory-lane/"
        private const val HTTP_PORT = 8080
        private const val WS_PORT = 8081
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Allow remote inspection of the WebView over adb (chrome://inspect / CDP),
        // so the game's real on-device FPS can be profiled.
        WebView.setWebContentsDebuggingEnabled(true)

        webView = WebView(this).apply {
            setBackgroundColor(0xFF000000.toInt())
            isFocusable = true
            isFocusableInTouchMode = true
        }
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = true
            allowContentAccess = true
        }
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        // Lets the game ask for the pairing QR + arm Player-2 pairing at the husband
        // milestone (see the 2-player prompt in game.js).
        webView.addJavascriptInterface(WebBridge(), "AndroidBridge")

        root = FrameLayout(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        overlay = buildOverlay()
        root.addView(overlay)
        setContentView(root)

        startServers()

        webView.loadUrl(GAME_URL)
        webView.requestFocus()

        // Show the pairing QR on launch (covering the start screen); any remote
        // key dismisses it so the user can just play with the remote.
        showOverlay()
    }

    // ---- Servers ---------------------------------------------------------

    private fun startServers() {
        val ip = getLocalIpAddress() ?: "127.0.0.1"
        // The ChillStick app scans this QR and connects straight to the WebSocket;
        // it expects a bare ws:// address.
        val wsUrl = "ws://$ip:$WS_PORT"
        pairingWsUrl = wsUrl
        urlLabel.text = wsUrl
        qrImage.setImageBitmap(makeQr(wsUrl, 640))

        try {
            http = ControllerHttpServer(HTTP_PORT, assets).also { it.start() }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        try {
            gamepad = GamepadServer(WS_PORT, this).also { it.start() }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onClientConnected(conn: WebSocket) {
        // If the game is waiting for Player 2, the first phone to connect claims it
        // and we tell the game so Barney is promoted to Player 2.
        if (expectingP2 && p2Conn == null) {
            p2Conn = conn
            expectingP2 = false
            runOnUiThread {
                webView.evaluateJavascript(
                    "try{ if (Game && Game.onPlayer2Connected) Game.onPlayer2Connected(); }catch(e){}",
                    null,
                )
            }
        }
        runOnUiThread { hideOverlay() }
    }

    override fun onClientDisconnected(conn: WebSocket) {
        if (conn == p2Conn) p2Conn = null
        // Make sure no key is left stuck "down" if the phone drops mid-press.
        runOnUiThread { releaseAllKeys() }
    }

    override fun onMessageReceived(conn: WebSocket, message: String) {
        try {
            val obj = JSONObject(message)
            val action = obj.getString("action") // "keydown" | "keyup"
            if (action != "keydown" && action != "keyup") return
            val key = obj.getString("key")

            // "Back" from the phone = exit the game, same as the remote's Back
            // button (sends the app to the background → Google TV home).
            if (key == "back") {
                if (action == "keydown") runOnUiThread { @Suppress("DEPRECATION") onBackPressed() }
                return
            }

            // Two button vocabularies are accepted: our own (jump/chop) and the
            // ChillStick app's fixed labels (thrust/brake), mapped to the same
            // game actions — thrust = jump, brake = chop.
            val keyCode = when (key) {
                "left" -> 37            // ArrowLeft
                "right" -> 39           // ArrowRight
                "jump", "thrust" -> 32  // Space (jump / bounce; also advances dialogue)
                "chop", "brake" -> 13   // Enter (karate chop / racket swing; also confirms)
                else -> return
            }
            val keyName = when (key) {
                "left" -> "ArrowLeft"
                "right" -> "ArrowRight"
                "jump", "thrust" -> " "
                "chop", "brake" -> "Enter"
                else -> ""
            }
            if (conn == p2Conn) {
                // Player 2 (co-op): gameplay-only input, tagged slot 1. The game
                // routes it to Barney/Preston; raw key names (left/right/jump/chop/
                // thrust/brake) are normalised game-side.
                injectCtrl(action, key, 1)
            } else {
                // Player 1 (and all menu/UI navigation): synthesise a real key event,
                // exactly as before.
                injectKey(action, keyCode, keyName)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun injectKey(action: String, keyCode: Int, keyName: String) {
        val js = "window.dispatchEvent(new KeyboardEvent('$action', " +
            "{ keyCode: $keyCode, which: $keyCode, key: '$keyName', bubbles: true, cancelable: true }));"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    private fun injectCtrl(action: String, key: String, slot: Int) {
        val js = "window.dispatchEvent(new CustomEvent('ctrl', " +
            "{ detail: { action: '$action', key: '$key', slot: $slot } }));"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    private fun releaseAllKeys() {
        listOf(37 to "ArrowLeft", 39 to "ArrowRight", 32 to " ", 13 to "Enter").forEach {
            injectKey("keyup", it.first, it.second)
        }
    }

    // ---- QR pairing overlay ---------------------------------------------

    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    /**
     * "Choose your controller" screen: two cards side by side — the TV remote on
     * the left, the phone QR pairing on the right. Either path leads into the game.
     */
    private fun buildOverlay(): View {
        val scrim = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xE6120A06.toInt())
            visibility = View.GONE
            isClickable = true // swallow stray touches
        }

        val heading = TextView(this).apply {
            text = "How do you want to play?"
            setTextColor(Color.WHITE)
            textSize = 28f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(22))
        }

        val cards = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        cards.addView(buildRemoteCard())
        cards.addView(buildPhoneCard())

        scrim.addView(heading)
        scrim.addView(cards)
        return scrim
    }

    private fun cardBackground(): GradientDrawable = GradientDrawable().apply {
        cornerRadius = dp(20).toFloat()
        setColor(0xFF1f140d.toInt())
        setStroke(dp(2), 0x33FFFFFF)
    }

    private fun cardParams() = LinearLayout.LayoutParams(dp(300), LinearLayout.LayoutParams.WRAP_CONTENT)
        .apply { marginStart = dp(14); marginEnd = dp(14) }

    private fun buildRemoteCard(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = cardBackground()
            setPadding(dp(22), dp(26), dp(22), dp(26))
            layoutParams = cardParams()
        }
        val icon = TextView(this).apply {
            text = "🕹️"
            textSize = 56f
            gravity = Gravity.CENTER
        }
        val title = TextView(this).apply {
            text = "TV Remote"
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(10))
        }
        val desc = TextView(this).apply {
            text = "D-pad ◀ ▶ to move\nUp / OK to jump\nOK / Select to chop\n\nPress any remote button to start"
            setTextColor(0xCCFFFFFF.toInt())
            textSize = 15f
            gravity = Gravity.CENTER
        }
        card.addView(icon)
        card.addView(title)
        card.addView(desc)
        return card
    }

    private fun buildPhoneCard(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = cardBackground()
            setPadding(dp(22), dp(26), dp(22), dp(26))
            layoutParams = cardParams()
        }
        val title = TextView(this).apply {
            text = "📱 ChillStick App"
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(12))
        }
        qrImage = ImageView(this).apply {
            val s = dp(170)
            // White quiet-zone around the QR so phone cameras lock on fast.
            setBackgroundColor(Color.WHITE)
            setPadding(dp(8), dp(8), dp(8), dp(8))
            layoutParams = LinearLayout.LayoutParams(s, s)
        }
        urlLabel = TextView(this).apply {
            setTextColor(0xFFFFD8C2.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(6))
        }
        val desc = TextView(this).apply {
            text = "Open the ChillStick app and scan this\n(phone on the same Wi-Fi as the TV)"
            setTextColor(0xCCFFFFFF.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
        }
        card.addView(title)
        card.addView(qrImage)
        card.addView(urlLabel)
        card.addView(desc)
        return card
    }

    private fun showOverlay() {
        overlay.visibility = View.VISIBLE
        overlayVisible = true
    }

    private fun hideOverlay() {
        overlay.visibility = View.GONE
        overlayVisible = false
        webView.requestFocus()
    }

    private fun getLocalIpAddress(): String? {
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (networkInterface in interfaces) {
                if (!networkInterface.isUp || networkInterface.isLoopback) continue
                val addresses = Collections.list(networkInterface.inetAddresses)
                for (address in addresses) {
                    if (!address.isLoopbackAddress && address is Inet4Address) {
                        val ip = address.hostAddress ?: continue
                        if (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.")) {
                            return ip
                        }
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return null
    }

    private fun makeQr(text: String, size: Int): Bitmap {
        val hints = mapOf(EncodeHintType.MARGIN to 1)
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        for (x in 0 until size) {
            for (y in 0 until size) {
                bmp.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
            }
        }
        return bmp
    }

    // ---- JS ↔ native bridge (2-player pairing) ---------------------------

    inner class WebBridge {
        @JavascriptInterface
        fun isAndroid(): Boolean = true

        // Arm Player-2 pairing: the next phone to connect becomes Player 2.
        @JavascriptInterface
        fun beginPlayer2Pairing() {
            expectingP2 = true
        }

        // Cancel pairing (e.g. the player chose "Continue Solo").
        @JavascriptInterface
        fun cancelPlayer2Pairing() {
            expectingP2 = false
        }

        // The pairing QR as a PNG data URL, so the web 2-player prompt can show it
        // inline (no native overlay covering the prompt's buttons).
        @JavascriptInterface
        fun getQrDataUrl(): String {
            return try {
                val url = if (pairingWsUrl.isNotEmpty()) pairingWsUrl else "ws://127.0.0.1:$WS_PORT"
                val bmp = makeQr(url, 320)
                val baos = java.io.ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.PNG, 100, baos)
                "data:image/png;base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            } catch (e: Exception) {
                ""
            }
        }
    }

    // ---- Input routing ---------------------------------------------------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val code = event.keyCode
            // While the overlay is up, the first key press just dismisses it.
            if (overlayVisible) {
                hideOverlay()
                return true
            }
            // Summon the pairing overlay again on demand.
            if (code == KeyEvent.KEYCODE_MENU ||
                code == KeyEvent.KEYCODE_INFO ||
                code == KeyEvent.KEYCODE_GUIDE
            ) {
                showOverlay()
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    // ---- Lifecycle -------------------------------------------------------

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        webView.onResume()
        // Resume the synthesized music if the player hadn't muted it. (Android's
        // WebView.onPause/onResume doesn't reliably fire the page's
        // visibilitychange, so we drive the AudioContext explicitly.)
        webView.evaluateJavascript(
            "try{ if (AudioEngine.userMusicOn && AudioEngine.ctx && " +
                "AudioEngine.ctx.state==='suspended') AudioEngine.ctx.resume(); }catch(e){}",
            null,
        )
    }

    override fun onPause() {
        // Halt Web Audio immediately so music doesn't keep playing after Back.
        webView.evaluateJavascript(
            "try{ if (AudioEngine.ctx && AudioEngine.ctx.state==='running') " +
                "AudioEngine.ctx.suspend(); }catch(e){}",
            null,
        )
        webView.onPause()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (overlayVisible) { hideOverlay(); return }
        if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
    }

    override fun onDestroy() {
        try { gamepad?.stop() } catch (_: Exception) {}
        try { http?.stop() } catch (_: Exception) {}
        webView.destroy()
        super.onDestroy()
    }
}
