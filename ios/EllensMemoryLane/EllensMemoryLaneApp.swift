import SwiftUI
import WebKit

/// Fullscreen WKWebView shell that hosts "Ellen's Memory Lane" as its own iOS /
/// iPadOS app icon — the iOS counterpart to the Google TV wrapper in `android/`.
///
/// Like the Android app it loads the live site
/// (https://avocadorice.github.io/ellens-memory-lane/), so every Pages deploy
/// updates the app automatically — you only rebuild when you change this wrapper.
///
/// Player 1 plays entirely on the touchscreen: the game shows its on-screen
/// D-pad / JUMP / chop controls on touch devices (see `detectTouch()` in
/// game.js and the safe-area-aware `#mobile-controls` styling in styles.css).
@main
struct EllensMemoryLaneApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = WebViewStore()

    var body: some Scene {
        WindowGroup {
            WebViewContainer(webView: store.webView)
                // Draw under the notch / home indicator; the web layer pads its
                // controls with env(safe-area-inset-*) so nothing is clipped.
                .ignoresSafeArea()
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .background(Color.black)
                .onAppear {
                    UIApplication.shared.isIdleTimerDisabled = true
                    store.load()
                }
                .onChange(of: scenePhase) { phase in
                    switch phase {
                    case .active:
                        // Keep the screen awake during play and resume the
                        // procedural music if it wasn't muted.
                        UIApplication.shared.isIdleTimerDisabled = true
                        store.resumeAudio()
                    case .inactive, .background:
                        // Halt Web Audio immediately when backgrounded.
                        store.suspendAudio()
                    @unknown default:
                        break
                    }
                }
        }
    }
}
