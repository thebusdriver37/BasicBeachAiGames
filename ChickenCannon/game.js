/* CHICKEN CANNON: Office Chair Armageddon
   A gloriously stupid physics game.
*/
(function () {
"use strict";

var Matter = window.Matter;
var Engine = Matter.Engine, World = Matter.World, Bodies = Matter.Bodies,
    Body = Matter.Body, Composite = Matter.Composite, Events = Matter.Events,
    Vector = Matter.Vector, Query = Matter.Query;

var W = 1280, H = 720, GROUND_Y = 640;
var LAUNCHER = { x: 150, y: GROUND_Y - 55 };

var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
var dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * dpr; canvas.height = H * dpr;
ctx.scale(dpr, dpr);

function fitStage() {
  var scale = Math.min(window.innerWidth / W, window.innerHeight / H) * 0.97;
  canvas.style.width = (W * scale) + "px";
  canvas.style.height = (H * scale) + "px";
}
window.addEventListener("resize", fitStage);
fitStage();

var rnd = function (a, b) { return a + Math.random() * (b - a); };
var pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

/* ---------------- AUDIO (procedural, no assets) ---------------- */
var AudioFX = (function () {
  var ac = null, master = null, muted = false;
  function ensure() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
    return true;
  }
  function blip(freq, dur, type, vol, slide) {
    if (muted) return;
    if (!ensure()) return;
    var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq) {
    if (muted) return;
    if (!ensure()) return;
    var len = (ac.sampleRate * dur) | 0;
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource(); src.buffer = buf;
    var f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq || 800;
    var g = ac.createGain(); g.gain.value = vol || 0.4;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }
  return {
    ensure: ensure,
    toggle: function () { muted = !muted; return muted; },
    muted: function () { return muted; },
    launch: function () { blip(220, 0.25, "square", 0.25, 600); noise(0.12, 0.25, 1400); },
    squawk: function () {
      blip(rnd(700, 900), 0.09, "sawtooth", 0.2, 300);
      setTimeout(function () { blip(rnd(800, 1000), 0.12, "sawtooth", 0.2, -200); }, 70);
    },
    pop: function () { blip(rnd(300, 420), 0.12, "triangle", 0.3, -180); noise(0.08, 0.3, 2200); },
    bonk: function () { blip(90, 0.18, "sine", 0.5, -40); noise(0.15, 0.5, 500); },
    thud: function () { blip(70, 0.2, "sine", 0.4, -30); },
    alarm: function () {
      for (var i = 0; i < 4; i++) {
        setTimeout(function () { blip(660, 0.18, "square", 0.22, -330); }, i * 220);
      }
    },
    cash: function () { blip(880, 0.09, "square", 0.18); setTimeout(function(){blip(1320, 0.14, "square", 0.18);}, 80); },
    boing: function () { blip(150, 0.3, "sine", 0.3, 250); },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function(){blip(f, 0.22, "square", 0.22);}, i * 140); });
    },
    lose: function () {
      [392, 330, 262, 196].forEach(function (f, i) { setTimeout(function(){blip(f, 0.3, "sawtooth", 0.2);}, i * 180); });
    }
  };
})();

/* ---------------- GAME STATE ---------------- */
var state = "menu"; // menu | playing | over
var engine = null;
var world = null;
var score = 0;
var chickensLeft = 12;
var totalChickens = 12;
var chairBodies = {}; // id -> chair data
var chickens = [];    // live chicken entities
var activeChicken = null;
var aiming = false, aimStart = null, aimNow = null;
var combo = 0, comboTimer = 0;
var shake = 0;
var time = 0;
var particles = [];
var floaters = [];
var banner = null; // {text, sub, t, dur, color}
var slowmo = 0;
var twistCount = 0;
var chairsKilledTotal = 0;
var hitCount = 0, hitSpeedSum = 0;
var lastTwist = 0;
var goldenNext = false;
var fireDrill = 0;
var worker = null;
var workerBonked = 0;
var mug = null; // the secret twist object
var mugDropped = false;

var CHAIR_INSULTS = [
  "FIRING YOU", "OUT OF OFFICE", "SEE HR", "RESTRUCTURED",
  "GHOSTED", "DECOMMISSIONED", "NO BAKE SALE FOR YOU", "YOUR DESK IS GONE",
  "PER MY LAST EMAIL", "ACTION ITEM", "CIRCLE BACK NEVER", "DEPRIORITIZED",
  "MID-LEVEL CHAIR", "SYNERGY LACKED", "BUDGET CUT", "TERMINATED (pun intended)"
];

var MUG_WORDS = [
  "SYNERGY", "DISRUPT", "PARADIGM", "BANDWIDTH", "GRINDSET", "CROSS-TEAM",
  "KPIs", "OKRs", "AGILE", "DESKLESS", "MINDSHARE", "QUARTERLY", "HUSTLE", "EV"
];

/* ---------------- WORLD SETUP ---------------- */
function makeChair(x, y, layer) {
  // physics body = trapezoid (wider base, narrower top) -> stacks like real chairs
  // the cute chair art (casters, back, headrest) is drawn on top, rotated with the body
  var chair = Bodies.trapezoid(x, y, 78, 58, 0.35, {
    friction: 0.9, restitution: 0.06, frictionAir: 0.02,
    density: 0.0016, chamfer: { radius: 4 }
  });
  var d = {
    body: chair,
    hp: 80 + layer * 12,
    maxHp: 80 + layer * 12,
    layer: layer,
    color: pick(["#3b6fd4", "#d44b6f", "#4bb46f", "#e0a13b", "#8f5fd4"]),
    dead: false,
    wobble: 0
  };
  chair.plugin.chickenChair = d;
  chair.label = "chair";
  chairBodies[chair.id] = d;
  World.add(world, chair);
  return d;
}

