package com.ellensmemorylane.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Fullscreen WebView shell that hosts "Ellen's Memory Lane" so it gets its own
 * Google TV launcher tile instead of being opened through a browser.
 *
 * The game itself still lives on GitHub Pages, so deploying the web build
 * automatically updates what this app shows — no need to rebuild the APK for
 * gameplay changes. To ship a fully offline build instead, bundle the web files
 * under app/src/main/assets/ and point GAME_URL at the file:// path below.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    companion object {
        // Live build (auto-updates with each Pages deploy):
        private const val GAME_URL = "https://avocadorice.github.io/ellens-memory-lane/"
        // Offline build (uncomment + drop the web files in app/src/main/assets/):
        // private const val GAME_URL = "file:///android_asset/index.html"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Don't let the TV dim/sleep during play
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this).apply {
            setBackgroundColor(0xFF000000.toInt())
            // D-pad input: the WebView must be focusable so remote key events
            // reach the page (the game listens for ArrowKeys / Enter, etc.).
            isFocusable = true
            isFocusableInTouchMode = true
        }
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Let the background music start without a separate tap
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = true            // needed only for the offline file:// option
            allowContentAccess = true
        }

        webView.webViewClient = WebViewClient()      // keep navigation inside the WebView
        webView.webChromeClient = WebChromeClient()  // enables fullscreen/media APIs

        webView.loadUrl(GAME_URL)
        webView.requestFocus()
    }

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

    // Remote BACK: step back in the game if possible, otherwise send the app to
    // the background instead of killing it — so an accidental press mid-gift
    // doesn't end the whole thing.
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
