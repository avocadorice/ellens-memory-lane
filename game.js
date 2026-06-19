// Core Game Engine for Ellen's Memory Lane

// --- WEBASSEMBLY PHYSICS MODULE ---
let wasmInstance = null;
let wasmExports = null;

async function initWasm() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('no_optimize') === 'true') {
      console.log("WebAssembly physics module disabled via URL parameter.");
      return;
    }
    const response = await fetch('physics.wasm');
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      env: {
        abort: (msg, file, line, col) => {
          console.error(`Abort called at ${file}:${line}:${col} - ${msg}`);
        },
        seed: () => {
          return Math.random();
        }
      }
    });
    wasmInstance = result.instance;
    wasmExports = wasmInstance.exports;
    console.log("WebAssembly physics module loaded successfully!");
  } catch (e) {
    console.error("Failed to load WebAssembly module, falling back to JavaScript physics:", e);
  }
}

// --- AUDIO ENGINE (Web Audio API Procedural Synth) ---
const AudioEngine = {
  ctx: null,
  masterGain: null,
  limiter: null,
  isPlaying: false,
  tempo: 105, // BPM
  schedulerInterval: null,
  nextNoteTime: 0.0,
  beatNumber: 0,
  scheduleAheadTime: 1.5, // sec - Large buffer to tolerate TV WebView lag spikes
  lookahead: 50.0, // ms - Polling check rate
  activeOscillators: [],
  startTime: 0.0,
  
  init() {
    try {
      // Use playback latencyHint to double the internal audio buffer size for TV browsers
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'playback'
      });
      // Master bus: every voice routes through a gain stage into a limiter, so
      // overlapping oscillators (chords + melody + SFX) can never sum past
      // 0 dBFS and crackle/distort on the TV's DAC.
      const now = this.ctx.currentTime;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.6, now);
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.setValueAtTime(-3, now); // start clamping just below full scale
      this.limiter.knee.setValueAtTime(0, now);       // hard knee = true limiting
      this.limiter.ratio.setValueAtTime(20, now);
      this.limiter.attack.setValueAtTime(0.003, now);
      this.limiter.release.setValueAtTime(0.25, now);
      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    } catch (e) {
      console.warn("Web Audio API not supported.", e);
    }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  playBGM() {
    if (this.isPlaying) return;
    if (!this.ctx) this.init();
    if (!this.ctx) {
      console.warn("AudioEngine: AudioContext is not available.");
      return;
    }
    this.resume();
    this.isPlaying = true;

    // Frequencies mapping
    const notes = {
      'C3': 130.81, 'E3': 164.81, 'G3': 196.00, 'A3': 220.00, 'B3': 246.94,
      'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F#4': 369.99, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
      'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'F#5': 739.99, 'G5': 783.99, 'A5': 880.00, 'B5': 987.77, 'D6': 1174.66
    };

    // Chord progression: Cmaj7 -> Gmaj7 -> Am7 -> Fmaj7
    const chords = [
      ['C3', 'E4', 'G4', 'B4'],
      ['G3', 'B3', 'D4', 'F#4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4']
    ];

    // Beautiful retro melody loop
    const melody = [
      'E5', 'G5', 'B5', 'A5', 'G5', null, 'E5', 'D5',
      'E5', 'G5', 'A5', 'B5', 'D6', 'B5', 'A5', 'G5',
      'B5', 'D5', 'G5', 'F#5', 'E5', null, 'D5', 'B4',
      'C5', 'E5', 'G5', 'B5', 'A5', null, 'G5', 'E5'
    ];

    this.startTime = this.ctx.currentTime;
    this.beatNumber = 0;
    const beatLen = 60.0 / this.tempo;
    this.activeOscillators = [];

    this.schedulerInterval = setInterval(() => {
      if (!this.isPlaying) return;
      
      const currentTime = this.ctx.currentTime;
      const tolerance = 0.150; // 150ms behind window

      // Clock recovery: If main thread froze and we fell too far behind, snap beatNumber forward
      // to keep it aligned to the absolute beat grid.
      if (this.startTime + this.beatNumber * beatLen < currentTime - tolerance) {
        const diff = currentTime - this.startTime;
        this.beatNumber = Math.ceil(diff / beatLen);
      }

      // Look-ahead schedule loop (queues up to scheduleAheadTime seconds into the future)
      while (this.startTime + this.beatNumber * beatLen < currentTime + this.scheduleAheadTime) {
        const noteTime = this.startTime + this.beatNumber * beatLen;

        // Play chords on every measure (4 beats)
        if (this.beatNumber % 4 === 0) {
          const chordIdx = Math.floor(this.beatNumber / 4) % chords.length;
          const chord = chords[chordIdx];
          
          // TV optimization: Only play root and fifth (2 notes) to save CPU/voices
          const isOptimized = !Assets.checkOptimize();
          const activeNotes = isOptimized ? [chord[0], chord[2] || chord[1]] : chord;

          activeNotes.forEach(noteName => {
            if (!noteName) return;
            const freq = notes[noteName] || 130.81;
            this.playSynthNote(freq, noteTime, 1.8, 0.03, 'triangle');
          });
        }

        // Play melody note
        const melNote = melody[this.beatNumber % melody.length];
        if (melNote) {
          const freq = notes[melNote];
          this.playSynthNote(freq, noteTime, 0.45, 0.05, 'sine');
        }

        this.beatNumber++;
      }
    }, this.lookahead);
  },

  stopBGM() {
    this.isPlaying = false;
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    if (this.activeOscillators) {
      this.activeOscillators.forEach(osc => {
        try {
          osc.stop();
        } catch (e) {
          // Ignore already stopped
        }
      });
      this.activeOscillators = [];
    }
  },

  playSynthNote(freq, startTime, duration, vol, type = 'sine') {
    if (!this.ctx || !freq) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);

    if (!this.activeOscillators) {
      this.activeOscillators = [];
    }
    this.activeOscillators.push(osc);
    osc.onended = () => {
      if (this.activeOscillators) {
        this.activeOscillators = this.activeOscillators.filter(o => o !== osc);
      }
    };
  },

  playJumpSFX() {
    if (!this.ctx) return;
    this.resume();
    const time = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(380, time + 0.12);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.12, time + 0.008); // soft attack, no click
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);

    osc.start();
    osc.stop(time + 0.12);
  },

  playHeartSFX() {
    if (!this.ctx) return;
    this.resume();
    const time = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, time); // C5
    osc.frequency.exponentialRampToValueAtTime(783.99, time + 0.08); // glide to G5 (instant jump = click)

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.15, time + 0.008); // soft attack, no click
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.22);

    osc.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);

    osc.start();
    osc.stop(time + 0.22);
  },

  playWinSFX() {
    if (!this.ctx) return;
    this.resume();
    const time = this.ctx.currentTime;
    const arp = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C major arpeggio
    
    arp.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time + idx * 0.07);
      
      gain.gain.setValueAtTime(0.0001, time + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.12, time + idx * 0.07 + 0.008); // soft attack, no click
      gain.gain.exponentialRampToValueAtTime(0.005, time + idx * 0.07 + 0.35);
      
      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);
      
      osc.start(time + idx * 0.07);
      osc.stop(time + idx * 0.07 + 0.45);
    });
  },

  // Generic short tone helper for SFX
  _blip(freqStart, freqEnd, dur, vol, type = 'triangle') {
    if (!this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
    osc.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);
    osc.start();
    osc.stop(t + dur);
  },

  playSlashSFX() {
    this._blip(620, 180, 0.16, 0.10, 'sawtooth');
  },

  playShootSFX() {
    this._blip(880, 320, 0.12, 0.09, 'square');
  },

  playBounceSFX() {
    this._blip(220, 760, 0.18, 0.12, 'sine');
  },

  playEnemyHurtSFX() {
    // Short, soft "ouch but still standing" thud — lower/quieter than defeat.
    this._blip(380, 260, 0.10, 0.07, 'square');
  },

  playEnemyDefeatSFX() {
    this._blip(420, 880, 0.18, 0.10, 'triangle');
    this._blip(660, 1100, 0.22, 0.06, 'sine');
  },

  playHurtSFX() {
    this._blip(300, 90, 0.22, 0.13, 'sawtooth');
  },

  playPickupSFX() {
    if (!this.ctx) return;
    this.resume();
    const arp = [523.25, 659.25, 783.99, 1046.50];
    arp.forEach((f, i) => this._delayedBlip(f, f, 0.18, 0.09, 'triangle', i * 0.06));
  },

  playGameOverSFX() {
    if (!this.ctx) return;
    this.resume();
    const notes = [392.00, 329.63, 261.63, 196.00];
    notes.forEach((f, i) => this._delayedBlip(f, f * 0.98, 0.4, 0.11, 'triangle', i * 0.16));
  },

  _delayedBlip(freqStart, freqEnd, dur, vol, type, delay) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
    osc.connect(gain);
    gain.connect(this.masterGain || this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }
};

