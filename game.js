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
  bossArenaStart: 13320, // x where the fight begins (after RV camping, before Fuji)
  bossWallX: 13900,      // Ellen can roam the full arena up to here (just shy of Fuji)
  fujiRevealProgress: 0, // 0 = Mt. Fuji shrouded in storm clouds, 1 = fully revealed
  viewZoom: 1,           // <1 zooms the camera out (boss arena gets a wide cinematic view)

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
    this.banner = null;
    this.boss = null;
    this.bossActive = false;
    this.bossDefeated = false;
    this.fujiRevealProgress = 0;
    this.viewZoom = 1;
    this.allowSecretOnCollect = false;
    this.endingFocusIndex = 0;
    this.heartsCollected = 0;

    // Reset player combat loadout
    this.player.weapon = null;
    this.player.hasBalls = false;
    this.player.familyAttackActive = false;
    this.familyAttackIndex = 0;
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
  // the trampoline-gated / enemy-drop bonus hearts. Ellen starts with a
  // bare-hand karate chop (short reach); the racket (longer reach) is grabbed a
  // bit into the journey, and the tennis balls (arcing serve) just past the
  // Wedding milestone (the midpoint).
  setupCombat() {
    const groundY = this.height - 80;
    const trackEnd = this.levels[this.levels.length - 1].x + 400;
    const racketX = 3600; // a bit later — karate carries the first stretch
    const ballsX = 8250; // just past Wedding (x=8000)
    this.racketX = racketX;
    this.ballsX = ballsX;

    // Pickups: tennis racket, tennis balls, and family locket
    const locketX = this.bossArenaStart - 240;
    this.locketX = locketX;
    this.pickups.push({ x: racketX, y: groundY, kind: 'racket', collected: false, frame: 0 });
    this.pickups.push({ x: locketX, y: groundY, kind: 'locket', collected: false, frame: 0 });

    const nearMilestone = (x) => this.levels.some(l => Math.abs(x - l.x) < 110);
    const nearPickup = (x) => Math.abs(x - racketX) < 150 || Math.abs(x - ballsX) < 150 || Math.abs(x - locketX) < 150;

    // Don't let a random hurdle (e.g. the camping campfire art) sit on top of a
    // pickup like the Locket of Unity — clear any that overlap a pickup spot.
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
    let wx = 1750, wi = 0;
    while (wx < ballsX - 200) {
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

    // Flying enemies in the latter half — alternate normal height and very-high.
    // Normal ones are jump/racket reachable; the very-high ones float ABOVE melee
    // reach, so the only way to defeat them is to whack their projectiles back.
    // (No trampolines here — those are reserved for the high-heart pads.)
    let fx = ballsX + 340;
    while (fx < trackEnd - 200 && fx < this.bossArenaStart - 250) {
      if (!nearMilestone(fx)) {
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
          // High foes shoot more often so you always have a projectile to return
          shootTimer: 50 + Math.floor(Math.random() * (high ? 70 : 120))
        });
        fi++;
      }
      fx += 760 - 280 * progress(fx); // ~620 -> ~480 late
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

    // Trampoline-gated bonus hearts floating high above the path
    const highHeartXs = [];
    for (let x = racketX + 760; x < ballsX - 300; x += 1650) {
      if (!nearMilestone(x) && !nearPickup(x)) highHeartXs.push(x);
    }
    for (let x = ballsX + 1000; x < trackEnd - 300 && x < this.bossArenaStart - 250; x += 1650) {
      if (!nearMilestone(x)) highHeartXs.push(x);
    }
    highHeartXs.forEach((x, i) => {
      // Heart floats high AND off to one side of the pad, drifting back and
      // forth — she must trampoline-bounce then steer forward to grab it.
      const dir = (i % 2 === 0) ? 1 : -1;
      const heartBaseX = x + dir * 38;
      this.hearts.push({
        x: heartBaseX, y: 150, width: 16, height: 16, collected: false,
        spawned: true, fromEnemy: false, falling: false, section: this.getLevelIndexAtX(x),
        motion: {
          baseX: heartBaseX, baseY: 150,
          ampX: 28, ampY: 16,
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
    if (this.player.x >= (this.racketX || 3600)) {
      this.player.weapon = 'racket';
      this.pickups.forEach(p => { if (p.kind === 'racket') p.collected = true; });
    }
    // Family locket (all 5 join the attack) — grant + consume only past its spot
    if (this.locketX && this.player.x >= this.locketX) {
      this.player.familyAttackActive = true;
      this.pickups.forEach(p => { if (p.kind === 'locket') p.collected = true; });
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
    } else if (!walkLeft && !walkRight && this.airJumpDir) {
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

    // --- COMPANION TRAIL ENGINE ---
    // Handle Dog, Husband and Kids following Ellen in a chain
    this.updateCompanions(lvlIdx);

    // --- CAMERA SCROLL SYSTEM ---
    // During the boss fight the camera locks to frame the whole arena + mountain
    // and zooms out; otherwise it follows the player.
    const inBossFight = this.bossActive && !this.bossDefeated;
    const targetCamX = inBossFight ? 13150 : (this.player.x - this.width / 3);
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
    if (this.player.attackTimer > 0) return;    // mid-swing/chop

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

    // Late-game family co-op attack (from the Locket of Unity). The standalone
    // tennis-ball serve was removed — ranged offense now comes from whacking
    // enemy projectiles back at them with the racket.
    if (this.player.familyAttackActive) {
      this.fireFamilyAttack();
    }
  },

  fireFamilyAttack() {
    if (this.familyAttackIndex === undefined) {
      this.familyAttackIndex = 0;
    }
    const currentIdx = this.familyAttackIndex;
    this.familyAttackIndex = (this.familyAttackIndex + 1) % 5;

    const dir = this.player.dir;
    let spawnX = this.player.x;
    let spawnY = this.player.y - 36;
    let pType = 'tennis_ball';

    if (currentIdx === 0) {
      // Ellen (player)
      spawnX = this.player.x + dir * 20;
      spawnY = this.player.y - 36;
      pType = 'tennis_ball';
      AudioEngine.playShootSFX();
    } else {
      let compType = '';
      if (currentIdx === 1) {
        compType = 'husband';
        pType = 'volleyball';
      } else if (currentIdx === 2) {
        compType = 'kid1';
        pType = 'nunchucks';
      } else if (currentIdx === 3) {
        compType = 'kid2';
        pType = Math.random() < 0.5 ? 'apple' : 'avocado';
      } else if (currentIdx === 4) {
        compType = 'dog';
        pType = 'dog_treat';
      }

      const comp = this.companions.find(c => c.type === compType);
      if (comp) {
        spawnX = comp.x;
        spawnY = comp.y - 20;
        if (this.hopTimers) {
          this.hopTimers[compType] = 15;
        }
      } else {
        spawnX = this.player.x + dir * 20;
        spawnY = this.player.y - 36;
      }
      AudioEngine.playShootSFX();
    }

    this.projectiles.push({
      x: spawnX,
      y: spawnY,
      vx: dir * this.combat.ballSpeedX,
      vy: this.combat.ballSpeedY,
      spin: 0,
      bounced: false,
      dir,
      alive: true,
      type: pType
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

  // ============================================================
  // FINAL BOSS — the Storm Guardian of Mt. Fuji
  // ============================================================
  startBossFight() {
    this.bossActive = true;
    this.boss = {
      homeX: 13950, x: 13950,
      baseY: 170, y: 90,
      w: 120, h: 120,
      hp: 12, maxHp: 12,
      alive: true, dir: -1, frame: 0,
      hitFlash: 0, lastSwingHit: -1,
      shootTimer: 110,
      swoopTimer: 240, swooping: false, swoopProg: 0,
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

    // Gets faster + meaner once it's below half health
    const enraged = b.hp <= b.maxHp / 2;

    // Arena bounds the boss zips across (full width, in front of the mountain)
    const arenaL = this.bossArenaStart + 30;   // ~13350
    const arenaR = this.bossWallX + 260;        // ~14160

    // Default: brisk full-width left<->right sweep + a vertical weave that uses
    // the upper sky.
    const sweepSpeed = enraged ? 0.020 : 0.014;
    let targetX = arenaL + (0.5 + 0.5 * Math.sin(b.frame * sweepSpeed)) * (arenaR - arenaL);
    let targetY = b.baseY + Math.sin(b.frame * 0.05) * 95; // ~75..265

    // Evasion: if Ellen is near or mid-swing, bolt the other way and climb high
    const pdx = this.player.x - b.x;
    if (b.introT <= 0 && (this.player.attackTimer > 0 || Math.abs(pdx) < 175)) {
      targetX = b.x - (pdx >= 0 ? 1 : -1) * 250;
      targetY = 90 + Math.sin(b.frame * 0.12) * 25; // dodge upward
    }

    // Periodic committed dive-bomb (telegraphed window to hit it)
    if (!b.swooping) {
      b.swoopTimer--;
      if (b.swoopTimer <= 0 && b.introT <= 0) { b.swooping = true; b.swoopProg = 0; }
    }
    if (b.swooping) {
      b.swoopProg += enraged ? 0.03 : 0.022;
      const dive = Math.sin(Math.min(1, b.swoopProg) * Math.PI); // 0 -> 1 -> 0
      targetX = b.x + (this.player.x - b.x) * dive * 0.6;
      targetY = b.baseY + dive * 150;
      if (b.swoopProg >= 1) { b.swooping = false; b.swoopTimer = enraged ? 160 : 240; }
    }

    targetX = Math.max(arenaL, Math.min(arenaR, targetX));
    targetY = Math.max(70, Math.min(330, targetY));

    // High agility — very responsive (snappy dodges)
    const agility = enraged ? 0.17 : 0.13;
    b.x += (targetX - b.x) * agility;
    b.y += (targetY - b.y) * agility;
    b.dir = (this.player.x < b.x) ? -1 : 1;

    // Ranged attack: aimed projectile spread
    if (b.introT <= 0) {
      b.shootTimer--;
      if (b.shootTimer <= 0) {
        this.bossShoot(enraged);
        b.shootTimer = enraged ? 80 : 120; // Slower shoot rate to dodge easier
      }
    }

    // Contact damage (smaller hitbox radius to feel more fair)
    const playerMidY = this.player.y - 28;
    if (Math.abs(b.x - this.player.x) < b.w * 0.35 && Math.abs(b.y - playerMidY) < b.h * 0.35) {
      this.damagePlayer();
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

  hitBoss(dmg) {
    const b = this.boss;
    if (!b || !b.alive) return;
    if (DEV_MODE) {
      dmg = 100; // One-shot boss in local development/dev mode
    }
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
    if (this.shout && this.shout.timer > 0) this.shout.timer--;
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
            text: '🎾 Tennis racket! Longer reach than your karate chop — swing at the monsters'
          };
        } else if (pk.kind === 'locket') {
          this.player.familyAttackActive = true;
          AudioEngine.playWinSFX();
          this.banner = {
            timer: 300,
            text: '💖 Locket of Unity! The family joins the fight with custom alternate attacks! 👨‍👩‍👧‍👦'
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

    // --- Melee can also hit the boss when it dives low enough ---
    if (this.player.attackTimer > 0 &&
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
    if (this.player.attackTimer > 0) {
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

    // --- Racket projectile return (timing-based) ---
    // Connect with an incoming shot during the racket's SWEET SPOT for an
    // accurate return that homes toward the foe. Mistime the swing and the shot
    // just clanks off at a bad angle and sails wide.
    if (usingRacket && this.player.attackTimer > 0) {
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
    this.currentLevelIndex = lvlIndex;

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
    const lineH = 25, headerH = 22, gap = 10, padTop = 16, padBot = 20, dotsH = 14;
    const boxH = padTop + headerH + gap + bodyLines.length * lineH + dotsH + padBot;
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

    // Header: memory name • year
    let y = by + padTop + 8;
    ctx.font = '700 15px "Fredoka", "Outfit", sans-serif';
    ctx.fillStyle = '#ffd1dc';
    ctx.fillText(`${active.name}  •  ${active.year}`, cx, y);
    y += headerH + gap;

    // Body line
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
    if (this.player.x > 1450) return; // all hints are near the start; skip later

    const ctx = this.ctx;
    const range = 230; // px window over which a hint fades in/out
    this.tutorialHints.forEach(hint => {
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
        if (p.type === 'volleyball') {
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

    // Draw active companion entities
    const lvlIdx = this.getLevelIndexAtX(this.player.x);
    this.companions.forEach(comp => {
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

    // Draw Ellen (blinks while invulnerable just after taking a hit)
    const pX = this.player.x - camX;
    const blink = this.player.invuln > 0 && Math.floor(this.player.invuln / 4) % 2 === 0;
    if (!blink) {
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

      // Racket held in hand (sways with her stride, swings on attack)
      if (this.player.weapon) {
        const swing = attacking
          ? 1 - this.player.attackTimer / (this.player.attackMax || this.combat.swingDuration)
          : 0;
        const moving = Math.abs(this.player.vx) > 0.5;
        Assets.drawHeldWeapon(this.ctx, pX, this.player.y, this.player.weapon, this.player.dir, swing, this.player.animFrame, moving);
      }

      // Attack effect: racket slash arc, or a karate chop
      if (attacking) {
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
    // HUD is drawn by the main loop (outside the zoom transform), not here.
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

    // Glowing storm aura
    ctx.shadowColor = flash ? '#ffffff' : 'rgba(150,90,255,0.85)';
    ctx.shadowBlur = 26;

    // Cloud body: a cluster of dark puffs
    ctx.fillStyle = flash ? '#ffffff' : '#2a2440';
    const puffs = [[-0.32, -0.05, 0.42], [0.32, -0.05, 0.42], [0, -0.28, 0.46], [0, 0.12, 0.5], [-0.5, 0.12, 0.32], [0.5, 0.12, 0.32]];
    puffs.forEach(([ox, oy, pr]) => {
      ctx.beginPath();
      ctx.arc(cx + ox * b.w, cy + oy * b.w + Math.sin(t * 0.1 + ox) * 2, pr * r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

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
    {
      let wName = 'Racket';
      let wIcon = '🎾';
      let wWidth = 86;
      if (!this.player.weapon) {
        // Bare-hand karate (the starting move)
        wName = 'Karate';
        wIcon = '🥋';
        wWidth = 86;
      }
      if (this.player.familyAttackActive) {
        wName = 'Family Unity 👨‍👩‍👧‍👦';
        wIcon = '💖';
        wWidth = 145;
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