function buildStacks() {
  var stacks = [
    { x: 700, n: 3 },
    { x: 900, n: 4 },
    { x: 1110, n: 5 }
  ];
  stacks.forEach(function (s) {
    for (var i = 0; i < s.n; i++) {
      makeChair(s.x, GROUND_Y - 20 - i * 50, i);
    }
  });
}

function makeWorker() {
  // poor intern standing to the right, drawn as a body so chickens can bonk him
  var b = Bodies.rectangle(1230, GROUND_Y - 34, 34, 68, {
    friction: 0.8, restitution: 0.2, frictionAir: 0.04, density: 0.004
  });
  b.label = "worker";
  b.plugin.worker = true;
  worker = { body: b, flash: 0, tilt: 0 };
  World.add(world, b);
}

function setupWorld() {
  world = engine.world;
  engine.gravity.y = 1;

  var ground = Bodies.rectangle(W / 2, GROUND_Y + 40, W * 2, 80, {
    isStatic: true, friction: 0.9, label: "ground"
  });
  var wallL = Bodies.rectangle(-30, H / 2, 60, H * 3, { isStatic: true, label: "wall" });
  var wallR = Bodies.rectangle(W + 30, H / 2, 60, H * 3, { isStatic: true, label: "wall" });
  World.add(world, [ground, wallL, wallR]);

  buildStacks();
  makeWorker();
}

/* ---------------- CHICKEN LAUNCHING ---------------- */
function launchChicken(power) {
  var dir = Vector.normalise(Vector.sub(power.from, power.to));
  var speed = clamp(power.mag * 0.125, 4, 30);
  var vel = Vector.mult(dir, speed);
  var golden = goldenNext;
  goldenNext = false;

  var r = golden ? 20 : 16;
  var b = Bodies.circle(LAUNCHER.x, LAUNCHER.y, r, {
    restitution: 0.72, friction: 0.4, frictionAir: 0.012,
    density: golden ? 0.0028 : 0.0022,
    label: "chicken"
  });
  Body.setVelocity(b, vel);
  Body.setAngularVelocity(b, rnd(-0.3, 0.3));
  var c = {
    body: b,
    golden: golden,
    age: 0,
    squish: 1,
    trail: []
  };
  b.plugin.chicken = c;
  chickens.push(c);
  activeChicken = c;
  World.add(world, b);
  chickensLeft--;
  combo = 0;
  AudioFX.launch();
  AudioFX.squawk();
  shake = Math.max(shake, 6);
  burst(LAUNCHER.x, LAUNCHER.y, "#ffd23f", 10, 4);
  if (golden) banner2("CEO APPROVED CHICKEN", "worth 2x everything", "#ffd23f", 1.4);
  rollTwist();
}

/* ---------------- THE SECRET TWIST ----------------
   Every so often the office's "efficiency review" kicks in.
   A giant coffee mug with a corporate buzzword drops from the
   sky and absolutely murders whatever is under it.
   Sometimes it rains rubber ducks instead. The office is cursed.
*/
function rollTwist() {
  if (twistCount >= 4) return;
  if (time - lastTwist < 9) return; // seconds between twists
  if (Math.random() > 0.55) return;
  lastTwist = time;
  twistCount++;

  var roll = Math.random();
  if (roll < 0.5) dropMug();
  else if (roll < 0.8) rainDucks();
  else fireDrillNow();
}

function dropMug() {
  var x = rnd(500, 1200);
  var word = pick(MUG_WORDS);
  var mugB = Bodies.rectangle(x, -140, 150, 120, {
    density: 0.006, restitution: 0.05, friction: 0.6, label: "mug"
  });
  mug = { body: mugB, word: word, steam: 0, landed: false };
  mugB.plugin.mug = mug;
  World.add(world, mugB);
  AudioFX.alarm();
  banner2("EFFICIENCY REVIEW", "A MUG IS COMING. THE MUG HAS " + word + ".", "#ff8fa3", 2.2);
  shake = Math.max(shake, 10);
}

function rainDucks() {
  for (var i = 0; i < 5; i++) {
    (function (i) {
      setTimeout(function () {
        if (state !== "playing") return;
        var x = rnd(300, 1250);
        var duck = Bodies.rectangle(x, -80 - rnd(0, 200), 34, 26, {
          density: 0.001, restitution: 0.5, friction: 0.5, label: "duck"
        });
        Body.setVelocity(duck, { x: rnd(-2, 2), y: rnd(2, 5) });
        World.add(world, duck);
        burst(x, 0, "#ffe98a", 6, 3);
      }, i * 260);
    })(i);
  }
  AudioFX.alarm();
  banner2("RUBBER DUCK DEPLOYMENT", "the office is releasing the ducks", "#7ee7ff", 2.0);
}

function fireDrillNow() {
  fireDrill = 2.2;
  AudioFX.alarm();
  banner2("FIRE DRILL", "everyone out, chairs included", "#ff5d5d", 2.0);
  // shove everything
  Composite.allBodies(world).forEach(function (b) {
    if (b.isStatic) return;
    Body.applyForce(b, b.position, { x: rnd(0.0006, 0.0014), y: -rnd(0.0002, 0.0008) });
  });
}