// --- GAME LOGIC ---
const Game = {
  canvas: null,
  ctx: null,
  width: 900,
  height: 500,
  
  // Game state
  isRunning: false,
  isPaused: false,
  heartsCollected: 0,
  totalHearts: 0,
  currentLevelIndex: 0,
  
  // Player properties
  player: {
    x: 150,
    y: 0,
    width: 30,
    height: 60,
    vx: 0,
    vy: 0,
    speed: 5.5,
    gravity: 0.7,
    jumpForce: -13,
    isGrounded: false,
    outfit: 'casual', // 'graduation', 'wedding', 'casual', 'hiking'
    animFrame: 0,
    dir: 1,
    // --- Combat state ---
    weapon: null,      // null | 'racket'
    hasBalls: false,   // unlocked by tennis-ball pickup → swing also serves an arcing ball
    health: 5,
    maxHealth: 5,
    attackTimer: 0,    // counts down during a racket swing
    serveCooldown: 0,  // counts down between served tennis balls
    invuln: 0,         // i-frames after taking damage
    isDead: false
  },

  // Combat tuning constants
  combat: {
    swingDuration: 16,   // frames a racket swing stays active
    swingReach: 60,      // px in front of player a swing hits
    serveCooldown: 20,   // frames between served tennis balls
    ballSpeedX: 8.5,     // arcing tennis-ball launch (horizontal)
    ballSpeedY: -10,     // arcing tennis-ball launch (upward)
    ballGravity: 0.4,    // gravity pulling the ball back down (the arc)
    invulnFrames: 70,    // i-frames after a hit (~1.1s)
    trampolineForce: -22, // super-bounce velocity (normal jump is -13)
    enemyBulletSpeed: 4.4, // flying foes' projectiles aimed at Ellen
    enemyShootRange: 540,  // only fire when she's within this horizontal range
    enemyShootMin: 75,     // min frames between an enemy's shots
    enemyShootMax: 150     // max frames between an enemy's shots
  },

  // Level data reference
  levels: levelsData,

  // Entities
  hearts: [],
  hurdles: [],
  parallaxLayers: [],
  companions: [], // Trailing list of entities (husband, dog, stroller, etc.)
  enemies: [],     // life-obstacle foes
  projectiles: [], // gun bullets (player's)
  enemyProjectiles: [], // bullets fired BY flying enemies at Ellen
  pickups: [],     // sword/gun pickups
  trampolines: [], // bounce pads
  poofs: [],       // defeat puff FX
  
  // Camera
  camera: {
    x: 0,
    y: 0
  },

  // Input states
  keys: {},
  
  // Dialog State
  activeDialog: null,
  dialogIndex: 0,

  // Ending / Fireworks state
  fireworks: [],
  isQuizCompleted: false,
  focusedChapterIndex: 0,
  gamepadBtnAPressed: false,
  gamepadMenuPressed: false,

  init() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.focus();
    
    // Scale for high-DPI screens
    this.resizeCanvas();
    this.updateOptimizationState();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.player.y = this.height - 80; // Ground height y = 420
    if (wasmExports) {
      wasmExports.initPlayer(this.player.x, this.player.y);
      wasmExports.initParticles();
    }

    // Hook DOM UI events
    this.bindUI();

    // Populate collectibles and hurdles based on milestone layout
    this.setupWorld();

    // Preload memory photos
    this.preloadPhotos();

    // Hide preloader
    setTimeout(() => {
      document.getElementById('loading-screen').classList.remove('active');
      document.getElementById('start-screen').classList.add('active');
    }, 1200);
  },

  resizeCanvas() {
    // Lock aspect ratio 16:9
    const container = document.getElementById('game-container');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    let targetWidth = containerWidth;
    let targetHeight = containerWidth * (this.height / this.width);

    if (targetHeight > containerHeight) {
      targetHeight = containerHeight;
      targetWidth = containerHeight * (this.width / this.height);
    }

    this.canvas.style.width = `${targetWidth}px`;
    this.canvas.style.height = `${targetHeight}px`;
    
    // Handle High DPI (cap at 1.0 on TV optimizations, 1.25 on high-end to avoid rendering lag)
    const isOptimized = !Assets.checkOptimize();
    const dprCap = isOptimized ? 1.0 : 1.25;
    const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
  },

  updateOptimizationState() {
    const isOptimized = !Assets.checkOptimize();
    
    // Toggle body class for blur filters
    if (isOptimized) {
      document.body.classList.add('no-blur');
    } else {
      document.body.classList.remove('no-blur');
    }

    // Trigger canvas resize to adjust DPR resolution scale
    this.resizeCanvas();
  },

  setupWorld() {
    this.hearts = [];
    this.hurdles = [];
    this.companions = [];
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.pickups = [];
    this.trampolines = [];
    this.poofs = [];
    this.banner = null;
    this.allowSecretOnCollect = false;
    this.endingFocusIndex = 0;
    this.heartsCollected = 0;

    // Reset player combat loadout
    this.player.weapon = null;
    this.player.hasBalls = false;
    this.player.health = this.player.maxHealth;
    this.player.attackTimer = 0;
    this.player.serveCooldown = 0;
    this.player.invuln = 0;
    this.player.isDead = false;

    // Setup hearts & hurdles along the entire track
    const trackEnd = this.levels[this.levels.length - 1].x + 400;

    // Distribute collectibles and obstacles
    for (let x = 300; x < trackEnd - 200; x += 220) {
      // Don't spawn collectibles too close to level dialogue trigger zones (milestone.x +/- 120)
      let nearMilestone = false;
      this.levels.forEach(lvl => {
        if (Math.abs(x - lvl.x) < 130) nearMilestone = true;
      });

      if (!nearMilestone) {
        // Collectible heart
        const baseY = this.height - 130 - Math.random() * 60;
        const heart = {
          x: x,
          y: baseY,
          width: 16,
          height: 16,
          collected: false,
          spawned: true,
          fromEnemy: false,
          falling: false,
          section: this.getLevelIndexAtX(x)
        };
        // ~35% of hearts drift side-to-side so a straight vertical jump won't
        // catch them — she has to jump AND move into the heart.
        if (Math.random() < 0.35) {
          heart.motion = {
            baseX: x, baseY,
            ampX: 32, ampY: 12,
            speed: 0.045, phase: Math.random() * Math.PI * 2
          };
        }
        this.hearts.push(heart);

        // Chance of obstacle hurdle below it
        if (Math.random() > 0.4) {
          // Use the milestone's scene id (not its position) so hurdle art matches scenery
          const activeLvl = this.levels[this.getLevelIndexAtX(x)].id;
          this.hurdles.push({
            x: x + 20,
            y: this.height - 80,
            width: 25,
            height: 25,
            levelId: activeLvl
          });
        }
      }
    }

    // Spawn weapons, enemies, trampolines and enemy-drop hearts
    this.setupCombat();

    this.totalHearts = this.hearts.length;
    this.updateHeartsUI();
  },

  // Places the tennis racket + tennis-ball pickups, enemies, trampolines and
  // the trampoline-gated / enemy-drop bonus hearts. The racket (melee) is
  // grabbed early; the tennis balls (arcing serve) are grabbed just past the
  // Wedding milestone (the midpoint).
  setupCombat() {
    const groundY = this.height - 80;
    const trackEnd = this.levels[this.levels.length - 1].x + 400;
    const racketX = 1000;
    const ballsX = 8250; // just past Wedding (x=8000)
    this.ballsX = ballsX;

    // Pickups: tennis racket, then tennis balls
    this.pickups.push({ x: racketX, y: groundY, kind: 'racket', collected: false, frame: 0 });
    this.pickups.push({ x: ballsX, y: groundY, kind: 'balls', collected: false, frame: 0 });

    const nearMilestone = (x) => this.levels.some(l => Math.abs(x - l.x) < 110);
    const nearPickup = (x) => Math.abs(x - racketX) < 150 || Math.abs(x - ballsX) < 150;

    const groundKinds = ['slime_green', 'slime_purple', 'slime_teal'];
    const flyingKinds = ['cloud', 'bat'];
    let gi = 0, fi = 0;

    // Difficulty ramps 0 -> 1 across the journey (Dating x2000 ... Fuji xEnd).
    const lastLevelX = this.levels[this.levels.length - 1].x;
    const progress = (x) => Math.max(0, Math.min(1, (x - 2000) / (lastLevelX - 2000)));
    // Probability an enemy is a tougher 2-hit monster, rising with the memories.
    const toughChance = (section) => section < 3 ? 0 : Math.min(0.6, (section - 2) * 0.12);

    // Ground enemies through the racket region (swing/melee them). Spacing
    // tightens and 2-hit monsters appear more often as we progress.
    let gx = racketX + 460;
    while (gx < ballsX - 150) {
      if (!nearMilestone(gx) && !nearPickup(gx)) {
        const section = this.getLevelIndexAtX(gx);
        const tier = Math.random() < toughChance(section) ? 2 : 1;
        this.enemies.push({
          type: 'ground', kind: groundKinds[gi % groundKinds.length],
          x: gx, homeX: gx, y: groundY - 14, baseY: groundY - 14,
          alive: true, dir: -1, range: 50, hitFlash: 0,
          frame: (gi * 9) % 60, section, high: false, heart: null,
          tier, hp: tier, maxHp: tier, lastSwingHit: -1
        });
        gi++;
      }
      gx += 720 - 300 * progress(gx); // ~720 early -> ~470 late
    }

    // Flying enemies in the tennis-ball region — alternate normal height and
    // very-high (very-high need a trampoline bounce to arc a serve up to them).
    let fx = ballsX + 340;
    while (fx < trackEnd - 200) {
      if (!nearMilestone(fx)) {
        const section = this.getLevelIndexAtX(fx);
        const high = fi % 2 === 1;
        const baseY = high ? 165 : 290;
        const tier = Math.random() < toughChance(section) ? 2 : 1;
        this.enemies.push({
          type: 'flying', kind: flyingKinds[fi % flyingKinds.length],
          x: fx, homeX: fx, y: baseY, baseY,
          alive: true, dir: -1, range: 70, hitFlash: 0,
          frame: (fi * 13) % 60, section, high, heart: null,
          tier, hp: tier, maxHp: tier, lastSwingHit: -1,
          shootTimer: 60 + Math.floor(Math.random() * 120) // flying foes shoot back
        });
        if (high) {
          this.trampolines.push({ x: fx, y: groundY, w: 58, squash: 0 });
        }
        fi++;
      }
      fx += 760 - 280 * progress(fx); // ~620 -> ~480 late
    }

    // Trampoline-gated bonus hearts floating high above the path
    const highHeartXs = [];
    for (let x = racketX + 760; x < ballsX - 300; x += 1650) {
      if (!nearMilestone(x) && !nearPickup(x)) highHeartXs.push(x);
    }
    for (let x = ballsX + 1000; x < trackEnd - 300; x += 1650) {
      if (!nearMilestone(x)) highHeartXs.push(x);
    }
    highHeartXs.forEach((x, i) => {
      // Heart floats high AND off to one side of the pad, drifting back and
      // forth — she must trampoline-bounce then steer forward to grab it.
      const dir = (i % 2 === 0) ? 1 : -1;
      const heartBaseX = x + dir * 70;
      this.hearts.push({
        x: heartBaseX, y: 128, width: 16, height: 16, collected: false,
        spawned: true, fromEnemy: false, falling: false, section: this.getLevelIndexAtX(x),
        motion: {
          baseX: heartBaseX, baseY: 128,
          ampX: 48, ampY: 20,
          speed: 0.04, phase: Math.random() * Math.PI * 2
        }
      });
      if (!this.trampolines.some(t => Math.abs(t.x - x) < 40)) {
        this.trampolines.push({ x, y: groundY, w: 58, squash: 0 });
      }
    });

    // Each enemy carries a heart that drops on defeat (counts toward the total)
    this.enemies.forEach(e => {
      const h = {
        x: e.x, y: e.baseY, width: 16, height: 16, collected: false,
        spawned: false, fromEnemy: true, falling: false, section: e.section
      };
      e.heart = h;
      this.hearts.push(h);
    });
  },

  preloadPhotos() {
    this.levels.forEach(lvl => {
      // Support multiple photos per memory (e.g. camping). Falls back to the
      // legacy single `photo` field if present.
      const srcs = lvl.photos || (lvl.photo ? [lvl.photo] : []);
      lvl.imgElements = srcs.map(src => {
        const img = new Image();
        img.src = src;
        img.onerror = () => {
          console.log(`Photo for ${lvl.name} not found (${src}), using procedural sketch instead.`);
        };
        return img;
      });
    });
  },

  teleportToLevel(lvlIndex) {
    // Snap close overlays
    this.isPaused = false;
    document.getElementById('dialog-overlay').classList.remove('active');
    document.getElementById('ending-screen').classList.remove('active');
    document.getElementById('chapter-menu-overlay').classList.remove('active');

    // Teleport player slightly to the left of the target milestone (lets them walk in)
    const lvl = this.levels[lvlIndex];
    const targetX = lvl.x - 160;
    if (wasmExports) {
      wasmExports.initPlayer(targetX, this.height - 80);
      this.player.x = wasmExports.player_x.value;
      this.player.y = wasmExports.player_y.value;
      this.player.vx = wasmExports.player_vx.value;
      this.player.vy = wasmExports.player_vy.value;
      this.player.isGrounded = wasmExports.player_isGrounded.value !== 0;
      this.player.dir = wasmExports.player_dir.value;
      this.player.animFrame = wasmExports.player_animFrame.value;
    } else {
      this.player.x = targetX;
      this.player.vx = 0;
      this.player.vy = 0;
    }

    // Center camera
    this.camera.x = this.player.x - this.width / 3;
    if (this.camera.x < 0) this.camera.x = 0;

    // Reset level indices so milestones trigger correctly
    this.currentLevelIndex = lvlIndex - 1;

    // Force updates of outfits and companions
    const frame = this.player.animFrame;
    this.player.outfit = this.getEllenOutfit(lvlIndex);

    this.updateCompanions(lvlIndex);

    // Grant the loadout appropriate to this position + restore health (dev convenience)
    this.player.health = this.player.maxHealth;
    this.player.invuln = 0;
    this.player.isDead = false;
    this.player.attackTimer = 0;
    this.player.serveCooldown = 0;
    if (this.player.x >= 1000) {
      this.player.weapon = 'racket';
      this.pickups.forEach(p => { if (p.kind === 'racket') p.collected = true; });
    }
    if (this.ballsX && this.player.x >= this.ballsX) {
      this.player.hasBalls = true;
      this.pickups.forEach(p => { p.collected = true; });
    }

    // Chime BGM effect
    AudioEngine.playHeartSFX();
  },

  bindUI() {
    // Keyboard inputs
    window.addEventListener('keydown', (e) => {
      // Normalize key identifier for TV browsers
      let code = e.code;
      console.log("Keydown: " + code);
      if (!code) {
        if (e.keyCode === 37) code = 'ArrowLeft';
        else if (e.keyCode === 39) code = 'ArrowRight';
        else if (e.keyCode === 38) code = 'ArrowUp';
        else if (e.keyCode === 40) code = 'ArrowDown';
        else if (e.keyCode === 32) code = 'Space';
        else if (e.keyCode === 13) code = 'Enter';
        else if (e.keyCode === 27) code = 'Escape';
        else if (e.keyCode === 8) code = 'Backspace';
        else if (e.keyCode === 65) code = 'KeyA';
        else if (e.keyCode === 68) code = 'KeyD';
        else if (e.keyCode === 87) code = 'KeyW';
      }

      // Prevent default browser spatial navigation focus changes on TV during gameplay
      if (this.isRunning && !this.isPaused) {
        if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'Space') {
          e.preventDefault();
        }
      }

      this.keys[code] = true;
      
      const menu = document.getElementById('chapter-menu-overlay');
      const startScreen = document.getElementById('start-screen');
      const endingScreen = document.getElementById('ending-screen');
      const gameOverScreen = document.getElementById('game-over-screen');
      const secretScreen = document.getElementById('secret-screen');

      // If chapter menu is open, handle D-pad grid navigation
      if (menu && menu.classList.contains('active')) {
        const buttons = document.querySelectorAll('.chapter-menu-btn');
        if (buttons.length > 0) {
          if (code === 'ArrowRight') {
            this.focusedChapterIndex = (this.focusedChapterIndex + 1) % buttons.length;
            this.updateChapterMenuFocus();
            e.preventDefault();
            return;
          } else if (code === 'ArrowLeft') {
            this.focusedChapterIndex = (this.focusedChapterIndex - 1 + buttons.length) % buttons.length;
            this.updateChapterMenuFocus();
            e.preventDefault();
            return;
          } else if (code === 'ArrowDown') {
            if (this.focusedChapterIndex + 2 < buttons.length) {
              this.focusedChapterIndex += 2;
            } else {
              this.focusedChapterIndex = this.focusedChapterIndex % 2;
            }
            this.updateChapterMenuFocus();
            e.preventDefault();
            return;
          } else if (code === 'ArrowUp') {
            if (this.focusedChapterIndex - 2 >= 0) {
              this.focusedChapterIndex -= 2;
            } else {
              const lastRowStart = Math.floor((buttons.length - 1) / 2) * 2;
              this.focusedChapterIndex = Math.min(buttons.length - 1, lastRowStart + (this.focusedChapterIndex % 2));
            }
            this.updateChapterMenuFocus();
            e.preventDefault();
            return;
          } else if (code === 'Enter' || code === 'Space') {
            buttons[this.focusedChapterIndex].click();
            e.preventDefault();
            return;
          } else if (code === 'Escape' || code === 'Backspace') {
            document.getElementById('close-menu-btn').click();
            e.preventDefault();
            return;
          }
        }
      }

      // Start Screen enter/space trigger
      if (startScreen && startScreen.classList.contains('active')) {
        if (code === 'Enter' || code === 'Space') {
          document.getElementById('start-btn').click();
          e.preventDefault();
          return;
        }
      }

      // Ending Screen: ←/→ choose between Keep Exploring / Play Again, Enter activates
      if (endingScreen && endingScreen.classList.contains('active')) {
        if (code === 'ArrowLeft' || code === 'ArrowRight') {
          this.endingFocusIndex = (this.endingFocusIndex || 0) === 0 ? 1 : 0;
          this.updateEndingFocus();
          e.preventDefault();
          return;
        }
        if (code === 'Enter' || code === 'Space') {
          const ids = ['keep-exploring-btn', 'replay-btn'];
          document.getElementById(ids[this.endingFocusIndex || 0]).click();
          e.preventDefault();
          return;
        }
      }

      // Game Over Screen: Try Again
      if (gameOverScreen && gameOverScreen.classList.contains('active')) {
        if (code === 'Enter' || code === 'Space') {
          document.getElementById('retry-btn').click();
          e.preventDefault();
          return;
        }
      }

      // Secret Prize Screen: replay
      if (secretScreen && secretScreen.classList.contains('active')) {
        if (code === 'Enter' || code === 'Space') {
          document.getElementById('secret-replay-btn').click();
          e.preventDefault();
          return;
        }
      }

      // Escape or M key to toggle chapter menu
      if (code === 'Escape' || code === 'KeyM') {
        if (menu) {
          if (menu.classList.contains('active')) {
            document.getElementById('close-menu-btn').click();
          } else {
            document.getElementById('hud-menu-btn').click();
            this.focusedChapterIndex = 0;
            setTimeout(() => this.updateChapterMenuFocus(), 50);
          }
          e.preventDefault();
          return;
        }
      }
      
      // Advance dialogue on Right Arrow, Space, Enter, or D keys
      if (this.isPaused && this.activeDialog) {
        if (code === 'ArrowRight' || code === 'KeyD' || code === 'Space' || code === 'Enter') {
          this.advanceDialogue();
          e.preventDefault();
          return;
        }
      }

      // Teleport shortcuts (1-9 and 0 keys) for dev testing
      if (code.startsWith('Digit')) {
        const num = parseInt(code.replace('Digit', ''));
        let targetLvlIdx = num - 1;
        if (num === 0) targetLvlIdx = 9;
        
        if (targetLvlIdx >= 0 && targetLvlIdx < this.levels.length) {
          this.teleportToLevel(targetLvlIdx);
          e.preventDefault();
          return;
        }
      }

      if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') {
        if (this.isRunning && !this.isPaused) {
          this.jump();
          e.preventDefault();
        }
      }

      // Attack: Enter (TV remote center "select"/click), F or J on keyboard
      if (code === 'Enter' || code === 'KeyF' || code === 'KeyJ') {
        if (this.isRunning && !this.isPaused) {
          this.attack();
          e.preventDefault();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      let code = e.code;
      if (!code) {
        if (e.keyCode === 37) code = 'ArrowLeft';
        else if (e.keyCode === 39) code = 'ArrowRight';
        else if (e.keyCode === 38) code = 'ArrowUp';
        else if (e.keyCode === 40) code = 'ArrowDown';
        else if (e.keyCode === 32) code = 'Space';
        else if (e.keyCode === 13) code = 'Enter';
        else if (e.keyCode === 65) code = 'KeyA';
        else if (e.keyCode === 68) code = 'KeyD';
        else if (e.keyCode === 87) code = 'KeyW';
      }
      console.log("Keyup: " + code);
      this.keys[code] = false;
    });

    // Start Button
    document.getElementById('start-btn').addEventListener('click', () => {
      const audioToggle = document.getElementById('music-toggle').checked;
      
      // Initialize Audio
      AudioEngine.init();
      if (audioToggle) {
        AudioEngine.playBGM();
        document.getElementById('hud-sound-btn').innerText = '🔊';
      } else {
        document.getElementById('hud-sound-btn').innerText = '🔇';
      }

      document.getElementById('start-screen').classList.remove('active');
      this.startGame();
    });

    // Dialog Button
    document.getElementById('dialog-action-btn').addEventListener('click', () => {
      this.advanceDialogue();
    });

    // Audio HUD control
    document.getElementById('hud-sound-btn').addEventListener('click', () => {
      if (AudioEngine.isPlaying) {
        AudioEngine.stopBGM();
        document.getElementById('hud-sound-btn').innerText = '🔇';
      } else {
        AudioEngine.playBGM();
        document.getElementById('hud-sound-btn').innerText = '🔊';
      }
      this.canvas.focus();
    });

    // Chapter Select HUD button
    document.getElementById('hud-menu-btn').addEventListener('click', () => {
      document.getElementById('chapter-menu-overlay').classList.add('active');
    });

    document.getElementById('close-menu-btn').addEventListener('click', () => {
      document.getElementById('chapter-menu-overlay').classList.remove('active');
      this.canvas.focus();
    });

    document.getElementById('chapter-menu-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'chapter-menu-overlay') {
        document.getElementById('chapter-menu-overlay').classList.remove('active');
        this.canvas.focus();
      }
    });

    // Populate Chapter Menu Buttons dynamically
    const listContainer = document.getElementById('chapter-buttons-list');
    listContainer.innerHTML = '';
    this.levels.forEach((lvl, idx) => {
      const btn = document.createElement('button');
      btn.className = 'chapter-menu-btn';
      btn.tabIndex = -1;
      
      const numSpan = document.createElement('span');
      numSpan.className = 'chapter-btn-num';
      numSpan.innerText = `Memory #${idx + 1} (${lvl.year})`;
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'chapter-btn-name';
      nameSpan.innerText = lvl.name;
      
      btn.appendChild(numSpan);
      btn.appendChild(nameSpan);
      
      btn.addEventListener('click', () => {
        this.teleportToLevel(idx);
      });
      
      listContainer.appendChild(btn);
    });

    // Replay Button
    document.getElementById('replay-btn').addEventListener('click', () => {
      document.getElementById('ending-screen').classList.remove('active');
      this.resetGame();
    });

    // Keep Exploring Button — resume the game so she can backtrack for hearts
    document.getElementById('keep-exploring-btn').addEventListener('click', () => {
      this.continueExploring();
    });

    // Dev HUD control
    document.getElementById('hud-dev-btn').addEventListener('click', () => {
      const devPanel = document.getElementById('dev-panel');
      if (devPanel) {
        devPanel.classList.toggle('active');
        this.updateDevPanel();
      }
      this.canvas.focus();
    });

    // Dev Panel toggle optimizations
    document.getElementById('dev-toggle-opt-btn').addEventListener('click', () => {
      const nextState = !Assets.checkOptimize();
      Assets.noOptimize = nextState;
      Game.useWasm = !nextState;
      Assets.clearCache();
      this.updateOptimizationState();
      this.updateDevPanel();
      this.canvas.focus();
    });

    // Dev Panel clear cache
    document.getElementById('dev-clear-cache-btn').addEventListener('click', () => {
      Assets.clearCache();
      this.updateDevPanel();
      this.canvas.focus();
    });

    // Dev Panel: jump straight to the 100% secret-prize ending
    document.getElementById('dev-win-btn').addEventListener('click', () => {
      this.hearts.forEach(h => { h.collected = true; h.spawned = true; h.falling = false; });
      this.totalHearts = this.hearts.length;
      this.heartsCollected = this.totalHearts;
      this.updateHeartsUI();
      this.currentLevelIndex = this.levels.length - 1;
      document.getElementById('dev-panel').classList.remove('active');
      this.triggerGameComplete();
    });

    // Dev Panel: jump to the normal (< 100%) ending
    document.getElementById('dev-end-btn').addEventListener('click', () => {
      // Leave a few hearts uncollected so it takes the normal-ending branch
      if (this.heartsCollected >= this.totalHearts) this.heartsCollected = Math.max(0, this.totalHearts - 3);
      this.currentLevelIndex = this.levels.length - 1;
      document.getElementById('dev-panel').classList.remove('active');
      this.triggerGameComplete();
    });

    // Mobile buttons touch bindings
    const leftBtn = document.getElementById('btn-left');
    const rightBtn = document.getElementById('btn-right');
    const jumpBtn = document.getElementById('btn-jump');

    const handleTouchStart = (btn, code) => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.keys[code] = true;
        if (code === 'KeyW') this.jump();
      });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.keys[code] = false;
      });
      // Fallback for mouse click debugging of mobile controls
      btn.addEventListener('mousedown', () => {
        this.keys[code] = true;
        if (code === 'KeyW') this.jump();
      });
      btn.addEventListener('mouseup', () => {
        this.keys[code] = false;
      });
    };

    handleTouchStart(leftBtn, 'ArrowLeft');
    handleTouchStart(rightBtn, 'ArrowRight');
    handleTouchStart(jumpBtn, 'KeyW');

    // Mobile attack button
    const attackBtn = document.getElementById('btn-attack');
    if (attackBtn) {
      const doAttack = (e) => {
        if (e) e.preventDefault();
        if (this.isRunning && !this.isPaused) this.attack();
      };
      attackBtn.addEventListener('touchstart', doAttack);
      attackBtn.addEventListener('mousedown', doAttack);
    }

    // Game Over: Try Again button
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.respawnSection());
    }

    // Secret Prize: replay button
    const secretReplayBtn = document.getElementById('secret-replay-btn');
    if (secretReplayBtn) {
      secretReplayBtn.addEventListener('click', () => {
        document.getElementById('secret-screen').classList.remove('active');
        this.resetGame();
      });
    }
  },

  updateDevPanel() {
    const devPanel = document.getElementById('dev-panel');
    if (!devPanel || !devPanel.classList.contains('active')) return;

    const fpsSpan = document.getElementById('dev-fps');
    if (fpsSpan) {
      fpsSpan.innerText = Math.round(this.smoothedFps || 0);
    }

    const optSpan = document.getElementById('dev-opt-status');
    if (optSpan) {
      const noOpt = Assets.checkOptimize();
      optSpan.innerText = noOpt ? 'OFF (Original)' : 'ON (Optimized)';
      optSpan.style.color = noOpt ? '#ff5400' : '#52b788';
    }

    const wasmSpan = document.getElementById('dev-wasm-status');
    if (wasmSpan) {
      const active = wasmExports && (Game.useWasm !== false);
      wasmSpan.innerText = active ? 'Active (WASM)' : 'Inactive (JS)';
      wasmSpan.style.color = active ? '#52b788' : '#ff5400';
    }

    const cacheSpan = document.getElementById('dev-cache-count');
    if (cacheSpan) {
      cacheSpan.innerText = Object.keys(Assets._cache || {}).length;
    }

    const partSpan = document.getElementById('dev-particles');
    if (partSpan) {
      let activeCount = 0;
      if (wasmExports && (Game.useWasm !== false)) {
        const MAX_PARTICLES = 300;
        for (let i = 0; i < MAX_PARTICLES; i++) {
          if (wasmExports.getParticleActive(i) !== 0) activeCount++;
        }
      } else {
        activeCount = this.fireworks.length;
      }
      partSpan.innerText = activeCount;
    }

    const posSpan = document.getElementById('dev-player-pos');
    if (posSpan) {
      posSpan.innerText = `X: ${Math.round(this.player.x)}, Y: ${Math.round(this.player.y)}`;
    }
  },

  startGame() {
    this.canvas.focus();
    this.ensureLoop();
  },

  resetGame() {
    // Hide any end-state overlays
    ['ending-screen', 'game-over-screen', 'secret-screen'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });

    if (wasmExports) {
      wasmExports.initPlayer(150, this.height - 80);
      this.player.x = wasmExports.player_x.value;
      this.player.y = wasmExports.player_y.value;
      this.player.vx = wasmExports.player_vx.value;
      this.player.vy = wasmExports.player_vy.value;
      this.player.isGrounded = wasmExports.player_isGrounded.value !== 0;
      this.player.dir = wasmExports.player_dir.value;
      this.player.animFrame = wasmExports.player_animFrame.value;
      this.player.outfit = 'casual';
    } else {
      this.player.x = 150;
      this.player.y = this.height - 80;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.outfit = 'casual';
    }
    this.camera.x = 0;
    this.currentLevelIndex = 0;
    this.isPaused = false;
    this.isQuizCompleted = false;

    this.setupWorld();
    this.ensureLoop();
  },

  jump() {
    if (wasmExports) {
      const didJump = wasmExports.playerJump();
      if (didJump) {
        this.player.vy = wasmExports.player_vy.value;
        this.player.isGrounded = wasmExports.player_isGrounded.value !== 0;
        AudioEngine.playJumpSFX();
      }
    } else {
      if (this.player.isGrounded) {
        this.player.vy = this.player.jumpForce;
        this.player.isGrounded = false;
        AudioEngine.playJumpSFX();
      }
    }
  },

  // Interpolates RGB/Hex colors to create a beautiful blending sky background
  getLevelIndexAtX(x) {
    for (let i = 0; i < this.levels.length - 1; i++) {
      if (x >= this.levels[i].x && x < this.levels[i + 1].x) {
        return i;
      }
    }
    if (x >= this.levels[this.levels.length - 1].x) {
      return this.levels.length - 1;
    }
    return 0;
  },

  // Per-level outfit for Ellen (array index = level index in levelsData)
  // 0: Dating, 1: Graduation, 2: Mochi, 3: First Home, 4: Engagement,
  // 5: Wedding, 6: Preston, 7: 2nd House, 8: Blaire, 9: RV Camping, 10: Mt Fuji
  getEllenOutfit(lvlIdx) {
    const outfits = [
      'date_dress',     // 0 - Started Dating
      'graduation',     // 1 - Graduation
      'casual',         // 2 - Adopting Mochi
      'sundress',       // 3 - First Home
      'engagement_dress', // 4 - The Engagement
      'wedding',        // 5 - Our Wedding Day
      'mom_casual',     // 6 - Welcoming Preston
      'casual',         // 7 - Moving to 2nd House
      'mom_casual',     // 8 - Welcoming Blaire
      'hiking',         // 9 - RV Camping
      'hiking',         // 10 - Mt Fuji
    ];
    return outfits[lvlIdx] || 'casual';
  },

  // Per-level outfit for Barney (husband)
  getHusbandOutfit(lvlIdx) {
    const outfits = [
      'red_vneck',      // 0 - Started Dating
      'graduation',     // 1 - Graduation
      'casual',         // 2 - Adopting Mochi
      'flannel',        // 3 - First Home
      'suit',           // 4 - The Engagement
      'tuxedo',         // 5 - Our Wedding Day
      'dad_casual',     // 6 - Welcoming Preston
      'casual',         // 7 - Moving to 2nd House
      'dad_casual',     // 8 - Welcoming Blaire
      'hiking',         // 9 - RV Camping
      'hiking',         // 10 - Mt Fuji
    ];
    return outfits[lvlIdx] || 'casual';
  },

  // Year shown in the HUD. Flips to a milestone's year slightly BEFORE the
  // player arrives, so the final stretch reads ...2024 → 2025 → 2026 before the
  // Mt. Fuji dialogue fires (otherwise the last year is never visible because
  // its milestone sits at the very end of the map where the game completes).
  getDisplayYear(x) {
    const lead = 350; // px of anticipation before a milestone
    let year = this.levels[0].year;
    for (let i = 0; i < this.levels.length; i++) {
      if (x >= this.levels[i].x - lead) year = this.levels[i].year;
    }
    return year;
  },

  getSkyColors(x) {
    const activeLvlIdx = this.getLevelIndexAtX(x);
    const lvl1 = this.levels[activeLvlIdx];

    if (activeLvlIdx === this.levels.length - 1) {
      return lvl1.skyGradient;
    }

    const lvl2 = this.levels[activeLvlIdx + 1];
    
    // Calculate blending factor (0.0 to 1.0)
    const segmentLength = lvl2.x - lvl1.x;
    const distanceWalked = x - lvl1.x;
    const factor = Math.max(0, Math.min(1, distanceWalked / segmentLength));

    // Blends Hex colors
    const blendHex = (color1, color2, ratio) => {
      const parse = (hex) => {
        let c = hex.substring(1);
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        return {
          r: parseInt(c.substring(0, 2), 16),
          g: parseInt(c.substring(2, 4), 16),
          b: parseInt(c.substring(4, 6), 16)
        };
      };
      
      const rgbToHexStr = (r, g, b) => {
        const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
        return "#" + ((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1);
      };

      const c1 = parse(color1);
      const c2 = parse(color2);

      const r = c1.r + (c2.r - c1.r) * ratio;
      const g = c1.g + (c2.g - c1.g) * ratio;
      const b = c1.b + (c2.b - c1.b) * ratio;

      return rgbToHexStr(r, g, b);
    };

    return {
      top: blendHex(lvl1.skyGradient.top, lvl2.skyGradient.top, factor),
      bottom: blendHex(lvl1.skyGradient.bottom, lvl2.skyGradient.bottom, factor)
    };
  },

  updatePhysics() {
    // Apply Left/Right movements
    const walkLeft = (this.keys['KeyA'] || this.keys['ArrowLeft']) ? 1 : 0;
    const walkRight = (this.keys['KeyD'] || this.keys['ArrowRight']) ? 1 : 0;
    const endX = this.levels[this.levels.length - 1].x;

    if (walkLeft || walkRight) {
      console.log("walkLeft: " + walkLeft + ", walkRight: " + walkRight + ", wasm: " + !!wasmExports);
    }

    if (wasmExports) {
      wasmExports.updatePlayerPhysics(walkLeft, walkRight, endX);
      this.player.x = wasmExports.player_x.value;
      this.player.y = wasmExports.player_y.value;
      this.player.vx = wasmExports.player_vx.value;
      this.player.vy = wasmExports.player_vy.value;
      this.player.isGrounded = wasmExports.player_isGrounded.value !== 0;
      this.player.dir = wasmExports.player_dir.value;
      this.player.animFrame = wasmExports.player_animFrame.value;
    } else {
      if (walkLeft) {
        this.player.vx = -this.player.speed;
        this.player.dir = -1;
        this.player.animFrame++;
      } else if (walkRight) {
        this.player.vx = this.player.speed;
        this.player.dir = 1;
        this.player.animFrame++;
      } else {
        this.player.vx *= 0.7; // friction
        if (Math.abs(this.player.vx) < 0.2) this.player.vx = 0;
      }

      // Apply gravity
      this.player.vy += this.player.gravity;
      this.player.y += this.player.vy;
      this.player.x += this.player.vx;

      // Ground collision
      const groundY = this.height - 80;
      if (this.player.y >= groundY) {
        this.player.y = groundY;
        this.player.vy = 0;
        this.player.isGrounded = true;
      }

      // Map limits
      if (this.player.x < 40) this.player.x = 40;
      if (this.player.x > endX) this.player.x = endX;
    }

    // Set Ellen's outfit based on current level milestone reached
    const lvlIdx = this.getLevelIndexAtX(this.player.x);
    this.player.outfit = this.getEllenOutfit(lvlIdx);

    // --- COMPANION TRAIL ENGINE ---
    // Handle Dog, Husband and Kids following Ellen in a chain
    this.updateCompanions(lvlIdx);

    // --- CAMERA SCROLL SYSTEM ---
    // Camera centers horizontally on the player
    const targetCamX = this.player.x - this.width / 3;
    this.camera.x += (targetCamX - this.camera.x) * 0.1;
    // Lock camera boundaries
    if (this.camera.x < 0) this.camera.x = 0;
    if (this.camera.x > endX - this.width + 250) this.camera.x = endX - this.width + 250;

    // Check collectible Heart collisions
    this.hearts.forEach(heart => {
      if (!heart.collected && heart.spawned !== false) {
        let isColliding = false;
        if (wasmExports) {
          isColliding = wasmExports.checkHeartCollision(heart.x, heart.y) !== 0;
        } else {
          const dist = Math.hypot((this.player.x - 5) - heart.x, (this.player.y - 35) - heart.y);
          isColliding = dist < 28;
        }

        if (isColliding) {
          heart.collected = true;
          this.heartsCollected++;
          this.updateHeartsUI();
          AudioEngine.playHeartSFX();

          // If she's backtracking after the finish and just grabbed the last
          // heart, reward the secret prize right away.
          if (this.allowSecretOnCollect && this.totalHearts > 0 && this.heartsCollected >= this.totalHearts) {
            this.allowSecretOnCollect = false;
            this.showSecretPrize();
          }
        }
      }
    });

    // Check hurdle obstacle collisions (slowing the player down slightly, but safe)
    this.hurdles.forEach(hurdle => {
      if (wasmExports) {
        const collided = wasmExports.checkHurdleCollision(hurdle.x, hurdle.y);
        if (collided) {
          this.player.x = wasmExports.player_x.value;
          this.player.vx = wasmExports.player_vx.value;
        }
      } else {
        const px = this.player.x;
        const py = this.player.y;
        
        const hDist = Math.abs(px - hurdle.x);
        const vDist = py - hurdle.y;

        if (hDist < 25 && vDist > -25 && vDist < 5) {
          // Simple bounce back collision physics
          this.player.x -= this.player.dir * 12;
          this.player.vx = -this.player.dir * 3;
        }
      }
    });

    // Check Memory triggers
    this.levels.forEach((lvl, idx) => {
      // Trigger dialogue pause when passing milestone x coordinate
      if (idx > this.currentLevelIndex && this.player.x >= lvl.x - 80) {
        this.triggerMilestone(idx);
      }
    });

    // Combat systems (pickups, enemies, projectiles, trampolines, damage)
    this.updateCombat();
  },

  // ============================================================
  // COMBAT SYSTEMS
  // ============================================================
  attack() {
    if (!this.isRunning || this.isPaused || this.player.isDead) return;
    if (!this.player.weapon) return;            // no racket yet
    if (this.player.attackTimer > 0) return;    // mid-swing

    // Swing the racket (melee — resolved each active frame in updateCombat)
    this.player.attackTimer = this.combat.swingDuration;
    this._swingId = (this._swingId || 0) + 1; // so one swing damages an enemy once
    AudioEngine.playSlashSFX();

    // Once she's picked up the tennis balls, the same swing serves an arcing ball
    if (this.player.hasBalls && this.player.serveCooldown <= 0) {
      this.player.serveCooldown = this.combat.serveCooldown;
      this.serveBall();
      AudioEngine.playShootSFX();
    }
  },

  serveBall() {
    const dir = this.player.dir;
    this.projectiles.push({
      x: this.player.x + dir * 20,
      y: this.player.y - 36,
      vx: dir * this.combat.ballSpeedX,
      vy: this.combat.ballSpeedY, // launches upward, gravity arcs it back down
      spin: 0,
      bounced: false,
      dir,
      alive: true
    });
  },

  // Apply damage to an enemy. Tougher (2-hit) monsters flash when hurt but
  // survive until their hp runs out.
  hitEnemy(e, dmg) {
    if (!e.alive) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      this.defeatEnemy(e);
    } else {
      e.hitFlash = 12; // white flash = "ouch, but still standing"
      AudioEngine.playEnemyHurtSFX();
    }
  },

  defeatEnemy(e) {
    if (!e.alive) return;
    e.alive = false;
    e.hitFlash = 0;
    this.poofs.push({ x: e.x, y: e.y, progress: 0 });
    AudioEngine.playEnemyDefeatSFX();
    // Drop its heart (pops up, then falls to the ground)
    if (e.heart && !e.heart.collected) {
      e.heart.spawned = true;
      e.heart.falling = true;
      e.heart.x = e.x;
      e.heart.y = e.y;
      e.heart.vy = -5;
    }
  },

  damagePlayer() {
    if (this.player.invuln > 0 || this.player.isDead) return;
    this.player.health -= 1;
    this.player.invuln = this.combat.invulnFrames;
    AudioEngine.playHurtSFX();
    // Knockback away from facing direction
    const kb = -this.player.dir * 6;
    this.player.vx = kb;
    if (wasmExports) wasmExports.player_vx.value = kb;
    if (this.player.health <= 0) {
      this.player.health = 0;
      this.triggerGameOver();
    }
  },

  updateCombat() {
    const groundY = this.height - 80;

    // Drift wobbling hearts (so a straight vertical jump won't always catch them)
    this._heartClock = (this._heartClock || 0) + 1;
    const hc = this._heartClock;
    this.hearts.forEach(h => {
      if (h.motion && !h.falling && !h.collected) {
        h.x = h.motion.baseX + Math.sin(hc * h.motion.speed + h.motion.phase) * h.motion.ampX;
        h.y = h.motion.baseY + Math.cos(hc * h.motion.speed + h.motion.phase) * h.motion.ampY;
      }
    });

    // Tick player timers
    if (this.player.attackTimer > 0) this.player.attackTimer--;
    if (this.player.serveCooldown > 0) this.player.serveCooldown--;
    if (this.player.invuln > 0) this.player.invuln--;
    if (this.banner && this.banner.timer > 0) this.banner.timer--;

    // --- Pickups (tennis racket, then tennis balls) ---
    this.pickups.forEach(pk => {
      if (pk.collected) return;
      pk.frame++;
      if (Math.abs(pk.x - this.player.x) < 32 && Math.abs(pk.y - this.player.y) < 72) {
        pk.collected = true;
        AudioEngine.playPickupSFX();
        if (pk.kind === 'racket') {
          this.player.weapon = 'racket';
          this.banner = {
            timer: 240,
            text: '🎾 Tennis racket! Press SELECT / Enter to swing at the monsters'
          };
        } else if (pk.kind === 'balls') {
          this.player.hasBalls = true;
          this.banner = {
            timer: 240,
            text: '🎾 Tennis balls! Your swing now serves an arcing ball — jump & serve at the clouds'
          };
        }
      }
    });

    // --- Trampolines (super-bounce) ---
    this.trampolines.forEach(t => {
      if (t.squash > 0) t.squash *= 0.8;
      const onPadX = Math.abs(this.player.x - t.x) < t.w / 2;
      if (onPadX && this.player.vy >= 0 && this.player.y >= t.y - 14 && this.player.y <= t.y + 8) {
        this.player.vy = this.combat.trampolineForce;
        this.player.y = t.y - 16;
        this.player.isGrounded = false;
        if (wasmExports) {
          wasmExports.player_vy.value = this.combat.trampolineForce;
          wasmExports.player_y.value = t.y - 16;
          wasmExports.player_isGrounded.value = 0;
        }
        t.squash = 1;
        AudioEngine.playBounceSFX();
      }
    });

    // --- Enemies: movement + contact damage ---
    const playerMidY = this.player.y - 28;
    this.enemies.forEach(e => {
      if (e.hitFlash > 0) e.hitFlash--;
      if (!e.alive) return;
      e.frame++;
      e.dir = (this.player.x < e.x) ? -1 : 1;
      if (e.type === 'ground') {
        e.x = e.homeX + Math.sin(e.frame * 0.03) * e.range;
      } else {
        e.y = e.baseY + Math.sin(e.frame * 0.05) * 14;
        e.x = e.homeX + Math.sin(e.frame * 0.02) * 30;
        // Flying foes shoot projectiles aimed at Ellen
        if (e.shootTimer !== undefined) {
          e.shootTimer--;
          const dxp = this.player.x - e.x;
          if (e.shootTimer <= 0 && !this.player.isDead && Math.abs(dxp) < this.combat.enemyShootRange) {
            const dyp = playerMidY - e.y;
            const dist = Math.hypot(dxp, dyp) || 1;
            const sp = this.combat.enemyBulletSpeed;
            this.enemyProjectiles.push({
              x: e.x, y: e.y,
              vx: (dxp / dist) * sp,
              vy: (dyp / dist) * sp,
              kind: e.kind, frame: 0, alive: true
            });
            e.shootTimer = this.combat.enemyShootMin +
              Math.floor(Math.random() * (this.combat.enemyShootMax - this.combat.enemyShootMin));
          }
        }
      }
      // Contact damage
      if (Math.abs(e.x - this.player.x) < 24 && Math.abs(e.y - playerMidY) < 30) {
        this.damagePlayer();
      }
    });

    // --- Racket swing hit resolution (ground enemies only) ---
    // One swing damages a given enemy at most once (guarded by swing id), so a
    // 2-hit monster survives a single swing.
    if (this.player.weapon === 'racket' && this.player.attackTimer > 0) {
      const reach = this.combat.swingReach;
      const dir = this.player.dir;
      this.enemies.forEach(e => {
        if (!e.alive || e.type !== 'ground') return;
        if (e.lastSwingHit === this._swingId) return;
        const dx = (e.x - this.player.x) * dir; // >0 = in front
        if (dx > -12 && dx < reach && Math.abs(e.y - playerMidY) < 48) {
          e.lastSwingHit = this._swingId;
          this.hitEnemy(e, 1);
        }
      });
    }

    // --- Tennis balls (player's serves): arc under gravity, bounce once ---
    this.projectiles.forEach(p => {
      if (!p.alive) return;
      p.vy += this.combat.ballGravity;
      p.x += p.vx;
      p.y += p.vy;
      p.spin = (p.spin || 0) + p.vx * 0.06;
      // single ground bounce, then it rolls out and expires
      if (p.y > groundY - 4) {
        if (!p.bounced) {
          p.bounced = true;
          p.y = groundY - 4;
          p.vy = -Math.abs(p.vy) * 0.55;
          p.vx *= 0.8;
        } else {
          p.alive = false;
          return;
        }
      }
      if (p.x < this.camera.x - 80 || p.x > this.camera.x + this.width + 80) {
        p.alive = false;
        return;
      }
      this.enemies.forEach(e => {
        if (!e.alive) return;
        if (Math.abs(e.x - p.x) < 20 && Math.abs(e.y - p.y) < 24) {
          this.hitEnemy(e, 1);
          p.alive = false;
        }
      });
    });
    if (this.projectiles.length) {
      this.projectiles = this.projectiles.filter(p => p.alive);
    }

    // --- Enemy projectiles (damage the player on hit) ---
    this.enemyProjectiles.forEach(p => {
      if (!p.alive) return;
      p.x += p.vx;
      p.y += p.vy;
      p.frame++;
      if (p.y > groundY + 6 || p.y < -50 ||
          p.x < this.camera.x - 80 || p.x > this.camera.x + this.width + 80) {
        p.alive = false;
        return;
      }
      if (Math.abs(p.x - this.player.x) < 20 && Math.abs(p.y - playerMidY) < 28) {
        p.alive = false;
        this.damagePlayer();
      }
    });
    if (this.enemyProjectiles.length) {
      this.enemyProjectiles = this.enemyProjectiles.filter(p => p.alive);
    }

    // --- Dropped hearts fall to the ground ---
    this.hearts.forEach(h => {
      if (h.falling) {
        h.vy += 0.5;
        h.y += h.vy;
        const restY = groundY - 16;
        if (h.y >= restY) {
          h.y = restY;
          h.falling = false;
          h.vy = 0;
        }
      }
    });

    // --- Defeat puffs ---
    if (this.poofs.length) {
      this.poofs.forEach(pf => pf.progress += 0.08);
      this.poofs = this.poofs.filter(pf => pf.progress < 1);
    }
  },

  triggerGameOver() {
    this.player.isDead = true;
    this.isPaused = true;
    AudioEngine.playGameOverSFX();
    setTimeout(() => {
      const el = document.getElementById('game-over-screen');
      if (el) el.classList.add('active');
    }, 700);
  },

  // Try Again: respawn at the current section's milestone with full health.
  // Enemies/hearts in this section and ahead are reset so the section is replayable.
  respawnSection() {
    const over = document.getElementById('game-over-screen');
    if (over) over.classList.remove('active');

    const sec = this.getLevelIndexAtX(this.player.x);

    this.enemies.forEach(e => {
      if (e.section >= sec) {
        e.alive = true;
        e.hitFlash = 0;
        e.hp = e.maxHp;
        e.lastSwingHit = -1;
        if (e.heart) {
          e.heart.spawned = false;
          e.heart.collected = false;
          e.heart.falling = false;
        }
      }
    });
    this.hearts.forEach(h => {
      if (h.section >= sec && !h.fromEnemy) {
        h.collected = false;
      }
    });
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.poofs = [];
    this.heartsCollected = this.hearts.filter(h => h.collected).length;

    this.player.health = this.player.maxHealth;
    this.player.isDead = false;
    this.player.invuln = this.combat.invulnFrames;
    this.player.attackTimer = 0;
    this.player.serveCooldown = 0;

    const targetX = Math.max(700, this.levels[sec].x - 120);
    if (wasmExports) {
      wasmExports.initPlayer(targetX, this.height - 80);
      this.player.x = wasmExports.player_x.value;
      this.player.y = wasmExports.player_y.value;
      this.player.vx = wasmExports.player_vx.value;
      this.player.vy = wasmExports.player_vy.value;
      this.player.isGrounded = wasmExports.player_isGrounded.value !== 0;
      this.player.dir = wasmExports.player_dir.value;
    } else {
      this.player.x = targetX;
      this.player.vx = 0;
      this.player.vy = 0;
    }
    this.camera.x = Math.max(0, this.player.x - this.width / 3);
    this.currentLevelIndex = sec; // don't re-trigger this milestone's dialogue
    this.isPaused = false;
    this.updateHeartsUI();
    this.canvas.focus();
  },

  confirmGamepadScreen() {
    const click = (id) => { const el = document.getElementById(id); if (el) el.click(); };
    const isActive = (id) => {
      const el = document.getElementById(id);
      return el && el.classList.contains('active');
    };
    if (isActive('start-screen')) click('start-btn');
    else if (isActive('game-over-screen')) click('retry-btn');
    else if (isActive('secret-screen')) click('secret-replay-btn');
    else if (isActive('ending-screen')) {
      const ids = ['keep-exploring-btn', 'replay-btn'];
      click(ids[this.endingFocusIndex || 0]);
    }
  },

  updateCompanions(lvlIdx) {
    this.companions = [];
    const frame = this.player.animFrame;
    const speed = Math.abs(this.player.vx);
    const isMoving = speed > 0.5;
    const groundY = this.height - 80;

    // Record Ellen's vertical jump offset each frame so the whole family can
    // echo the hop on a short delay — a conga-line ripple where she leads and
    // each follower jumps a few frames later based on how far back it trails.
    // When grounded the offset is 0, so this is a no-op until she jumps.
    const jumpOffset = this.player.y - groundY;
    if (!this.player.yHistory) this.player.yHistory = [];
    this.player.yHistory.unshift(jumpOffset);
    if (this.player.yHistory.length > 24) this.player.yHistory.pop();
    const echoY = (delayFrames) => {
      const h = this.player.yHistory;
      return groundY + (h[Math.min(delayFrames, h.length - 1)] || 0);
    };

    // 1. Dog joins once we've adopted Mochi (index 2) onward
    if (lvlIdx >= 2) {
      this.companions.push({
        type: 'dog',
        x: this.player.x - 55 * this.player.dir,
        y: echoY(6),
        outfit: 'casual',
        frame: frame,
        dir: this.player.dir
      });
    }

    // 2. Husband (Barney) joins at the Dating milestone (index 0) onward
    if (this.player.x >= this.levels[0].x) {
      this.companions.push({
        type: 'husband',
        x: this.player.x - 30 * this.player.dir,
        y: echoY(3),
        outfit: this.getHusbandOutfit(lvlIdx),
        frame: frame,
        dir: this.player.dir
      });
    }

    // 3. Child 1 (Preston) joins at his birth (index 6, baby stroller), toddler from the next milestone
    if (lvlIdx >= 6) {
      let kidType = 'baby_stroller';
      let offset = 85;
      if (lvlIdx >= 7) {
        kidType = 'kid1';
        offset = 90;
      }

      this.companions.push({
        type: kidType,
        x: this.player.x - offset * this.player.dir,
        y: echoY(9),
        outfit: 'casual',
        frame: frame,
        dir: this.player.dir
      });
    }

    // 4. Child 2 (Blaire) joins at her birth (index 8, crawling baby), toddler from the next milestone
    if (lvlIdx >= 8) {
      let kid2Type = 'baby_crawling';
      let offset = 115;

      if (lvlIdx >= 9) {
        kid2Type = 'kid2';
        offset = 120;
      }

      this.companions.push({
        type: kid2Type,
        x: this.player.x - offset * this.player.dir,
        y: echoY(12),
        outfit: 'casual',
        frame: frame,
        dir: this.player.dir
      });
    }
  },

  updateHeartsUI() {
    const text = `❤️ ${this.heartsCollected} / ${this.totalHearts}`;
    this.ctx.font = 'bold 16px Outfit';
    this.ctx.fillStyle = '#ffffff';
  },

  triggerMilestone(lvlIndex) {
    this.isPaused = true;
    this.currentLevelIndex = lvlIndex;
    
    // Lock player walking keys
    this.player.vx = 0;

    const lvl = this.levels[lvlIndex];
    this.activeDialog = lvl.dialogue;
    this.dialogIndex = 0;

    // Populate and show the modal
    document.getElementById('dialog-title').innerText = lvl.name;
    document.getElementById('dialog-date').innerText = lvl.year;
    document.getElementById('dialog-text').innerText = this.activeDialog[0];
    
    const actionBtn = document.getElementById('dialog-action-btn');
    if (this.activeDialog.length > 1) {
      actionBtn.innerText = "Next ➡️";
    } else {
      actionBtn.innerText = "Continue Walk ➡️";
    }

    document.getElementById('dialog-overlay').classList.add('active');
  },

  advanceDialogue() {
    this.dialogIndex++;
    const actionBtn = document.getElementById('dialog-action-btn');
    
    if (this.dialogIndex < this.activeDialog.length) {
      document.getElementById('dialog-text').innerText = this.activeDialog[this.dialogIndex];
      if (this.dialogIndex === this.activeDialog.length - 1) {
        actionBtn.innerText = "Continue Walk ➡️";
      }
    } else {
      // Close overlay and resume walking
      document.getElementById('dialog-overlay').classList.remove('active');
      this.isPaused = false;
      this.activeDialog = null;
      this.canvas.focus();

      // If they reached the end (Fuji milestone)
      if (this.currentLevelIndex === this.levels.length - 1) {
        this.triggerGameComplete();
      }
    }
  },

  triggerGameComplete() {
    // Keep the loop alive (isRunning stays true) so the celebration fireworks
    // play behind the overlay AND so "Keep Exploring" can resume instantly.
    this.isPaused = true;

    if (wasmExports) {
      wasmExports.initParticles();
    }
    this.fireworks = [];

    // Win sound chime
    AudioEngine.playWinSFX();

    // Did she collect EVERY heart? That unlocks the secret prize.
    const allHearts = this.totalHearts > 0 && this.heartsCollected >= this.totalHearts;

    // Show ending UI overlay after a short delay
    setTimeout(() => {
      if (allHearts) {
        this.showSecretPrize();
      } else {
        const missing = this.totalHearts - this.heartsCollected;
        const hint = document.getElementById('ending-hearts-hint');
        if (hint) {
          hint.textContent = `💗 You found ${this.heartsCollected} of ${this.totalHearts} hearts. Collect them ALL for a special secret prize — choose “Keep Exploring” to go back for the ${missing} you missed!`;
        }
        this.endingFocusIndex = 0;
        document.getElementById('ending-screen').classList.add('active');
        this.updateEndingFocus();
      }
    }, 1500);
  },

  // Resume play after finishing so she can backtrack and collect missed hearts.
  continueExploring() {
    document.getElementById('ending-screen').classList.remove('active');
    this.isPaused = false;
    // Now that she's finished, grabbing the final heart pops the secret prize.
    this.allowSecretOnCollect = true;
    this.ensureLoop();
    this.canvas.focus();
  },

  // Shows the golden 100%-completion reward (from the finish line OR from
  // collecting the last heart while backtracking).
  showSecretPrize() {
    this.isPaused = true;
    if (wasmExports) {
      wasmExports.initParticles();
    }
    this.fireworks = [];
    AudioEngine.playWinSFX();
    setTimeout(() => {
      document.getElementById('secret-screen').classList.add('active');
    }, 800);
  },

  updateEndingFocus() {
    const ids = ['keep-exploring-btn', 'replay-btn'];
    ids.forEach((id, i) => {
      const b = document.getElementById(id);
      if (b) b.classList.toggle('focused', i === (this.endingFocusIndex || 0));
    });
  },

  // Renders the background scenery, hills and ground
  drawBackground() {
    // Dynamic Sky Gradient
    const sky = this.getSkyColors(this.player.x);
    const bgGrad = this.ctx.createLinearGradient(0, 0, 0, this.height);
    bgGrad.addColorStop(0, sky.top);
    bgGrad.addColorStop(1, sky.bottom);
    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Dynamic Stars depending on levels (Blaire idx 8 and RV idx 9 are the night milestones)
    const lvlIdx = this.getLevelIndexAtX(this.player.x);
    if (lvlIdx >= 8 && lvlIdx <= 9) {
      // Draw stars twinkling
      this.ctx.fillStyle = '#ffffff';
      const time = Date.now() * 0.002;
      for (let i = 0; i < 25; i++) {
        const starX = (1032 * i) % this.width;
        const starY = (512 * i) % (this.height - 200);
        const size = Math.abs(Math.sin(time + i)) * 1.8 + 0.5;
        this.ctx.fillRect(starX, starY, size, size);
      }
    }

    // Draw Parallax clouds & hills
    this.drawParallaxHills(lvlIdx);

    // Draw Milestone Scenery backdrops (e.g. Wedding Arch, houses, campground)
    this.levels.forEach(lvl => {
      const relativeX = lvl.x - this.camera.x;
      // Only draw if visible on canvas viewport
      if (relativeX > -300 && relativeX < this.width + 300) {
        Assets.drawScenery(this.ctx, lvl.id, relativeX, Date.now() * 0.02);
      }
    });

    // Draw Floating Polaroid Photos in the sky
    this.levels.forEach((lvl, idx) => {
      const relativeX = lvl.x - this.camera.x;
      // Float card in the sky
      const py = 125;
      
      const dist = Math.abs(this.player.x - lvl.x);
      
      // Calculate opacity: starts fading in 420px away
      let alpha = 0;
      if (dist < 420) {
        alpha = 1 - (dist / 420);
      }
      
      if (alpha > 0) {
        Assets.drawPolaroid(this.ctx, relativeX, py, lvl, alpha, Date.now());
      }
    });
  },

  drawParallaxHills(lvlIdx) {
    const camX = this.camera.x;
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('no_optimize') === 'true') {
      // Old dynamic drawing loops
      // Far hills (Slowest scroll speed: 0.15)
      this.ctx.fillStyle = lvlIdx >= 8 ? '#0b1626' : (lvlIdx >= 7 ? '#2b442b' : '#32531d');
      this.ctx.beginPath();
      this.ctx.moveTo(0, this.height - 80);
      for (let x = 0; x <= this.width; x += 30) {
        const scrollPos = x + camX * 0.15;
        const y = this.height - 110 + Math.sin(scrollPos * 0.005) * 20 + Math.cos(scrollPos * 0.01) * 8;
        this.ctx.lineTo(x, y);
      }
      this.ctx.lineTo(this.width, this.height - 80);
      this.ctx.closePath();
      this.ctx.fill();

      // Mid hills (Medium scroll speed: 0.3)
      this.ctx.fillStyle = lvlIdx >= 8 ? '#122538' : (lvlIdx >= 7 ? '#385838' : '#47752b');
      this.ctx.beginPath();
      this.ctx.moveTo(0, this.height - 80);
      for (let x = 0; x <= this.width; x += 30) {
        const scrollPos = x + camX * 0.3;
        const y = this.height - 95 + Math.sin(scrollPos * 0.008) * 12 + Math.cos(scrollPos * 0.015) * 5;
        this.ctx.lineTo(x, y);
      }
      this.ctx.lineTo(this.width, this.height - 80);
      this.ctx.closePath();
      this.ctx.fill();
      return;
    }

    // Determine color state (0, 1, 2)
    const state = lvlIdx >= 8 ? 2 : (lvlIdx >= 7 ? 1 : 0);
    
    // Lazy render far hills
    const farKey = `far_hills_${state}`;
    if (!Assets._cache[farKey]) {
      const canvas = document.createElement('canvas');
      canvas.width = 4300;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = state === 2 ? '#0b1626' : (state === 1 ? '#2b442b' : '#32531d');
      ctx.beginPath();
      ctx.moveTo(0, 150);
      for (let x = 0; x <= 4300; x += 4) {
        const y = 40 - (Math.sin(x * 0.005) * 20 + Math.cos(x * 0.01) * 8);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(4300, 150);
      ctx.closePath();
      ctx.fill();
      Assets._cache[farKey] = canvas;
    }
    
    // Lazy render mid hills
    const midKey = `mid_hills_${state}`;
    if (!Assets._cache[midKey]) {
      const canvas = document.createElement('canvas');
      canvas.width = 4300;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = state === 2 ? '#122538' : (state === 1 ? '#385838' : '#47752b');
      ctx.beginPath();
      ctx.moveTo(0, 150);
      for (let x = 0; x <= 4300; x += 4) {
        const y = 55 - (Math.sin(x * 0.008) * 12 + Math.cos(x * 0.015) * 5);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(4300, 150);
      ctx.closePath();
      ctx.fill();
      Assets._cache[midKey] = canvas;
    }

    const farCanvas = Assets._cache[farKey];
    const midCanvas = Assets._cache[midKey];
    
    const farSrcX = camX * 0.15;
    const midSrcX = camX * 0.3;
    
    // Draw far hills
    this.ctx.drawImage(
      farCanvas,
      farSrcX, 0, this.width, 150,
      0, this.height - 150, this.width, 150
    );
    
    // Draw mid hills
    this.ctx.drawImage(
      midCanvas,
      midSrcX, 0, this.width, 150,
      0, this.height - 150, this.width, 150
    );
  },

  drawForeground() {
    const camX = this.camera.x;

    // Draw Ground Path
    const currentGroundColor = this.levels[this.getLevelIndexAtX(this.player.x)].groundColor || "#47752b";
    this.ctx.fillStyle = currentGroundColor;
    this.ctx.fillRect(0, this.height - 80, this.width, 80);
    
    // Ground detail line
    this.ctx.fillStyle = 'rgba(0,0,0,0.08)';
    this.ctx.fillRect(0, this.height - 80, this.width, 6);

    // Draw obstacles (hurdles)
    this.hurdles.forEach(hurdle => {
      const rx = hurdle.x - camX;
      if (rx > -50 && rx < this.width + 50) {
        Assets.drawHurdle(this.ctx, rx, hurdle.y, hurdle.levelId);
      }
    });

    // Draw trampolines (bounce pads)
    this.trampolines.forEach(t => {
      const rx = t.x - camX;
      if (rx > -60 && rx < this.width + 60) {
        Assets.drawTrampoline(this.ctx, rx, t.y, t.w, t.squash);
      }
    });

    // Draw weapon pickups
    this.pickups.forEach(pk => {
      if (pk.collected) return;
      const rx = pk.x - camX;
      if (rx > -60 && rx < this.width + 60) {
        Assets.drawWeaponPickup(this.ctx, rx, pk.y, pk.kind, pk.frame);
      }
    });

    // Draw hearts collectibles
    this.hearts.forEach(heart => {
      if (!heart.collected && heart.spawned !== false) {
        const rx = heart.x - camX;
        if (rx > -50 && rx < this.width + 50) {
          Assets.drawHeart(this.ctx, rx, heart.y, this.player.animFrame);
        }
      }
    });

    // Draw enemies (tougher 2-hit monsters render bigger + show hp pips)
    this.enemies.forEach(e => {
      if (!e.alive) return;
      const rx = e.x - camX;
      if (rx > -70 && rx < this.width + 70) {
        Assets.drawEnemy(this.ctx, rx, e.y, e.kind, e.frame, e.dir, e.hitFlash, e.tier, e.hp, e.maxHp);
      }
    });

    // Draw projectiles (player's served tennis balls)
    this.projectiles.forEach(p => {
      const rx = p.x - camX;
      if (rx > -30 && rx < this.width + 30) {
        Assets.drawBullet(this.ctx, rx, p.y, p.dir, p.spin);
      }
    });

    // Draw enemy projectiles
    this.enemyProjectiles.forEach(p => {
      const rx = p.x - camX;
      if (rx > -30 && rx < this.width + 30) {
        Assets.drawEnemyBullet(this.ctx, rx, p.y, p.kind, p.frame);
      }
    });

    // Draw defeat puffs
    this.poofs.forEach(pf => {
      const rx = pf.x - camX;
      if (rx > -40 && rx < this.width + 40) {
        Assets.drawPoof(this.ctx, rx, pf.y, pf.progress);
      }
    });

    // Draw active companion entities
    const lvlIdx = this.getLevelIndexAtX(this.player.x);
    this.companions.forEach(comp => {
      const rx = comp.x - camX;
      if (rx > -60 && rx < this.width + 60) {
        if (comp.type === 'dog') {
          Assets.drawDog(this.ctx, rx, comp.y, comp.frame, comp.dir);
        } else if (comp.type === 'husband') {
          Assets.drawHusband(this.ctx, rx, comp.y, comp.outfit, comp.frame, comp.dir);
        } else {
          // kids (baby stroller, kid1, kid2)
          Assets.drawKid(this.ctx, rx, comp.y, comp.type, comp.frame, comp.dir, lvlIdx);
        }
      }
    });

    // Draw Ellen (blinks while invulnerable just after taking a hit)
    const pX = this.player.x - camX;
    const blink = this.player.invuln > 0 && Math.floor(this.player.invuln / 4) % 2 === 0;
    if (!blink) {
      Assets.drawEllen(
        this.ctx,
        pX,
        this.player.y,
        this.player.outfit,
        this.player.animFrame,
        this.player.dir
      );

      // Racket held in hand (sways with her stride, swings on attack)
      if (this.player.weapon) {
        const swing = this.player.attackTimer > 0
          ? 1 - this.player.attackTimer / this.combat.swingDuration
          : 0;
        const moving = Math.abs(this.player.vx) > 0.5;
        Assets.drawHeldWeapon(this.ctx, pX, this.player.y, this.player.weapon, this.player.dir, swing, this.player.animFrame, moving);
      }

      // Racket swing arc effect
      if (this.player.weapon === 'racket' && this.player.attackTimer > 0) {
        const prog = 1 - this.player.attackTimer / this.combat.swingDuration;
        Assets.drawSlash(this.ctx, pX + this.player.dir * 14, this.player.y - 30, this.player.dir, prog);
      }
    }

    // HUD overlays rendered on canvas
    this.drawHUD();
  },

  drawHUD() {
    // Collectible Heart bubble background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.beginPath();
    this.ctx.arc(60, 40, 20, Math.PI * 0.5, Math.PI * 1.5);
    this.ctx.arc(120, 40, 20, Math.PI * 1.5, Math.PI * 0.5);
    this.ctx.closePath();
    this.ctx.fill();

    // Heart Emoji
    this.ctx.font = '16px Outfit';
    this.ctx.fillText('💖', 48, 45);
    
    // Heart Text
    this.ctx.font = '600 15px Outfit';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${this.heartsCollected} / ${this.totalHearts}`, 76, 45);

    // Current Year Indicator in top center
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.fillRect(this.width / 2 - 60, 20, 120, 30);
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    this.ctx.strokeRect(this.width / 2 - 60, 20, 120, 30);

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '600 15px Outfit';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.getDisplayYear(this.player.x), this.width / 2, 41);

    // --- Health bar (segmented) ---
    const hbX = 42, hbY = 66, hbW = 116, hbH = 11;
    this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
    this.ctx.fillRect(hbX - 6, hbY - 5, hbW + 12, hbH + 10);
    const segW = hbW / this.player.maxHealth;
    for (let i = 0; i < this.player.maxHealth; i++) {
      this.ctx.fillStyle = i < this.player.health ? '#ff4d6d' : 'rgba(255,255,255,0.18)';
      this.ctx.fillRect(hbX + i * segW + 1, hbY, segW - 2, hbH);
    }
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '700 9px Outfit';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('HP', hbX - 4, hbY - 7);

    // --- Weapon badge ---
    if (this.player.weapon) {
      const wName = this.player.hasBalls ? 'Racket + Balls' : 'Racket';
      this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
      this.ctx.fillRect(hbX - 6, hbY + 14, this.player.hasBalls ? 128 : 86, 22);
      this.ctx.font = '14px Outfit';
      this.ctx.textAlign = 'left';
      this.ctx.fillText('🎾', hbX - 2, hbY + 30);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '600 12px Outfit';
      this.ctx.fillText(wName, hbX + 20, hbY + 30);
    }

    // --- Pickup / tip banner ---
    if (this.banner && this.banner.timer > 0) {
      const a = Math.min(1, this.banner.timer / 40);
      this.ctx.save();
      this.ctx.globalAlpha = a;
      this.ctx.textAlign = 'center';
      this.ctx.font = '700 16px Outfit';
      const tw = this.ctx.measureText(this.banner.text).width;
      this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this.ctx.fillRect(this.width / 2 - tw / 2 - 14, 60, tw + 28, 30);
      this.ctx.fillStyle = '#ffe066';
      this.ctx.fillText(this.banner.text, this.width / 2, 80);
      this.ctx.restore();
    }
  },

  // Final celebration fireworks system
  updateFireworks() {
    if (wasmExports) {
      // WASM-based Particle System
      if (Math.random() < 0.05) {
        const fx = Math.random() * this.width;
        const fy = Math.random() * (this.height - 150);
        const hue = Math.random() * 360;
        wasmExports.spawnFireworkBurst(fx, fy, hue);
      }

      wasmExports.updateFireworksWasm();

      const MAX_PARTICLES = 300;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const active = wasmExports.getParticleActive(i);
        if (active !== 0) {
          const px = wasmExports.getParticleX(i);
          const py = wasmExports.getParticleY(i);
          const hue = wasmExports.getParticleHue(i);
          const alpha = wasmExports.getParticleAlpha(i);

          this.ctx.save();
          this.ctx.globalAlpha = alpha;
          this.ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
          this.ctx.beginPath();
          this.ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.restore();
        }
      }
    } else {
      // JS Fallback
      if (Math.random() < 0.05) {
        const fx = Math.random() * this.width;
        const fy = Math.random() * (this.height - 150);
        const color = `hsl(${Math.random() * 360}, 100%, 65%)`;
        
        // Spawn particles
        for (let i = 0; i < 40; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 5 + 2;
          this.fireworks.push({
            x: fx,
            y: fy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            alpha: 1,
            decay: Math.random() * 0.015 + 0.01
          });
        }
      }

      // Update and draw fireworks particles
      this.fireworks.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity on sparks
        p.alpha -= p.decay;

        this.ctx.save();
        this.ctx.globalAlpha = p.alpha;
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2);
        this.ctx.fill();
        this.ctx.restore();

        if (p.alpha <= 0) {
          this.fireworks.splice(idx, 1);
        }
      });
    }
  },

  // Starts the render loop only if one isn't already running (prevents a
  // second concurrent requestAnimationFrame chain / double-speed game).
  ensureLoop() {
    if (this._loopRunning) return;
    this.isRunning = true;
    this.loop();
  },

  loop() {
    if (!this.isRunning) {
      this._loopRunning = false;
      return;
    }
    this._loopRunning = true;

    // FPS calculation
    const now = performance.now();
    if (this.lastFrameTime) {
      const delta = now - this.lastFrameTime;
      const currentFps = 1000 / delta;
      if (!this.smoothedFps) this.smoothedFps = currentFps;
      this.smoothedFps += (currentFps - this.smoothedFps) * 0.1;
    }
    this.lastFrameTime = now;

    // Update Dev Panel metrics every 15 frames
    if (!this.devUpdateFrameCount) this.devUpdateFrameCount = 0;
    this.devUpdateFrameCount++;
    if (this.devUpdateFrameCount >= 15) {
      this.devUpdateFrameCount = 0;
      this.updateDevPanel();
    }

    // Poll gamepad inputs
    this.updateGamepadInput();

    // Clear Canvas
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!this.isPaused) {
      this.updatePhysics();
    }

    // Rendering pipeline
    this.drawBackground();
    this.drawForeground();

    // If game ended, run fireworks
    if (this.currentLevelIndex === this.levels.length - 1 && this.isPaused) {
      this.updateFireworks();
    }

    requestAnimationFrame(() => this.loop());
  },

  updateGamepadInput() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        gp = gamepads[i];
        break;
      }
    }

    if (gp) {
      const axeX = gp.axes[0];
      const dpadLeft = gp.buttons[14] ? gp.buttons[14].pressed : false;
      const dpadRight = gp.buttons[15] ? gp.buttons[15].pressed : false;
      
      this.keys['ArrowLeft'] = axeX < -0.3 || dpadLeft;
      this.keys['ArrowRight'] = axeX > 0.3 || dpadRight;

      // Jump: D-pad up or left stick up
      const axeY = gp.axes[1] || 0;
      const dpadUp = gp.buttons[12] ? gp.buttons[12].pressed : false;
      if ((dpadUp || axeY < -0.5) && this.isRunning && !this.isPaused) {
        this.jump();
      }

      // Attack / confirm: A (center select on TV remotes) or X — edge-triggered
      const btnA = gp.buttons[0] ? gp.buttons[0].pressed : false;
      const btnX = gp.buttons[2] ? gp.buttons[2].pressed : false;
      if (btnA || btnX) {
        if (!this.gamepadBtnAPressed) {
          if (this.isRunning && !this.isPaused) {
            this.attack();
          } else if (this.isPaused && this.activeDialog) {
            this.advanceDialogue();
          } else {
            this.confirmGamepadScreen();
          }
        }
        this.gamepadBtnAPressed = true;
      } else {
        this.gamepadBtnAPressed = false;
      }

      // Start button or Select button to toggle chapter menu
      const btnStart = gp.buttons[9] ? gp.buttons[9].pressed : false;
      const btnSelect = gp.buttons[8] ? gp.buttons[8].pressed : false;
      if (btnStart || btnSelect) {
        if (!this.gamepadMenuPressed) {
          const menu = document.getElementById('chapter-menu-overlay');
          if (menu) {
            if (menu.classList.contains('active')) {
              document.getElementById('close-menu-btn').click();
            } else {
              document.getElementById('hud-menu-btn').click();
              this.focusedChapterIndex = 0;
              setTimeout(() => this.updateChapterMenuFocus(), 50);
            }
          }
        }
        this.gamepadMenuPressed = true;
      } else {
        this.gamepadMenuPressed = false;
      }
    }
  },

  updateChapterMenuFocus() {
    const buttons = document.querySelectorAll('.chapter-menu-btn');
    buttons.forEach((btn, idx) => {
      if (idx === this.focusedChapterIndex) {
        btn.classList.add('focused');
        btn.focus();
        btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        btn.classList.remove('focused');
      }
    });
  }
};

// Start the game initialization
window.addEventListener('load', async () => {
  await initWasm();
  Game.init();
});
