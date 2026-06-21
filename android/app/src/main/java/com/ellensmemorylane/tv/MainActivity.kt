package com.ellensmemorylane.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
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

    companion object {
        private const val GAME_URL = "https://avocadorice.github.io/ellens-memory-lane/"
        private const val HTTP_PORT = 8080
        private const val WS_PORT = 8081
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

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
        runOnUiThread { hideOverlay() }
    }

    override fun onClientDisconnected(conn: WebSocket) {
        // Make sure no key is left stuck "down" if the phone drops mid-press.
        runOnUiThread { releaseAllKeys() }
    }

    override fun onMessageReceived(conn: WebSocket, message: String) {
        try {
            val obj = JSONObject(message)
            val action = obj.getString("action") // "keydown" | "keyup"
            if (action != "keydown" && action != "keyup") return
            val key = obj.getString("key")

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
            injectKey(action, keyCode, keyName)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun injectKey(action: String, keyCode: Int, keyName: String) {
        val js = "window.dispatchEvent(new KeyboardEvent('$action', " +
            "{ keyCode: $keyCode, which: $keyCode, key: '$keyName', bubbles: true, cancelable: true }));"
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
    }

    override fun onPause() {
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
