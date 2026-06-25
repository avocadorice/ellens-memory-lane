// Core Game Engine for Ellen's Memory Lane

// Developer mode: only ON when running locally OR when ?dev is in the URL.
// Gates the Dev Panel, the chapter (memory) selector, the start-screen music
// toggle, the in-game audio button, and the keyboard dev shortcuts — so the
// shipped TV/gift build shows a clean, kiosk-style experience.
const DEV_MODE = (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  new URLSearchParams(location.search).has('dev')
);

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
  currentTrack: 'normal',
  userMusicOn: false, // did the player opt into music? (drives boss-music swaps)

  // Note frequency table shared by every track
  NOTES: {
    'A2': 110.00, 'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00,
    'G3': 196.00, 'A3': 220.00, 'Bb3': 233.08, 'B3': 246.94,
    'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00,
    'A4': 440.00, 'Bb4': 466.16, 'B4': 493.88,
    'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99,
    'A5': 880.00, 'Bb5': 932.33, 'B5': 987.77, 'D6': 1174.66
  },

  // Two playable themes: the gentle nostalgic walk + the driving boss battle
  bgmTracks: {
    normal: {
      tempo: 105,
      chordWave: 'triangle', chordVol: 0.03, chordDur: 1.8,
      melodyWave: 'sine', melodyVol: 0.05, melodyDur: 0.45,
      chords: [
        ['C3', 'E4', 'G4', 'B4'],
        ['G3', 'B3', 'D4', 'F#4'],
        ['A3', 'C4', 'E4', 'G4'],
        ['F3', 'A3', 'C4', 'E4']
      ],
      melody: [
        'E5', 'G5', 'B5', 'A5', 'G5', null, 'E5', 'D5',
        'E5', 'G5', 'A5', 'B5', 'D6', 'B5', 'A5', 'G5',
        'B5', 'D5', 'G5', 'F#5', 'E5', null, 'D5', 'B4',
        'C5', 'E5', 'G5', 'B5', 'A5', null, 'G5', 'E5'
      ]
    },
    boss: {
      tempo: 152, // fast + urgent
      chordWave: 'square', chordVol: 0.022, chordDur: 1.1,
      melodyWave: 'sawtooth', melodyVol: 0.035, melodyDur: 0.32,
      // Dark D-minor driving loop
      chords: [
        ['D3', 'A3', 'D4', 'F4'],
        ['Bb3', 'F4', 'Bb4', 'D5'],
        ['F3', 'C4', 'F4', 'A4'],
        ['A2', 'E4', 'A4', 'C5']
      ],
      melody: [
        'D5', 'F5', 'A5', 'F5', 'E5', null, 'D5', 'C5',
        'D5', 'F5', 'G5', 'A5', null, 'A5', 'G5', 'F5',
        'E5', 'D5', 'F5', 'E5', 'D5', null, 'C5', 'A4',
        'D5', 'F5', 'A5', 'D6', 'A5', null, 'F5', 'D5'
      ]
    }
  },

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

  // Stop the current theme (if any) and start another. Used to swap between
  // the nostalgic walk and the boss battle without overlapping schedulers.
  switchBGM(track) {
    if (this.currentTrack === track && this.isPlaying) return;
    this.stopBGM();
    this.playBGM(track);
  },

  playBGM(track = 'normal') {
    if (this.isPlaying) return;
    if (!this.ctx) this.init();
    if (!this.ctx) {
      console.warn("AudioEngine: AudioContext is not available.");
      return;
    }
    this.resume();
    this.isPlaying = true;
    this.currentTrack = this.bgmTracks[track] ? track : 'normal';

    const cfg = this.bgmTracks[this.currentTrack];
    const notes = this.NOTES;
    const chords = cfg.chords;
    const melody = cfg.melody;
    this.tempo = cfg.tempo;

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
            this.playSynthNote(freq, noteTime, cfg.chordDur, cfg.chordVol, cfg.chordWave);
          });
        }

        // Play melody note
        const melNote = melody[this.beatNumber % melody.length];
        if (melNote) {
          const freq = notes[melNote];
          this.playSynthNote(freq, noteTime, cfg.melodyDur, cfg.melodyVol, cfg.melodyWave);
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

  // Walk-through memory text (see drawStoryBanner): each dialogue line is spaced
  // STORY_STEP px apart, so inching forward reveals the next line and walking
  // back re-shows the previous one. STORY_LEAD is the fade-in/out runway at the
  // edges of a memory's reading zone. The enemy spawner uses the same zone
  // (storyZone) to keep fighting away from story text.
  STORY_STEP: 240,
  STORY_LEAD: 170,

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
    weapon: null,      // null = bare-hand karate | 'racket'
    hasBalls: false,   // unlocked by tennis-ball pickup → swing also serves an arcing ball
    health: 5,
    maxHealth: 5,
    attackTimer: 0,    // counts down during a swing/chop
    attackType: 'karate', // 'karate' (short reach) | 'racket' (longer reach)
    attackMax: 12,     // frames the current attack lasts (for render normalization)
    serveCooldown: 0,  // counts down between served tennis balls
    invuln: 0,         // i-frames after taking damage
    isDead: false
  },

  // Player 2 (Barney, later Preston) for local co-op. Independent body —
  // move + jump + karate chop only (no racket/tennis/soccer weapons).
  player2: {
    x: 150, y: 0, width: 30, height: 60,
    vx: 0, vy: 0, speed: 5.5, gravity: 0.7, jumpForce: -13,
    isGrounded: false, animFrame: 0, dir: 1,
    attackTimer: 0, attackType: 'karate', attackMax: 12,
    health: 3, maxHealth: 3, invuln: 0,
    isDead: false, reviveTimer: 0,
    active: false,        // true once 2-player is chosen
    role: 'husband',      // 'husband' (lvlIdx < 7) | 'kid1' (Preston, lvlIdx >= 7)
    yHistory: []
  },
  _swingId2: 0,

  // Combat tuning constants
  combat: {
    swingDuration: 16,   // frames a racket swing stays active
    swingReach: 60,      // px in front of player a racket swing hits
    swingVReach: 58,     // vertical reach of the racket (easily clips aerial foes)
    karateDuration: 12,  // frames a karate chop stays active (snappier)
    karateReach: 36,     // px in front — shorter reach than the racket
    karateVReach: 30,    // vertical reach — must be near apex to clip aerial foes
    serveCooldown: 20,   // frames between served tennis balls
    ballSpeedX: 8.5,     // arcing tennis-ball launch (horizontal)
    ballSpeedY: -10,     // arcing tennis-ball launch (upward)
    ballGravity: 0.4,    // gravity pulling the ball back down (the arc)
    invulnFrames: 70,    // i-frames after a hit (~1.1s)
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

  // --- Final boss (the Storm Guardian of Mt. Fuji) ---
  boss: null,
  bossActive: false,    // fight in progress (invisible wall up)
  bossDefeated: false,  // beaten → Fuji photos reveal + path opens
  bossArenaStart: 37200, // x where the fight begins (after the soccer gauntlet, before Fuji)
  bossWallX: 37780,      // Ellen can roam the full arena up to here (just shy of Fuji)
  soccerStart: 35100,    // x where the family soccer gauntlet begins (after RV camping)
  fujiRevealProgress: 0, // 0 = Mt. Fuji shrouded in storm clouds, 1 = fully revealed
  viewZoom: 1,           // <1 zooms the camera out (boss arena gets a wide cinematic view)

  // Camera
  camera: {
    x: 0,
    y: 0
  },

  // Input states
  keys: {},                                  // Player 1 (Ellen) — remote/desktop/ctrl
  keys2: { left: false, right: false },      // Player 2 (held movement)

  // --- 2-player co-op state ---
  twoPlayer: false,
  playerCount: 1,
  p1Slot: null,           // controller connection slot bound to Ellen
  p2Slot: null,           // controller connection slot bound to Barney/Preston
  twoPlayerPrompted: false, // the "play together?" prompt has been shown once
  twoPlayerFocusIndex: 0,   // 0 = "2 Players", 1 = "Continue Solo"

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

    // Hide developer + config UI unless running locally / with ?dev
    this.applyDevModeVisibility();

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

  // In the shipped (non-dev) build, hide the Dev Panel, the chapter/memory
  // selector, the start-screen music toggle and the in-game audio button so
  // players get a clean experience. Music still plays (the hidden toggle stays
  // checked). Pass ?dev or run on localhost to re-enable all of it.
  applyDevModeVisibility() {
    if (DEV_MODE) return;
    const hide = (sel) => {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (el) el.style.display = 'none';
    };
    hide('#dev-panel');
    hide('#hud-controls');         // chapter select + sound + dev buttons
    hide('.audio-toggle-container'); // "Play Nostalgic Music" on the start screen
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
    this.confetti = [];
    this.balloons = [];
    this.raindrops = [];
    this.rainIntensity = 0;
    this.banner = null;
    this.boss = null;
    this.bossActive = false;
    this.bossDefeated = false;
    this.fujiRevealProgress = 0;
    this.viewZoom = 1;
    this.allowSecretOnCollect = false;
    this.endingFocusIndex = 0;

    // --- Decorative fruit trees scattered throughout the world ----------------
    const treeKinds = ['red_apple', 'green_apple', 'lemon', 'plum', 'pear'];
    this.fruitTrees = [];
    const walkLimitXTrees = this.levels[this.levels.length - 1].x;
    for (let tx = 800; tx < walkLimitXTrees - 200; tx += 480 + ((tx * 7) % 320)) {
      // Don't place trees right on top of milestone scenery
      let tooClose = false;
      this.levels.forEach(lvl => {
        if (Math.abs(tx - lvl.x) < 160) tooClose = true;
      });
      if (tooClose) continue;
      const kind = treeKinds[((tx * 13 + 7) >> 0) % treeKinds.length];
      const scale = 0.75 + ((tx * 3) % 50) / 100;   // 0.75 – 1.25
      const offsetX = ((tx * 11) % 80) - 40;         // jitter ±40px
      this.fruitTrees.push({ x: tx + offsetX, kind, scale });
    }

    // --- Decorative crows / ravens -------------------------------------------
    this.crows = [];
    // Ground-hopping crows (pecking along the path)
    const hopSpots = [1800, 4200, 7500, 10800, 14800, 18300, 21500, 25200, 28900, 33000];
    hopSpots.forEach((sx, i) => {
      const count = 1 + (i % 3);  // 1–3 crows per spot
      for (let j = 0; j < count; j++) {
        this.crows.push({
          mode: 'hop',
          baseX: sx + j * 32 + ((i * 17 + j * 41) % 24),
          y: this.height - 78 + ((i + j) % 3) * 2,
          dir: (i + j) % 2 === 0 ? 1 : -1,
          hopSpeed: 0.3 + (j * 0.15),
          hopPhase: (i * 2.1 + j * 1.3),
          hopDrift: 0  // accumulated x drift from hopping
        });
      }
    });
    // Flying crows (soaring across the sky at various altitudes)
    for (let i = 0; i < 12; i++) {
      const startX = 1200 + i * 3100 + ((i * 137) % 600);
      this.crows.push({
        mode: 'fly',
        baseX: startX,
        y: 60 + ((i * 53) % 100),
        dir: i % 3 === 0 ? -1 : 1,
        flapPhase: i * 1.7,
        flySpeed: 0.4 + ((i * 19) % 30) / 100,  // 0.4–0.7 px/frame
        flyDrift: 0
      });
    }

    // --- Decorative farm animals (non-interactive) ----------------------------
    this.farmAnimals = [];

    // Chicks — little flocks pecking around the ground
    const chickSpots = [2400, 5200, 8800, 13200, 17000, 22000, 26000, 32500];
    chickSpots.forEach((sx, i) => {
      const count = 2 + (i % 3); // 2–4 chicks per flock
      for (let j = 0; j < count; j++) {
        this.farmAnimals.push({
          type: 'chick',
          x: sx + j * 18 + ((i * 13 + j * 29) % 20) - 10,
          y: this.height - 74,
          dir: (i + j) % 2 === 0 ? 1 : -1,
          phase: i * 1.4 + j * 2.1
        });
      }
    });

    // Cows — grazing in small herds at pastoral spots
    const cowSpots = [3600, 11000, 19000, 26500, 33500];
    cowSpots.forEach((sx, i) => {
      // Don't place cows on top of milestone scenery
      let skip = false;
      this.levels.forEach(lvl => { if (Math.abs(sx - lvl.x) < 250) skip = true; });
      if (skip) return;
      const count = 1 + (i % 2); // 1–2 cows per spot
      for (let j = 0; j < count; j++) {
        this.farmAnimals.push({
          type: 'cow',
          x: sx + j * 90 + ((i * 23) % 40),
          y: this.height - 105,
          dir: (i + j) % 2 === 0 ? 1 : -1,
          phase: i * 0.8 + j * 3.2
        });
      }
    });

    // Horses — standing/grazing in meadows
    const horseSpots = [6800, 15500, 24000, 31500];
    horseSpots.forEach((sx, i) => {
      let skip = false;
      this.levels.forEach(lvl => { if (Math.abs(sx - lvl.x) < 250) skip = true; });
      if (skip) return;
      this.farmAnimals.push({
        type: 'horse',
        x: sx + ((i * 37) % 50),
        y: this.height - 109,
        dir: i % 2 === 0 ? 1 : -1,
        phase: i * 2.3
      });
    });

    // Owls — perched in trees, only in the nighttime zone (near Blaire & RV Camping, x ~29000–35500)
    const owlSpots = [29200, 30200, 31400, 32600, 33800, 34800];
    owlSpots.forEach((sx, i) => {
      this.farmAnimals.push({
        type: 'owl',
        x: sx + ((i * 41) % 60) - 30,
        y: this.height - 160 - ((i * 23) % 30), // perched high, varied heights
        dir: i % 2 === 0 ? 1 : -1,
        phase: i * 1.9
      });
    });

    // Foxes — trotting through fields
    const foxSpots = [4600, 10500, 18500, 25500, 34000];
    foxSpots.forEach((sx, i) => {
      let skip = false;
      this.levels.forEach(lvl => { if (Math.abs(sx - lvl.x) < 200) skip = true; });
      if (skip) return;
      this.farmAnimals.push({
        type: 'fox',
        x: sx + ((i * 31) % 60),
        y: this.height - 88,
        dir: i % 2 === 0 ? 1 : -1,
        phase: i * 1.6,
        drift: 0,
        driftSpeed: 0.25 + (i % 3) * 0.1
      });
    });

    // Sheep — small flocks grazing
    const sheepSpots = [3200, 8200, 14000, 21000, 28000];
    sheepSpots.forEach((sx, i) => {
      let skip = false;
      this.levels.forEach(lvl => { if (Math.abs(sx - lvl.x) < 200) skip = true; });
      if (skip) return;
      const count = 2 + (i % 2); // 2–3 sheep per flock
      for (let j = 0; j < count; j++) {
        this.farmAnimals.push({
          type: 'sheep',
          x: sx + j * 45 + ((i * 19 + j * 37) % 30),
          y: this.height - 84,
          dir: (i + j) % 2 === 0 ? 1 : -1,
          phase: i * 2.0 + j * 1.3
        });
      }
    });

    // Cats — lounging or strolling
    const catSpots = [2800, 7400, 13500, 20500, 27500, 33200];
    catSpots.forEach((sx, i) => {
      let skip = false;
      this.levels.forEach(lvl => { if (Math.abs(sx - lvl.x) < 180) skip = true; });
      if (skip) return;
      this.farmAnimals.push({
        type: 'cat',
        x: sx + ((i * 27) % 50),
        y: this.height - 76,
        dir: i % 2 === 0 ? 1 : -1,
        phase: i * 1.8,
        drift: 0,
        driftSpeed: 0.15 + (i % 2) * 0.1
      });
    });

    // Rabbits — hopping around in small groups
    const rabbitSpots = [1600, 5800, 10000, 15800, 22500, 29500, 35000];
    rabbitSpots.forEach((sx, i) => {
      let skip = false;
      this.levels.forEach(lvl => { if (Math.abs(sx - lvl.x) < 160) skip = true; });
      if (skip) return;
      const count = 1 + (i % 3); // 1–3 rabbits
      for (let j = 0; j < count; j++) {
        this.farmAnimals.push({
          type: 'rabbit',
          x: sx + j * 28 + ((i * 11 + j * 23) % 20),
          y: this.height - 78,
          dir: (i + j) % 2 === 0 ? 1 : -1,
          phase: i * 1.5 + j * 2.4,
          drift: 0,
          driftSpeed: 0.35 + (j % 2) * 0.15
        });
      }
    });

    // Squirrels — sitting upright, scattered near trees
    const squirrelSpots = [1200, 4000, 7800, 12000, 16800, 23000, 28500, 32000, 36000];
    squirrelSpots.forEach((sx, i) => {
      let skip = false;
      this.levels.forEach(lvl => { if (Math.abs(sx - lvl.x) < 150) skip = true; });
      if (skip) return;
      this.farmAnimals.push({
        type: 'squirrel',
        x: sx + ((i * 23) % 40) - 20,
        y: this.height - 72,
        dir: i % 2 === 0 ? 1 : -1,
        phase: i * 2.1,
        drift: 0,
        driftSpeed: 0.4 + (i % 3) * 0.1
      });
    });

    // --- Barney waiting on a chair at the Dating milestone --------------------
    // He sits in a folding chair just before the Dating milestone (x=2000),
    // facing right, waiting for Ellen. When she reaches him, he stands and
    // becomes a walking companion.
    this.seatedBarney = {
      x: this.levels[0].x - 100, // slightly before the milestone
      y: this.height - 80,
      dir: -1, // face left, watching for Ellen as she walks up from behind
      joined: false
    };
    this.heartsCollected = 0;

    // Reset player combat loadout
    this.player.weapon = null;
    this.player.hasBalls = false;
    this.player.hasSoccer = false; // granted by the soccer-ball pickup
    this.soccerQueue = null;       // P1 circular kicking line (built on pickup)
    this.soccerQueue2 = null;      // P2 kicking line (2-player co-op only)
    this.soccerPos = {};           // animated display x per family member (P1 line)
    this.soccerPos2 = {};          // animated display x (P2 line)
    this._soccerJog1 = { id: null, t: 0 }; // ex-kicker jog-to-back (P1 line)
    this._soccerJog2 = { id: null, t: 0 }; // ex-kicker jog-to-back (P2 line)
    this.hopTimers = { husband: 0, kid1: 0, kid2: 0, dog: 0 };
    this.player.health = this.player.maxHealth;
    this.player.attackTimer = 0;
    this.player.attackType = 'karate';
    this.player.serveCooldown = 0;
    this.player.invuln = 0;
    this.player.isDead = false;
    this.shout = null;

    // Progressive control hints floating in the sky near the start. Each fades
    // in as Ellen walks up to it and fades out as she passes: walk -> jump -> chop.
    this.tutorialHints = [
      { x: 330, title: 'Hold ➡️ to walk', sub: 'D-pad right • or ➡️ / D' },
      { x: 720, title: 'Press ⬆️ to jump', sub: 'D-pad up • or Space / W' },
      { x: 1120, title: 'Press ● to karate chop', sub: 'Select • or Enter / F — "Aya!"' }
    ];

    // Setup hearts & hurdles along the entire track
    const walkLimitX = this.levels[this.levels.length - 1].x;

    // Distribute collectibles and obstacles (stop before the final Mt. Fuji milestone so no hearts spawn in the locked zone)
    for (let x = 300; x < walkLimitX - 150; x += 220) {
      // Don't spawn collectibles too close to level dialogue trigger zones (milestone.x +/- 120)
      let nearMilestone = false;
      this.levels.forEach(lvl => {
        if (Math.abs(x - lvl.x) < 130) nearMilestone = true;
      });

      if (!nearMilestone) {
        // (No hearts lie around the world — hearts now drop from defeated foes,
        //  see defeatEnemy.) Chance of an obstacle hurdle here.
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
  // the trampoline-gated / enemy-drop bonus hearts. Ellen starts with a
  // bare-hand karate chop (short reach); the racket (longer reach) is grabbed a
  // bit into the journey, and the tennis balls (arcing serve) just past the
  // Wedding milestone (the midpoint).
  setupCombat() {
    const groundY = this.height - 80;
    const trackEnd = this.levels[this.levels.length - 1].x + 400;
    const racketX = 3800; // a bit into the first stretch (karate carries the way in)
    const ballsX = 20250; // ~just past Wedding (x=20000) — splits ground/flying foes
    this.racketX = racketX;
    this.ballsX = ballsX;

    // Weapon pickups (racket + soccer ball) float high above a trampoline, set
    // forward of the pad — so you must bounce AND carry momentum into them at an
    // angle, not grab them with a straight jump.
    const placeWeaponPickup = (padX, kind) => {
      this.pickups.push({ x: padX + 55, y: 155, kind, collected: false, frame: 0 });
      this.trampolines.push({ x: padX, y: groundY, w: 58, squash: 0 });
    };
    placeWeaponPickup(racketX, 'racket');
    placeWeaponPickup(this.soccerStart + 120, 'soccer');

    // A lingering how-to hint by the racket — like the start hints, it fades in
    // as she nears it and can be re-read by walking back. Only shows once she's
    // actually grabbed the racket.
    this.tutorialHints.push({
      x: racketX + 55,
      title: 'Hit the shots back! 🎾',
      sub: 'Time a racket swing to return enemy projectiles',
      needWeapon: 'racket'
    });

    const nearMilestone = (x) => this.levels.some(l => Math.abs(x - l.x) < 110);
    const nearPickup = (x) => Math.abs(x - racketX) < 150 || Math.abs(x - ballsX) < 150;

    // Don't let a random hurdle (e.g. the camping campfire art) sit on top of a
    // pickup — clear any that overlap a pickup spot.
    this.hurdles = this.hurdles.filter(h => !nearPickup(h.x));

    const groundKinds = ['slime_green', 'slime_purple', 'slime_teal'];
    const flyingKinds = ['cloud', 'bat'];
    let gi = 0, fi = 0;

    // Difficulty ramps 0 -> 1 across the journey (Dating x2000 ... Fuji xEnd).
    const lastLevelX = this.levels[this.levels.length - 1].x;
    const progress = (x) => Math.max(0, Math.min(1, (x - 2000) / (lastLevelX - 2000)));
    // Probability an enemy is a tougher 2-hit monster, rising with the memories.
    const toughChance = (section) => section < 3 ? 0 : Math.min(0.6, (section - 2) * 0.12);

    // Ground enemies span the early-to-mid journey. The first stretch is fought
    // with karate; the racket (grabbed at racketX) makes later ones easier.
    let gx = 1300;
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

    // Low-hovering wasps across the early-to-mid journey. They sit at a jump-to-
    // hit height: with a karate chop you must connect near the very top of a jump
    // (short vertical reach = tricky), but the racket's taller reach clips them
    // easily — so they showcase the karate->racket upgrade. They don't shoot.
    // A couple of non-shooting wasps BEFORE the racket (karate practice).
    let wx = 1750, wi = 0;
    while (wx < racketX - 100) {
      if (!nearMilestone(wx) && !nearPickup(wx)) {
        this.enemies.push({
          type: 'flying', kind: 'wasp',
          x: wx, homeX: wx, y: 250, baseY: 250,
          alive: true, dir: -1, range: 46, hitFlash: 0,
          frame: (wi * 17) % 60, section: this.getLevelIndexAtX(wx), high: false,
          heart: null, tier: 1, hp: 1, maxHp: 1, lastSwingHit: -1
        });
        wi++;
      }
      wx += 1450;
    }

    // Projectile-throwing flying enemies — they kick in a bit AFTER the racket is
    // grabbed (so you have the tool to whack shots back) and run dense the rest of
    // the way. They alternate normal height (jump/racket reachable) and very-high
    // (above melee reach — beat them ONLY by returning their projectiles).
    let fx = racketX + 700;
    while (fx < trackEnd - 200 && fx < this.bossArenaStart - 250) {
      if (!nearMilestone(fx) && !nearPickup(fx)) {
        const section = this.getLevelIndexAtX(fx);
        const high = fi % 2 === 1;
        const baseY = high ? 150 : 290; // 150 = out of melee reach (whack-back only)
        const tier = Math.random() < toughChance(section) ? 2 : 1;
        this.enemies.push({
          type: 'flying', kind: flyingKinds[fi % flyingKinds.length],
          x: fx, homeX: fx, y: baseY, baseY,
          alive: true, dir: -1, range: 70, hitFlash: 0,
          frame: (fi * 13) % 60, section, high, heart: null,
          tier, hp: tier, maxHp: tier, lastSwingHit: -1,
          shootTimer: 50 + Math.floor(Math.random() * (high ? 70 : 110))
        });
        fi++;
      }
      fx += 1400 - 350 * progress(fx); // dense enough for ~25 shooters across the long road
    }

    // Memories are now read by walking through them, so any enemy that landed
    // inside a memory's story-reading span gets nudged forward into the gap that
    // follows it — same number of foes, just never on screen while she's reading.
    const storyZones = this.levels.map(l => this.storyZone(l));
    const packed = {};
    this.enemies.forEach(e => {
      for (let zi = 0; zi < storyZones.length; zi++) {
        const z = storyZones[zi];
        if (e.x > z.start - 40 && e.x < z.end + 40) {
          const gapStart = z.end + 55;
          const gapEnd = (zi + 1 < storyZones.length ? storyZones[zi + 1].start : trackEnd) - 55;
          const n = packed[zi] || 0;
          const nx = Math.min(gapStart + n * 95, Math.max(gapStart, gapEnd));
          packed[zi] = n + 1;
          e.x = nx;
          e.homeX = nx;
          break;
        }
      }
    });

    // Soccer gauntlet → final showdown: a long, dense run of TOUGHER foes (she
    // has the soccer ball now). Tier ramps 2 -> 3 as you near the boss, and a
    // few aerial foes mix it up. (After the relocation pass so they stay put.)
    let si = 0;
    for (let sx = this.soccerStart + 220; sx < this.bossArenaStart - 160; sx += 200) {
      const frac = (sx - this.soccerStart) / (this.bossArenaStart - this.soccerStart);
      const tier = frac > 0.55 ? 3 : 2;        // meaner the closer you get
      const flying = (si % 4 === 3);            // an occasional hovering foe
      this.enemies.push({
        type: flying ? 'flying' : 'ground',
        kind: flying ? flyingKinds[si % flyingKinds.length] : groundKinds[gi % groundKinds.length],
        x: sx, homeX: sx,
        y: flying ? 250 : groundY - 14, baseY: flying ? 250 : groundY - 14,
        alive: true, dir: -1, range: flying ? 46 : 40, hitFlash: 0,
        frame: (gi * 9) % 60, section: this.getLevelIndexAtX(sx), high: false, heart: null,
        tier, hp: tier, maxHp: tier, lastSwingHit: -1
      });
      gi++; si++;
    }

    // (Trampoline-gated bonus hearts removed — hearts only drop from foes now.
    //  The weapon pickups keep their own trampolines.)

    // Hearts are no longer pre-placed on enemies — defeatEnemy rolls a
    // health-scaled drop chance at the moment a foe is beaten.
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

    // Teleporting away mid-boss-fight: tear it down so the arena wall + locked
    // camera release (otherwise you get yanked straight back into the arena).
    // bossDefeated stays false, so it re-triggers if you walk back in.
    if (this.bossActive) {
      this.bossActive = false;
      this.boss = null;
      this.enemyProjectiles = [];
      this.viewZoom = 1;
    }

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
    if (this.player.x >= (this.racketX || 3600)) {
      this.player.weapon = 'racket';
      this.pickups.forEach(p => { if (p.kind === 'racket') p.collected = true; });
    }

    // Chime BGM effect
    AudioEngine.playHeartSFX();
  },

  bindUI() {
    // Keyboard inputs
    window.addEventListener('keydown', (e) => {
      // Normalize key identifier for TV browsers
      let code = e.code;
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

      // 2-Player prompt: ←/→ choose, Enter/Space confirm
      const tpPrompt = document.getElementById('twoplayer-prompt');
      if (tpPrompt && tpPrompt.classList.contains('active')) {
        if (code === 'ArrowLeft' || code === 'ArrowRight') {
          this.twoPlayerFocusIndex = this.twoPlayerFocusIndex === 0 ? 1 : 0;
          this.updateTwoPlayerFocus();
          e.preventDefault();
          return;
        }
        if (code === 'Enter' || code === 'Space') {
          this.chooseTwoPlayer(this.twoPlayerFocusIndex === 0);
          e.preventDefault();
          return;
        }
      }

      // Escape or M key to toggle chapter menu (dev only)
      if (DEV_MODE && (code === 'Escape' || code === 'KeyM')) {
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

      // Teleport shortcuts (1-9 and 0 keys) — kept enabled everywhere for quick
      // testing (harmless on TV, which has no number keys).
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

      // '-' warps straight to the boss arena, soccer ball in hand, ready to fight.
      if (code === 'Minus') {
        const targetX = this.bossArenaStart - 70;
        if (wasmExports) {
          wasmExports.initPlayer(targetX, this.height - 80);
          this.player.x = wasmExports.player_x.value;
          this.player.y = wasmExports.player_y.value;
          this.player.vx = 0; this.player.vy = 0;
        } else {
          this.player.x = targetX;
        }
        this.isPaused = false;
        this.currentLevelIndex = this.levels.length - 2;
        this.bossDefeated = false; this.bossActive = false; this.boss = null;
        this.enemyProjectiles = []; this.viewZoom = 1;
        this.player.hasSoccer = true; // arrive with the soccer ball
        this.setupSoccerLines();
        this.player.weapon = 'racket';
        this.player.health = this.player.maxHealth;
        this.player.isDead = false; this.player.invuln = 0; this.player.attackTimer = 0;
        this.camera.x = this.player.x - this.width / 3;
        e.preventDefault();
        return;
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

      // --- Player 2 (desktop dev keys): H/L move, U jump, O chop ---
      if (code === 'KeyH') { this.applyAction(1, 'left', true); e.preventDefault(); }
      else if (code === 'KeyL') { this.applyAction(1, 'right', true); e.preventDefault(); }
      else if (code === 'KeyU') { this.applyAction(1, 'jump', true); e.preventDefault(); }
      else if (code === 'KeyO') { this.applyAction(1, 'chop', true); e.preventDefault(); }

      // Dev: toggle 2-player co-op for desktop testing (P)
      if (DEV_MODE && code === 'KeyP') { if (!this.twoPlayer) this.enableTwoPlayer(); e.preventDefault(); }
    });

    // Tagged controller events from the native Android bridge (slot-aware).
    window.addEventListener('ctrl', (e) => this.handleCtrl(e.detail));

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
      if (code === 'KeyH') { this.applyAction(1, 'left', false); }
      else if (code === 'KeyL') { this.applyAction(1, 'right', false); }
      this.keys[code] = false;
    });

    // Start Button
    document.getElementById('start-btn').addEventListener('click', () => {
      // Music plays by default now (the start-screen toggle was removed). The
      // click itself is the user gesture that lets the browser start audio.
      AudioEngine.init();
      AudioEngine.userMusicOn = true;
      AudioEngine.playBGM('normal');
      const soundBtn = document.getElementById('hud-sound-btn');
      if (soundBtn) soundBtn.innerText = '🔊';

      document.getElementById('start-screen').classList.remove('active');
      this.startGame();
    });

    // Dialog Button
    document.getElementById('dialog-action-btn').addEventListener('click', () => {
      this.advanceDialogue();
    });

    // 2-player prompt buttons
    const tpYes = document.getElementById('twoplayer-yes-btn');
    const tpSolo = document.getElementById('twoplayer-solo-btn');
    if (tpYes) tpYes.addEventListener('click', () => this.chooseTwoPlayer(true));
    if (tpSolo) tpSolo.addEventListener('click', () => this.chooseTwoPlayer(false));

    // Audio HUD control
    document.getElementById('hud-sound-btn').addEventListener('click', () => {
      if (AudioEngine.isPlaying) {
        AudioEngine.userMusicOn = false;
        AudioEngine.stopBGM();
        document.getElementById('hud-sound-btn').innerText = '🔇';
      } else {
        AudioEngine.userMusicOn = true;
        // Resume whichever theme fits the moment (boss music mid-fight)
        AudioEngine.playBGM(this.bossActive && !this.bossDefeated ? 'boss' : 'normal');
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

    // Reset co-op so a replay starts solo (and can be re-offered at Barney).
    this.twoPlayer = false;
    this.playerCount = 1;
    this.twoPlayerPrompted = false;
    this.p1Slot = null;
    this.p2Slot = null;
    this.keys2 = { left: false, right: false };
    this.player2.active = false;
    this.player2.isDead = false;
    this.player2.role = 'husband';
    this.skyQr = null;

    this.setupWorld();
    this.ensureLoop();
  },

  jump() {
    if (wasmExports) {
      const didJump = wasmExports.playerJump();
      if (didJump) {
        this.player.vy = wasmExports.player_vy.value;
        this.player.isGrounded = wasmExports.player_isGrounded.value !== 0;
        // Carry the pre-jump heading through the arc (see updatePhysics)
        this.airJumpDir = this.lastWalkDir || 0;
        AudioEngine.playJumpSFX();
      }
    } else {
      if (this.player.isGrounded) {
        this.player.vy = this.player.jumpForce;
        this.player.isGrounded = false;
        this.airJumpDir = this.lastWalkDir || 0;
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
    let walkLeft = (this.keys['KeyA'] || this.keys['ArrowLeft']) ? 1 : 0;
    let walkRight = (this.keys['KeyD'] || this.keys['ArrowRight']) ? 1 : 0;
    const endX = this.levels[this.levels.length - 1].x;

    // --- TV D-pad forward-jump assist ---
    // A 4-way remote rocker can only register ONE direction at a time, so the
    // moment you press Up to jump it drops the Right/Left you were holding and
    // the character stops mid-air. We remember the heading from just before the
    // jump and carry it through the whole arc so "hold right + up" = a reliable
    // forward jump (and trampoline bounces keep their momentum too).
    if (this.player.isGrounded) {
      this.lastWalkDir = walkLeft ? -1 : (walkRight ? 1 : 0);
      this.airJumpDir = 0;
    } else if (walkLeft || walkRight) {
      // Steering mid-air updates the carried heading, so when you release the
      // key she keeps going the way you were LAST pushing — not the original
      // takeoff direction (which used to swing her back once all keys released).
      this.airJumpDir = walkLeft ? -1 : 1;
    } else if (this.airJumpDir) {
      // Coasting with no keys held: carry the last heading through the arc.
      if (this.airJumpDir > 0) walkRight = 1; else walkLeft = 1;
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

    // --- Final boss: trigger the fight + block the path to Mt. Fuji ---
    if (!this.bossDefeated && !this.bossActive && this.player.x >= this.bossArenaStart) {
      this.startBossFight();
    }
    if (this.bossActive && !this.bossDefeated) {
      // Keep Ellen inside the arena (right wall + a left bound so she stays in frame)
      const leftBound = this.bossArenaStart - 60;
      let clamped = null;
      if (this.player.x > this.bossWallX) clamped = this.bossWallX;
      else if (this.player.x < leftBound) clamped = leftBound;
      if (clamped !== null) {
        this.player.x = clamped;
        this.player.vx = 0;
        if (wasmExports) {
          wasmExports.player_x.value = clamped;
          wasmExports.player_vx.value = 0;
        }
      }
    }

    // Set Ellen's outfit based on current level milestone reached
    const lvlIdx = this.getLevelIndexAtX(this.player.x);
    this.player.outfit = this.getEllenOutfit(lvlIdx);

    // --- PLAYER 2 (co-op) ---
    if (this.player2.active) this.updateP2Physics(endX);

    // --- COMPANION TRAIL ENGINE ---
    // Handle Dog, Husband and Kids following Ellen in a chain
    this.updateCompanions(lvlIdx);

    // --- CAMERA SCROLL SYSTEM ---
    // During the boss fight the camera locks to frame the whole arena + mountain
    // and zooms out; otherwise it follows the player.
    const inBossFight = this.bossActive && !this.bossDefeated;
    let targetCamX;
    if (inBossFight) {
      targetCamX = this.bossArenaStart - 170;
    } else if (this.twoPlayer && this.player2.active && !this.player2.isDead) {
      // Co-op leash: frame both players at the midpoint and stop either from
      // outrunning the other off-screen (a soft wall clamps the one in front).
      const maxSep = (this.width / (this.viewZoom || 1)) - 220;
      const dx = this.player.x - this.player2.x;
      if (dx > maxSep) {
        this.player.x = this.player2.x + maxSep; this.player.vx = 0;
        if (wasmExports) wasmExports.player_x.value = this.player.x;
      } else if (dx < -maxSep) {
        this.player2.x = this.player.x + maxSep; this.player2.vx = 0;
      }
      targetCamX = (this.player.x + this.player2.x) / 2 - this.width / 2;
    } else {
      targetCamX = this.player.x - this.width / 3;
    }
    this.camera.x += (targetCamX - this.camera.x) * 0.08;
    // Lock camera boundaries
    if (this.camera.x < 0) this.camera.x = 0;
    if (this.camera.x > endX - this.width + 250) this.camera.x = endX - this.width + 250;

    // Smoothly zoom the view out for the boss arena, back in afterward
    const zoomTarget = inBossFight ? 0.72 : 1;
    this.viewZoom += (zoomTarget - this.viewZoom) * 0.06;
    if (Math.abs(this.viewZoom - zoomTarget) < 0.003) this.viewZoom = zoomTarget;

    // Check collectible Heart collisions
    this.hearts.forEach(heart => {
      if (!heart.collected && heart.spawned !== false) {
        // Collision resolved in JS (not WASM) with a forgiving radius so a
        // heart reliably collects whenever Ellen overlaps it — important for
        // the floating/drifting hearts that were tricky to grab on a TV remote.
        const dist = Math.hypot((this.player.x - 5) - heart.x, (this.player.y - 35) - heart.y);
        const isColliding = dist < 38;

        // Touching a heart always collects it (it disappears); it heals 1 only
        // if she's hurt — at full health it just vanishes with no effect.
        if (isColliding) {
          heart.collected = true;
          if (this.player.health < this.player.maxHealth) {
            this.player.health += 1;
            AudioEngine.playHeartSFX();
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
  // PLAYER 2 / LOCAL CO-OP
  // ============================================================

  // Which character Player 2 drives at a given milestone: Barney until Preston
  // is walking (lvlIdx 7), then Preston (Barney falls back to a follower).
  p2Role(lvlIdx) {
    return lvlIdx >= 7 ? 'kid1' : 'husband';
  },

  // Turn on co-op: activate Barney as an independent body just behind Ellen.
  enableTwoPlayer() {
    this.twoPlayer = true;
    this.playerCount = 2;
    const b = this.player2;
    b.active = true;
    b.role = this.p2Role(this.getLevelIndexAtX(this.player.x));
    b.x = this.player.x - 40;
    b.y = this.height - 80;
    b.vx = 0; b.vy = 0; b.isGrounded = true; b.dir = 1;
    b.health = b.maxHealth; b.isDead = false; b.invuln = 0;
    b.attackTimer = 0; b.reviveTimer = 0;
    b.yHistory = [];
    this.p2Slot = null; // the next controller to send input becomes Player 2
    this.skyQr = null;  // the pairing QR has done its job
    this.rescaleEnemiesForTwoPlayers();
  },

  // Generic JS physics step for a body (mirrors Ellen's JS fallback, used for P2).
  stepBody(b, walkLeft, walkRight, endX) {
    if (walkLeft) { b.vx = -b.speed; b.dir = -1; b.animFrame++; }
    else if (walkRight) { b.vx = b.speed; b.dir = 1; b.animFrame++; }
    else { b.vx *= 0.7; if (Math.abs(b.vx) < 0.2) b.vx = 0; }
    b.vy += b.gravity; b.y += b.vy; b.x += b.vx;
    const groundY = this.height - 80;
    if (b.y >= groundY) { b.y = groundY; b.vy = 0; b.isGrounded = true; }
    if (b.x < 40) b.x = 40;
    if (b.x > endX) b.x = endX;
  },

  jumpBody(b) {
    if (!b || !b.active || b.isDead || !this.isRunning || this.isPaused) return;
    if (b.isGrounded) { b.vy = b.jumpForce; b.isGrounded = false; AudioEngine.playJumpSFX(); }
  },

  updateP2Physics(endX) {
    const b = this.player2;
    if (!b.active) return;
    // Hand off control across the story: Barney until Preston walks, then Preston.
    const newRole = this.p2Role(this.getLevelIndexAtX(this.player.x));
    if (newRole !== b.role) {
      b.role = newRole;
      b.x = this.player.x - (newRole === 'kid1' ? 90 : 40) * (this.player.dir || 1);
      b.y = this.height - 80; b.vx = 0; b.vy = 0; b.isGrounded = true;
    }
    if (b.isDead) {
      if (b.reviveTimer > 0) { b.reviveTimer--; if (b.reviveTimer === 0) this.reviveP2(); }
      return;
    }
    const walkLeft = this.keys2.left ? 1 : 0;
    const walkRight = this.keys2.right ? 1 : 0;
    this.stepBody(b, walkLeft, walkRight, endX);
    if (b.attackTimer > 0) b.attackTimer--;
    if (b.invuln > 0) b.invuln--;
    // jump-echo history (used later for the P2 soccer line)
    if (!b.yHistory) b.yHistory = [];
    b.yHistory.unshift(b.y - (this.height - 80));
    if (b.yHistory.length > 24) b.yHistory.pop();
    // Keep P2 inside the boss arena, like Ellen.
    if (this.bossActive && !this.bossDefeated) {
      const leftBound = this.bossArenaStart - 60;
      if (b.x > this.bossWallX) { b.x = this.bossWallX; b.vx = 0; }
      else if (b.x < leftBound) { b.x = leftBound; b.vx = 0; }
    }
  },

  attackP2() {
    const b = this.player2;
    if (!b.active || b.isDead || !this.isRunning || this.isPaused) return;
    if (b.attackTimer > 0) return;
    // In co-op soccer, P2's chop kicks Barney's line instead of a melee chop.
    if (this.soccerActive() && this.twoPlayer && this.soccerQueue2) {
      this.kickSoccerForLine(1);
      return;
    }
    b.attackType = 'karate';
    b.attackMax = this.combat.karateDuration;
    b.attackTimer = b.attackMax;
    this._swingId2 = (this._swingId2 || 0) + 1;
    this.shout2 = { text: 'Aya!', timer: b.attackMax + 10 }; // P2's karate yell
    AudioEngine.playSlashSFX();
  },

  reviveP2() {
    const b = this.player2;
    b.isDead = false;
    b.health = b.maxHealth;
    b.invuln = this.combat.invulnFrames;
    b.x = this.player.x - 40;
    b.y = this.height - 80;
    b.vx = 0; b.vy = 0; b.isGrounded = true;
  },

  // Route a controller action to a player. pIdx 0 = Ellen, 1 = Barney/Preston.
  applyAction(pIdx, key, down) {
    // While the 2-player prompt is up, ANY controller navigates/confirms it.
    const tpPrompt = (typeof document !== 'undefined') && document.getElementById('twoplayer-prompt');
    if (tpPrompt && tpPrompt.classList.contains('active')) {
      if (!down) return;
      if (key === 'left' || key === 'ArrowLeft' || key === 'right' || key === 'ArrowRight') {
        this.twoPlayerFocusIndex = this.twoPlayerFocusIndex === 0 ? 1 : 0;
        this.updateTwoPlayerFocus();
      } else if (key === 'chop' || key === 'brake' || key === 'Enter' ||
                 key === 'jump' || key === 'thrust' || key === ' ' || key === 'Space') {
        this.chooseTwoPlayer(this.twoPlayerFocusIndex === 0);
      }
      return;
    }
    const isLeft  = key === 'left'  || key === 'ArrowLeft';
    const isRight = key === 'right' || key === 'ArrowRight';
    const isJump  = key === 'jump'  || key === 'thrust' || key === ' ' || key === 'Space';
    const isChop  = key === 'chop'  || key === 'brake'  || key === 'Enter';
    if (pIdx === 0) {
      if (isLeft) this.keys['ArrowLeft'] = down;
      else if (isRight) this.keys['ArrowRight'] = down;
      else if (isJump) { if (down) this.jump(); }
      else if (isChop && down) {
        if (this.isPaused && this.activeDialog) this.advanceDialogue();
        else this.attack();
      }
    } else {
      this.maybePromoteCoop(); // desktop P2 keys also bring Barney into co-op
      if (isLeft) this.keys2.left = down;
      else if (isRight) this.keys2.right = down;
      else if (isJump) this.jumpBody(this.player2);
      else if (isChop && down) this.attackP2();
    }
  },

  // A tagged controller event from the native bridge: {action, key, slot}.
  // Solo → everything drives Ellen. 2P → the first distinct slot after enabling
  // co-op claims Player 2; that slot drives Barney, all others drive Ellen.
  // Once Ellen has met Barney, the first controller input promotes co-op (so the
  // phone reliably becomes Player 2 even if the "connected" signal was missed).
  maybePromoteCoop() {
    if (!this.twoPlayer && this.seatedBarney && this.seatedBarney.joined) {
      this.enableTwoPlayer();
    }
  },

  handleCtrl(detail) {
    if (!detail) return;
    const slot = detail.slot;
    const down = detail.action === 'keydown';
    if (slot != null) this.maybePromoteCoop();
    let pIdx = 0;
    if (this.twoPlayer && slot != null) {
      if (this.p2Slot == null && slot !== this.p1Slot) this.p2Slot = slot;
      if (slot === this.p2Slot) pIdx = 1;
      else if (this.p1Slot == null) this.p1Slot = slot;
    }
    this.applyAction(pIdx, detail.key, down);
  },

  // Two players = roughly double the DPS, so bump the foes still ahead of the
  // party: some gain a hit point (cap tier 3) and the ranks thicken with extra
  // spawns. Only touches enemies ahead of Ellen so already-cleared ground is
  // left alone. (Called when co-op is enabled — Ellen is near the very start,
  // so almost every foe is still ahead.)
  rescaleEnemiesForTwoPlayers() {
    if (this.playerCount < 2 || !this.enemies) return;
    const px = this.player.x;
    const extra = [];
    this.enemies.forEach(e => {
      if (!e.alive || e.x <= px + 100) return; // only foes still ahead
      if (Math.random() < 0.5) {
        const nt = Math.min(3, (e.maxHp || e.tier || 1) + 1);
        e.tier = nt; e.hp = nt; e.maxHp = nt;
      }
      if (Math.random() < 0.35) {
        const nx = e.x + 60 + Math.random() * 40;
        extra.push({ ...e, x: nx, homeX: nx, hp: e.maxHp, maxHp: e.maxHp,
          lastSwingHit: -1, hitFlash: 0, frame: (Math.random() * 60) | 0 });
      }
    });
    if (extra.length) this.enemies.push(...extra);
  },

  // ============================================================
  // COMBAT SYSTEMS
  // ============================================================
  attack() {
    if (!this.isRunning || this.isPaused || this.player.isDead) return;
    if (this.player.attackTimer > 0) return;    // mid-swing/chop/kick

    // Soccer: once she's grabbed the soccer ball, the ranged attack becomes a
    // kicked soccer ball (in the gauntlet AND on into the boss fight).
    if (this.soccerActive()) {
      this.kickSoccerBall();
      return;
    }

    // Karate from the start (short reach); the racket extends reach once grabbed.
    const usingRacket = this.player.weapon === 'racket';
    this.player.attackType = usingRacket ? 'racket' : 'karate';
    this.player.attackMax = usingRacket ? this.combat.swingDuration : this.combat.karateDuration;
    this.player.attackTimer = this.player.attackMax;
    this._swingId = (this._swingId || 0) + 1; // so one swing damages an enemy once
    AudioEngine.playSlashSFX();

    if (!usingRacket) {
      // Karate chop: Ellen shouts "Aya!"
      this.shout = { text: 'Aya!', timer: this.player.attackMax + 10 };
    }
  },

  // The x-range of the soccer gauntlet (where the pickup + soccer foes live).
  inSoccerZone() {
    return this.player.x >= this.soccerStart && this.player.x < this.bossArenaStart;
  },
  // The soccer kick is available the moment she picks up the soccer ball, and
  // stays equipped for good — she keeps it even walking back (no reverting to
  // the racket) and on through the boss fight.
  soccerActive() {
    return this.player.hasSoccer;
  },
  // The full circular-queue line formation — runs in the gauntlet AND on into
  // the boss fight (the line still moves/jumps with the player, so she can dodge).
  soccerFormationActive() {
    return this.soccerActive() && this.soccerQueue && this.soccerQueue.length > 0;
  },

  // Build the kicking line(s) when the soccer ball is grabbed. Solo = one family
  // line; co-op splits into Ellen's line (Ellen, Blaire, Mochi) and Barney's line
  // (Barney, Preston) so each player kicks their own.
  setupSoccerLines() {
    if (this.twoPlayer && this.player2.active) {
      this.soccerQueue  = ['player', 'kid2', 'dog'];
      this.soccerQueue2 = ['husband', 'kid1'];
    } else {
      this.soccerQueue  = ['player', 'husband', 'kid1', 'kid2', 'dog'];
      this.soccerQueue2 = null;
    }
    this.soccerPos = {}; this.soccerPos2 = {};
    this._soccerJog1 = { id: null, t: 0 };
    this._soccerJog2 = { id: null, t: 0 };
  },

  // Kick from a line: the FRONT member kicks, then the circular queue rotates
  // (kicker jogs to the back). idx 0 = Ellen's line (Player 1), 1 = Barney's (P2).
  kickSoccerForLine(idx) {
    const lead = idx === 0 ? this.player : this.player2;
    const queue = idx === 0 ? this.soccerQueue : this.soccerQueue2;
    const pos = idx === 0 ? this.soccerPos : this.soccerPos2;
    const jog = idx === 0 ? this._soccerJog1 : this._soccerJog2;
    const dir = lead.dir;
    lead.attackType = 'karate';
    lead.attackMax = this.combat.karateDuration;
    lead.attackTimer = lead.attackMax;

    let spawnX, spawnY;
    if (queue && queue.length) {
      const who = queue[0];
      const baseX = (pos && pos[who] != null) ? pos[who] : lead.x;
      spawnX = baseX + dir * 16;
      spawnY = lead.y - 18;
      if (this.hopTimers && who !== 'player') this.hopTimers[who] = 15; // kick hop
      queue.push(queue.shift()); // rotate: kicker → back
      if (jog) { jog.id = who; jog.t = 22; }
    } else {
      spawnX = lead.x + dir * 22;
      spawnY = lead.y - 18;
    }

    this.projectiles.push({
      x: spawnX, y: spawnY,
      vx: dir * this.combat.ballSpeedX, vy: this.combat.ballSpeedY,
      spin: 0, bounced: false, dir, alive: true, type: 'soccer_ball'
    });
    AudioEngine.playShootSFX();
  },

  // Ellen's kick (Player 1).
  kickSoccerBall() { this.kickSoccerForLine(0); },

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

    // Health-scaled heart drop (no hearts lie around the world anymore): the
    // lower her health, the likelier a defeated foe drops a heart — so heals
    // show up when she actually needs them.
    const frac = this.player.maxHealth > 0 ? this.player.health / this.player.maxHealth : 1;
    const dropChance = 0.08 + (1 - frac) * 0.55; // ~8% at full HP, ~52% at 1 heart
    if (Math.random() < dropChance) {
      this.hearts.push({
        x: e.x, y: e.y, width: 16, height: 16,
        collected: false, spawned: true, fromEnemy: true, falling: true,
        vy: -5, section: e.section
      });
    }
  },

  // ============================================================
  // FINAL BOSS — the Storm Guardian of Mt. Fuji
  // ============================================================
  startBossFight() {
    this.bossActive = true;
    this.boss = {
      homeX: 37830, x: 37830,
      baseY: 170, y: 90,
      w: 120, h: 120,
      hp: 12 * (this.playerCount === 2 ? 2 : 1), maxHp: 12 * (this.playerCount === 2 ? 2 : 1),
      alive: true, dir: -1, frame: 0,
      hitFlash: 0, lastSwingHit: -1,
      shootTimer: 110,
      swoopTimer: 240, swooping: false, swoopProg: 0,
      phase2: false, // flips at 50% HP → Storm Fury (fast + lightning)
      introT: 100 // brief grace before it starts attacking
    };
    this.banner = { timer: 320, text: '⚡ The Storm Guardian blocks the path to Mt. Fuji — defeat it!' };
    if (AudioEngine.userMusicOn) AudioEngine.switchBGM('boss');
  },

  updateBoss() {
    const b = this.boss;
    if (!b || !b.alive) return;
    b.frame++;
    if (b.introT > 0) b.introT--;
    if (b.hitFlash > 0) b.hitFlash--;

    // Two distinct phases, switching at 50% HP:
    //  Phase 1 (>50%): a slow, readable glide — gentle sweep + bob, with the
    //    occasional committed swoop as the main window to hit it. No panic
    //    dodging (the constant bolt-away is what made it feel erratic before).
    //  Phase 2 (<=50%): "Storm Fury" — fast, dynamic and evasive. Quick sweeps,
    //    active dodging when Ellen is close or swinging, frequent swoops, and
    //    fast lightning bolts.
    const phase2 = b.hp <= b.maxHp / 2;
    if (phase2 && !b.phase2) {
      b.phase2 = true;        // just crossed the threshold
      b.shootTimer = 28;      // a quick first bolt to announce the shift
      this.banner = { timer: 240, text: '⚡ STORM FURY! The Guardian crackles with lightning — dodge!' };
    }

    // Arena bounds the boss zips across (full width, in front of the mountain)
    const arenaL = this.bossArenaStart + 30;
    const arenaR = this.bossWallX + 260;

    // Sweep + vertical weave (calmer in phase 1, snappier in phase 2)
    const sweepSpeed = phase2 ? 0.026 : 0.0095;
    let targetX = arenaL + (0.5 + 0.5 * Math.sin(b.frame * sweepSpeed)) * (arenaR - arenaL);
    let targetY = b.baseY + Math.sin(b.frame * (phase2 ? 0.075 : 0.035)) * (phase2 ? 82 : 68);

    // Active dodging is PHASE 2 ONLY — bolt away + climb when Ellen is close or
    // mid-swing. (Phase 1 stays calm and trackable.)
    if (phase2 && b.introT <= 0 && (this.player.attackTimer > 0 || Math.abs(this.player.x - b.x) < 190)) {
      const pdx = this.player.x - b.x;
      targetX = b.x - (pdx >= 0 ? 1 : -1) * 270;
      targetY = 95 + Math.sin(b.frame * 0.14) * 28;
    }

    // Periodic committed dive-bomb (telegraphed window to hit it)
    if (!b.swooping) {
      b.swoopTimer--;
      if (b.swoopTimer <= 0 && b.introT <= 0) { b.swooping = true; b.swoopProg = 0; }
    }
    if (b.swooping) {
      b.swoopProg += phase2 ? 0.034 : 0.020;
      const dive = Math.sin(Math.min(1, b.swoopProg) * Math.PI); // 0 -> 1 -> 0
      targetX = b.x + (this.player.x - b.x) * dive * 0.6;
      targetY = b.baseY + dive * 150;
      if (b.swoopProg >= 1) { b.swooping = false; b.swoopTimer = phase2 ? 150 : 300; }
    }

    targetX = Math.max(arenaL, Math.min(arenaR, targetX));
    targetY = Math.max(70, Math.min(330, targetY));

    // Phase 1 glides smoothly (low agility); phase 2 snaps around — dynamic and
    // hard to track.
    const agility = phase2 ? 0.17 : 0.06;
    b.x += (targetX - b.x) * agility;
    b.y += (targetY - b.y) * agility;
    b.dir = (this.player.x < b.x) ? -1 : 1;

    // Ranged attack: a slow aimed spread in phase 1; fast lightning in phase 2.
    if (b.introT <= 0) {
      b.shootTimer--;
      if (b.shootTimer <= 0) {
        if (phase2) {
          this.bossShootLightning();
          b.shootTimer = 70;
        } else {
          this.bossShoot(false);
          b.shootTimer = 135;
        }
      }
    }

    // Contact damage (smaller hitbox radius to feel more fair)
    const playerMidY = this.player.y - 28;
    if (Math.abs(b.x - this.player.x) < b.w * 0.35 && Math.abs(b.y - playerMidY) < b.h * 0.35) {
      this.damagePlayer();
    }
    if (this.player2.active && !this.player2.isDead) {
      const p2MidY = this.player2.y - 28;
      if (Math.abs(b.x - this.player2.x) < b.w * 0.35 && Math.abs(b.y - p2MidY) < b.h * 0.35) {
        this.damageBody(this.player2);
      }
    }
  },

  bossShoot(enraged) {
    const b = this.boss;
    const playerMidY = this.player.y - 28;
    const baseAng = Math.atan2(playerMidY - b.y, this.player.x - b.x);
    const spread = enraged ? [-0.3, -0.1, 0.1, 0.3] : [-0.18, 0.18];
    const sp = this.combat.enemyBulletSpeed * 0.85; // Slower projectile speed
    spread.forEach(off => {
      const a = baseAng + off;
      this.enemyProjectiles.push({
        x: b.x, y: b.y + 18,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        kind: 'bat', frame: 0, alive: true
      });
    });
    AudioEngine.playShootSFX();
  },

  // Phase 2 attack: a forked lightning bolt aimed straight at Ellen, much faster
  // than the phase-1 orbs so it's far harder to sidestep.
  bossShootLightning() {
    const b = this.boss;
    const playerMidY = this.player.y - 28;
    const a = Math.atan2(playerMidY - b.y, this.player.x - b.x);
    const sp = this.combat.enemyBulletSpeed * 2.1; // ~2.5x a normal boss shot
    [-0.05, 0.05].forEach(off => {
      const ang = a + off;
      this.enemyProjectiles.push({
        x: b.x, y: b.y + 18,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        kind: 'lightning', frame: 0, alive: true
      });
    });
    AudioEngine.playShootSFX();
  },

  hitBoss(dmg) {
    const b = this.boss;
    if (!b || !b.alive) return;
    b.hp -= dmg;
    b.hitFlash = 10;
    if (b.hp <= 0) {
      b.hp = 0;
      this.defeatBoss();
    } else {
      AudioEngine.playEnemyHurtSFX();
    }
  },

  defeatBoss() {
    const b = this.boss;
    b.alive = false;
    this.bossActive = false;
    this.bossDefeated = true;
    this.enemyProjectiles = [];
    // A flurry of celebratory poofs where it fell
    for (let i = 0; i < 5; i++) {
      this.poofs.push({ x: b.x + (Math.random() - 0.5) * 70, y: b.y + (Math.random() - 0.5) * 70, progress: i * 0.12 });
    }
    AudioEngine.playEnemyDefeatSFX();
    AudioEngine.playWinSFX();
    // Back to the gentle nostalgic theme for the Fuji finale
    if (AudioEngine.userMusicOn) AudioEngine.switchBGM('normal');
    this.banner = { timer: 360, text: '🌸 The Storm Guardian falls — the path to Mt. Fuji opens! 🗻' };
  },

  // Nearest alive foe ahead of a returned projectile (for accurate whack-backs)
  _nearestReturnTarget(p, dir) {
    let best = null, bestD = Infinity;
    this.enemies.forEach(e => {
      if (!e.alive) return;
      if ((e.x - p.x) * dir < -10) return; // must be ahead of the ball
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestD) { bestD = d; best = { x: e.x, y: e.y }; }
    });
    if (this.boss && this.boss.alive) {
      const d = Math.hypot(this.boss.x - p.x, this.boss.y - p.y);
      if (d < bestD) { bestD = d; best = { x: this.boss.x, y: this.boss.y }; }
    }
    return best;
  },

  // Damage either body. Ellen (P1) KO ends the game; Player 2 KO just sits out
  // and revives next to Ellen (co-op stays forgiving).
  damageBody(body) {
    if (!body || body.invuln > 0 || body.isDead) return;
    body.health -= 1;
    body.invuln = this.combat.invulnFrames;
    AudioEngine.playHurtSFX();
    const kb = -body.dir * 6;
    body.vx = kb;
    if (body === this.player) {
      if (wasmExports) wasmExports.player_vx.value = kb;
      if (body.health <= 0) {
        body.health = 0;
        this.triggerGameOver();
      }
    } else {
      // Player 2: knocked out → revive after a short delay (never a game over).
      if (body.health <= 0) {
        body.health = 0;
        body.isDead = true;
        body.reviveTimer = 180; // ~3s at 60fps
        body.vx = 0;
      }
    }
  },

  // Back-compat: existing call sites damage Ellen.
  damagePlayer() { this.damageBody(this.player); },

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
    if (this.shout && this.shout.timer > 0) this.shout.timer--;
    if (this.shout2 && this.shout2.timer > 0) this.shout2.timer--;
    if (this.player.invuln > 0) this.player.invuln--;
    if (this.banner && this.banner.timer > 0) this.banner.timer--;

    // Tick companion hop timers
    if (this.hopTimers) {
      if (this.hopTimers.husband > 0) this.hopTimers.husband--;
      if (this.hopTimers.kid1 > 0) this.hopTimers.kid1--;
      if (this.hopTimers.kid2 > 0) this.hopTimers.kid2--;
      if (this.hopTimers.dog > 0) this.hopTimers.dog--;
    }

    // --- Pickups (tennis racket, tennis balls, and locket of unity) ---
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
            text: '🎾 Tennis racket! Try to hit the enemy projectiles back at them'
          };
        } else if (pk.kind === 'soccer') {
          this.player.hasSoccer = true;
          this.setupSoccerLines();
          this.banner = {
            timer: 320,
            text: '⚽ Soccer ball! The family lines up — kick it at the foes, taking turns!'
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
        // Keep the run-up heading so she can steer to the high hearts mid-bounce
        this.airJumpDir = this.lastWalkDir || 0;
        if (wasmExports) {
          wasmExports.player_vy.value = this.combat.trampolineForce;
          wasmExports.player_y.value = t.y - 16;
          wasmExports.player_isGrounded.value = 0;
        }
        t.squash = 1;
        AudioEngine.playBounceSFX();
      }
      // Player 2 can super-bounce too
      const b2 = this.player2;
      if (b2.active && !b2.isDead) {
        const onPad2 = Math.abs(b2.x - t.x) < t.w / 2;
        if (onPad2 && b2.vy >= 0 && b2.y >= t.y - 14 && b2.y <= t.y + 8) {
          b2.vy = this.combat.trampolineForce;
          b2.y = t.y - 16;
          b2.isGrounded = false;
          t.squash = 1;
          AudioEngine.playBounceSFX();
        }
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
      if (this.player2.active && !this.player2.isDead &&
          Math.abs(e.x - this.player2.x) < 24 && Math.abs(e.y - (this.player2.y - 28)) < 30) {
        this.damageBody(this.player2);
      }
    });

    // --- Final boss update (movement, attacks, contact damage) ---
    if (this.bossActive && this.boss && this.boss.alive) {
      this.updateBoss();
    }

    // Once the boss falls, the storm clouds over Mt. Fuji slowly part (the reward reveal)
    if (this.bossDefeated && this.fujiRevealProgress < 1) {
      this.fujiRevealProgress = Math.min(1, this.fujiRevealProgress + 0.006);
    }

    // Reach depends on the current attack. The racket reaches farther AND higher
    // than the karate chop, so aerial foes that are tricky to clip with a chop
    // (need a near-apex jump) become easy once the racket is in hand.
    const usingRacket = this.player.attackType === 'racket';
    const hReach = usingRacket ? this.combat.swingReach : this.combat.karateReach;
    const vReach = usingRacket ? this.combat.swingVReach : this.combat.karateVReach;
    // While the soccer ball is equipped she only kicks (ranged) — no melee swing,
    // so a kick near the boss/enemies doesn't also land a hidden hit.
    const meleeActive = this.player.attackTimer > 0 && !this.soccerActive();

    // --- Melee can also hit the boss when it dives low enough ---
    if (meleeActive &&
        this.boss && this.boss.alive && this.boss.lastSwingHit !== this._swingId) {
      const b = this.boss;
      const dir = this.player.dir;
      const dx = (b.x - this.player.x) * dir;
      if (dx > -30 && dx < hReach + 40 && Math.abs(b.y - playerMidY) < vReach + 24) {
        b.lastSwingHit = this._swingId;
        this.hitBoss(1);
      }
    }

    // --- Melee hit resolution (ground AND aerial enemies) ---
    // One swing damages a given enemy at most once (guarded by swing id), so a
    // 2-hit monster survives a single swing. Vertical reach (vReach) is what
    // makes karate vs racket matter against flying foes.
    if (meleeActive) {
      const dir = this.player.dir;
      this.enemies.forEach(e => {
        if (!e.alive) return;
        if (e.lastSwingHit === this._swingId) return;
        const dx = (e.x - this.player.x) * dir; // >0 = in front
        if (dx > -12 && dx < hReach && Math.abs(e.y - playerMidY) < vReach) {
          e.lastSwingHit = this._swingId;
          this.hitEnemy(e, 1);
        }
      });
    }

    // --- Player 2 (co-op) karate melee — hits enemies and the boss too ---
    // Uses a distinct 'p2_' swing-id namespace so a P2 swing and a P1 swing each
    // land independently on the same target.
    const p2b = this.player2;
    if (p2b.active && !p2b.isDead && p2b.attackTimer > 0 && !this.soccerActive()) {
      const dir2 = p2b.dir;
      const p2MidY = p2b.y - 28;
      const hR = this.combat.karateReach;
      const vR = this.combat.karateVReach;
      const sid2 = 'p2_' + this._swingId2;
      if (this.boss && this.boss.alive && this.boss.lastSwingHit !== sid2) {
        const bo = this.boss;
        const dxb = (bo.x - p2b.x) * dir2;
        if (dxb > -30 && dxb < hR + 40 && Math.abs(bo.y - p2MidY) < vR + 24) {
          this.boss.lastSwingHit = sid2;
          this.hitBoss(1);
        }
      }
      this.enemies.forEach(e => {
        if (!e.alive) return;
        if (e.lastSwingHit === sid2) return;
        const dxe = (e.x - p2b.x) * dir2;
        if (dxe > -12 && dxe < hR && Math.abs(e.y - p2MidY) < vR) {
          e.lastSwingHit = sid2;
          this.hitEnemy(e, 1);
        }
      });
    }

    // --- Racket projectile return (timing-based) ---
    // Connect with an incoming shot during the racket's SWEET SPOT for an
    // accurate return that homes toward the foe. Mistime the swing and the shot
    // just clanks off at a bad angle and sails wide.
    if (usingRacket && meleeActive) {
      const dir = this.player.dir;
      const prog = 1 - this.player.attackTimer / (this.player.attackMax || this.combat.swingDuration);
      const sweet = prog >= 0.15 && prog <= 0.55;
      this.enemyProjectiles.forEach(p => {
        if (!p.alive || p.friendly) return;
        const dx = (p.x - this.player.x) * dir;
        if (dx > -16 && dx < hReach + 6 && Math.abs(p.y - playerMidY) < vReach) {
          p.friendly = true;
          if (sweet) {
            // Clean hit: rocket it toward the nearest foe ahead
            const tgt = this._nearestReturnTarget(p, dir);
            const speed = 9.5;
            if (tgt) {
              const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
              p.vx = Math.cos(a) * speed;
              p.vy = Math.sin(a) * speed;
            } else {
              p.vx = dir * speed; p.vy = -2;
            }
            AudioEngine.playSlashSFX();
          } else {
            // Mistimed: clanks off, scattered and weak — unlikely to connect
            const speed = 3.5 + Math.random() * 2;
            p.vx = dir * speed * (0.4 + Math.random() * 0.5);
            p.vy = -2 - Math.random() * 4;
            AudioEngine.playEnemyHurtSFX();
          }
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
      // Served tennis balls are the main way to chip down the floating boss
      if (p.alive && this.boss && this.boss.alive &&
          Math.abs(this.boss.x - p.x) < this.boss.w * 0.45 &&
          Math.abs(this.boss.y - p.y) < this.boss.h * 0.45) {
        this.hitBoss(1);
        p.alive = false;
      }
    });
    if (this.projectiles.length) {
      this.projectiles = this.projectiles.filter(p => p.alive);
    }

    // --- Enemy projectiles: damage the player, UNLESS the racket returned them
    //     (friendly) — then they fly back and hurt the enemies/boss instead. ---
    this.enemyProjectiles.forEach(p => {
      if (!p.alive) return;
      if (p.friendly) p.vy += this.combat.ballGravity * 0.5; // returned shots arc gently
      p.x += p.vx;
      p.y += p.vy;
      p.frame++;
      if (p.y > groundY + 6 || p.y < -50 ||
          p.x < this.camera.x - 80 || p.x > this.camera.x + this.width + 80) {
        p.alive = false;
        return;
      }
      if (p.friendly) {
        // Returned shot: strike enemies / boss, ignore the player
        this.enemies.forEach(e => {
          if (!e.alive || !p.alive) return;
          if (Math.abs(e.x - p.x) < 22 && Math.abs(e.y - p.y) < 26) {
            this.hitEnemy(e, 1);
            p.alive = false;
          }
        });
        if (p.alive && this.boss && this.boss.alive &&
            Math.abs(this.boss.x - p.x) < this.boss.w * 0.45 &&
            Math.abs(this.boss.y - p.y) < this.boss.h * 0.45) {
          this.hitBoss(1);
          p.alive = false;
        }
      } else if (Math.abs(p.x - this.player.x) < 20 && Math.abs(p.y - playerMidY) < 28) {
        p.alive = false;
        this.damagePlayer();
      } else if (this.player2.active && !this.player2.isDead &&
                 Math.abs(p.x - this.player2.x) < 20 && Math.abs(p.y - (this.player2.y - 28)) < 28) {
        p.alive = false;
        this.damageBody(this.player2);
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

    // --- Wedding confetti ---
    this.updateConfetti();

    // --- Engagement balloons + approaching-boss rain ---
    this.updateBalloons();
    this.updateRain();
    this.updateCrows();
    this.updateFarmAnimals();
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

    // If she fell to the boss, clear it so the fight restarts when she walks back in
    if (this.boss && !this.bossDefeated) {
      this.boss = null;
      this.bossActive = false;
      if (AudioEngine.userMusicOn) AudioEngine.switchBGM('normal');
    }

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

    // In co-op, whichever character Player 2 is driving is drawn as the P2 body,
    // so skip it here (otherwise it'd appear twice — once controlled, once trailing).
    const p2On = this.twoPlayer && this.player2.active;
    const p2IsHusband = p2On && this.player2.role === 'husband';
    const p2IsKid1 = p2On && this.player2.role === 'kid1';

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

    // 2. Husband (Barney) joins once Ellen has walked up to him on his chair.
    //    Gated purely on `joined` (not player.x) so the walking companion appears
    //    the instant he stands — no gap between the seated sprite and the walker.
    if (this.seatedBarney && this.seatedBarney.joined && !p2IsHusband) {
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

      // Skip Preston here when Player 2 is driving him.
      if (!(p2IsKid1 && kidType === 'kid1')) {
        this.companions.push({
          type: kidType,
          x: this.player.x - offset * this.player.dir,
          y: echoY(9),
          outfit: 'casual',
          frame: frame,
          dir: this.player.dir
        });
      }
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
    this.currentLevelIndex = lvlIndex;

    // Crossing the wedding altar (id 4) sets off a celebratory confetti burst.
    if (this.levels[lvlIndex].id === 4) {
      this.startConfetti(this.levels[lvlIndex].x);
    }

    // Earlier memories no longer freeze the game — their story is revealed as a
    // floating banner that advances with Ellen's position (see drawStoryBanner),
    // so she can stroll through (or back over) the words at her own pace. Only
    // the final Mt. Fuji milestone keeps the modal: it's the climactic finale
    // that leads straight into the ending celebration.
    if (lvlIndex !== this.levels.length - 1) return;

    this.isPaused = true;
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

    // Show the ending overlay after a short delay (no more collect-'em-all prize).
    setTimeout(() => {
      const hint = document.getElementById('ending-hearts-hint');
      if (hint) hint.textContent = '';
      this.endingFocusIndex = 0;
      document.getElementById('ending-screen').classList.add('active');
      this.updateEndingFocus();
    }, 1500);
  },

  // Resume play after finishing so she can keep wandering the memories.
  continueExploring() {
    document.getElementById('ending-screen').classList.remove('active');
    this.isPaused = false;
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

  // A single HUD heart — filled red, or a hollow dark outline when empty. The
  // two states are rendered once into tiny offscreen canvases and then blitted,
  // so we don't re-tessellate bezier paths every frame.
  drawHeartIcon(cx, cy, s, filled) {
    if (!this._heartCache) this._heartCache = {};
    const key = (filled ? 'f' : 'e') + s;
    let cv = this._heartCache[key];
    if (!cv) {
      cv = document.createElement('canvas');
      const pad = 4, dim = Math.ceil(s + pad * 2);
      cv.width = dim;
      cv.height = dim;
      const c = cv.getContext('2d');
      const k = s * 0.5;
      c.translate(dim / 2, dim / 2 + 1);
      c.beginPath();
      c.moveTo(0, k * 0.7);
      c.bezierCurveTo(k * 1.1, -k * 0.4, k * 0.55, -k * 1.1, 0, -k * 0.45);
      c.bezierCurveTo(-k * 0.55, -k * 1.1, -k * 1.1, -k * 0.4, 0, k * 0.7);
      c.closePath();
      if (filled) {
        c.fillStyle = '#ff4d6d'; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = '#b3173b'; c.stroke();
      } else {
        c.fillStyle = 'rgba(0,0,0,0.4)'; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,0.5)'; c.stroke();
      }
      this._heartCache[key] = cv;
    }
    this.ctx.drawImage(cv, Math.round(cx - cv.width / 2), Math.round(cy - cv.height / 2));
  },

  // --- Wedding confetti: a one-off celebratory burst at the altar ---
  startConfetti(worldX) {
    if (!this.confetti) this.confetti = [];
    const groundY = this.height - 80;
    const colors = ['#ff6b9d', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#ffffff', '#c77dff', '#ffd6e0'];
    for (let i = 0; i < 90; i++) {
      this.confetti.push({
        x: worldX + (Math.random() - 0.5) * 170,
        y: groundY - 70 - Math.random() * 70,
        vx: (Math.random() - 0.5) * 6,
        vy: -4 - Math.random() * 6,            // burst upward
        w: 4 + Math.random() * 4,
        h: 6 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.35,
        sway: Math.random() * Math.PI * 2,
        life: 150 + Math.random() * 90
      });
    }
  },

  updateConfetti() {
    if (!this.confetti || !this.confetti.length) return;
    const groundY = this.height - 80;
    this.confetti.forEach(p => {
      p.vy += 0.14;       // gravity
      p.vx *= 0.99;
      p.sway += 0.12;
      p.x += p.vx + Math.sin(p.sway) * 0.7;   // flutter
      p.y += p.vy;
      p.rot += p.vrot;
      p.life--;
      if (p.y > groundY + 8) { p.y = groundY + 8; p.vy *= -0.25; p.vx *= 0.6; }
    });
    this.confetti = this.confetti.filter(p => p.life > 0);
  },

  drawConfetti(camX) {
    if (!this.confetti || !this.confetti.length) return;
    const ctx = this.ctx;
    this.confetti.forEach(p => {
      const rx = p.x - camX;
      if (rx < -20 || rx > this.width + 20) return;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / 45);
      ctx.translate(rx, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
  },

  // --- Engagement balloons: a gentle stream rises into the sky while she's at
  // the proposal chapter (purely decorative). ---
  updateBalloons() {
    if (!this.balloons) this.balloons = [];
    const eng = this.levels.find(l => l.id === 3); // The Engagement
    if (eng && this.player) {
      const dx = Math.abs(this.player.x - eng.x);
      if (dx < 650 && this.balloons.length < 26 && Math.random() < 0.07) {
        const colors = ['#ff6b9d', '#ffd166', '#06d6a0', '#4cc9f0', '#ef476f', '#c77dff', '#ff9e6d', '#ffffff'];
        this.balloons.push({
          x: eng.x + (Math.random() - 0.5) * 520,
          y: this.height - 96,
          vy: -(0.8 + Math.random() * 0.7),
          r: 8 + Math.random() * 5,
          color: colors[(Math.random() * colors.length) | 0],
          sway: Math.random() * Math.PI * 2,
          life: 460
        });
      }
    }
    if (this.balloons.length) {
      this.balloons.forEach(b => {
        b.y += b.vy;
        b.sway += 0.035;
        b.x += Math.sin(b.sway) * 0.6;
        b.life--;
      });
      this.balloons = this.balloons.filter(b => b.life > 0 && b.y > -40);
    }
  },

  drawBalloons(camX) {
    if (!this.balloons || !this.balloons.length) return;
    const ctx = this.ctx;
    this.balloons.forEach(b => {
      const rx = b.x - camX;
      if (rx < -30 || rx > this.width + 30) return;
      const aIn = Math.min(1, (460 - b.life) / 12);
      const aOut = Math.min(1, b.life / 50);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(aIn, aOut));
      // string
      ctx.strokeStyle = 'rgba(120,110,90,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx, b.y + b.r);
      ctx.quadraticCurveTo(rx + Math.sin(b.sway) * 4, b.y + b.r + 12, rx + Math.sin(b.sway) * 2, b.y + b.r + 22);
      ctx.stroke();
      // body
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.ellipse(rx, b.y, b.r * 0.86, b.r, 0, 0, Math.PI * 2);
      ctx.fill();
      // knot
      ctx.beginPath();
      ctx.moveTo(rx - 2, b.y + b.r); ctx.lineTo(rx + 2, b.y + b.r); ctx.lineTo(rx, b.y + b.r + 3);
      ctx.closePath(); ctx.fill();
      // highlight
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(rx - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.22, b.r * 0.32, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },

  // --- Ambient wildlife: a few mallards bobbing on little ponds (background,
  // non-interactive) and a flock of birds drifting across the sky. ---
  drawMallards(camX) {
    const ctx = this.ctx;
    const groundY = this.height - 84;
    const spots = this._mallardSpots || (this._mallardSpots = [3100, 6400, 10300, 14200, 24600, 31200]);
    const t = Date.now() * 0.004;
    spots.forEach((sx, gi) => {
      const baseRx = sx - camX;
      if (baseRx < -120 || baseRx > this.width + 120) return;
      // little pond
      ctx.fillStyle = 'rgba(86,138,168,0.55)';
      ctx.beginPath(); ctx.ellipse(baseRx + 18, groundY + 9, 48, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(185,212,230,0.22)';
      ctx.beginPath(); ctx.ellipse(baseRx + 14, groundY + 6, 30, 4, 0, 0, Math.PI * 2); ctx.fill();
      const n = 2 + (gi % 2);
      for (let k = 0; k < n; k++) {
        const rx = baseRx + k * 25 + (k % 2) * 5;
        const bob = Math.sin(t * 1.3 + gi * 2 + k) * 2.0;
        const wob = Math.sin(t * 0.7 + k) * 1.2;
        this.drawMallard(ctx, rx + wob, groundY + 2 + bob, (gi + k) % 2 === 0 ? 1 : -1);
      }
    });
  },

  drawMallard(ctx, x, y, dir) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    // body
    ctx.fillStyle = '#8a7355';
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    // tail
    ctx.beginPath(); ctx.moveTo(-8, -1); ctx.lineTo(-13, -3); ctx.lineTo(-8, 2.5); ctx.closePath(); ctx.fill();
    // lighter chest
    ctx.fillStyle = '#a8916b';
    ctx.beginPath(); ctx.ellipse(4, 1, 4.2, 4, 0, 0, Math.PI * 2); ctx.fill();
    // neck + green head
    ctx.fillStyle = '#2f6b3a';
    ctx.fillRect(5.5, -6, 3, 5.5);
    ctx.beginPath(); ctx.ellipse(8, -6, 3.6, 4, 0, 0, Math.PI * 2); ctx.fill();
    // white collar
    ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(5.5, -2.4); ctx.lineTo(9, -2.4); ctx.stroke();
    // yellow bill
    ctx.fillStyle = '#e3b23c';
    ctx.beginPath(); ctx.moveTo(11, -6.4); ctx.lineTo(15, -5.3); ctx.lineTo(11, -4); ctx.closePath(); ctx.fill();
    // eye
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(9.2, -6.6, 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  drawBirds() {
    if (this.rainIntensity > 0.4) return; // birds don't fly in the storm
    const ctx = this.ctx;
    const period = 34000;
    const t = (Date.now() % period) / period;
    const leadX = this.width + 80 - t * (this.width + 220); // drift right -> left
    const leadY = 70 + Math.sin(t * Math.PI * 2) * 18;
    const flock = [[0, 0], [-18, 8], [18, 8], [-36, 16], [36, 16], [-54, 24], [54, 24]];
    const flap = Math.sin(Date.now() * 0.012);
    ctx.save();
    ctx.strokeStyle = 'rgba(45,55,75,0.5)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    flock.forEach((o, i) => {
      const bx = leadX + o[0];
      const by = leadY + o[1] + Math.sin(Date.now() * 0.01 + i) * 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - 6, by + (flap > 0 ? -1 : 1));
      ctx.quadraticCurveTo(bx, by - 3 - flap * 1.5, bx + 6, by + (flap > 0 ? -1 : 1));
      ctx.stroke();
    });
    ctx.restore();
  },

  // --- Decorative Fruit Trees (background scenery, non-interactive) ----------
  drawFruitTrees(camX) {
    if (!this.fruitTrees) return;
    const groundY = this.height - 80;
    const ctx = this.ctx;
    this.fruitTrees.forEach(tree => {
      const rx = tree.x - camX;
      // Cull off-screen trees (generous margin for canopy width)
      if (rx < -80 || rx > this.width + 80) return;
      Assets.drawFruitTree(ctx, rx, groundY, tree.kind, tree.scale);
    });
  },

  // --- Decorative Crows / Ravens (non-interactive wildlife) ------------------
  // Flying crows soar across the sky; ground crows hop and peck.
  updateCrows() {
    if (!this.crows) return;
    this.crows.forEach(c => {
      if (c.mode === 'fly') {
        c.flapPhase += 0.09;
        c.flyDrift += c.dir * c.flySpeed;
        // Wrap around so they reappear: drift range ±1200 around their home
        if (Math.abs(c.flyDrift) > 1200) c.flyDrift = -c.flyDrift * 0.1;
      } else {
        // Hopping crows
        c.hopPhase += 0.06 * c.hopSpeed;
        // Small hops drift them a few px, then they reverse direction
        const hopVal = Math.sin(c.hopPhase);
        c.hopDrift += c.dir * Math.max(0, hopVal) * 0.3;
        // Reverse direction periodically
        if (Math.abs(c.hopDrift) > 45) {
          c.dir *= -1;
          c.hopDrift *= 0.8;
        }
      }
    });
  },

  drawCrows(camX, modeFilter) {
    if (!this.crows) return;
    const ctx = this.ctx;
    this.crows.forEach(c => {
      if (modeFilter && c.mode !== modeFilter) return;
      const worldX = c.baseX + (c.flyDrift || 0) + (c.hopDrift || 0);
      const rx = worldX - camX;
      if (rx < -40 || rx > this.width + 40) return;
      // Flying crows hide during heavy rain (same as the V-flock)
      if (c.mode === 'fly' && this.rainIntensity > 0.4) return;
      const dy = c.mode === 'fly'
        ? c.y + Math.sin(Date.now() * 0.002 + c.flapPhase) * 6  // gentle altitude bobbing
        : c.y - Math.abs(Math.sin(c.hopPhase)) * 5;              // hop-bounce
      Assets.drawCrow(ctx, rx, dy, c.dir, c.mode, c.flapPhase || 0, c.hopPhase || 0);
    });
  },

  // --- Decorative Farm Animals (non-interactive wildlife) ---------------------
  updateFarmAnimals() {
    if (!this.farmAnimals) return;
    this.farmAnimals.forEach(a => {
      // Advance animation phase at different rates per animal type
      switch (a.type) {
        case 'chick':    a.phase += 0.07;  break;
        case 'cow':      a.phase += 0.02;  break;
        case 'horse':    a.phase += 0.025; break;
        case 'owl':      a.phase += 0.04;  break;
        case 'fox':      a.phase += 0.045; break;
        case 'sheep':    a.phase += 0.03;  break;
        case 'cat':      a.phase += 0.05;  break;
        case 'rabbit':   a.phase += 0.06;  break;
        case 'squirrel': a.phase += 0.055; break;
      }
      // Dynamic drift movement for roaming animals
      if (a.driftSpeed) {
        a.drift = (a.drift || 0) + a.dir * a.driftSpeed * Math.max(0, Math.sin(a.phase * 0.3));
        if (Math.abs(a.drift) > 50) {
          a.dir *= -1;
          a.drift *= 0.8;
        }
      }
    });
    // Update seated Barney (check if Ellen has reached him)
    this.updateSeatedBarney();
  },

  // Barney sits on a chair at the Dating milestone. When Ellen walks up to him
  // we pause once and offer 2-player co-op (or continue solo).
  updateSeatedBarney() {
    if (!this.seatedBarney || this.seatedBarney.joined) return;
    const dist = Math.abs(this.player.x - this.seatedBarney.x);
    if (dist < 50) this.meetBarney();
  },

  // Ellen reaches Barney: he stands and joins as a follower, and a pairing QR
  // appears floating in the sky near him — no pause. A second player can scan it
  // any time to take control of Barney.
  meetBarney() {
    if (this.seatedBarney) this.seatedBarney.joined = true;
    this.armPlayer2Pairing();
    this.launchSkyQr();
  },

  armPlayer2Pairing() {
    try {
      if (window.AndroidBridge) {
        if (AndroidBridge.beginPlayer2Pairing) AndroidBridge.beginPlayer2Pairing();
        if (AndroidBridge.getQrDataUrl) this.setPairingQr(AndroidBridge.getQrDataUrl());
      } else {
        this.connectP2Relay(); // relay replies with the QR + controller events
      }
    } catch (e) { /* keyboard P2 still works */ }
  },

  setPairingQr(dataUrl) {
    if (!dataUrl) return;
    this._pairingQrUrl = dataUrl;
    if (!this._pairingQrImg || this._pairingQrImg.src !== dataUrl) {
      const img = new Image();
      this._pairingQrReady = false;
      img.onload = () => { this._pairingQrReady = true; };
      img.src = dataUrl;
      this._pairingQrImg = img;
    }
  },

  launchSkyQr() {
    // Persistent, world-anchored card just LEFT of Barney's chair — kept clear of
    // the Dating memory polaroid (which floats over the milestone to the right).
    // Like a floating memory card it appears/disappears by position and gently
    // bobs in place — it does NOT rise away or time out. Removed once P2 joins.
    this.skyQr = {
      x: (this.seatedBarney ? this.seatedBarney.x : this.player.x) - 110,
      baseY: 120,
    };
  },

  drawSkyQr(camX) {
    const q = this.skyQr;
    if (!q) return;
    const ctx = this.ctx;
    // Fade in/out by Ellen's distance from the card (positional, like the memory
    // banners) — never a timed fade.
    const dist = Math.abs(this.player.x - q.x);
    const alpha = Math.max(0, Math.min(1, (820 - dist) / 200));
    if (alpha <= 0.02) return;
    const rx = q.x - camX;
    if (rx < -160 || rx > this.width + 160) return;
    const bob = Math.sin(Date.now() * 0.0018) * 6;
    const sway = Math.cos(Date.now() * 0.0011) * 4;
    const size = 92, pad = 7, cardW = 150, cardH = size + pad * 2 + 20;
    const cx = rx + sway, cy = q.baseY + bob;
    ctx.save();
    ctx.globalAlpha = alpha;
    // card
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fillRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
    // QR (or a placeholder while it loads / on a setup with no transport)
    const qx = cx - size / 2, qy = cy - cardH / 2 + pad;
    if (this._pairingQrImg && this._pairingQrReady) {
      ctx.drawImage(this._pairingQrImg, qx, qy, size, size);
    } else {
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(qx, qy, size, size);
    }
    // caption
    ctx.fillStyle = '#222';
    ctx.font = '700 11px Outfit';
    ctx.textAlign = 'center';
    ctx.fillText('📲 Scan to play as Barney!', cx, cy + cardH / 2 - 6);
    ctx.restore();
  },

  // A phone controller connected — promote co-op so Barney becomes Player 2.
  onPlayer2Connected() {
    if (!this.twoPlayer) this.enableTwoPlayer();
  },

  showTwoPlayerPrompt() {
    this.isPaused = true;
    this.player.vx = 0;
    if (wasmExports) wasmExports.player_vx.value = 0;
    this.twoPlayerFocusIndex = 0;
    const el = document.getElementById('twoplayer-prompt');
    if (el) el.classList.add('active');

    // Surface the pairing QR so Player 2 can scan to join as Barney.
    const qr = document.getElementById('twoplayer-qr');
    if (qr) qr.innerHTML = '';
    try {
      if (window.AndroidBridge) {
        // Android TV build: native hosts the WS server + generates the QR.
        if (AndroidBridge.beginPlayer2Pairing) AndroidBridge.beginPlayer2Pairing();
        if (AndroidBridge.getQrDataUrl) this.showP2Qr(AndroidBridge.getQrDataUrl());
      } else {
        // Desktop: connect to the local relay (npm run dev); it replies with the QR.
        this.connectP2Relay();
      }
    } catch (e) { /* no controller transport — Player 2 can still use the keyboard (H/L/U/O) */ }

    this.updateTwoPlayerFocus();
  },

  showP2Qr(dataUrl) {
    const qr = document.getElementById('twoplayer-qr');
    if (!qr || !dataUrl) return;
    qr.innerHTML = '<img alt="Scan to join as Player 2" src="' + dataUrl +
      '" style="width:150px;height:150px;border-radius:8px;background:#fff;padding:6px;">';
  },

  // Desktop only: connect to tools/p2-relay.js as the "game" client. The relay
  // sends us the pairing QR and forwards phone-controller input here, which we
  // feed straight into handleCtrl (same path the Android native injection uses).
  connectP2Relay() {
    if (window.AndroidBridge) return;
    if (this._p2ws && this._p2ws.readyState <= 1) return; // connecting or open
    try {
      const host = location.hostname || '127.0.0.1';
      const ws = new WebSocket('ws://' + host + ':8081');
      this._p2ws = ws;
      ws.onopen = () => { try { ws.send(JSON.stringify({ role: 'game' })); } catch (e) {} };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'pairing') { this.setPairingQr(m.qr); return; }
        if (m.type === 'controller') { if (m.state === 'connected') this.onPlayer2Connected(); return; }
        if (m.action && m.key != null) this.handleCtrl(m);
      };
      ws.onclose = () => { this._p2ws = null; };
      ws.onerror = () => {};
    } catch (e) { /* relay not running — keyboard P2 still works */ }
  },

  // yes = start co-op; either way Barney is now "acquired".
  chooseTwoPlayer(yes) {
    const el = document.getElementById('twoplayer-prompt');
    if (el) el.classList.remove('active');
    const qr = document.getElementById('twoplayer-qr');
    if (qr) qr.innerHTML = '';
    if (this.seatedBarney) this.seatedBarney.joined = true;
    if (yes) {
      this.enableTwoPlayer();
    } else {
      try { if (window.AndroidBridge && AndroidBridge.cancelPlayer2Pairing) AndroidBridge.cancelPlayer2Pairing(); } catch (e) {}
    }
    this.isPaused = false;
    if (this.canvas) this.canvas.focus();
  },

  updateTwoPlayerFocus() {
    const ids = ['twoplayer-yes-btn', 'twoplayer-solo-btn'];
    ids.forEach((id, i) => {
      const b = document.getElementById(id);
      if (b) b.classList.toggle('focused', i === (this.twoPlayerFocusIndex || 0));
    });
  },

  drawFarmAnimals(camX) {
    if (!this.farmAnimals) return;
    const ctx = this.ctx;
    this.farmAnimals.forEach(a => {
      const rx = (a.x + (a.drift || 0)) - camX;
      // Cull with generous margins (horses/cows are ~70px wide)
      if (rx < -80 || rx > this.width + 80) return;
      switch (a.type) {
        case 'chick':
          Assets.drawChick(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'cow':
          Assets.drawCow(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'horse':
          Assets.drawHorse(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'owl':
          Assets.drawOwl(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'fox':
          Assets.drawFox(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'sheep':
          Assets.drawSheep(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'cat':
          Assets.drawCat(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'rabbit':
          Assets.drawRabbit(ctx, rx, a.y, a.dir, a.phase);
          break;
        case 'squirrel':
          Assets.drawSquirrel(ctx, rx, a.y, a.dir, a.phase);
          break;
      }
    });

    // Draw seated Barney (if he hasn't joined Ellen yet)
    if (this.seatedBarney && !this.seatedBarney.joined) {
      const brx = this.seatedBarney.x - camX;
      if (brx > -60 && brx < this.width + 60) {
        Assets.drawSeatedHusband(this.ctx, brx, this.seatedBarney.y, 'red_vneck', this.seatedBarney.dir);
      }
    }
  },

  // --- Rain that builds as she nears the boss arena (none -> light -> heavy),
  // then clears once the boss is beaten so Mt. Fuji rises into sunshine. ---
  updateRain() {
    if (!this.raindrops) this.raindrops = [];
    let intensity = 0;
    if (this.player && !this.bossDefeated) {
      const rainStart = this.bossArenaStart - 2400;
      const rainFull = this.bossArenaStart - 200;
      intensity = (this.player.x - rainStart) / (rainFull - rainStart);
      intensity = Math.max(0, Math.min(1, intensity));
    }
    this.rainIntensity += (intensity - this.rainIntensity) * 0.04; // smooth ramp
    if (this.rainIntensity < 0.01) { this.rainIntensity = 0; this.raindrops.length = 0; return; }
    const target = Math.floor(this.rainIntensity * 170);
    while (this.raindrops.length < target) this.raindrops.push(this.makeRaindrop(true));
    if (this.raindrops.length > target) this.raindrops.length = target;
    const wind = 1.8;
    this.raindrops.forEach(d => {
      d.y += d.spd;
      d.x += wind;
      if (d.y > this.height + 10) Object.assign(d, this.makeRaindrop(false));
      else if (d.x > this.width + 20) d.x = -20;
    });
  },

  makeRaindrop(anywhere) {
    return {
      x: Math.random() * (this.width + 60) - 30,
      y: anywhere ? Math.random() * this.height : -20 - Math.random() * 60,
      len: 9 + Math.random() * 12,
      spd: 11 + Math.random() * 7
    };
  },

  drawRain() {
    if (!this.rainIntensity || this.rainIntensity < 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    // stormy darkening that deepens with the rain
    ctx.fillStyle = `rgba(40,48,66,${0.2 * this.rainIntensity})`;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = `rgba(190,205,230,${0.32 + 0.15 * this.rainIntensity})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    this.raindrops.forEach(d => {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * 0.2, d.y + d.len);
    });
    ctx.stroke();
    ctx.restore();
  },

  // Distant landmarks tied to a chapter, drawn with slow parallax + a haze fade
  // so they read as far away (Golden Gate near Preston, Taipei 101 near Blaire).
  drawBackgroundLandmarks(camX) {
    const horizon = this.height - 90;
    const items = [
      { id: 6, kind: 'goldengate', side: 0.5 },  // Preston
      { id: 8, kind: 'taipei101', side: 0.6 },    // Blaire
      { id: 9, kind: 'elcapitan', side: 0.58 }    // RV Camping
    ];
    items.forEach(it => {
      const lvl = this.levels.find(l => l.id === it.id);
      if (!lvl) return;
      const refCam = lvl.x - this.width / 3;       // camera when she's at the chapter
      const dx = camX - refCam;
      if (Math.abs(dx) > 2600) return;
      const screenX = this.width * it.side - dx * 0.32; // slow scroll = distant
      const alpha = Math.max(0, Math.min(1, (2600 - Math.abs(dx)) / 1100));
      if (alpha <= 0.02) return;
      if (it.kind === 'goldengate') Assets.drawGoldenGate(this.ctx, screenX, horizon, alpha);
      else if (it.kind === 'taipei101') Assets.drawTaipei101(this.ctx, screenX, horizon, alpha);
      else if (it.kind === 'elcapitan') Assets.drawElCapitan(this.ctx, screenX, horizon, alpha);
    });
  },

  // A plane crosses the sky (climbing at a gentle upward angle) — only around
  // the 2nd-house chapter.
  drawBackgroundPlane() {
    const lvl = this.levels.find(l => l.id === 7); // Moving to Our Second House
    if (!lvl) return;
    const dx = this.camera.x - (lvl.x - this.width / 3);
    if (Math.abs(dx) > 2300) return;
    const period = 15000;
    const t = (Date.now() % period) / period;
    const x0 = -120, x1 = this.width + 120, y0 = 128, y1 = 34;
    const x = x0 + t * (x1 - x0);
    const y = y0 + t * (y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0); // tilt the plane up to match the climb
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (2300 - Math.abs(dx)) / 700)); // fade at the edges
    ctx.translate(x, y);
    ctx.rotate(ang);
    Assets.drawPlane(ctx, 0, 0, 1);
    ctx.restore();
  },

  // Renders the background scenery, hills and ground
  drawBackground() {
    // Dynamic Sky Gradient
    const sky = this.getSkyColors(this.player.x);
    const bgGrad = this.ctx.createLinearGradient(0, 0, 0, this.height);
    bgGrad.addColorStop(0, sky.top);
    bgGrad.addColorStop(1, sky.bottom);
    this.ctx.fillStyle = bgGrad;
    // Over-fill well beyond the canvas so the zoomed-out boss view has no gaps
    this.ctx.fillRect(-this.width, -this.height, this.width * 3, this.height * 2);

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

    // Distant parallaxed landmarks (rise from behind the hills) + an ambient plane
    this.drawBackgroundLandmarks(this.camera.x);
    this.drawBackgroundPlane();
    this.drawBirds(); // a flock drifting across the sky
    this.drawCrows(this.camera.x, 'fly'); // flying crows soaring across the sky

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

    // Engagement balloons drift up behind the foreground characters
    this.drawBalloons(this.camera.x);

    // Storm shroud over Mt. Fuji — hides the mountain until the boss is beaten,
    // then slowly parts to reveal it as the reward.
    const fujiLvl = this.levels[this.levels.length - 1];
    const fujiScreenX = fujiLvl.x - this.camera.x;
    const shroudAlpha = 1 - (this.fujiRevealProgress || 0);
    if (shroudAlpha > 0.01 && fujiScreenX > -460 && fujiScreenX < this.width + 460) {
      this.drawFujiShroud(fujiScreenX, shroudAlpha, Date.now());
    }

    // Draw Floating Polaroid Photos in the sky
    this.levels.forEach((lvl, idx) => {
      // The Mt. Fuji memory stays sealed until the Storm Guardian is defeated
      if (idx === this.levels.length - 1 && !this.bossDefeated) return;

      // Optional per-level card offset (Mt. Fuji shifts its photos to the upper
      // right so they don't cover the mountain).
      const relativeX = lvl.x - this.camera.x + (lvl.cardDX || 0);
      const py = 125 + (lvl.cardDY || 0);

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

    // Progressive control hints in the sky near the start (walk -> jump -> chop)
    this.drawTutorialHints();

    // Walk-through memory story (replaces the old freezing dialogue modal)
    this.drawStoryBanner();
  },

  // The on-screen span over which a memory's story is read. Line 0 sits roughly
  // at the milestone marker; each subsequent line is STORY_STEP px further on,
  // with a STORY_LEAD fade runway at each edge. Shared by the banner and the
  // enemy spawner so combat never overlaps the words.
  storyZone(lvl) {
    const n = (lvl.dialogue && lvl.dialogue.length) || 1;
    const s0 = lvl.x - 60;
    return {
      n,
      s0,
      start: s0 - this.STORY_LEAD,
      end: s0 + (n - 1) * this.STORY_STEP + this.STORY_LEAD,
    };
  },

  // Greedy word-wrap for canvas text → array of lines that each fit maxWidth.
  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(test).width > maxWidth) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  },

  // Floating "memory card" near the top of the screen. The line shown is chosen
  // purely by Ellen's x position, so walking forward advances the story and
  // walking back rewinds it — no pause, no button. The finale (Mt. Fuji) is the
  // one exception that still uses the modal.
  drawStoryBanner() {
    if (!this.levels || this.isPaused) return;
    if (this.bossActive && !this.bossDefeated) return;

    const px = this.player.x;
    const lastIdx = this.levels.length - 1;
    let active = null, zone = null;
    for (let i = 0; i < lastIdx; i++) {
      const z = this.storyZone(this.levels[i]);
      if (px >= z.start && px <= z.end) { active = this.levels[i]; zone = z; break; }
    }
    if (!active) return;

    // Which line are we on, and how strongly is the card faded in?
    const idx = Math.max(0, Math.min(zone.n - 1, Math.round((px - zone.s0) / this.STORY_STEP)));
    const edge = Math.min(px - zone.start, zone.end - px);
    const alpha = Math.max(0, Math.min(1, edge / this.STORY_LEAD));
    if (alpha <= 0.01) return;

    const ctx = this.ctx;
    const cx = this.width / 2;
    const boxW = Math.min(620, this.width - 80);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';

    ctx.font = '600 19px "Outfit", sans-serif';
    const bodyLines = this.wrapText(ctx, active.dialogue[idx], boxW - 56);
    const lineH = 25, padTop = 18, padBot = 20, dotsH = 14;
    const boxH = padTop + bodyLines.length * lineH + dotsH + padBot;
    // Float the card in the open middle band — below the polaroid album (cardH
    // 145, centred ~y125, so its base is ~y205) and above the characters/ground
    // near the bottom — so it overlaps neither.
    const albumBottom = 210;
    const groundTop = this.height - 150;
    let by = Math.round((albumBottom + groundTop) / 2 - boxH / 2);
    by = Math.max(albumBottom, Math.min(by, groundTop - boxH));
    const bx = cx - boxW / 2, r = 18;

    // Rounded translucent backdrop
    ctx.fillStyle = 'rgba(20, 24, 40, 0.62)';
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r);
    ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r);
    ctx.arcTo(bx, by + boxH, bx, by, r);
    ctx.arcTo(bx, by, bx + boxW, by, r);
    ctx.closePath();
    ctx.fill();

    // Body line(s) — no name/year header (it's already on the polaroid + HUD)
    let y = by + padTop + 4;
    ctx.font = '600 19px "Outfit", sans-serif';
    ctx.fillStyle = '#ffffff';
    for (const bl of bodyLines) { ctx.fillText(bl, cx, y); y += lineH; }

    // Progress dots
    y += 2;
    const dotGap = 13, totalW = (zone.n - 1) * dotGap;
    for (let d = 0; d < zone.n; d++) {
      ctx.beginPath();
      ctx.arc(cx - totalW / 2 + d * dotGap, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = d === idx ? '#ffd1dc' : 'rgba(255,255,255,0.3)';
      ctx.fill();
    }

    // Gentle nudge on the first line so the player knows to keep walking
    if (idx === 0 && zone.n > 1) {
      ctx.globalAlpha = alpha * 0.7;
      ctx.font = '500 11px "Outfit", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('keep walking to read on  →', cx, by - 9);
    }

    ctx.restore();
  },

  // Floating control hints that fade in/out as Ellen walks past them.
  drawTutorialHints() {
    if (!this.tutorialHints) return;

    const ctx = this.ctx;
    const range = 230; // px window over which a hint fades in/out
    this.tutorialHints.forEach(hint => {
      // Some hints only apply once a tool is in hand (e.g. the racket how-to).
      if (hint.needWeapon && this.player.weapon !== hint.needWeapon) return;
      const dist = Math.abs(this.player.x - hint.x);
      if (dist >= range) return;
      const alpha = 1 - dist / range;
      const sx = hint.x - this.camera.x;
      if (sx < -160 || sx > this.width + 160) return;
      const y = 96;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';

      // Soft rounded backdrop sized to the title
      ctx.font = '700 20px "Fredoka", "Outfit", sans-serif';
      const tw = ctx.measureText(hint.title).width;
      const w = Math.max(180, tw + 44), h = hint.sub ? 56 : 40;
      const bx = sx - w / 2, by = y - 26, r = 14;
      ctx.fillStyle = 'rgba(20, 24, 40, 0.5)';
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + w, by, bx + w, by + h, r);
      ctx.arcTo(bx + w, by + h, bx, by + h, r);
      ctx.arcTo(bx, by + h, bx, by, r);
      ctx.arcTo(bx, by, bx + w, by, r);
      ctx.closePath();
      ctx.fill();

      // Title
      ctx.fillStyle = '#ffffff';
      ctx.fillText(hint.title, sx, y - 2);
      // Sub-hint
      if (hint.sub) {
        ctx.font = '500 12px "Outfit", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(hint.sub, sx, y + 18);
      }
      ctx.restore();
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

    // Draw Ground Path (over-filled wide + down so the zoomed-out view has no gaps)
    const currentGroundColor = this.levels[this.getLevelIndexAtX(this.player.x)].groundColor || "#47752b";
    this.ctx.fillStyle = currentGroundColor;
    this.ctx.fillRect(-this.width, this.height - 80, this.width * 3, 240);

    // Ground detail line
    this.ctx.fillStyle = 'rgba(0,0,0,0.08)';
    this.ctx.fillRect(-this.width, this.height - 80, this.width * 3, 6);

    // Background wildlife (mallards bobbing on little ponds — non-interactive)
    this.drawMallards(camX);

    // Decorative fruit trees (behind hurdles/characters, on the ground)
    this.drawFruitTrees(camX);

    // Ground-hopping crows (pecking along the path — non-interactive)
    this.drawCrows(camX, 'hop');

    // Farm animals (chicks, cows, horses, owls — non-interactive)
    this.drawFarmAnimals(camX);

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

    // Draw the final boss
    if (this.boss && this.boss.alive) {
      this.drawBoss(this.boss.x - camX, this.boss.y, this.boss);
    }

    // Draw projectiles (family cooperative projectiles)
    this.projectiles.forEach(p => {
      const rx = p.x - camX;
      if (rx > -30 && rx < this.width + 30) {
        if (p.type === 'soccer_ball') {
          Assets.drawSoccerBall(this.ctx, rx, p.y, p.spin);
        } else if (p.type === 'volleyball') {
          Assets.drawVolleyball(this.ctx, rx, p.y, p.dir, p.spin);
        } else if (p.type === 'nunchucks') {
          Assets.drawNunchucks(this.ctx, rx, p.y, p.dir, p.spin);
        } else if (p.type === 'apple') {
          Assets.drawApple(this.ctx, rx, p.y, p.dir, p.spin);
        } else if (p.type === 'avocado') {
          Assets.drawAvocado(this.ctx, rx, p.y, p.dir, p.spin);
        } else if (p.type === 'dog_treat') {
          Assets.drawDogTreat(this.ctx, rx, p.y, p.dir, p.spin);
        } else {
          Assets.drawBullet(this.ctx, rx, p.y, p.dir, p.spin);
        }
      }
    });

    // Draw enemy projectiles (returned ones render as her glowing tennis ball)
    this.enemyProjectiles.forEach(p => {
      const rx = p.x - camX;
      if (rx > -30 && rx < this.width + 30) {
        if (p.friendly) {
          Assets.drawBullet(this.ctx, rx, p.y, Math.sign(p.vx) || 1, (p.frame || 0) * 0.3);
        } else if (p.kind === 'lightning') {
          Assets.drawLightningBolt(this.ctx, rx, p.y, Math.atan2(p.vy, p.vx), p.frame || 0);
        } else {
          Assets.drawEnemyBullet(this.ctx, rx, p.y, p.kind, p.frame);
        }
      }
    });

    // Draw defeat puffs
    this.poofs.forEach(pf => {
      const rx = pf.x - camX;
      if (rx > -40 && rx < this.width + 40) {
        Assets.drawPoof(this.ctx, rx, pf.y, pf.progress);
      }
    });

    // Draw active companion entities (replaced by the soccer line in the gauntlet)
    const lvlIdx = this.getLevelIndexAtX(this.player.x);
    const soccerForm = this.soccerFormationActive();
    if (!soccerForm) this.companions.forEach(comp => {
      const rx = comp.x - camX;
      if (rx > -60 && rx < this.width + 60) {
        let drawY = comp.y;
        const hopVal = this.hopTimers ? this.hopTimers[comp.type] : 0;
        if (hopVal > 0) {
          const progress = hopVal / 15;
          const hopHeight = 24 * Math.sin(progress * Math.PI);
          drawY -= hopHeight;
        }

        if (comp.type === 'dog') {
          Assets.drawDog(this.ctx, rx, drawY, comp.frame, comp.dir);
        } else if (comp.type === 'husband') {
          Assets.drawHusband(this.ctx, rx, drawY, comp.outfit, comp.frame, comp.dir);
        } else {
          // kids (baby stroller, kid1, kid2)
          Assets.drawKid(this.ctx, rx, drawY, comp.type, comp.frame, comp.dir, lvlIdx);
        }
      }
    });

    // Draw Ellen (skipped during the soccer line, which draws the whole family)
    const pX = this.player.x - camX;
    const blink = this.player.invuln > 0 && Math.floor(this.player.invuln / 4) % 2 === 0;
    if (!soccerForm && !blink) {
      const attacking = this.player.attackTimer > 0;
      const isKarate = this.player.attackType === 'karate';
      const shouting = attacking && isKarate;

      Assets.drawEllen(
        this.ctx,
        pX,
        this.player.y,
        this.player.outfit,
        this.player.animFrame,
        this.player.dir,
        1,
        shouting // open her mouth mid karate chop
      );

      // Racket held in hand (hidden while the soccer ball is equipped)
      if (this.player.weapon && !this.soccerActive()) {
        const swing = attacking
          ? 1 - this.player.attackTimer / (this.player.attackMax || this.combat.swingDuration)
          : 0;
        const moving = Math.abs(this.player.vx) > 0.5;
        Assets.drawHeldWeapon(this.ctx, pX, this.player.y, this.player.weapon, this.player.dir, swing, this.player.animFrame, moving);
      }

      // Attack effect: racket slash arc, or a karate chop (not while kicking)
      if (attacking && !this.soccerActive()) {
        const prog = 1 - this.player.attackTimer / (this.player.attackMax || this.combat.swingDuration);
        if (isKarate) {
          Assets.drawKarateChop(this.ctx, pX + this.player.dir * 12, this.player.y - 32, this.player.dir, prog);
        } else if (this.player.weapon === 'racket') {
          Assets.drawSlash(this.ctx, pX + this.player.dir * 14, this.player.y - 30, this.player.dir, prog);
        }
      }

      // "Aya!" speech bubble while shouting
      if (this.shout && this.shout.timer > 0) {
        Assets.drawSpeechBubble(this.ctx, pX + this.player.dir * 10, this.player.y - 80, this.shout.text);
      }
    }

    // Draw Player 2 (Barney, or Preston once he's walking) in co-op — an
    // independent body with its own karate chop. (Soccer split handled separately.)
    if (this.player2.active && !this.player2.isDead && !soccerForm) {
      const b = this.player2;
      const p2blink = b.invuln > 0 && Math.floor(b.invuln / 4) % 2 === 0;
      if (!p2blink) {
        const b2x = b.x - camX;
        if (b2x > -60 && b2x < this.width + 60) {
          const shouting2 = b.attackTimer > 0; // open mouth mid karate chop
          if (b.role === 'kid1') {
            Assets.drawKid(this.ctx, b2x, b.y, 'kid1', b.animFrame, b.dir, lvlIdx, shouting2);
          } else {
            Assets.drawHusband(this.ctx, b2x, b.y, this.getHusbandOutfit(lvlIdx), b.animFrame, b.dir, 1, shouting2);
          }
          if (b.attackTimer > 0) {
            const prog2 = 1 - b.attackTimer / (b.attackMax || this.combat.karateDuration);
            Assets.drawKarateChop(this.ctx, b2x + b.dir * 24, b.y - 24, b.dir, prog2);
          }
          // "Aya!" speech bubble while shouting
          if (this.shout2 && this.shout2.timer > 0) {
            Assets.drawSpeechBubble(this.ctx, b2x + b.dir * 10, b.y - 80, this.shout2.text);
          }
        }
      }
    }

    // Soccer: the gauntlet draws the whole family as a circular kicking line;
    // during the boss fight Ellen keeps normal control and just dribbles a ball.
    if (soccerForm) {
      this.drawSoccerLine(camX, lvlIdx, this.player, this.soccerQueue, this.soccerPos, this._soccerJog1);
      if (this.twoPlayer && this.soccerQueue2 && this.soccerQueue2.length) {
        this.drawSoccerLine(camX, lvlIdx, this.player2, this.soccerQueue2, this.soccerPos2, this._soccerJog2);
      }
    } else if (this.soccerActive()) {
      const bob = Math.abs(Math.sin(Date.now() * 0.012)) * 4;
      Assets.drawSoccerBall(this.ctx, pX + this.player.dir * 16, this.player.y - 6 - bob, Date.now() * 0.02);
    }

    // Wedding confetti rains over everything
    this.drawConfetti(camX);

    // The "play as Barney" pairing QR floating up into the sky
    this.drawSkyQr(camX);

    // HUD is drawn by the main loop (outside the zoom transform), not here.
  },

  // The circular kicking queue rendered as a physical line: the front member is
  // the kicker (with the dribble ball + a name marker). After a kick the queue
  // rotates and the ex-kicker jogs to the back while everyone shifts forward.
  // Draws one kicking line anchored to `lead` (player or player2), using its own
  // queue, position map and jog state — so co-op can render two independent lines.
  drawSoccerLine(camX, lvlIdx, lead, queue, pos, jog) {
    const q = queue;
    if (!q || !q.length || !pos) return;
    const groundY = this.height - 80;
    const dir = lead.dir;
    const spacing = 48;
    const frame = lead.animFrame;
    // Echo the lead's jump down the line (front follows it exactly, the rest
    // ripple a few frames behind — so jumping is visible again).
    const hist = lead.yHistory || [];
    // Flash the whole line while the lead is invulnerable after a hit.
    const blink = lead.invuln > 0 && Math.floor(lead.invuln / 4) % 2 === 0;
    if (jog && jog.t > 0) jog.t--;

    q.forEach((id, i) => {
      const targetX = lead.x - dir * i * spacing; // slot i; front (i=0) = lead's x
      if (pos[id] == null) pos[id] = targetX;
      pos[id] += (targetX - pos[id]) * 0.18;

      let drawY = groundY + (hist[Math.min(i * 3, hist.length - 1)] || 0);
      if (jog && id === jog.id && jog.t > 0) {
        drawY -= Math.sin((1 - jog.t / 22) * Math.PI) * 22; // jog-to-back arc
      }
      const hop = this.hopTimers ? this.hopTimers[id] : 0;
      if (hop > 0) drawY -= 22 * Math.sin((hop / 15) * Math.PI);

      const rx = pos[id] - camX;
      if (rx < -70 || rx > this.width + 70) return;
      if (blink) return; // flash out this frame while invulnerable
      if (id === 'player') {
        Assets.drawEllen(this.ctx, rx, drawY, this.player.outfit, frame, dir, 1, false);
      } else if (id === 'husband') {
        Assets.drawHusband(this.ctx, rx, drawY, this.getHusbandOutfit(lvlIdx), frame, dir);
      } else if (id === 'dog') {
        Assets.drawDog(this.ctx, rx, drawY, frame, dir);
      } else {
        Assets.drawKid(this.ctx, rx, drawY, id, frame, dir, lvlIdx);
      }
    });

    // Dribble ball + name marker on the front kicker (also blinks while hit)
    const front = q[0];
    const fx = pos[front];
    if (fx != null && !blink) {
      const frontY = groundY + (hist[0] || 0); // follow the jump
      const bob = Math.abs(Math.sin(Date.now() * 0.012)) * 4;
      Assets.drawSoccerBall(this.ctx, fx - camX + dir * 16, frontY - 6 - bob, Date.now() * 0.02);
      const name = { player: 'Ellen', husband: 'Barney', kid1: 'Preston', kid2: 'Blaire', dog: 'Mochi' }[front] || '';
      const sx = fx - camX;
      this.ctx.save();
      this.ctx.globalAlpha = 0.85;
      this.ctx.textAlign = 'center';
      this.ctx.font = '700 11px Outfit';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText('⚽ ' + name, sx, frontY - 96);
      this.ctx.fillText('▾', sx, frontY - 86);
      this.ctx.restore();
    }
  },

  // A bank of storm clouds shrouding Mt. Fuji. `alpha` fades 1 -> 0 as the
  // reveal plays out after the boss is beaten, parting the clouds.
  drawFujiShroud(cx, alpha, now) {
    const ctx = this.ctx;
    const t = now * 0.00006;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);

    // Soft base wash covering the whole mountain footprint
    ctx.fillStyle = '#c3cbd9';
    ctx.beginPath();
    ctx.ellipse(cx, 215, 430, 215, 0, 0, Math.PI * 2);
    ctx.fill();

    // Layered drifting cloud puffs for a billowing storm look. As the reveal
    // plays, each layer also slides outward so the clouds visibly part.
    const part = (1 - alpha) * 90; // px the banks spread apart while clearing
    const blobs = [
      [-250, 60, 150, 80, '#aab4c6', -1],
      [-80, 30, 200, 105, '#d4dbe8', -1],
      [110, 55, 180, 95, '#bcc5d6', 1],
      [270, 80, 150, 82, '#a8b2c4', 1],
      [10, 130, 250, 120, '#dbe1ed', 0],
      [-180, 180, 190, 100, '#cad2e0', -1],
      [200, 185, 200, 105, '#c0c9da', 1],
      [-30, 235, 240, 110, '#d0d7e4', 0],
      [40, -10, 150, 70, '#b6c0d1', 0]
    ];
    blobs.forEach((b, i) => {
      const drift = Math.sin(t + i) * 16;
      ctx.fillStyle = b[4];
      ctx.beginPath();
      ctx.ellipse(cx + b[0] + drift + b[5] * part, 60 + b[1], b[2], b[3], 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  },

  // The Storm Guardian: a dark thundercloud oni hovering before Mt. Fuji
  drawBoss(cx, cy, b) {
    const ctx = this.ctx;
    const t = b.frame;
    const flash = b.hitFlash > 0;
    const r = b.w * 0.5;
    ctx.save();

    // Glowing storm aura — a single cheap radial-gradient halo instead of an
    // expensive per-puff shadowBlur (6× blur every frame was halving the FPS).
    const auraR = r * 2.1;
    const auraCol = flash ? '255,255,255' : '150,90,255';
    const aura = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, auraR);
    aura.addColorStop(0, `rgba(${auraCol},0.5)`);
    aura.addColorStop(1, `rgba(${auraCol},0)`);
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
    ctx.fill();

    // Cloud body: a cluster of dark puffs
    ctx.fillStyle = flash ? '#ffffff' : '#2a2440';
    const puffs = [[-0.32, -0.05, 0.42], [0.32, -0.05, 0.42], [0, -0.28, 0.46], [0, 0.12, 0.5], [-0.5, 0.12, 0.32], [0.5, 0.12, 0.32]];
    puffs.forEach(([ox, oy, pr]) => {
      ctx.beginPath();
      ctx.arc(cx + ox * b.w, cy + oy * b.w + Math.sin(t * 0.1 + ox) * 2, pr * r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Lighter inner highlight
    ctx.fillStyle = flash ? '#ffffff' : '#473a6e';
    ctx.beginPath();
    ctx.arc(cx, cy - 0.06 * b.w, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Angry glowing eyes
    const eyeColor = flash ? '#000' : '#ffe14d';
    const ey = cy - 0.02 * b.w;
    const ex = 0.18 * b.w;
    [-1, 1].forEach(s => {
      ctx.save();
      ctx.translate(cx + s * ex, ey);
      ctx.rotate(s * 0.3);
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.11 * b.w, 0.06 * b.w, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b22';
      ctx.beginPath();
      ctx.arc(s * 2, 0, 0.035 * b.w, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Jagged angry mouth
    ctx.strokeStyle = flash ? '#000' : '#ffe14d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const my = cy + 0.2 * b.w;
    ctx.moveTo(cx - 0.18 * b.w, my);
    ctx.lineTo(cx - 0.06 * b.w, my + 0.06 * b.w);
    ctx.lineTo(cx + 0.06 * b.w, my);
    ctx.lineTo(cx + 0.18 * b.w, my + 0.06 * b.w);
    ctx.stroke();

    // Crackling lightning bolts
    if (Math.floor(t * 0.2) % 5 === 0) {
      ctx.strokeStyle = 'rgba(180,220,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const lx = cx + (Math.random() - 0.5) * b.w;
      ctx.moveTo(lx, cy);
      ctx.lineTo(lx + 6, cy + 12);
      ctx.lineTo(lx - 4, cy + 20);
      ctx.lineTo(lx + 8, cy + 34);
      ctx.stroke();
    }
    ctx.restore();
  },

  drawHUD() {
    // (Heart collect-'em-all counter removed — hearts are now Zelda-style health.)

    // --- Health: a row of Zelda-style hearts, pinned to the very top-left ---
    const heartSize = 16, heartGap = 20, hRowX = 22, hRowY = 26;
    for (let i = 0; i < this.player.maxHealth; i++) {
      this.drawHeartIcon(hRowX + i * heartGap, hRowY, heartSize, i < this.player.health);
    }

    // --- Player 2 (Barney/Preston) health: right next to Ellen's, same row ---
    if (this.twoPlayer && this.player2.active) {
      const b = this.player2;
      const rowW1 = (this.player.maxHealth - 1) * heartGap + heartSize;
      const gx = hRowX + rowW1 + 26; // gap after Ellen's row
      // little divider between the two health bars
      this.ctx.fillStyle = 'rgba(255,255,255,0.35)';
      this.ctx.fillRect(gx - 14, hRowY - 7, 2, 15);
      for (let i = 0; i < b.maxHealth; i++) {
        this.drawHeartIcon(gx + i * heartGap, hRowY, heartSize, !b.isDead && i < b.health);
      }
      // name tag under Barney's hearts
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '600 10px Outfit';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(b.isDead ? 'Reviving…' : (b.role === 'kid1' ? 'Preston' : 'Barney'), gx, hRowY + 15);
    }

    // --- Weapon badge --- (just below the heart row, top-left)
    {
      const hbX = 18, hbY = 40;
      let wName = 'Racket';
      let wIcon = '🎾';
      let wWidth = 86;
      if (!this.player.weapon) {
        // Bare-hand karate (the starting move)
        wName = 'Karate';
        wIcon = '🥋';
        wWidth = 86;
      }
      if (this.soccerActive()) {
        wName = 'Family Soccer';
        wIcon = '⚽';
        wWidth = 120;
      }
      this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
      this.ctx.fillRect(hbX - 6, hbY + 14, wWidth, 22);
      this.ctx.font = '14px Outfit';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(wIcon, hbX - 2, hbY + 30);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '600 12px Outfit';
      this.ctx.fillText(wName, hbX + 20, hbY + 30);
    }

    // --- Boss health bar ---
    if (this.boss && this.boss.alive) {
      const bw = 360, bh = 16;
      const bx = this.width / 2 - bw / 2, by = this.height - 38;
      this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this.ctx.fillRect(bx - 6, by - 24, bw + 12, bh + 30);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '700 13px Outfit';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('⚡ Storm Guardian of Mt. Fuji', this.width / 2, by - 8);
      this.ctx.fillStyle = 'rgba(255,255,255,0.18)';
      this.ctx.fillRect(bx, by, bw, bh);
      const frac = Math.max(0, this.boss.hp / this.boss.maxHp);
      const grad = this.ctx.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#ff4d6d');
      grad.addColorStop(1, '#b14bff');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(bx, by, bw * frac, bh);
      this.ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      this.ctx.strokeRect(bx, by, bw, bh);
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

    // Rendering pipeline. The world is drawn under an optional zoom-out transform
    // (boss arena); the HUD is drawn afterwards so it stays full-size & crisp.
    const z = this.viewZoom || 1;
    const zooming = Math.abs(z - 1) > 0.001;
    if (zooming) {
      this.ctx.save();
      this.ctx.translate(this.width / 2, this.height); // anchor zoom at bottom-center
      this.ctx.scale(z, z);
      this.ctx.translate(-this.width / 2, -this.height);
    }
    this.drawBackground();
    this.drawForeground();
    if (zooming) this.ctx.restore();
    this.drawRain(); // screen-space storm overlay, on top of the world but under the HUD
    this.drawHUD();

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

      // Start button or Select button to toggle chapter menu (dev only)
      const btnStart = gp.buttons[9] ? gp.buttons[9].pressed : false;
      const btnSelect = gp.buttons[8] ? gp.buttons[8].pressed : false;
      if (DEV_MODE && (btnStart || btnSelect)) {
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

// --- Pause audio when the page is hidden / backgrounded ---------------------
// On the TV, hitting Back sends the app to the background; on mobile, switching
// apps or locking the screen hides the tab. In either case the synthesized
// music would otherwise keep playing. Suspending the AudioContext halts the
// audio thread immediately; we only resume if the player hasn't muted music.
(function () {
  function suspendAudio() {
    if (AudioEngine.ctx && AudioEngine.ctx.state === 'running') AudioEngine.ctx.suspend();
  }
  function resumeAudio() {
    if (AudioEngine.userMusicOn && AudioEngine.ctx && AudioEngine.ctx.state === 'suspended') {
      AudioEngine.ctx.resume();
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) suspendAudio(); else resumeAudio();
  });
  window.addEventListener('pagehide', suspendAudio);
  window.addEventListener('pageshow', resumeAudio);
})();
