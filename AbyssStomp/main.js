import { Cube } from './cube.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const comboEl = document.getElementById('combo');
const bannerEl = document.getElementById('banner');

// --- World / constants ---
const GRAVITY = 2400; // px/s^2
const CUBE_RESTITUTION = 0.45;
const CUBE_FRICTION = 0.55;
const STOMP_IMPULSE = 1500; // downward velocity on stomp
const KICK_RANGE = 120; // horizontal reach of a stomp
const KICK_FORCE = 950; // outward push on neighbors
const JUMP_VELOCITY = 900;
const WALK_SPEED = 460;
const SPAWN_INTERVAL = 900; // ms
const ABYSS_Y_MARGIN = 200; // how far below platform a cube must fall to score
const MAX_CUBES = 14;

let W = 0;
let H = 0;
let platform = { x: 0, y: 0, w: 0, h: 40 };
let cubes = [];
let particles = [];
let floaters = []; // score popups
let score = 0;
let combo = 0;
let comboTimer = 0;
let shake = 0;
let time = 0;
let lastSpawn = 0;
let running = false;

const papi = {
  x: 0,
  y: 0,
  w: 34,
  h: 46,
  vx: 0,
  vy: 0,
  onGround: false,
  facing: 1,
  walkPhase: 0,
};

// --- Input state ---
const input = { left: false, right: false, jump: false };
let pointerX = 0;
let pointerY = 0;

// --- Setup / resize ---
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  platform.w = Math.min(W * 0.6, 720);
  platform.x = (W - platform.w) / 2;
  platform.y = H * 0.62;

  // Keep Papi on the platform after resize.
  papi.y = platform.y - papi.h;
  papi.x = Math.max(platform.x, Math.min(platform.x + platform.w - papi.w, papi.x));
}

window.addEventListener('resize', resize);

// --- Spawning ---
function spawnCube() {
  if (cubes.length >= MAX_CUBES) return;
  const size = 40 + Math.random() * 40;
  const margin = size / 2 + 6;
  const x = platform.x + margin + Math.random() * (platform.w - margin * 2);
  const y = platform.y - size / 2;
  const hue = 190 + Math.random() * 160; // blue->purple->pink range
  cubes.push(new Cube(x, y, size, hue));
  // A little spawn dust.
  for (let i = 0; i < 6; i++) {
    particles.push(makeParticle(x, platform.y, 1, 'dust'));
  }
}

function makeParticle(x, y, power, kind) {
  const angle = Math.random() * Math.PI * 2;
  const speed = (60 + Math.random() * 220) * power;
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - (kind === 'dust' ? 120 : 40),
    life: 1,
    decay: 1.2 + Math.random() * 1.2,
    size: 2 + Math.random() * 4,
    hue: kind === 'dust' ? 220 : 40 + Math.random() * 30,
  };
}

function burst(x, y, power, hue) {
  const n = Math.floor(10 + power * 14);
  for (let i = 0; i < n; i++) {
    const p = makeParticle(x, y, power, 'spark');
    p.hue = hue;
    particles.push(p);
  }
}

function addFloater(x, y, text, hue) {
  floaters.push({ x, y, text, hue, life: 1 });
}

// --- Physics ---
function resolveCubePlatform(c) {
  // Only interact when horizontally overlapping the platform.
  if (c.right < platform.x || c.left > platform.x + platform.w) return false;
  // Landing on top surface.
  if (c.vy >= 0 && c.bottom >= platform.y && c.bottom - c.vy * lastDt <= platform.y + 1) {
    c.y = platform.y - c.half;
    if (c.vy > 200) {
      c.squash = Math.min(1, c.vy / 1600);
    }
    c.vy = -c.vy * CUBE_RESTITUTION;
    if (Math.abs(c.vy) < 60) c.vy = 0;
    c.vx *= 1 - CUBE_FRICTION * 0.1;
    return true;
  }
  // Side walls of the platform (cube falling past the edge onto the side).
  if (c.vy >= 0) {
    if (c.right >= platform.x && c.left <= platform.x && c.bottom > platform.y + 4) {
      c.x = platform.x - c.half;
      c.vx = -Math.abs(c.vx) * CUBE_RESTITUTION;
    } else if (c.left <= platform.x + platform.w && c.right >= platform.x + platform.w && c.bottom > platform.y + 4) {
      c.x = platform.x + platform.w + c.half;
      c.vx = Math.abs(c.vx) * CUBE_RESTITUTION;
    }
  }
  return false;
}

