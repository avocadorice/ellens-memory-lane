# Ellen's Memory Lane — Google TV app

A tiny native Kotlin app that hosts the game in a fullscreen `WebView`, so it
shows up as its own tile on the Google TV home screen (no more TV Bro).

It loads the live site (`https://avocadorice.github.io/ellens-memory-lane/`),
so **every Pages deploy updates the app automatically** — you only rebuild the
APK if you change this wrapper itself.

## Build it (Android Studio — easiest)

1. Open **Android Studio** → **Open** → select this `android/` folder.
2. Let it finish "Gradle sync" (it downloads Gradle 8.7 + the Android SDK bits
   on first run). If prompted to install an SDK / build-tools, accept.
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
   The APK lands in `app/build/outputs/apk/debug/app-debug.apk`.

> No Android Studio? With a JDK 17 + the Android command-line SDK installed and
> `ANDROID_HOME` set, run `gradle wrapper` once in this folder, then
> `./gradlew assembleDebug`.

## Install on the TV (ADB over Wi‑Fi)

```bash
adb connect <TV-IP>:5555            # accept the "Allow USB debugging?" prompt on the TV
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb disconnect
```

After install it appears as a tile in the Google TV launcher ("Ellen's Memory
Lane"). Launch it like any app.

## Notes

- **Controls:** the TV remote D-pad and Select reach the game as normal key
  events — no extra wiring needed. (The "can't hold two directions" remote quirk
  is already handled in the game's movement code.)
- **Offline build:** to ship without internet, copy the web files
  (`index.html`, `game.js`, `assets.js`, `levels.js`, `styles.css`, `photos/`,
  `physics.wasm`, …) into `app/src/main/assets/`, then in `MainActivity.kt`
  switch `GAME_URL` to `file:///android_asset/index.html`. You'll then need to
  rebuild the APK whenever the game changes.
- **BACK button** sends the app to the background (won't kill it mid-play).
- Bump `versionCode` in `app/build.gradle` for each new wrapper release so the
  TV accepts the update.
