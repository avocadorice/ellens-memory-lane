# 🎂 Ellen's Memory Lane: 2D side-scrolling Memory Lane Game

A beautiful, interactive, and personalized 2D HTML5 Canvas side-scrolling game built as a special birthday gift for Ellen.

## 🌟 Game Highlights

- **Ellen as the Hero:** Ellen stars as the main character, complete with custom animated SVG sprites representing her in different outfits (Graduation, Wedding, Casual, and Hiking/Camping gear).
- **The Journey of a Lifetime:** A continuous 10-milestone path that moves through major milestones:
  1. **Graduation (2012)** - Releasing academic caps under confetti.
  2. **Adopting Our Dog (2014)** - A cute furry companion joins the walk.
  3. **Engagement (2016)** - A romantic proposal scene.
  4. **Wedding (2017)** - Standing under a floral archway in wedding attire.
  5. **First Home (2018)** - Moving boxes and building dreams.
  6. **First Child (2020)** - Pushing a cute baby stroller.
  7. **Second House (2021)** - Onto bigger and better spaces.
  8. **Second Child (2023)** - The family of four is complete!
  9. **RV Camping (2025)** - Cozy campfire and sleeping under the stars.
  10. **Mt. Fuji (2026)** - Standing together at sunrise in Japan.
- **Growing Family Train:** As milestones are unlocked, Ellen's husband, their dog, and their two children join the walk train behind her, walking and jumping along!
- **Dynamic Sky Interpolation:** The sky colors smoothly blend and transition as she walks, moving from morning blue to mid-day sunshine, sunset glow, starry night skies, and a gorgeous sunrise over Mt. Fuji.
- **WebAssembly Physics Engine:** Player movement physics, jumps, boundaries, heart/hurdle collision detection, and ending screen celebration fireworks particles are calculated in high-performance WebAssembly for absolute performance scaling.
- **Robust JS Fallback:** If the WebAssembly binary fails to load or stream for any reason, the engine falls back to standard JS calculation loops with zero gameplay impact.
- **Procedural Synthesizer & Sound Effects:** Music and SFX are generated dynamically using the **Web Audio API**—meaning zero lag, zero external asset loading, and a nostalgic 8-bit/chime feel that plays a lovely melody in the background.

---

## 🛠️ File Structure

* `index.html` - Game structure, preloader screen, overlays, and virtual controller buttons.
* `styles.css` - Premium glassmorphic UI overlay panels, animations, and custom font styling.
* `game.js` - Main game engine, canvas graphics rendering pipeline, input handlers, companion trailing offset logic, and procedural music generator. Coordinates with the WASM engine.
* `physics.ts` - AssemblyScript source code for the WebAssembly physics, collision, and particle calculations.
* `physics.wasm` - Compiled WebAssembly binary loaded dynamically by the game.
* `assets.js` - Procedural 2D path rendering canvas assets for all character animations, background houses, camper, and Mt. Fuji scenery.
* `levels.js` - Configuration of coordinates, years, sky gradient colors, dialogues, and trivia questions.

---

## 🚀 Running the Game Locally

1. Ensure you have Node.js installed.
2. In your terminal, run:
   ```bash
   npm install
   ```
3. (Optional) Compile the WebAssembly module if you edit the AssemblyScript (`physics.ts`):
   ```bash
   npm run build:wasm
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to:
   ```
   http://127.0.0.1:3000
   ```
