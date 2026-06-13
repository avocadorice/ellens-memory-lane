// Core Game Engine for Ellen's Great Adventure

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
          chord.forEach(noteName => {
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
    gain.connect(this.ctx.destination);

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

    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

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
    osc.frequency.setValueAtTime(783.99, time + 0.08); // G5

    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.22);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

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
      
      gain.gain.setValueAtTime(0.12, time + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.005, time + idx * 0.07 + 0.35);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(time + idx * 0.07);
      osc.stop(time + idx * 0.07 + 0.45);
    });
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
    outfit: 'graduation', // 'graduation', 'wedding', 'casual', 'hiking'
    animFrame: 0,
    dir: 1
  },

  // Level data reference
  levels: levelsData,
  
  // Entities
  hearts: [],
  hurdles: [],
  parallaxLayers: [],
  companions: [], // Trailing list of entities (husband, dog, stroller, etc.)
  
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
    
    // Handle High DPI (cap at 1.25 on TVs/4K displays to avoid rendering lag)
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
  },

  setupWorld() {
    this.hearts = [];
    this.hurdles = [];
    this.companions = [];
    this.heartsCollected = 0;

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
        this.hearts.push({
          x: x,
          y: this.height - 130 - Math.random() * 60,
          width: 16,
          height: 16,
          collected: false
        });

        // Chance of obstacle hurdle below it
        if (Math.random() > 0.4) {
          // Identify corresponding level ID for asset drawing
          const activeLvl = this.getLevelIndexAtX(x) + 1;
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

    this.totalHearts = this.hearts.length;
    this.updateHeartsUI();
  },

  preloadPhotos() {
    this.levels.forEach(lvl => {
      if (lvl.photo) {
        const img = new Image();
        img.src = lvl.photo;
        img.onerror = () => {
          console.log(`Placeholder photo for ${lvl.name} not found, using procedural sketch instead.`);
        };
        lvl.imgElement = img;
      }
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
    if (lvlIndex === 0) {
      this.player.outfit = 'graduation';
    } else if (lvlIndex === 3) {
      this.player.outfit = 'wedding';
    } else if (lvlIndex >= 4 && lvlIndex <= 7) {
      this.player.outfit = 'casual';
    } else if (lvlIndex >= 8) {
      this.player.outfit = 'hiking';
    }
    
    this.updateCompanions(lvlIndex);

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

      // Ending Screen enter/space trigger
      if (endingScreen && endingScreen.classList.contains('active')) {
        if (code === 'Enter' || code === 'Space') {
          document.getElementById('replay-btn').click();
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
      this.updateDevPanel();
      this.canvas.focus();
    });

    // Dev Panel clear cache
    document.getElementById('dev-clear-cache-btn').addEventListener('click', () => {
      Assets.clearCache();
      this.updateDevPanel();
      this.canvas.focus();
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
    this.isRunning = true;
    this.canvas.focus();
    this.loop();
  },

  resetGame() {
    if (wasmExports) {
      wasmExports.initPlayer(150, this.height - 80);
      this.player.x = wasmExports.player_x.value;
      this.player.y = wasmExports.player_y.value;
      this.player.vx = wasmExports.player_vx.value;
      this.player.vy = wasmExports.player_vy.value;
      this.player.isGrounded = wasmExports.player_isGrounded.value !== 0;
      this.player.dir = wasmExports.player_dir.value;
      this.player.animFrame = wasmExports.player_animFrame.value;
      this.player.outfit = 'graduation';
    } else {
      this.player.x = 150;
      this.player.y = this.height - 80;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.outfit = 'graduation';
    }
    this.camera.x = 0;
    this.currentLevelIndex = 0;
    this.isPaused = false;
    this.isRunning = true;
    this.isQuizCompleted = false;

    this.setupWorld();
    this.loop();
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
    if (lvlIdx === 0) {
      this.player.outfit = 'graduation';
    } else if (lvlIdx === 3) {
      this.player.outfit = 'wedding';
    } else if (lvlIdx >= 4 && lvlIdx <= 7) {
      this.player.outfit = 'casual';
    } else if (lvlIdx >= 8) {
      this.player.outfit = 'hiking';
    }

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
      if (!heart.collected) {
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
  },

  updateCompanions(lvlIdx) {
    this.companions = [];
    const frame = this.player.animFrame;
    const speed = Math.abs(this.player.vx);
    const isMoving = speed > 0.5;

    // 1. Dog joins at Level 2+
    if (lvlIdx >= 1) {
      this.companions.push({
        type: 'dog',
        x: this.player.x - 55 * this.player.dir,
        y: this.height - 80,
        outfit: 'casual',
        frame: frame,
        dir: this.player.dir
      });
    }

    // 2. Husband joins at Level 4+ (Wedding)
    if (lvlIdx >= 3) {
      let husbandOutfit = 'casual';
      if (lvlIdx === 3) husbandOutfit = 'tuxedo';
      if (lvlIdx >= 8) husbandOutfit = 'hiking';

      this.companions.push({
        type: 'husband',
        x: this.player.x - 30 * this.player.dir,
        y: this.height - 80,
        outfit: husbandOutfit,
        frame: frame,
        dir: this.player.dir
      });
    }

    // 3. Child 1 joins at Level 6 (Baby stroller) or Level 7+ (Toddler walking)
    if (lvlIdx >= 5) {
      let kidType = 'baby_stroller';
      let offset = 85;
      if (lvlIdx >= 6) {
        kidType = 'kid1';
        offset = 90;
      }

      this.companions.push({
        type: kidType,
        x: this.player.x - offset * this.player.dir,
        y: this.height - 80,
        outfit: 'casual',
        frame: frame,
        dir: this.player.dir
      });
    }

    // 4. Child 2 (Blaire) joins at Level 8+ (making family of 4)
    if (lvlIdx >= 7) {
      let kid2Type = 'baby_crawling'; // crawling baby in Level 8 (lvlIdx == 7)
      let offset = 115;
      
      if (lvlIdx >= 8) {
        kid2Type = 'kid2'; // walking toddler in Level 9 & 10 (lvlIdx >= 8)
        offset = 120;
      }

      this.companions.push({
        type: kid2Type,
        x: this.player.x - offset * this.player.dir,
        y: this.height - 80,
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
    this.isPaused = true;
    this.isRunning = false;

    if (wasmExports) {
      wasmExports.initParticles();
    }
    this.fireworks = [];

    // Win sound chime
    AudioEngine.playWinSFX();

    // Show ending UI overlay after a short delay
    setTimeout(() => {
      document.getElementById('ending-screen').classList.add('active');
    }, 1500);
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

    // Dynamic Stars / Sun/Moon depending on levels (e.g. Levels 7, 8, 9 are night)
    const lvlIdx = this.getLevelIndexAtX(this.player.x);
    if (lvlIdx >= 7 && lvlIdx <= 8) {
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
      this.ctx.fillStyle = lvlIdx >= 7 ? '#0b1626' : (lvlIdx >= 4 ? '#2b442b' : '#32531d');
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
      this.ctx.fillStyle = lvlIdx >= 7 ? '#122538' : (lvlIdx >= 4 ? '#385838' : '#47752b');
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
    const state = lvlIdx >= 7 ? 2 : (lvlIdx >= 4 ? 1 : 0);
    
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

    // Draw hearts collectibles
    this.hearts.forEach(heart => {
      if (!heart.collected) {
        const rx = heart.x - camX;
        if (rx > -50 && rx < this.width + 50) {
          Assets.drawHeart(this.ctx, rx, heart.y, this.player.animFrame);
        }
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

    // Draw Ellen
    const pX = this.player.x - camX;
    Assets.drawEllen(
      this.ctx,
      pX,
      this.player.y,
      this.player.outfit,
      this.player.animFrame,
      this.player.dir
    );

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
    const lvl = this.levels[this.getLevelIndexAtX(this.player.x)];
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.fillRect(this.width / 2 - 60, 20, 120, 30);
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    this.ctx.strokeRect(this.width / 2 - 60, 20, 120, 30);

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '600 15px Outfit';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(lvl.year, this.width / 2, 41);
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

  loop() {
    if (!this.isRunning) return;

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

      const btnA = gp.buttons[0] ? gp.buttons[0].pressed : false;
      const dpadUp = gp.buttons[12] ? gp.buttons[12].pressed : false;
      
      if (btnA || dpadUp) {
        if (this.isRunning && !this.isPaused) {
          this.jump();
        } else if (this.isPaused && this.activeDialog) {
          if (!this.gamepadBtnAPressed) {
            this.advanceDialogue();
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