function resolveCubeCube(a, b) {
  const overlapX = a.half + b.half - Math.abs(a.x - b.x);
  const overlapY = a.half + b.half - Math.abs(a.y - b.y);
  if (overlapX <= 0 || overlapY <= 0) return;

  // Positional correction along the axis of least penetration.
  if (overlapX < overlapY) {
    const dir = a.x < b.x ? -1 : 1;
    a.x += (dir * overlapX) / 2;
    b.x -= (dir * overlapX) / 2;
    // Exchange x-velocity with restitution.
    const va = a.vx;
    const vb = b.vx;
    a.vx = vb * CUBE_RESTITUTION * 0.5 + a.vx * (1 - CUBE_RESTITUTION);
    b.vx = va * CUBE_RESTITUTION * 0.5 + b.vx * (1 - CUBE_RESTITUTION);
    a.vx += dir * KICK_FORCE * 0.06;
    b.vx -= dir * KICK_FORCE * 0.06;
    a.vr += dir * 0.02;
    b.vr -= dir * 0.02;
  } else {
    const dir = a.y < b.y ? -1 : 1;
    a.y += (dir * overlapY) / 2;
    b.y -= (dir * overlapY) / 2;
    const va = a.vy;
    const vb = b.vy;
    a.vy = vb * CUBE_RESTITUTION * 0.5 + a.vy * (1 - CUBE_RESTITUTION);
    b.vy = va * CUBE_RESTITUTION * 0.5 + b.vy * (1 - CUBE_RESTITUTION);
    if (dir === -1) a.vy -= 40;
  }
}

function resolvePapiPlatform() {
  const over = papi.x + papi.w > platform.x && papi.x < platform.x + platform.w;
  if (over && papi.vy >= 0 && papi.y + papi.h >= platform.y && papi.y + papi.h - papi.vy * lastDt <= platform.y + 2) {
    papi.y = platform.y - papi.h;
    papi.vy = 0;
    papi.onGround = true;
  }
}

function resolvePapiCubes() {
  papi.onGround = false;
  for (const c of cubes) {
    if (c.dead) continue;
    const px = papi.x;
    const py = papi.y;
    const overlapX = papi.w / 2 + c.half - Math.abs(papi.x + papi.w / 2 - c.x);
    const overlapY = papi.h / 2 + c.half - Math.abs(papi.y + papi.h / 2 - c.y);
    if (overlapX <= 0 || overlapY <= 0) continue;

    // Stomp: Papi falling onto the cube from above.
    if (papi.vy > 0 && papi.y + papi.h / 2 < c.y) {
      // Land on top of cube.
      papi.y = c.y - c.half - papi.h / 2;
      papi.onGround = true;
      const impact = papi.vy;
      papi.vy = 0;
      if (impact > 250) {
        stompCube(c, impact);
      }
    } else if (overlapY < overlapX) {
      // Vertical bump from below or above while not stomping.
      const dir = papi.y < c.y ? -1 : 1;
      papi.y += (dir * overlapY) / 2;
      papi.vy = dir > 0 ? Math.abs(papi.vy) * 0.3 : 0;
    } else {
      // Horizontal push.
      const dir = papi.x + papi.w / 2 < c.x ? -1 : 1;
      papi.x += (dir * overlapX) / 2;
      c.x -= (dir * overlapX) / 2;
      c.vx -= dir * 60;
    }
  }
}

