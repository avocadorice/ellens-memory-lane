// AssemblyScript WebAssembly Module for Ellen's Great Adventure Physics & Collisions

// Player variables
export var player_x: f32 = 150.0;
export var player_y: f32 = 420.0; // height - 80
export var player_vx: f32 = 0.0;
export var player_vy: f32 = 0.0;
export var player_isGrounded: i32 = 1;
export var player_dir: i32 = 1;
export var player_animFrame: i32 = 0;

// Game constants
const game_height: f32 = 500.0;
const player_speed: f32 = 5.5;
const player_gravity: f32 = 0.7;
const player_jumpForce: f32 = -13.0;
const groundY: f32 = 420.0; // 500 - 80

// Initialize player position
export function initPlayer(x: f32, y: f32): void {
  player_x = x;
  player_y = y;
  player_vx = 0.0;
  player_vy = 0.0;
  player_isGrounded = 1;
  player_dir = 1;
  player_animFrame = 0;
}

// Update player physics
export function updatePlayerPhysics(walkLeft: i32, walkRight: i32, endX: f32): void {
  if (walkLeft) {
    player_vx = -player_speed;
    player_dir = -1;
    player_animFrame += 1;
  } else if (walkRight) {
    player_vx = player_speed;
    player_dir = 1;
    player_animFrame += 1;
  } else {
    player_vx *= 0.7; // friction
    if (Math.abs(player_vx) < 0.2) {
      player_vx = 0.0;
    }
  }

  // Apply gravity
  player_vy += player_gravity;
  player_y += player_vy;
  player_x += player_vx;

  // Ground collision
  if (player_y >= groundY) {
    player_y = groundY;
    player_vy = 0.0;
    player_isGrounded = 1;
  }

  // Map limits
  if (player_x < 40.0) {
    player_x = 40.0;
  }
  if (player_x > endX) {
    player_x = endX;
  }
}

// Player jump
export function playerJump(): i32 {
  if (player_isGrounded) {
    player_vy = player_jumpForce;
    player_isGrounded = 0;
    return 1; // played jump sfx
  }
  return 0; // didn't jump
}

// Check collision with a heart (distance < 28)
// Player center is offset: x-5, y-35
export function checkHeartCollision(hx: f32, hy: f32): i32 {
  const dx = (player_x - 5.0) - hx;
  const dy = (player_y - 35.0) - hy;
  const distSq = dx * dx + dy * dy;
  if (distSq < 28.0 * 28.0) {
    return 1; // Collision
  }
  return 0;
}

// Check collision with a hurdle
export function checkHurdleCollision(hx: f32, hy: f32): i32 {
  const px = player_x;
  const py = player_y;

  const hDist = Math.abs(px - hx);
  const vDist = py - hy;

  if (hDist < 25.0 && vDist > -25.0 && vDist < 5.0) {
    // Bounce back
    player_x -= f32(player_dir) * 12.0;
    player_vx = -f32(player_dir) * 3.0;
    return 1; // Collision occurred
  }
  return 0;
}

// --- FIREWORKS PARTICLE SYSTEM ---
class Particle {
  x: f32;
  y: f32;
  vx: f32;
  vy: f32;
  hue: f32;
  alpha: f32;
  decay: f32;
  active: i32;
}

const MAX_PARTICLES = 300;
const particles = new Array<Particle>(MAX_PARTICLES);

export function initParticles(): void {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = new Particle();
    p.x = 0.0;
    p.y = 0.0;
    p.vx = 0.0;
    p.vy = 0.0;
    p.hue = 0.0;
    p.alpha = 0.0;
    p.decay = 0.0;
    p.active = 0;
    particles[i] = p;
  }
}

export function spawnFireworkBurst(fx: f32, fy: f32, baseHue: f32): void {
  let spawned = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (particles[i].active == 0) {
      const angle = f32(Math.random() * Math.PI * 2.0);
      const speed = f32(Math.random() * 5.0 + 2.0);
      
      particles[i].x = fx;
      particles[i].y = fy;
      particles[i].vx = f32(Math.cos(angle) * speed);
      particles[i].vy = f32(Math.sin(angle) * speed);
      particles[i].hue = baseHue;
      particles[i].alpha = 1.0;
      particles[i].decay = f32(Math.random() * 0.015 + 0.01);
      particles[i].active = 1;
      
      spawned++;
      if (spawned >= 40) {
        break;
      }
    }
  }
}

export function updateFireworksWasm(): void {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (particles[i].active == 1) {
      particles[i].x += particles[i].vx;
      particles[i].y += particles[i].vy;
      particles[i].vy += 0.08; // gravity on sparks
      particles[i].alpha -= particles[i].decay;
      if (particles[i].alpha <= 0.0) {
        particles[i].active = 0;
      }
    }
  }
}

export function getParticleActive(idx: i32): i32 {
  if (idx < 0 || idx >= MAX_PARTICLES) return 0;
  return particles[idx].active;
}

export function getParticleX(idx: i32): f32 {
  if (idx < 0 || idx >= MAX_PARTICLES) return 0.0;
  return particles[idx].x;
}

export function getParticleY(idx: i32): f32 {
  if (idx < 0 || idx >= MAX_PARTICLES) return 0.0;
  return particles[idx].y;
}

export function getParticleHue(idx: i32): f32 {
  if (idx < 0 || idx >= MAX_PARTICLES) return 0.0;
  return particles[idx].hue;
}

export function getParticleAlpha(idx: i32): f32 {
  if (idx < 0 || idx >= MAX_PARTICLES) return 0.0;
  return particles[idx].alpha;
}