/* ---------------- COLLISION HANDLING ---------------- */
function onCollision(ev) {
  ev.pairs.forEach(function (p) {
    var a = (p.bodyA.parent || p.bodyA), b = (p.bodyB.parent || p.bodyB);
    var speed = Math.hypot(
      (a.velocity.x - b.velocity.x), (a.velocity.y - b.velocity.y)
    );
    var chairA = a.plugin.chickenChair, chairB = b.plugin.chickenChair;
    var chicA = a.plugin.chicken, chicB = b.plugin.chicken;

    // chicken vs chair
    var hitChair = null;
    var hitChic = null;
    if (chicA && chairB) { hitChic = chicA; hitChair = chairB; }
    else if (chicB && chairA) { hitChic = chicB; hitChair = chairA; }
    if (hitChic && hitChair && !hitChair.dead && speed > 2.5) { hitCount++; hitSpeedSum += speed;
      var dmg = speed * 9;
      hitChair.hp -= dmg;
      hitChair.wobble = 1;
      hitChic.squish = 1;
      shake = Math.max(shake, Math.min(speed * 1.2, 14));
      var cp = p.collision && p.collision.supports && p.collision.supports[0]
        ? p.collision.supports[0] : hitChair.body.position;
      burst(cp.x, cp.y, "#ffffff", 8, 5);
      if (hitChair.hp <= 0) killChair(hitChair, cp.x, cp.y);
      else {
        AudioFX.pop();
        hitChair.hp = Math.max(1, hitChair.hp);
        floatText(hitChair.body.position.x, hitChair.body.position.y - 60,
          pick(["CLANK!", "BONK!", "SMACK!", "WHACK!", "CLONK!"]), "#fff", 0.7, 20);
      }
    }

    // mug landing on stuff = big damage
    var mugObj = a.plugin.mug || b.plugin.mug;
    if (mugObj && !mugObj.landed) {
      var other = mugObj === a.plugin.mug ? b : a;
      if (other.label !== "ground" && other.label !== "wall" && speed > 3) {
        other.plugin.mugCrashed = true;
      }
    }
    // detect mug settled (only counts as landed once it has stopped moving)
    [a, b].forEach(function (bb) {
      var m = bb.plugin.mug;
      if (m && !m.landed && m.landedOnce !== true &&
          Math.hypot(bb.velocity.x, bb.velocity.y) < 0.4 &&
          a.label !== "ground" && b.label !== "ground") {
        m.landed = true;
        m.landedOnce = true;
        score += 200;
        AudioFX.bonk();
        shake = 18;
        burst(bb.position.x, bb.position.y, "#8a5a2b", 20, 8);
        floatText(bb.position.x, bb.position.y - 90, "MUG IMPACT +200", "#ff8fa3", 1.4, 24);
        floatText(bb.position.x, bb.position.y - 120, "THE MUG SPOKE. " + m.word + " IS DEADLINE.", "#ff8fa3", 1.4, 15);
      }
    });

    // duck squash
    [a, b].forEach(function (bb) {
      if (bb.label === "duck" && Math.hypot(bb.velocity.x, bb.velocity.y) > 4) {
        World.remove(world, bb);
        burst(bb.position.x, bb.position.y, "#ffe98a", 10, 5);
        AudioFX.boing();
        floatText(bb.position.x, bb.position.y - 30, "SQUEAK", "#ffe98a", 0.6, 16);
      }
    });

    // bonk the intern
    var chic2 = a.plugin.chicken || b.plugin.chicken;
    var wk = a.label === "worker" ? a : (b.label === "worker" ? b : null);
    if (chic2 && wk && speed > 2 && workerBonked <= 0) {
      workerBonked = 1.2;
      worker.flash = 1;
      worker.tilt = clamp(wk.position.x > wk.position.y ? 0.5 : -0.5, -0.5, 0.5);
      AudioFX.bonk();
      score = Math.max(0, score - 25);
      floatText(wk.position.x, wk.position.y - 80, "BONKED THE INTERN -25", "#ff8fa3", 1.0, 16);
      burst(wk.position.x, wk.position.y - 50, "#cfd8ff", 12, 6);
      shake = Math.max(shake, 10);
    }
  });
}

/* ---------------- SCORING / CHAIR DEATH ---------------- */
function killChair(d, x, y) {
  d.dead = true;
  World.remove(world, d.body);
  delete chairBodies[d.body.id];
  combo++;
  comboTimer = 3;
  var base = 100;
  var mult = 1 + (combo - 1) * 0.5;
  if (activeChicken && activeChicken.golden) mult *= 2;
  var pts = Math.round(base * mult);
  score += pts;
  chairsKilledTotal++;
  if (chairsKilledTotal % 3 === 0 && chairsKilledTotal > 0) {
    chickensLeft++;
    totalChickens++;
    floatText(LAUNCHER.x, LAUNCHER.y - 60, "OVERTIME +1 CHICKEN", "#7ee7ff", 1.6, 18);
    AudioFX.cash();
  }
  AudioFX.pop();
  burst(x, y, d.color, 18, 7);
  burst(x, y, "#ffffff", 8, 5);
  floatText(x, y - 40, "+" + pts, "#ffd23f", 1.2, 26);
  if (combo > 1) {
    floatText(x, y - 80, "COMBO x" + combo, "#7ee7ff", 1.2, 22);
    if (combo >= 3) { slowmo = Math.max(slowmo, 0.5); AudioFX.cash(); }
  }
  var insult = pick(CHAIR_INSULTS);
  floatText(x, y - 115, insult, "#ff8fa3", 1.4, 15);
  shake = Math.max(shake, 8);
  checkWinLose();
}

function checkWinLose() {
  var remaining = Object.keys(chairBodies).length;
  if (remaining === 0) {
    endGame(true);
  }
}

