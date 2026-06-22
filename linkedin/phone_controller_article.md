# Read-more article (the "go all out" technical deep-dive)

> Publish this as a LinkedIn Article. LinkedIn gives it a short lnkd.in URL —
> paste that URL back into the feed post (phone_controller_post.md).

---

## A $30 TV stick that hosts its own game server — and turns your phone into a controller with one QR scan

If you've followed along, you know the backstory: instead of buying my wife the fancy gift, I built her a side-scrolling platformer that walks through a decade of our memories together, running at 60 FPS on a cheap Chromecast-class stick in the living room. No game engine — just HTML5 Canvas, a sprinkle of WebAssembly, and procedural Web Audio.

It shipped. And then I had to actually *play* it on the couch, which surfaced the one thing I'd been avoiding: **a TV remote is a terrible gamepad.**

This is the story of fixing that without an app store, a cable, or a Bluetooth controller — by making the TV stick host its own game server and turning any phone into a wireless controller you pair by scanning a QR code.

### The real problem: a D-pad that can't hold two directions

The game runs on a Google TV stick through a tiny native Kotlin app — basically a fullscreen WebView pointed at the live web build, so every web deploy updates the TV automatically.

Input came from the remote's D-pad, mapped to arrow keys. It works, but a directional pad on a TV remote physically debounces to a single direction at a time. You can't run-and-jump by holding right + up; it just picks one. For a platformer, that's the whole game. (My workaround in the game was giving jumps momentum so a press of "up" carries your existing horizontal speed — clever, but a band-aid.)

I wanted a real controller. I did **not** want to ask anyone to install an app from a store to play a one-off gift.

### The architecture: the TV is the server

The trick is to flip the usual setup. Instead of a phone app talking to a cloud service, the **Chromecast itself** runs the servers, and the phone is a thin client on the same Wi-Fi:

```
   Chromecast (Android TV)                    iPhone
 ┌──────────────────────────┐
 │  Kotlin WebView app       │
 │   • the game (webview)    │
 │   • HTTP server   :8080   │◀── serves controller web page ──▶ Safari
 │   • WebSocket srv :8081   │◀────── touch inputs (JSON) ─────── controller
 └──────────────────────────┘
         ▲
         │ inject synthetic KeyboardEvents into the webview
         ▼
   the game reacts as if a keyboard was pressed
```

Two small servers, both running inside the Android app on the stick:

- A **WebSocket server on :8081** (the Java-WebSocket library) receives controller inputs.
- A tiny **static HTTP server on :8080** (raw sockets, zero deps) serves the controller web page to the phone.

No internet round-trip. Inputs travel phone → router → TV over the LAN, so latency is basically nothing.

### Injecting "fake" keypresses into a webview

Here's the part I enjoyed most. The game already listens for keyboard events — it reads `event.keyCode` and tracks which keys are held. So I don't need to modify the game at all. When the WebSocket receives a message, the Kotlin side just dispatches a synthetic keyboard event straight into the webview's JavaScript context:

```kotlin
val js = "window.dispatchEvent(new KeyboardEvent('$action', " +
    "{ keyCode: $keyCode, which: $keyCode, bubbles: true }));"
webView.evaluateJavascript(js, null)
```

`keydown` on touch-start, `keyup` on touch-release. The browser's event system can't tell the difference between this and a real key. Left/right are arrow keys, jump is Space, the attack is Enter.

And the bonus: a phone can send **true simultaneous** keydowns. Hold left + jump and both fire — the exact thing the physical remote couldn't do. The phone controller is strictly *more* capable than the remote it replaces.

### The gotcha that ate an hour: ws:// from an https:// page

My first instinct was to host the controller page on the same GitHub Pages site as the game. It failed instantly, and the reason is a security rule worth memorizing:

**A page served over `https://` cannot open an insecure `ws://` WebSocket.** Browsers block it as mixed content. And you can't get a TLS cert for `192.168.x.x`, so the local WebSocket to the TV is necessarily plain `ws://`.

The fix is to serve the controller page itself over plain `http://` *from the TV* (that's what the :8080 server is for). An `http://` page is allowed to open a `ws://` connection. So the phone loads `http://<tv-ip>:8080`, which then dials `ws://<tv-ip>:8081`. Same-host, both insecure, browser is happy.

### Pairing: a QR code that *is* the address

No typing IP addresses on a TV. The app detects its own LAN IP, renders a QR code (ZXing) that encodes the WebSocket URL directly — `ws://192.168.x.x:8081` — and shows a little "How do you want to play?" screen with two cards side by side: **TV Remote** on the left, **Phone Controller** (the QR) on the right. Pick either; the remote keeps working the whole time, and the moment a phone connects the chooser auto-dismisses into the game.

### The Frankenstein moment

The phone side wasn't new. Months ago I'd started a separate side project — a native phone-controller app — and abandoned it. It already spoke a dead-simple protocol: connect to a `ws://` URL from a scanned QR, then send `{ "action": "keydown", "key": "left" }` style JSON.

So "combining the two projects" turned out to be almost free: I made the game's TV app speak that same protocol, mapped the controller's buttons to the game's actions, and the two half-finished side projects became one finished thing with a single scan. The most satisfying kind of integration is the one where past-you accidentally designed a compatible interface.

### Bonus 1: an app icon rendered from the game itself

While I was in there, the launcher tile still showed the game's *old* name — because the name was baked into the icon and banner artwork, not the text label (Google TV renders the banner image, not the app's string name). Rather than open a design tool, I rendered a new icon straight from the game's own character: a headless-Chrome screenshot of a tiny HTML page that draws the heroine's sprite (she's drawn procedurally on a canvas) zoomed into just her head. The app icon is now literally a frame of the game. No new art, guaranteed to match.

### Bonus 2: deploying to the thing is its own adventure

Getting builds onto a Chromecast over Wi-Fi (ADB) is a saga of its own — "USB debugging" alone doesn't open the wireless port, Android 11+ needs a separate pairing handshake with a rotating code, and the whole thing resets on reboot. That's a post for another day, but if you've fought it, you know.

### Takeaways

- **Put the server where the screen is.** A TV stick is a full Linux box; it can host its own pairing + input servers and skip the cloud entirely.
- **Synthetic input is a superpower for webviews.** If your content already listens for standard events, you can drive it from native code without touching the content.
- **Mixed-content rules will bite you on LAN.** Serve the client over `http` from the same host so `ws://` is allowed.
- **Design simple protocols.** A 2-field JSON message (`action`, `key`) let two unrelated projects merge in an afternoon.

The whole thing is still a love letter disguised as an engineering project. But now it's a love letter you can play two-handed, from the couch, with a phone you pulled out of your pocket and scanned. 😄

For anyone who's built local-network device pairing: how do you handle the QR/IP discovery when the device's LAN address changes on every DHCP lease? Still want a cleaner answer than "just reserve it in the router." 👇

#GameDev #AndroidTV #WebSockets #WebViews #Kotlin #CreativeCoding #SideProjects #Chromecast #VibeCoding #SystemsProgramming
