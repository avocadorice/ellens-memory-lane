# Ellen's Memory Lane — iOS / iPadOS app

A tiny native SwiftUI app that hosts the game in a fullscreen `WKWebView`, so it
gets its own icon on an iPhone or iPad — the iOS counterpart to the Google TV
wrapper in [`../android`](../android).

It loads the live site (`https://avocadorice.github.io/ellens-memory-lane/`),
so **every Pages deploy updates the app automatically** — you only rebuild the
app if you change this wrapper itself.

**Player 1 plays on the touchscreen.** On any touch device the game shows its
on-screen controls — ◀ ▶ to move, **JUMP**, and ⚔️ to chop — laid out clear of
the notch and home indicator. They're built for fingers: each button captures
its own touch so you can hold a direction and tap JUMP at the same time, and a
press is always released (even if iOS interrupts with Control Center or a call),
so Ellen never gets stuck running. (See `detectTouch()` and the pointer-event
bindings in `../game.js`, and the safe-area styling in `../styles.css`.)

## Build it

The Xcode project is generated from `project.yml` with
[XcodeGen](https://github.com/yonyz/XcodeGen) (the iOS analog of the Android
`build.gradle`), so it isn't checked in.

```bash
brew install xcodegen          # one-time
cd ios
xcodegen generate             # creates EllensMemoryLane.xcodeproj
open EllensMemoryLane.xcodeproj
```

Then in Xcode: pick your device (or a Simulator), set your signing **Team**
under *Signing & Capabilities*, and press **Run** (⌘R).

> **No XcodeGen?** Create the project by hand instead: Xcode → *New → Project →
> iOS App* (Interface: **SwiftUI**, Language: **Swift**). Delete the generated
> `ContentView.swift`, drag the three files in `EllensMemoryLane/` (`*.swift`)
> into the target, and replace the generated `Info.plist` keys with the ones in
> `EllensMemoryLane/Info.plist` (status bar hidden, landscape-only, requires
> fullscreen).

## Install on a device

Connect the iPhone/iPad over USB (or Wi-Fi), select it as the run destination in
Xcode, and **Run**. With a free Apple ID you can sideload to your own device;
the app then lives on the home screen like any other. For TestFlight / App Store
distribution use a paid Apple Developer account and **Product → Archive**.

## Notes

- **Orientation:** locked to landscape — it's a 16:9 side-scroller.
- **Stays awake:** the idle timer is disabled while the app is foregrounded, and
  the procedural music is suspended/resumed as the app backgrounds/returns.
- **App icon:** none is bundled yet. Add `EllensMemoryLane/Assets.xcassets` with
  an `AppIcon` set (a single 1024×1024 PNG works in modern Xcode — you can start
  from the repo's `../icon-512.png`/`../icon.png`), then set
  `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` in `project.yml` and regenerate.
- **Offline build:** to ship without internet, copy the web files (`index.html`,
  `game.js`, `assets.js`, `levels.js`, `styles.css`, `photos/`, `physics.wasm`,
  …) into the target as a folder reference, then point `WebViewStore.gameURL` at
  `Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: …)`.
  You'll then rebuild whenever the game changes.
- **Two-player co-op:** the bundled app is Player-1-only. Player 2 (Barney) joins
  through the existing relay/QR path (`npm run relay`), which needs the relay
  running on the same network and an `ws://` ATS exception — out of scope for the
  basic touchscreen build. Single-player is fully self-contained.
- **Bump `CFBundleVersion`** in `Info.plist` for each new wrapper release.