function endGame(won) {
  if (state === "over") return;
  state = "over";
  if (won) {
    AudioFX.win();
    banner2("ALL CHAIRS DOWN", "the office is floor-sitting now", "#7ee7ff", 3);
  } else {
    AudioFX.lose();
    banner2("OUT OF CHICKENS", "HR has been notified", "#ff8fa3", 3);
  }
  var finalScore = score;
  setTimeout(function () {
    var title = document.getElementById("endTitle");
    var rank = document.getElementById("endRank");
    var sc = document.getElementById("endScore");
    if (won) {
      title.textContent = "PROMOTED";
      var ranks = [
        [6000, "CEO (temporary)"],
        [4000, "VP of Chickens"],
        [2500, "Senior Chair Destroyer"],
        [1500, "Mid-Level Aggressor"],
        [500, "Junior Bonker"],
        [0, "Intern (again)"]
      ];
      var r = ranks.find(function (x) { return finalScore >= x[0]; });
      rank.textContent = "RANK: " + r[1].toUpperCase();
    } else {
      title.textContent = "TERMINATED";
      rank.textContent = "REASON: CHAIRS WERE LEFT STANDING";
    }
    sc.textContent = finalScore + " PTS";
    // wall of shame: localStorage
    var wall = [];
    try { wall = JSON.parse(localStorage.getItem("ccWall") || "[]"); } catch (e) {}
    wall.push({ s: finalScore, d: won ? "WIN" : "LOSS", t: Date.now() });
    wall.sort(function (a, b) { return b.s - a.s; });
    wall = wall.slice(0, 5);
    try { localStorage.setItem("ccWall", JSON.stringify(wall)); } catch (e) {}
    var list = document.getElementById("shameList");
    list.innerHTML = "";
    if (wall.length === 0) list.innerHTML = "<li>No shame yet. Historic.</li>";
    wall.forEach(function (w, i) {
      var li = document.createElement("li");
      li.textContent = (i + 1) + ". " + w.s + " pts (" + w.d + ")";
      if (i === wall.length - 1 && w.s === finalScore && w.t === wall[wall.length-1].t) li.className = "me";
      list.appendChild(li);
    });
    document.getElementById("endScreen").classList.remove("hidden");
  }, won ? 1600 : 900);
}

/* ---------------- INPUT ---------------- */
function canvasPos(e) {
  var r = canvas.getBoundingClientRect();
  var cx = (e.touches ? e.touches[0].clientX : e.clientX);
  var cy = (e.touches ? e.touches[0].clientY : e.clientY);
  return {
    x: (cx - r.left) * (W / r.width),
    y: (cy - r.top) * (H / r.height)
  };
}

function onDown(e) {
  if (state !== "playing" || activeChicken) return;
  if (chickensLeft <= 0) return;
  AudioFX.ensure();
  aiming = true;
  aimStart = canvasPos(e);
  aimNow = aimStart;
  e.preventDefault();
}
function onMove(e) {
  if (!aiming) return;
  aimNow = canvasPos(e);
  e.preventDefault();
}
function onUp(e) {
  if (!aiming) return;
  aiming = false;
  var drag = Vector.sub(aimNow, aimStart);
  if (Vector.magnitude(drag) > 24) {
    // slingshot: launch opposite the drag
    launchChicken({ from: aimStart, to: aimNow, mag: Vector.magnitude(drag) });
  }
  e.preventDefault();
}
canvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);
canvas.addEventListener("touchstart", onDown, { passive: false });
window.addEventListener("touchmove", onMove, { passive: false });
window.addEventListener("touchend", onUp, { passive: false });

/* ---------------- UI BUTTONS ---------------- */
document.getElementById("startBtn").addEventListener("click", function () {
  AudioFX.ensure();
  document.getElementById("startScreen").classList.add("hidden");
  startGame();
});
document.getElementById("againBtn").addEventListener("click", function () {
  document.getElementById("endScreen").classList.add("hidden");
  startGame();
});

function startGame() {
  World.clear(world, false);
  score = 0;
  chickensLeft = totalChickens;
  chickens = [];
  activeChicken = null;
  chairBodies = {};
  particles = [];
  floaters = [];
  combo = 0;
  twistCount = 0;
  lastTwist = 0;
  chairsKilledTotal = 0;
  goldenNext = false;
  mugDropped = false;
  fireDrill = 0;
  workerBonked = 0;
  banner = null;
  setupWorld();
  state = "playing";
  banner2("QUARTERLY REVIEW", "destroy every chair before the chickens run out", "#7ee7ff", 2.5);
}

/* ---------------- EFFECTS ---------------- */
function burst(x, y, color, n, speed) {
  for (var i = 0; i < n; i++) {
    var a = Math.random() * Math.PI * 2;
    var s = rnd(speed * 0.4, speed);
    particles.push({
      x: x, y: y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2,
      life: rnd(0.4, 0.9), age: 0,
      color: color, size: rnd(3, 8)
    });
  }
}
function floatText(x, y, text, color, dur, size) {
  floaters.push({ x: x, y: y, text: text, color: color, dur: dur, age: 0, size: size || 18 });
}
function banner2(text, sub, color, dur) {
  banner = { text: text, sub: sub, color: color, t: 0, dur: dur };
}

