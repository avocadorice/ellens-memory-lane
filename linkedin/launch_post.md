Headline: I vibe-coded my wife's birthday gift into a 2D platformer — and a $30 TV stick out-ran my MacBook 🎂📺

A few weeks ago I admitted here that — instead of buying the fancy dinner or the handbag 👜🍽️ — I was building Ellen a side-scrolling platformer that walks through a decade of our memories together: graduation, adopting our dog, the wedding, two kids, RV trips, and ending at sunrise on Mt. Fuji. 🗻

It's shipped. It runs at a smooth 60 FPS on a sideloaded browser on the living-room TV. No game engine, no dependencies — just HTML5 Canvas, WebAssembly, and the Web Audio API. Here are the three performance lessons that actually mattered. 🧵

1) The cheap TV beat the expensive laptop 🤯
Counterintuitive moment of the week: the game hit a locked 60 FPS on a low-end Chromecast-class device while *dropping to 30 on my Retina MacBook*. The CPU wasn't the bottleneck — pixel fill-rate was. `requestAnimationFrame` is vsync-locked, so the instant a frame misses the ~16.6ms budget, the browser halves you to a clean 30. The fix was forcing the cheapest render path everywhere:
• Hard-cap canvas DPR to 1.0 (a 4K TV reports 2–3× and will happily render a 2700×1500 canvas on a potato GPU)
• Kill every `backdrop-filter: blur()` — those glassmorphic panels are gorgeous and one of the most expensive compositor ops there is; they re-sample everything behind them every frame.
Lesson: on weak GPUs, fill-rate and compositor cost dwarf compute. Render fewer, cheaper pixels.

2) Physics in WebAssembly, with a JS safety net 🧮
Player movement, jump arcs, collision, and the end-screen fireworks particles run in a hand-written WASM module for headroom on TV silicon — with a full JS fallback if the binary fails to stream, so gameplay never breaks.

3) Procedural chiptune audio — and the crackle that taught me signal flow 🎵
All music and SFX are synthesized live with the Web Audio API (zero asset loading, instant playback). But on the TV the audio crackled and popped. Two root causes, both classic:
• Every oscillator connected straight to the output, so overlapping chords + melody + SFX summed past 0 dBFS and hard-clipped on the TV's DAC. Fix: route everything through a master gain → DynamicsCompressor limiter bus so peaks can never clip.
• SFX jumped gain from 0 to full instantly — an audible click on every jump. Fix: ~8ms attack ramps and a pitch glide instead of an instant jump.
Lesson: a synth is a signal chain. Respect the master bus and never hand the hardware a discontinuity.

The whole thing is a love letter disguised as a performance-optimization project. Turns out shipping a gift teaches you more about low-end rendering, WASM, and audio DSP than any tutorial. 😄

For anyone who's built for Android TV / Chromecast: how do you tame Web Audio scheduler drift when the render thread stalls? Still chasing that one. 👇

#GameDev #WebAssembly #WebAudio #PerformanceOptimization #HTML5Canvas #Chiptune #AndroidTV #CreativeCoding #VibeCoding #FrontendEngineering
