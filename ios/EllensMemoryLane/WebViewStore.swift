import SwiftUI
import WebKit

/// Owns the single WKWebView for the app's lifetime and drives the small bits of
/// native behaviour the game expects from a host (the same touch-points the
/// Android wrapper handles): autoplay-capable inline media, no rubber-band
/// scrolling over the canvas, and explicit Web Audio resume/suspend on
/// foreground/background.
final class WebViewStore: NSObject, ObservableObject, WKNavigationDelegate {

    /// The live site. Every Pages deploy updates the app automatically.
    /// To ship fully offline instead, bundle the web files and point this at
    /// `Bundle.main.url(forResource: "index", withExtension: "html", ...)`.
    static let gameURL = URL(string: "https://avocadorice.github.io/ellens-memory-lane/")!

    let webView: WKWebView

    override init() {
        let config = WKWebViewConfiguration()
        // The game's procedural Web Audio + any media must start without a
        // tap-through gesture requirement (the start button is the gesture).
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let wv = WKWebView(frame: .zero, configuration: config)
        // It's a fixed-viewport game, not a scrollable page — kill panning,
        // bouncing, and zoom so dragging on the canvas never scrolls the WebView.
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.bounces = false
        wv.scrollView.bouncesZoom = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.allowsBackForwardNavigationGestures = false
        wv.isOpaque = false
        wv.backgroundColor = .black
        wv.scrollView.backgroundColor = .black

        self.webView = wv
        super.init()
        wv.navigationDelegate = self
    }

    func load() {
        // Avoid reloading on every SwiftUI re-render.
        guard webView.url == nil else { return }
        webView.load(URLRequest(url: Self.gameURL))
    }

    /// Resume the synthesized BGM if the player hadn't muted it (WKWebView does
    /// not reliably fire `visibilitychange`, so we drive the AudioContext, mirroring
    /// the Android wrapper).
    func resumeAudio() {
        webView.evaluateJavaScript(
            "try{ if (AudioEngine.userMusicOn && AudioEngine.ctx && " +
            "AudioEngine.ctx.state==='suspended') AudioEngine.ctx.resume(); }catch(e){}",
            completionHandler: nil
        )
    }

    /// Stop Web Audio immediately so music doesn't keep playing in the background.
    func suspendAudio() {
        webView.evaluateJavaScript(
            "try{ if (AudioEngine.ctx && AudioEngine.ctx.state==='running') " +
            "AudioEngine.ctx.suspend(); }catch(e){}",
            completionHandler: nil
        )
    }
}