/* ---------------- DRAWING ---------------- */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground() {
  // office wall
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2b3350");
  g.addColorStop(0.65, "#3a4468");
  g.addColorStop(1, "#4a5578");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // floor
  ctx.fillStyle = "#232941";
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = "#5b6b9e";
  ctx.fillRect(0, GROUND_Y, W, 5);
  // floor tiles
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  for (var x = 0; x < W; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x - 40, H); ctx.stroke();
  }

  // window with sun
  ctx.fillStyle = "rgba(255,240,180,0.12)";
  roundRect(40, 60, 300, 180, 12); ctx.fill();
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath(); ctx.arc(110, 120, 28, 0, Math.PI * 2); ctx.fill();
  for (var i = 0; i < 8; i++) {
    var a = i * Math.PI / 4 + time * 0.3;
    ctx.strokeStyle = "rgba(255,210,63,0.6)"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(110 + Math.cos(a) * 34, 120 + Math.sin(a) * 34);
    ctx.lineTo(110 + Math.cos(a) * 48, 120 + Math.sin(a) * 48);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(126,231,255,0.25)";
  roundRect(200, 100, 120, 90, 6); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 4;
  roundRect(40, 60, 300, 180, 12); ctx.stroke();

  // motivational poster (upside down, because of course)
  ctx.save();
  ctx.translate(500, 150);
  ctx.rotate(0.06);
  ctx.fillStyle = "#c9b27e";
  ctx.fillRect(-70, -50, 140, 100);
  ctx.fillStyle = "#7a5c2e";
  ctx.font = "bold 14px Arial Black, sans-serif";
  ctx.textAlign = "center";
  ctx.save(); ctx.rotate(Math.PI);
  ctx.fillText("TEAMWORK", 0, -18);
  ctx.fillText("IS A", 0, 0);
  ctx.fillText("MUG THING", 0, 18);
  ctx.restore();
  ctx.restore();

  // motivational poster 2
  ctx.save();
  ctx.translate(660, 120);
  ctx.rotate(-0.05);
  ctx.fillStyle = "#8fb7d9";
  ctx.fillRect(-60, -45, 120, 90);
  ctx.fillStyle = "#2b3350";
  ctx.font = "bold 13px Arial Black, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("HANG", 0, -12);
  ctx.fillText("IN THERE", 0, 8);
  ctx.restore();

  // fire exit sign
  ctx.fillStyle = "#2e7d4f";
  roundRect(1180, 70, 90, 34, 6); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px Arial Black, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("EXIT", 1225, 93);

  // ceiling lights
  ctx.fillStyle = "rgba(255,255,220,0.9)";
  [400, 800, 1150].forEach(function (x) {
    roundRect(x - 60, 18, 120, 14, 6); ctx.fill();
    ctx.fillStyle = "rgba(255,255,220,0.06)";
    ctx.beginPath();
    ctx.moveTo(x - 60, 32); ctx.lineTo(x - 130, GROUND_Y);
    ctx.lineTo(x + 130, GROUND_Y); ctx.lineTo(x + 60, 32);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,220,0.9)";
  });
}