function stompCube(c, impact) {
  const power = Math.min(2, impact / 1200);
  c.vy = STOMP_IMPULSE * (0.6 + power * 0.6);
  c.kicked = true;
  c.vr = (Math.random() - 0.5) * 0.25;
  c.squash = 1;
  shake = Math.min(18, shake + 6 + power * 8);
  burst(c.x, c.bottom, power, c.hue);
  addFloater(c.x, c.y - c.half, 'STOMP!', c.hue);

  // Kick neighbors in range.
  for (const other of cubes) {
    if (other === c || other.dead) continue;
    const dx = other.x - c.x;
    if (Math.abs(dx) < KICK_RANGE && Math.abs(other.y - c.y) < c.half + other.half + 10) {
      const dir = dx < 0 ? -1 : 1;
      other.vx += dir * KICK_FORCE * (1 - Math.abs(dx) / KICK_RANGE);
      other.vy -= 220;
      other.kicked = true;
      other.vr += dir * 0.1;
    }
  }

  // Papi bounces up a bit for feel.
  papi.vy = -JUMP_VELOCITY * 0.35;
}

let lastDt = 1 / 60;

function update(dt) {
  lastDt = dt;
  time += dt;

  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }

  // Spawn
  if (running && time - lastSpawn > SPAWN_INTERVAL / 1000) {
    spawnCube();
    lastSpawn = time;
  }

  // Papi horizontal input
  const target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (target !== 0) {
    papi.vx += (target * WALK_SPEED - papi.vx) * Math.min(1, dt * 14);
    papi.facing = target;
    papi.walkPhase += dt * 12;
  } else {
    papi.vx *= Math.max(0, 1 - dt * 16);
  }
  papi.vy += GRAVITY * dt;
  papi.x += papi.vx * dt;
  papi.y += papi.vy * dt;

  // Keep Papi roughly above the platform region; allow running off into the abyss.
  // (No clamping: falling off is part of the fun, respawn if lost.)
  if (papi.y > H + 200) {
    papi.x = platform.x + platform.w / 2 - papi.w / 2;
    papi.y = platform.y - papi.h - 200;
    papi.vx = 0;
    papi.vy = 0;
    shake = Math.max(shake, 10);
    addFloater(papi.x + papi.w / 2, papi.y, 'OOF', 0);
  }

  resolvePapiPlatform();
  if (input.jump && papi.onGround) {
    papi.vy = -JUMP_VELOCITY;
    papi.onGround = false;
    for (let i = 0; i < 5; i++) particles.push(makeParticle(papi.x + papi.w / 2, papi.y + papi.h, 0.5, 'dust'));
  }

  // Cubes physics
  for (const c of cubes) {
    if (c.dead) continue;
    c.vy += GRAVITY * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vr * dt;
    c.vx *= Math.pow(0.995, dt * 60);
    c.vr *= Math.pow(0.98, dt * 60);
    c.squash *= Math.pow(0.86, dt * 60);
    resolveCubePlatform(c);
  }

  // Cube-cube collisions (a few iterations for stability).
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < cubes.length; i++) {
      for (let j = i + 1; j < cubes.length; j++) {
        if (cubes[i].dead || cubes[j].dead) continue;
        resolveCubeCube(cubes[i], cubes[j]);
      }
    }
  }

  resolvePapiCubes();

  // Scoring: cubes that fall past the abyss line.
  const abyssLine = platform.y + ABYSS_Y_MARGIN;
  for (const c of cubes) {
    if (!c.dead && c.top > abyssLine) {
      c.dead = true;
      combo += 1;
      comboTimer = 1.4;
      const base = Math.round(10 + (c.size - 40) * 0.4);
      const gained = base * combo;
      score += gained;
      shake = Math.min(24, shake + 5 + combo * 1.5);
      burst(c.x, abyssLine - 40, 0.8, c.hue);
      addFloater(c.x, abyssLine - 60, '+' + gained, 50);
      scoreEl.textContent = score.toLocaleString();
      updateCombo();
    }
  }
  cubes = cubes.filter((c) => !c.dead);

  // Particles
  for (const p of particles) {
    p.vy += GRAVITY * 0.35 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= p.decay * dt;
  }
  particles = particles.filter((p) => p.life > 0);

  // Floaters
  for (const f of floaters) {
    f.y -= 40 * dt;
    f.life -= dt * 0.9;
  }
  floaters = floaters.filter((f) => f.life > 0);

  // Shake decay
  shake *= Math.pow(0.82, dt * 60);
}

function updateCombo() {
  if (combo > 1) {
    comboEl.textContent = 'COMBO x' + combo;
  } else {
    comboEl.textContent = '';
  }
}

