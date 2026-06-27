import SwiftUI
import WebKit

/// Thin SwiftUI bridge that hosts the long-lived WKWebView owned by WebViewStore.
struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