function drawLauncher() {
  var x = LAUNCHER.x, y = LAUNCHER.y;
  // cannon base
  ctx.save();
  ctx.translate(x, y + 30);
  ctx.fillStyle = "#39415e";
  roundRect(-42, 0, 84, 22, 8); ctx.fill();
  ctx.fillStyle = "#2b3350";
  ctx.beginPath(); ctx.arc(-28, 22, 12, 0, Math.PI * 2); ctx.arc(28, 22, 12, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // barrel aims along current drag
  var ang = -Math.PI / 4;
  if (aiming && aimNow) {
    var lv = Vector.sub(aimStart, aimNow);
    if (Vector.magnitude(lv) > 8) ang = Math.atan2(lv.y, lv.x);
  }
  ctx.save();
  ctx.translate(x, y + 8);
  ctx.rotate(ang);
  ctx.fillStyle = "#4b5578";
  roundRect(-14, -16, 66, 32, 10); ctx.fill();
  ctx.fillStyle = "#5f6b94";
  roundRect(38, -20, 14, 40, 5); ctx.fill();
  ctx.restore();

  // rubber chicken loaded in the barrel
  if (!activeChicken && chickensLeft > 0 && state === "playing") {
    ctx.save();
    ctx.translate(x, y + 8);
    ctx.rotate(ang);
    drawChickenSprite(44, 0, 13, 1, 0, goldenNext);
    ctx.restore();
  }
}

function drawChickenSprite(x, y, r, angle, squish, golden) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  var sx = 1 + squish * 0.45;
  var sy = 1 - squish * 0.45;
  ctx.scale(sx, sy);
  var body = golden ? "#ffe98a" : "#ffd23f";
  var outline = golden ? "#b58a00" : "#c78a00";
  // body
  ctx.fillStyle = body;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // tail feathers
  ctx.fillStyle = body;
  for (var i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(-r * 1.0, i * r * 0.3);
    ctx.lineTo(-r * 1.7, i * r * 0.55 - r * 0.15);
    ctx.lineTo(-r * 1.5, i * r * 0.55 + r * 0.2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // wing
  ctx.fillStyle = "rgba(199,138,0,0.35)";
  ctx.beginPath(); ctx.ellipse(-r * 0.15, r * 0.1, r * 0.55, r * 0.4, 0.3, 0, Math.PI * 2); ctx.fill();
  // head
  ctx.fillStyle = body;
  ctx.strokeStyle = outline;
  ctx.beginPath(); ctx.arc(r * 0.95, -r * 0.55, r * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // comb
  ctx.fillStyle = "#ff5d5d";
  ctx.beginPath();
  ctx.arc(r * 0.75, -r * 1.18, r * 0.2, 0, Math.PI * 2);
  ctx.arc(r * 1.0, -r * 1.25, r * 0.2, 0, Math.PI * 2);
  ctx.arc(r * 1.22, -r * 1.15, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  // beak
  ctx.fillStyle = "#ff9d2e";
  ctx.beginPath();
  ctx.moveTo(r * 1.5, -r * 0.62);
  ctx.lineTo(r * 2.05, -r * 0.45);
  ctx.lineTo(r * 1.5, -r * 0.28);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // wattle
  ctx.fillStyle = "#ff5d5d";
  ctx.beginPath(); ctx.arc(r * 1.35, -r * 0.1, r * 0.18, 0, Math.PI * 2); ctx.fill();
  // eye
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(r * 1.1, -r * 0.65, r * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1a1f2e";
  ctx.beginPath(); ctx.arc(r * 1.16, -r * 0.65, r * 0.11, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawChair(d) {
  var b = d.body;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle + Math.sin(time * 30) * d.wobble * 0.06);
  var col = d.color;
  var dark = shade(col, -30);
  // base / casters
  ctx.fillStyle = "#8a93ad";
  roundRect(-27, 9, 54, 10, 4); ctx.fill();
  ctx.fillStyle = "#39415e";
  ctx.beginPath();
  ctx.arc(-22, 22, 5, 0, Math.PI * 2); ctx.arc(22, 22, 5, 0, Math.PI * 2); ctx.fill();
  // column
  ctx.fillStyle = "#8a93ad";
  ctx.fillRect(-4, 16, 8, 8);
  // seat
  ctx.fillStyle = col;
  roundRect(-37, -10, 74, 20, 7); ctx.fill();
  ctx.fillStyle = dark;
  roundRect(-37, 4, 74, 6, 3); ctx.fill();
  // back
  ctx.fillStyle = col;
  roundRect(-33, -64, 18, 56, 6); ctx.fill();
  ctx.fillStyle = dark;
  roundRect(-33, -40, 18, 8, 3); ctx.fill();
  // headrest
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(-24, -70, 9, 0, Math.PI * 2); ctx.fill();
  // damage cracks
  if (d.hp < d.maxHp * 0.6) {
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-20, -6); ctx.lineTo(-12, -2); ctx.lineTo(-16, 4);
    ctx.stroke();
  }
  if (d.hp < d.maxHp * 0.3) {
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.moveTo(-28, -50); ctx.lineTo(-22, -42); ctx.lineTo(-27, -34);
    ctx.moveTo(10, -4); ctx.lineTo(18, 0);
    ctx.stroke();
  }
  // hp bar
  if (d.hp < d.maxHp) {
    ctx.rotate(-(b.angle + Math.sin(time * 30) * d.wobble * 0.06));
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(-24, -88, 48, 6);
    ctx.fillStyle = d.hp > d.maxHp * 0.4 ? "#7ee7ff" : "#ff8fa3";
    ctx.fillRect(-24, -88, 48 * clamp(d.hp / d.maxHp, 0, 1), 6);
  }
  ctx.restore();
}

function drawMug(m) {
  var b = m.body;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  // handle
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.arc(95, 0, 42, -Math.PI / 2.4, Math.PI / 2.4); ctx.stroke();
  // mug body
  ctx.fillStyle = "#8a5a2b";
  roundRect(-75, -60, 150, 120, 14); ctx.fill();
  ctx.fillStyle = "#a06c34";
  roundRect(-75, -60, 150, 22, 14); ctx.fill();
  // coffee
  ctx.fillStyle = "#3d2410";
  ctx.beginPath(); ctx.ellipse(0, -48, 62, 14, 0, 0, Math.PI * 2); ctx.fill();
  // word
  ctx.save();
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 30px Arial Black, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(m.word, 0, 10);
  ctx.restore();
  // steam
  m.steam += 0.1;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 5;
  for (var i = 0; i < 3; i++) {
    var sx = -30 + i * 30;
    ctx.beginPath();
    ctx.moveTo(sx, -64);
    ctx.quadraticCurveTo(sx + Math.sin(m.steam + i) * 14, -90, sx + Math.sin(m.steam * 1.3 + i) * 20, -116);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWorker() {
  var b = worker.body;
  var flash = worker.flash > 0;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle + worker.tilt * Math.sin(time * 20) * Math.min(1, worker.tilt * 4));
  if (flash) {
    ctx.fillStyle = "rgba(255,93,93,0.35)";
    ctx.beginPath(); ctx.ellipse(0, -10, 34, 48, 0, 0, Math.PI * 2); ctx.fill();
  }
  // legs
  ctx.fillStyle = "#2b3350";
  ctx.fillRect(-12, 20, 9, 20);
  ctx.fillRect(3, 20, 9, 20);
  // torso (blue shirt)
  ctx.fillStyle = "#3b6fd4";
  roundRect(-16, -18, 32, 40, 8); ctx.fill();
  // tie
  ctx.fillStyle = "#ff5d5d";
  ctx.beginPath();
  ctx.moveTo(0, -16); ctx.lineTo(4, -4); ctx.lineTo(0, 10); ctx.lineTo(-4, -4);
  ctx.closePath(); ctx.fill();
  // arms
  ctx.fillStyle = "#3b6fd4";
  roundRect(-22, -14, 8, 26, 4); ctx.fill();
  roundRect(14, -14, 8, 26, 4); ctx.fill();
  // head
  ctx.fillStyle = "#f2c9a0";
  ctx.beginPath(); ctx.arc(0, -34, 14, 0, Math.PI * 2); ctx.fill();
  // hair
  ctx.fillStyle = "#5a3d20";
  ctx.beginPath(); ctx.arc(0, -40, 13, Math.PI, 0); ctx.fill();
  // face: stressed
  ctx.fillStyle = "#1a1f2e";
  ctx.beginPath(); ctx.arc(-5, -35, 2, 0, Math.PI * 2); ctx.arc(5, -35, 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#1a1f2e";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -26, 4, 0.2, Math.PI - 0.2); ctx.stroke();
  // sweat drop
  ctx.fillStyle = "#7ee7ff";
  ctx.beginPath();
  ctx.moveTo(14, -44); ctx.quadraticCurveTo(19, -38, 14, -35); ctx.quadraticCurveTo(10, -38, 14, -44);
  ctx.fill();
  ctx.restore();
}

function drawAim() {
  if (!aiming || !aimNow) return;
  var drag = Vector.sub(aimNow, aimStart);
  var power = clamp(Vector.magnitude(drag), 0, 240);
  // slingshot: chicken launches OPPOSITE the drag (pull back, release)
  var launch = Vector.normalise(Vector.sub(aimStart, aimNow));
  var speed = clamp(power * 0.125, 4, 30);

  // dotted trajectory preview (matches physics: 1 frame per step, g = 0.5 px/frame^2)
  var px = LAUNCHER.x, py = LAUNCHER.y;
  var vx = launch.x * speed, vy = launch.y * speed;
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  for (var i = 1; i <= 70; i++) {
    px += vx;
    py += vy;
    vy += 0.5;
    if (py > GROUND_Y || px > W || px < 0) break;
    var fade = 1 - i / 30;
    ctx.globalAlpha = fade * 0.7;
    ctx.beginPath(); ctx.arc(px, py, 4 * fade + 1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // power meter
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  roundRect(LAUNCHER.x - 40, LAUNCHER.y + 70, 80, 12, 6); ctx.fill();
  var pc = power > 180 ? "#ff5d5d" : (power > 90 ? "#ffd23f" : "#7ee7ff");
  ctx.fillStyle = pc;
  roundRect(LAUNCHER.x - 40, LAUNCHER.y + 70, 80 * (power / 240), 12, 6); ctx.fill();
}

function drawHUD() {
  // chickens left
  ctx.save();
  ctx.font = "bold 15px Arial Black, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("CHICKENS", 24, 34);
  for (var i = 0; i < totalChickens; i++) {
    var x = 30 + (i % 12) * 26, y = 58 + Math.floor(i / 12) * 26;
    if (i < chickensLeft) {
      drawChickenSprite(x, y, 8, 0, 0, false);
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
      ctx.stroke();
    }
  }

  // score
  ctx.textAlign = "right";
  ctx.font = "bold 40px Arial Black, sans-serif";
  ctx.fillStyle = "#ffd23f";
  ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6;
  ctx.fillText(score, W - 28, 52);
  ctx.shadowBlur = 0;
  ctx.font = "bold 13px Arial Black, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("PTS", W - 28, 72);

  // chairs left
  var remaining = Object.keys(chairBodies).length;
  ctx.textAlign = "center";
  ctx.font = "bold 16px Arial Black, sans-serif";
  ctx.fillStyle = "#7ee7ff";
  ctx.fillText("CHAIRS LEFT: " + remaining, W / 2, 40);

  // fire drill overlay
  if (fireDrill > 0) {
    var a = 0.12 + 0.1 * Math.sin(time * 12);
    ctx.fillStyle = "rgba(255,60,60," + a + ")";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function drawBanner() {
  if (!banner) return;
  banner.t += 1 / 60;
  var t = banner.t / banner.dur;
  if (t >= 1) { banner = null; return; }
  var slide = t < 0.15 ? t / 0.15 : (t > 0.85 ? (1 - t) / 0.15 : 1);
  ctx.save();
  ctx.globalAlpha = slide;
  ctx.translate(W / 2, 150);
  var w = 640, h = 90;
  ctx.fillStyle = "rgba(10,14,24,0.88)";
  roundRect(-w / 2, -h / 2, w, h, 16); ctx.fill();
  ctx.strokeStyle = banner.color;
  ctx.lineWidth = 5;
  roundRect(-w / 2, -h / 2, w, h, 16); ctx.stroke();
  ctx.fillStyle = banner.color;
  ctx.font = "bold 34px Arial Black, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(banner.text, 0, -8);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 15px Arial, sans-serif";
  ctx.fillText(banner.sub, 0, 26);
  ctx.restore();
}

function shade(hex, amt) {
  var n = parseInt(hex.slice(1), 16);
  var r = clamp(((n >> 16) & 255) + amt, 0, 255);
  var g = clamp(((n >> 8) & 255) + amt, 0, 255);
  var b = clamp((n & 255) + amt, 0, 255);
  return "rgb(" + r + "," + g + "," + b + ")";
}

/* ---------------- MAIN LOOP ---------------- */
var last = performance.now();
var acc = 0;
var STEP = 1000 / 60;

function tick(now) {
  requestAnimationFrame(tick);
  var dt = Math.min(now - last, 100);
  last = now;
  time += dt / 1000;
  acc += dt;

  var scale = slowmo > 0 ? 0.35 : 1;
  if (slowmo > 0) slowmo -= dt / 1000;

  while (acc >= STEP) {
    acc -= STEP;
    if (state === "playing" || state === "over") {
      Engine.update(engine, STEP * scale);
      stepEffects();
    }
  }

  render();
}

function stepEffects() {
  // chicken squish decay + trail + cull
  for (var i = chickens.length - 1; i >= 0; i--) {
    var c = chickens[i];
    c.age += 1 / 60;
    c.squish = Math.max(0, c.squish - 0.08);
    c.trail.unshift({ x: c.body.position.x, y: c.body.position.y, a: c.body.angle });
    if (c.trail.length > 10) c.trail.pop();
    var p = c.body.position;
    var speed = Math.hypot(c.body.velocity.x, c.body.velocity.y);
    var settled = speed < 0.35 && Math.abs(c.body.angularVelocity) < 0.03;
    if (c.age > 7 || p.y > H + 120 || p.x > W + 150 || p.x < -150) {
      World.remove(world, c.body);
      chickens.splice(i, 1);
      if (activeChicken === c) activeChicken = null;
    } else if (settled) {
      c.settled = (c.settled || 0) + 1 / 60;
      if (c.settled > 1.4) {
        c.age += 0.35; // despawn faster once it has given up its life
      }
    } else {
      c.settled = 0;
    }
  }

  // chairs wobble decay + fly off
  Object.keys(chairBodies).forEach(function (id) {
    var d = chairBodies[id];
    d.wobble = Math.max(0, d.wobble - 0.04);
    if (d.body.position.y > H + 150 || d.body.position.x > W + 120 || d.body.position.x < -120) {
      delete chairBodies[id];
      World.remove(world, d.body);
      chairsKilledTotal++;
      if (d.body.position.x > W + 120 || d.body.position.x < -120) {
        score += 50;
        floatText(clamp(d.body.position.x, 60, W - 60), GROUND_Y - 60, "OFF THE BUILDING +50", "#7ee7ff", 1.2, 20);
        AudioFX.pop();
      }
      checkWinLose();
    }
  });

  // mug
  if (mug && mug.body.position.y > H + 200) mug = null;

  // particles
  for (var i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    p.age += 1 / 60;
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.3;
    p.vx *= 0.98;
    if (p.age >= p.life) particles.splice(i, 1);
  }
  // floaters
  for (var i = floaters.length - 1; i >= 0; i--) {
    var f = floaters[i];
    f.age += 1 / 60;
    f.y -= 0.7;
    if (f.age >= f.dur) floaters.splice(i, 1);
  }

  // combo timer
  if (comboTimer > 0) {
    comboTimer -= 1 / 60;
    if (comboTimer <= 0) combo = 0;
  }

  // timers
  if (shake > 0) shake = Math.max(0, shake - 0.8);
  if (fireDrill > 0) fireDrill -= 1 / 60;
  if (workerBonked > 0) workerBonked -= 1 / 60;
  if (worker) {
    worker.flash = Math.max(0, worker.flash - 0.05);
    worker.tilt *= 0.92;
  }

  // out of chickens -> lose
  if (state === "playing" && !activeChicken && chickensLeft <= 0 && Object.keys(chairBodies).length > 0) {
    endGame(false);
  }
}

function render() {
  ctx.save();
  if (shake > 0) {
    ctx.translate(rnd(-shake, shake) * 0.5, rnd(-shake, shake) * 0.5);
  }
  drawBackground();

  // aim preview under bodies
  drawAim();

  // chairs
  Object.keys(chairBodies).forEach(function (id) {
    drawChair(chairBodies[id]);
  });

  // worker
  if (worker) drawWorker();

  // mug
  if (mug) drawMug(mug);

  // chickens (trail + body)
  chickens.forEach(function (c) {
    c.trail.forEach(function (t, i) {
      if (i === 0) return;
      var a = 1 - i / c.trail.length;
      ctx.globalAlpha = a * 0.25;
      ctx.fillStyle = c.golden ? "#ffe98a" : "#ffd23f";
      ctx.beginPath(); ctx.arc(t.x, t.y, 12 * a, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (c.golden) {
      ctx.save();
      ctx.translate(c.body.position.x, c.body.position.y);
      ctx.rotate(time * 3);
      ctx.strokeStyle = "rgba(255,233,138,0.7)";
      ctx.lineWidth = 3;
      for (var i = 0; i < 5; i++) {
        var a = i * Math.PI * 2 / 5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
        ctx.lineTo(Math.cos(a) * 32, Math.sin(a) * 32);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawChickenSprite(c.body.position.x, c.body.position.y, 15, c.body.angle, c.squish, c.golden);
  });

  drawLauncher();

  // particles
  particles.forEach(function (p) {
    var a = 1 - p.age / p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
  ctx.globalAlpha = 1;

  // floaters
  floaters.forEach(function (f) {
    var a = 1 - f.age / f.dur;
    ctx.globalAlpha = a;
    ctx.font = "bold " + f.size + "px Arial Black, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  });
  ctx.globalAlpha = 1;

  drawHUD();
  drawBanner();
  ctx.restore();
}

/* ---------------- BOOT ---------------- */
engine = Engine.create();
Events.on(engine, "collisionStart", onCollision);
setupWorld();
requestAnimationFrame(tick);
// tiny debug hook (harmless in production, useful for testing)
window.__CHICKEN_CANNON = {
  get state() { return state; },
  get score() { return score; },
  get chickensLeft() { return chickensLeft; },
  get chairsLeft() { return Object.keys(chairBodies).length; },
  get combo() { return combo; },
  get activeChicken() { return activeChicken ? { x: activeChicken.body.position.x, y: activeChicken.body.position.y, vx: activeChicken.body.velocity.x, vy: activeChicken.body.velocity.y } : null; },
  get chickens() { return chickens.length; },
  get chairHP() { return Object.keys(chairBodies).map(function(k){ var d = chairBodies[k]; return { hp: d.hp.toFixed(0), max: d.maxHp, x: d.body.position.x.toFixed(0), y: d.body.position.y.toFixed(0), layer: d.layer }; }); },
  get chairCount() { return Object.keys(chairBodies).length; },
  get hits() { return { count: hitCount, avgSpeed: hitCount ? (hitSpeedSum/hitCount).toFixed(2) : 0 }; },
  forceTwist: function (kind) {
    if (kind === 'mug') dropMug();
    else if (kind === 'ducks') rainDucks();
    else if (kind === 'fire') fireDrillNow();
    return 'twist: ' + kind;
  },
  get mug() { return mug ? { word: mug.word, x: mug.body.position.x.toFixed(0), y: mug.body.position.y.toFixed(0), landed: mug.landed } : null; },
  fire: function (sx, sy, ex, ey) {
    // simulate a slingshot shot in game coordinates
    var ev = function (type, x, y) {
      canvas.dispatchEvent(new (type === "mousedown" ? MouseEvent : MouseEvent)(type, {
        clientX: 0, clientY: 0, bubbles: true
      }));
    };
    // directly drive the internal aim state
    aiming = true;
    aimStart = { x: sx, y: sy };
    aimNow = { x: ex, y: ey };
    var drag = Vector.sub(aimNow, aimStart);
    aiming = false;
    if (Vector.magnitude(drag) > 24) launchChicken({ from: aimStart, to: aimNow, mag: Vector.magnitude(drag) });
  },
  get worker() { return worker ? worker.flash : null; }
};
window.addEventListener("keydown", function (e) {
  if (e.key === "m" || e.key === "M") {
    AudioFX.ensure();
    var m = AudioFX.toggle();
    floatText(W / 2, 120, m ? "SOUND OFF" : "SOUND ON", "#fff", 1.0, 20);
  }
  if (e.key === " " && state === "menu") {
    document.getElementById("startBtn").click();
  }
});
})();