// --- Rendering ---
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0d1c');
  g.addColorStop(0.55, '#0a0a14');
  g.addColorStop(1, '#020208');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Starfield.
  ctx.save();
  for (let i = 0; i < 60; i++) {
    const sx = (i * 97.31) % W;
    const sy = ((i * 53.7 + time * 6) % (H + 40)) - 20;
    const r = (i % 3) * 0.5 + 0.5;
    ctx.globalAlpha = 0.25 + ((i * 13) % 10) / 18;
    ctx.fillStyle = '#9fb4ff';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Abyss glow at the bottom.
  const ag = ctx.createLinearGradient(0, H - 240, 0, H);
  ag.addColorStop(0, 'rgba(0,0,0,0)');
  ag.addColorStop(1, 'rgba(60, 20, 120, 0.35)');
  ctx.fillStyle = ag;
  ctx.fillRect(0, H - 240, W, 240);
}

function drawPlatform() {
  const { x, y, w, h } = platform;
  // Body.
  const g = ctx.createLinearGradient(0, y, 0, y + h + 30);
  g.addColorStop(0, '#2a2f45');
  g.addColorStop(1, '#12141f');
  ctx.fillStyle = g;
  roundRect(x, y, w, h, 8);
  ctx.fill();
  // Top edge highlight.
  ctx.fillStyle = 'rgba(150, 190, 255, 0.5)';
  roundRect(x, y, w, 4, 4);
  ctx.fill();
  // Under-glow.
  ctx.save();
  ctx.globalAlpha = 0.5;
  const ug = ctx.createLinearGradient(0, y + h, 0, y + h + 40);
  ug.addColorStop(0, 'rgba(90, 120, 255, 0.35)');
  ug.addColorStop(1, 'rgba(90, 120, 255, 0)');
  ctx.fillStyle = ug;
  ctx.fillRect(x - 10, y + h, w + 20, 40);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCube(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rot);
  const s = c.size;
  const squashY = 1 - c.squash * 0.28;
  const squashX = 1 + c.squash * 0.18;
  ctx.scale(squashX, squashY);

  // Shadow.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000';
  const shadowY = (platform.y - c.y) * 0.15 + s * 0.5;
  ctx.beginPath();
  ctx.ellipse(0, shadowY, s * 0.55, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Body with vertical gradient for faked lighting.
  const g = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
  g.addColorStop(0, `hsl(${c.hue}, 70%, 62%)`);
  g.addColorStop(1, `hsl(${c.hue}, 65%, 34%)`);
  ctx.fillStyle = g;
  roundRect(-s / 2, -s / 2, s, s, 6);
  ctx.fill();

  // Top face highlight.
  ctx.fillStyle = `hsla(${c.hue}, 90%, 80%, 0.35)`;
  roundRect(-s / 2 + 3, -s / 2 + 3, s - 6, s * 0.28, 4);
  ctx.fill();

  // Outline.
  ctx.strokeStyle = `hsla(${c.hue}, 80%, 75%, 0.5)`;
  ctx.lineWidth = 2;
  roundRect(-s / 2, -s / 2, s, s, 6);
  ctx.stroke();

  ctx.restore();
}

function drawPapi() {
  const cx = papi.x + papi.w / 2;
  const bob = papi.onGround && Math.abs(papi.vx) > 20 ? Math.sin(papi.walkPhase) * 2 : 0;
  const x = papi.x;
  const y = papi.y + bob;
  const w = papi.w;
  const h = papi.h;

  // Shadow.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  const shadowY = platform.y - (platform.y - (papi.y + papi.h)) * 0.15;
  ctx.ellipse(cx, Math.min(shadowY, platform.y) , w * 0.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Body.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#ff8a4c');
  g.addColorStop(1, '#e0552b');
  ctx.fillStyle = g;
  roundRect(x, y, w, h, 8);
  ctx.fill();

  // Face.
  const eyeY = y + h * 0.32;
  const eyeOff = w * 0.18 * papi.facing;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - eyeOff, eyeY, 5, 0, Math.PI * 2);
  ctx.arc(cx + eyeOff, eyeY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(cx - eyeOff + papi.facing * 1.5, eyeY, 2.4, 0, Math.PI * 2);
  ctx.arc(cx + eyeOff + papi.facing * 1.5, eyeY, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Mustache for Papi.
  ctx.strokeStyle = '#5a2b12';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 8, y + h * 0.52);
  ctx.quadraticCurveTo(cx - 2, y + h * 0.48, cx, y + h * 0.52);
  ctx.quadraticCurveTo(cx + 2, y + h * 0.48, cx + 8, y + h * 0.52);
  ctx.stroke();

  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = `hsl(${p.hue}, 80%, 65%)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawFloaters() {
  ctx.save();
  ctx.textAlign = 'center';
  for (const f of floaters) {
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillStyle = `hsl(${f.hue}, 90%, 70%)`;
    ctx.shadowColor = `hsl(${f.hue}, 90%, 60%)`;
    ctx.shadowBlur = 12;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}

function render() {
  ctx.save();
  if (shake > 0.3) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  drawBackground();
  drawPlatform();
  for (const c of cubes) drawCube(c);
  drawPapi();
  drawParticles();
  drawFloaters();
  ctx.restore();
}

// --- Input handlers ---
function startGame() {
  if (running) return;
  running = true;
  bannerEl.classList.add('hidden');
  // Seed a few cubes.
  for (let i = 0; i < 4; i++) spawnCube();
}

function onPointerDown(e) {
  const rect = canvas.getBoundingClientRect();
  pointerX = e.clientX - rect.left;
  pointerY = e.clientY - rect.top;

  if (!running) {
    startGame();
    return;
  }

  // Stomp: find the topmost cube under the pointer that Papi can reach.
  // If Papi is far away, dash toward it first (auto-aim assist), then stomp on landing.
  // Simplest satisfying behavior: if pointer is on a cube and Papi is horizontally near, stomp now.
  // Otherwise, walk toward it (handled by auto target) and stomp when close.
  const target = pickCubeAt(pointerX, pointerY);
  if (target) {
    papi.autoTarget = target;
    // If close enough and airborne or on ground, initiate a jump-toward-stomp.
    const dx = target.x - (papi.x + papi.w / 2);
    if (Math.abs(dx) < KICK_RANGE && papi.onGround) {
      papi.vy = -JUMP_VELOCITY * 0.55;
      papi.vx = Math.sign(dx) * WALK_SPEED * 0.6;
      papi.onGround = false;
    }
  }
}

function pickCubeAt(x, y) {
  // Topmost = largest y (lowest on screen) that contains point, within reach.
  let best = null;
  for (const c of cubes) {
    if (c.dead) continue;
    if (c.contains(x, y)) {
      if (!best || c.y > best.y) best = c;
    }
  }
  return best;
}

function onPointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  pointerX = e.clientX - rect.left;
  pointerY = e.clientY - rect.top;
}

window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);

window.addEventListener('keydown', (e) => {
  if (!running) {
    if (e.code === 'Space' || e.code === 'Enter') startGame();
    return;
  }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
    input.jump = true;
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') input.jump = false;
});

// Auto-advance Papi toward its stomp target each frame.
function updateAutoTarget() {
  if (!papi.autoTarget || papi.autoTarget.dead) {
    papi.autoTarget = null;
    return;
  }
  const t = papi.autoTarget;
  const px = papi.x + papi.w / 2;
  const dx = t.x - px;
  if (papi.onGround) {
    if (Math.abs(dx) > 6) {
      input.left = dx < 0;
      input.right = dx > 0;
    } else {
      input.left = false;
      input.right = false;
    }
    // Auto jump when close and on ground, to land on top.
    if (Math.abs(dx) < 20 && papi.vy >= 0) {
      papi.vy = -JUMP_VELOCITY;
      papi.onGround = false;
    }
  }
}

function updateFrame(dt) {
  updateAutoTarget();
  update(dt);
}

// --- Main loop ---
let lastFrame = performance.now();
function mainFrame(now) {
  const dt = Math.min(0.033, (now - lastFrame) / 1000);
  lastFrame = now;
  updateFrame(dt);
  render();
  requestAnimationFrame(mainFrame);
}

resize();
papi.x = platform.x + platform.w / 2 - papi.w / 2;
papi.y = platform.y - papi.h;
requestAnimationFrame(mainFrame);
