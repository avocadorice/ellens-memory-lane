# Feed post (the excerpt)

I built a 2D canvas platformer for my wife that runs on a $30 Google TV stick. But a TV remote D-pad is a terrible gamepad—it debounces to one direction at a time, meaning you physically can't hold "run" and press "jump".

To solve this, I made the TV stick run its own game servers and paired it with a native iOS controller app I had built and abandoned months ago.

Now you just point your iPhone camera at the TV, scan the QR code to pair, and play.

The technical bits:

1. **LAN-Only Architecture for Zero Latency**
Instead of relaying inputs through a cloud database (adding 100ms+ lag), the Google TV app runs a local HTTP server on :8080 and a WebSocket server on :8081. The iOS app connects directly to the TV over the local Wi-Fi. Input latency is basically <10ms.

2. **The HTTPS vs. Local WS Gotcha**
If you want to fall back to a web controller, modern browsers block insecure `ws://` connections from an `https://` page. Since you can't get a TLS certificate for a local IP (e.g. `192.168.1.55`), hosting the web client on GitHub Pages fails.
Solution: Serve the controller web client directly from the TV over plain `http://:8080` so the browser allows the local WebSocket handshake.

3. **Beating Audio Jitter on Weak Hardware**
TV WebViews are notorious for garbage collection stutters that make procedural Web Audio crackle. I fixed it with a custom scheduling loop:
- **1.5s Look-Ahead:** We queue notes 1.5s into the future (instead of the typical 100ms). If the rendering thread chokes, the browser's audio thread already has the schedule.
- **Clock Recovery:** If a main-thread freeze does drop us behind schedule, the engine snaps the beat pointer forward to align with real-time instead of firing a rapid burst of "catch-up" notes.
- **Dynamic Polyphony:** Chords scale down from 4 notes to 2 (root + fifth) on low-end hardware to cut oscillator CPU load.

4. **Kotlin-to-JS Input Injection**
The game engine (Canvas/JS) didn't have to change at all. The TV's Kotlin backend receives JSON packets from the iOS controller and dispatches synthetic KeyboardEvents straight into the WebView:
`webView.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 32 }));", null)`
This bypasses the physical remote's limitations, enabling true multi-touch rollover (holding right + jump simultaneously).

5. **Frankenstein-ing Old Code**
The iOS controller app ("ChillStick") was an old side project sitting on my hard drive. Because I’d designed it with a dead-simple WebSocket protocol—scanning a QR to parse the IP, then sending `{ action: "keydown", key: "thrust" }`—all I had to do was map those keys to the game's jumps and chops. The two projects joined seamlessly in under an hour.

6. **Handling Dirty Disconnects**
If the phone goes to sleep or loses Wi-Fi mid-jump, the player would run off a cliff forever. I mapped lifecycle hooks on both the iOS app and the TV servers to force-release all virtual keys (`keyup`) on disconnect.

Full deep dive on the build, the Gradle configs, and the QR IP auto-discovery: [lnkd.in/your-link-here]

What's your favorite local-network workaround for hardware limits? 👇

#GameDev #AndroidTV #iOSApp #WebSockets #WebAudio #CreativeCoding #SideProjects #VibeCoding #WebViews #Chromecast
