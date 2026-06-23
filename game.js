/* =====================================================================
   HOOKED — an endless grapple-swing arcade game.
   Hold to grab the nearest anchor and swing (pendulum physics);
   release to fly. Chain swings, grab cents, go far.
   Vanilla JS + Canvas. No dependencies.
   ===================================================================== */
(() => {
  'use strict';

  // ---------------------------------------------------------------- setup
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const els = {
    dist: document.getElementById('distVal'),
    cents: document.getElementById('centsVal'),
    comboChip: document.getElementById('comboChip'),
    menu: document.getElementById('menu'),
    gameover: document.getElementById('gameover'),
    hud: document.getElementById('hud'),
    playBtn: document.getElementById('playBtn'),
    retryBtn: document.getElementById('retryBtn'),
    shareBtn: document.getElementById('shareBtn'),
    muteBtn: document.getElementById('muteBtn'),
    bestDist: document.getElementById('bestDist'),
    bestCents: document.getElementById('bestCents'),
    goTitle: document.getElementById('goTitle'),
    goDist: document.getElementById('goDist'),
    goCents: document.getElementById('goCents'),
    goCombo: document.getElementById('goCombo'),
    goBest: document.getElementById('goBest'),
    releaseHint: document.getElementById('releaseHint'),
    installBtn: document.getElementById('installBtn'),
    toast: document.getElementById('toast'),
  };

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- storage
  const SAVE_KEY = 'hooked.save.v1';
  const save = loadSave();
  function loadSave() {
    try { return Object.assign({ bestDist: 0, bestCents: 0, muted: false }, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); }
    catch { return { bestDist: 0, bestCents: 0, muted: false }; }
  }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }

  // ---------------------------------------------------------------- audio
  const Audio = (() => {
    let actx = null, master = null;
    let muted = save.muted;
    function ensure() {
      if (actx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.5;
      master.connect(actx.destination);
    }
    function blip(freq, dur = 0.08, type = 'sine', vol = 0.5, slide = 0) {
      if (muted) return;
      ensure();
      if (!actx) return;
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      grab() { blip(520, 0.07, 'triangle', 0.35, 180); },
      release() { blip(680, 0.06, 'sine', 0.25, -120); },
      coin(n = 0) { blip(880 + n * 70, 0.07, 'square', 0.22); },
      big() { blip(440, 0.12, 'sawtooth', 0.3, 260); },
      die() { blip(220, 0.5, 'sawtooth', 0.4, -160); },
      get muted() { return muted; },
      toggle() { muted = !muted; save.muted = muted; persist(); if (!muted) { ensure(); if (actx && actx.state === 'suspended') actx.resume(); } return muted; },
    };
  })();

  // ---------------------------------------------------------------- helpers
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  function vibrate(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch {} }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), 1600);
  }

  // ---------------------------------------------------------------- world
  // The world scrolls left; player moves right. Everything is in world-x.
  // Anchors live in the sky; cents float along plausible swing arcs;
  // the ground is a series of platforms with deadly gaps.

  const GROUND_Y_FRAC = 0.82;       // ground baseline as fraction of H (re-eval on resize use)
  function groundY() { return H * GROUND_Y_FRAC; }

  const game = {
    state: 'menu',                  // menu | playing | dead
    t: 0,
    speed: 0,                       // base forward scroll assist (world units/sec)
    camX: 0,
    shake: 0,
    flash: 0,
  };

  const player = {
    x: 0, y: 0, vx: 0, vy: 0, r: 13,
    anchor: null,                   // {x,y} when attached
    ropeLen: 0,
    grounded: false,
    trail: [],
    rot: 0,
    alive: true,
  };

  let anchors = [];                 // {x, y, id}
  let cents = [];                   // {x, y, taken, bob}
  let drones = [];                  // {x, y, vy, dir, t} hazards
  let platforms = [];               // {x0, x1, y}
  let particles = [];
  let floaters = [];                // {x,y,vy,txt,life,color}
  let stars = [];                   // background parallax dots

  let genX = 0;                     // how far ahead we've generated
  let lastPlatformEnd = 0;
  let nextAnchorX = 0;
  let comboCount = 0;               // consecutive coins this swing-chain
  let chainSwings = 0;              // swings without touching ground
  let bestChain = 0;
  let centsEarned = 0;
  let distanceM = 0;
  let difficulty = 0;

  const PX_PER_M = 18;              // pixels per "meter" for the score

  function initStars() {
    stars = [];
    for (let i = 0; i < 90; i++) {
      stars.push({
        x: Math.random(), y: Math.random() * 0.7,
        z: rand(0.15, 1), s: rand(0.6, 1.8),
      });
    }
  }

  function reset() {
    game.t = 0;
    game.speed = 70;
    game.camX = 0;
    game.shake = 0;
    game.flash = 0;
    difficulty = 0;

    anchors = []; cents = []; drones = []; platforms = []; particles = []; floaters = [];
    genX = 0; lastPlatformEnd = 0; nextAnchorX = 0;
    comboCount = 0; chainSwings = 0; bestChain = 0; centsEarned = 0; distanceM = 0;

    // start airborne, drifting forward over the water
    player.x = 110;
    player.y = groundY() - H * 0.45;
    player.vx = 220;
    player.vy = 0;
    player.anchor = null;
    player.ropeLen = 0;
    player.grounded = false;
    player.trail = [];
    player.rot = 0;
    player.spin = 0;
    player.flipAccum = 0;
    player.flips = 0;
    player.alive = true;

    initStars();
    // pre-generate world to the right
    while (genX < player.x + W * 2) generateChunk();

    // begin already hooked & swinging on a friendly anchor, so the player
    // is in the air from frame one and can't faceplant before learning
    const a0 = { x: player.x + 120, y: groundY() - H * 0.66, id: -1, pulse: 1 };
    anchors.unshift(a0);
    player.anchor = a0;
    player.ropeLen = Math.hypot(a0.x - player.x, a0.y - player.y);
  }

  // Procedurally extend the world to the right.
  function generateChunk() {
    const d = difficulty;

    // --- anchors: a flowing line of grapple points across the sky ---
    const anchorGap = rand(150, 215) - Math.min(40, d * 4);
    nextAnchorX = (nextAnchorX || genX) + Math.max(120, anchorGap);
    const skyTop = H * 0.2, skyBottom = H * 0.5;
    const ay = clamp(
      (anchors.length ? anchors[anchors.length - 1].y : H * 0.32) + rand(-100, 100),
      skyTop, skyBottom
    );
    anchors.push({ x: nextAnchorX, y: ay, id: nextAnchorX | 0, pulse: 0 });

    // cents arcing below the anchor — reward dipping low on a swing
    if (Math.random() < 0.85) {
      const n = 3 + (Math.random() < 0.4 ? 2 : 0);
      const baseX = nextAnchorX - rand(20, 80);
      const baseY = ay + rand(80, 190);
      for (let i = 0; i < n; i++) {
        const ph = (i / (n - 1) - 0.5);
        cents.push({
          x: baseX + ph * 90,
          y: baseY - Math.cos(ph * Math.PI) * 50,
          taken: false, bob: Math.random() * 6.28,
        });
      }
    }

    // --- floating drone hazards in the air, once things heat up ---
    if (d > 1.0 && Math.random() < 0.22) {
      const dy = rand(H * 0.46, H * 0.72);
      drones.push({
        x: nextAnchorX + rand(40, 120), y: dy, baseY: dy,
        t: Math.random() * 6.28, amp: rand(24, 70), spd: rand(1, 2.4),
      });
    }

    genX = nextAnchorX + 80;
  }

  function cullBehind() {
    const left = game.camX - 200;
    if (anchors.length > 60) anchors = anchors.filter(a => a.x > left);
    if (cents.length > 80) cents = cents.filter(c => c.x > left && !c.taken);
    drones = drones.filter(dr => dr.x > left - 100);
    if (platforms.length > 40) platforms = platforms.filter(p => p.x1 > left);
    particles = particles.filter(p => p.life > 0);
    floaters = floaters.filter(f => f.life > 0);
  }

  // ---------------------------------------------------------------- input
  let pressing = false;

  function findAnchor() {
    // best anchor ahead of player & overhead, within reach
    let best = null, bestScore = Infinity;
    const maxLen = Math.min(H * 0.95, 560);
    for (const a of anchors) {
      const dx = a.x - player.x;
      const dy = a.y - player.y;
      if (a.y > player.y - 4) continue;          // must be above
      if (dx < -60) continue;                    // not far behind
      const len = Math.hypot(dx, dy);
      if (len > maxLen || len < 30) continue;
      // prefer anchors ahead and not too steep; favour forward progress
      const score = len + Math.max(0, -dx) * 2.0 + Math.abs(dx - len * 0.5) * 0.15;
      if (score < bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  function grab() {
    if (game.state !== 'playing') return;
    const a = findAnchor();
    if (!a) return;
    player.anchor = a;
    // cap the rope so it never grows unbounded across swings (which made
    // the player sink lower and lower); a too-long grab gently pulls up
    player.ropeLen = Math.min(Math.hypot(a.x - player.x, a.y - player.y), H * 0.5);
    a.pulse = 1;
    player.grounded = false;
    player.spin = 0;
    player.flipAccum = 0;
    chainSwings++;
    Audio.grab();
    vibrate(8);
    for (let i = 0; i < 6; i++) spark(a.x, a.y, '#4be1ec');
  }

  function letGo() {
    if (player.anchor) {
      player.anchor = null;
      Audio.release();
      // always launch forward & slightly up, so even a mistimed release flies
      // on with a somersault instead of dropping straight down
      player.vx = Math.max(player.vx + 70, 230);
      player.vy = Math.min(player.vy, -90);
      const sp = Math.hypot(player.vx, player.vy);
      player.spin = clamp(4 + sp / 90, 5, 16);
      player.flipAccum = 0;
    }
  }

  // a completed mid-air somersault pays a bonus that scales with the chain
  function onFlip() {
    player.flips++;
    const bonus = 2 * (1 + Math.floor(chainSwings / 2));
    centsEarned += bonus;
    Audio.big();
    vibrate(8);
    floatText(player.x, player.y - 24, 'SALTO! +' + bonus + '¢', '#8af4ff');
    burst(player.x, player.y, '#8af4ff', 8);
    updateHud();
  }

  function onDown(e) {
    e.preventDefault();
    if (game.state === 'menu') { startGame(); return; }
    if (game.state === 'dead') {
      // ignore taps for a beat to avoid accidental restart, handled by button
      return;
    }
    pressing = true;
    grab();
  }
  function onUp(e) {
    if (e) e.preventDefault();
    pressing = false;
    letGo();
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointerup', onUp, { passive: false });
  window.addEventListener('pointercancel', onUp, { passive: false });

  // desktop: spacebar = grapple
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (game.state === 'menu') return startGame();
      if (game.state === 'dead') return startGame();
      pressing = true; grab();
    }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { pressing = false; letGo(); } });

  // ---------------------------------------------------------------- fx
  function spark(x, y, color) {
    particles.push({
      x, y,
      vx: rand(-120, 120), vy: rand(-160, 40),
      life: rand(0.3, 0.7), max: 0.7, r: rand(1.5, 3.5), color,
    });
  }
  function burst(x, y, color, n = 10) { for (let i = 0; i < n; i++) spark(x, y, color); }
  function floatText(x, y, txt, color) {
    floaters.push({ x, y, vy: -42, txt, life: 0.9, color });
  }

  // ---------------------------------------------------------------- physics
  const GRAV = 1450;                 // px/s^2

  function step(dt) {
    game.t += dt;
    difficulty = game.t / 22;        // ramps over time
    game.speed = 70 + difficulty * 16;

    // holding the screen continuously seeks the next anchor, so a swing
    // chains the instant a reachable anchor appears — no pixel-perfect tap
    if (pressing && !player.anchor) grab();

    // integrate
    player.vy += GRAV * dt;

    if (player.anchor) {
      // pump the swing for amplitude, plus a gentle forward drive so simply
      // holding always makes you progress along the line
      const a = player.anchor;
      const ang = Math.atan2(player.y - a.y, player.x - a.x);
      const tang = ang + Math.PI / 2;
      if (pressing) {
        const swingDir = Math.sign(player.vx) || 1;
        player.vx += Math.cos(tang) * swingDir * 240 * dt;
        player.vy += Math.sin(tang) * swingDir * 240 * dt;
        player.vx += 120 * dt;
        // reel the rope in while holding → climb back up and accelerate,
        // so successive swings don't sink you into the water
        player.ropeLen = Math.max(80, player.ropeLen - 300 * dt);
      }
    } else {
      // free flight: hold a forward cruise so momentum never collapses into a
      // vertical drop — you always sail on toward the next anchor
      const cruise = 240 + difficulty * 22;
      if (player.vx < cruise) player.vx += (cruise - player.vx) * 1.4 * dt;
      if (player.vx < 130) player.vx = 130;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // rope constraint (position-based) — keep on circle & kill radial vel
    if (player.anchor) {
      const a = player.anchor;
      let dx = player.x - a.x, dy = player.y - a.y;
      let dist = Math.hypot(dx, dy) || 0.0001;
      if (dist > player.ropeLen) {
        const nx = dx / dist, ny = dy / dist;
        player.x = a.x + nx * player.ropeLen;
        player.y = a.y + ny * player.ropeLen;
        // remove outward radial velocity component
        const radial = player.vx * nx + player.vy * ny;
        if (radial > 0) { player.vx -= radial * nx; player.vy -= radial * ny; }
      }
      a.pulse = Math.max(a.pulse, 0.6);
    }

    // trail
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 18) player.trail.shift();

    // rotation: hang along the rope while swinging, somersault while free
    if (player.anchor) {
      const a = player.anchor;
      const target = Math.atan2(player.y - a.y, player.x - a.x) - Math.PI / 2;
      player.rot += (target - player.rot) * Math.min(1, dt * 12);
    } else {
      player.rot += player.spin * dt;
      player.flipAccum += player.spin * dt;
      if (Math.abs(player.flipAccum) >= Math.PI * 2) {
        player.flipAccum -= Math.sign(player.flipAccum) * Math.PI * 2;
        onFlip();
      }
    }

    // camera follows, biased so player sits left-of-center
    const targetCam = player.x - W * 0.34;
    game.camX = lerp(game.camX, Math.max(targetCam, game.camX), 1 - Math.pow(0.001, dt));
    if (targetCam > game.camX) game.camX = targetCam; // never scroll backward

    // distance score
    distanceM = Math.max(distanceM, Math.floor(player.x / PX_PER_M));

    // generate / cull
    while (genX < game.camX + W * 1.6) generateChunk();
    cullBehind();

    // collisions: cents
    for (const c of cents) {
      if (c.taken) continue;
      c.bob += dt * 4;
      if (Math.abs(c.x - player.x) < 26 && Math.abs(c.y - player.y) < 26) {
        c.taken = true;
        comboCount++;
        const mult = 1 + Math.floor(chainSwings / 2);
        const val = mult;
        centsEarned += val;
        Audio.coin(Math.min(comboCount, 8));
        vibrate(5);
        burst(c.x, c.y, '#ffd23f', 8);
        floatText(c.x, c.y - 10, '+' + val + '¢', '#ffd23f');
        updateHud();
      }
    }

    // drones
    for (const dr of drones) {
      dr.t += dt * dr.spd;
      dr.y = dr.baseY + Math.sin(dr.t) * dr.amp;
      if (Math.abs(dr.x - player.x) < 22 && Math.abs(dr.y - player.y) < 22) {
        return die('SWATTED');
      }
    }

    // water below — touch it and the run ends (no ground to roll on)
    const waterY = groundY();
    if (player.y + player.r >= waterY) {
      player.y = waterY;
      burst(player.x, waterY, '#8af4ff', 16);
      return die('SPLASH!');
    }

    // fx decay
    game.shake = Math.max(0, game.shake - dt * 60);
    game.flash = Math.max(0, game.flash - dt * 3);
    for (const a of anchors) a.pulse = Math.max(0, (a.pulse || 0) - dt * 2);
    for (const p of particles) {
      p.life -= dt; p.vy += GRAV * 0.35 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (const f of floaters) { f.life -= dt; f.y += f.vy * dt; f.vy *= 0.96; }

    // early coaching hint: teach the hold/release rhythm
    if (game.t < 6 && !player.anchor && distanceM < 14) {
      els.releaseHint.textContent = 'HOLD to swing';
      els.releaseHint.classList.remove('hidden');
    } else {
      els.releaseHint.classList.add('hidden');
    }
  }

  game.camYoffset = () => 0; // reserved (vertical camera locked for now)

  function die(reason) {
    if (game.state !== 'playing') return;
    player.alive = false;
    game.state = 'dead';
    game.shake = 22;
    game.flash = 1;
    Audio.die();
    vibrate([30, 40, 60]);
    burst(player.x, player.y, '#ff5d73', 22);

    bestChain = Math.max(bestChain, chainSwings);
    const newBestDist = distanceM > save.bestDist;
    const newBestCents = centsEarned > save.bestCents;
    save.bestDist = Math.max(save.bestDist, distanceM);
    save.bestCents = Math.max(save.bestCents, centsEarned);
    persist();

    els.goTitle.textContent = reason;
    els.goDist.textContent = distanceM;
    els.goCents.textContent = centsEarned;
    els.goCombo.textContent = 'x' + Math.max(1, bestChain);
    els.goBest.classList.toggle('hidden', !(newBestDist || newBestCents));

    setTimeout(() => {
      els.gameover.classList.remove('hidden');
      els.hud.style.opacity = '0';
    }, 420);
  }

  // ---------------------------------------------------------------- render
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // camera shake offset
    let sx = 0, sy = 0;
    if (game.shake > 0.1) {
      sx = rand(-1, 1) * game.shake;
      sy = rand(-1, 1) * game.shake;
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawSky();
    drawStars();
    drawSkyline();
    ctx.translate(-game.camX, 0);

    drawGround();
    drawCents();
    drawAnchors();
    drawDrones();
    if (game.state !== 'menu') {
      drawRope();
      drawPlayer();
    }
    drawParticles();
    drawFloaters();

    ctx.restore();

    // hit flash
    if (game.flash > 0.01) {
      ctx.fillStyle = `rgba(255,80,100,${game.flash * 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawSky() {
    const d = clamp(difficulty / 8, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    // shift from dusk to deep night as you progress
    g.addColorStop(0, mix('#1b2350', '#070818', d));
    g.addColorStop(0.55, mix('#2a2f63', '#0d1024', d));
    g.addColorStop(1, mix('#43325f', '#141026', d));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // moon
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#fdf3c7';
    ctx.beginPath();
    ctx.arc(W * 0.8, H * 0.2, 34, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.arc(W * 0.8, H * 0.2, 60, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawStars() {
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      const px = (s.x * W - game.camX * s.z * 0.05) % W;
      const x = (px + W) % W;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(game.t * 2 + s.x * 40);
      ctx.fillRect(x, s.y * H, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  // parallax city silhouettes
  function drawSkyline() {
    const layers = [
      { z: 0.25, col: 'rgba(20,24,52,0.9)', h: 0.34, step: 70, jag: 0.5 },
      { z: 0.5, col: 'rgba(14,17,40,0.95)', h: 0.26, step: 54, jag: 0.7 },
    ];
    for (const L of layers) {
      ctx.fillStyle = L.col;
      const base = H * GROUND_Y_FRAC;
      const off = -(game.camX * L.z) % (L.step * 2);
      ctx.beginPath();
      ctx.moveTo(-100, base);
      let x = -100 + off;
      let i = 0;
      while (x < W + 100) {
        const seed = Math.sin((Math.floor((game.camX * L.z) / L.step) + i) * 12.9898) * 43758.5453;
        const r = seed - Math.floor(seed);
        const bh = H * L.h * (0.45 + r * L.jag);
        ctx.lineTo(x, base - bh);
        ctx.lineTo(x + L.step, base - bh);
        x += L.step; i++;
      }
      ctx.lineTo(W + 100, base);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawGround() {
    // deadly water below the play area, with a shimmering wavy surface
    const wy = groundY();
    const left = game.camX - 20, right = game.camX + W + 20;
    const grad = ctx.createLinearGradient(0, wy, 0, H);
    grad.addColorStop(0, 'rgba(70,110,220,0.55)');
    grad.addColorStop(1, 'rgba(10,16,50,0.96)');
    ctx.fillStyle = grad;
    ctx.fillRect(left, wy, right - left, H);
    // wavy surface highlight
    ctx.strokeStyle = 'rgba(140,244,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = left; x <= right; x += 12) {
      const yy = wy + Math.sin(x * 0.045 + game.t * 3) * 4;
      if (x === left) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  function drawAnchors() {
    for (const a of anchors) {
      if (a.x < game.camX - 60 || a.x > game.camX + W + 60) continue;
      const pulse = a.pulse || 0;
      ctx.save();
      // glow
      ctx.globalAlpha = 0.25 + pulse * 0.5;
      ctx.fillStyle = '#4be1ec';
      ctx.beginPath(); ctx.arc(a.x, a.y, 12 + pulse * 10, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      // ring
      ctx.strokeStyle = '#8af4ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, 7); ctx.stroke();
      ctx.fillStyle = '#0d1020';
      ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  function drawCents() {
    for (const c of cents) {
      if (c.taken) continue;
      if (c.x < game.camX - 40 || c.x > game.camX + W + 40) continue;
      const y = c.y + Math.sin(c.bob) * 4;
      ctx.save();
      ctx.translate(c.x, y);
      const sq = Math.abs(Math.cos(c.bob * 0.8)); // fake spin
      ctx.scale(0.4 + sq * 0.6, 1);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#caa01f';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = '#caa01f'; ctx.stroke();
      ctx.fillStyle = '#7a5e00';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (sq > 0.5) ctx.fillText('¢', 0, 1);
      ctx.restore();
    }
  }

  function drawDrones() {
    for (const dr of drones) {
      if (dr.x < game.camX - 40 || dr.x > game.camX + W + 40) continue;
      ctx.save();
      ctx.translate(dr.x, dr.y);
      ctx.fillStyle = '#ff5d73';
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ff7b8c';
      roundRectPath(-12, -5, 24, 10, 4); ctx.fill();
      ctx.fillStyle = '#2a0c12';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
      // rotor blur
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(-4, -8);
      ctx.moveTo(14, -6); ctx.lineTo(4, -8); ctx.stroke();
      ctx.restore();
    }
  }

  function drawRope() {
    if (!player.anchor) return;
    const a = player.anchor;
    ctx.save();
    ctx.strokeStyle = '#8af4ff';
    ctx.lineWidth = 2.2;
    ctx.shadowColor = '#4be1ec';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(player.x, player.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer() {
    // trail
    for (let i = 0; i < player.trail.length; i++) {
      const t = player.trail[i];
      const k = i / player.trail.length;
      ctx.globalAlpha = k * 0.4;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(t.x, t.y, player.r * k * 0.9, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const spd = Math.hypot(player.vx, player.vy);
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.rot);
    // outer glow
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 16;
    const g = ctx.createRadialGradient(0, -3, 2, 0, 0, player.r);
    g.addColorStop(0, '#fff7d6');
    g.addColorStop(1, '#ffb938');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, player.r, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    // bold stripe + face so spins/somersaults read clearly
    ctx.strokeStyle = '#c8791a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-player.r + 2, 0); ctx.lineTo(player.r - 2, 0); ctx.stroke();
    ctx.fillStyle = '#3a2a00';
    ctx.beginPath(); ctx.arc(4, -4, 2.6, 0, 7); ctx.fill();
    ctx.restore();

    // speed lines when flying fast
    if (spd > 620 && !player.anchor) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      const a = Math.atan2(player.vy, player.vx);
      for (let i = 0; i < 3; i++) {
        const o = (i - 1) * 7;
        const bx = player.x - Math.cos(a) * (18 + i * 6) - Math.sin(a) * o;
        const by = player.y - Math.sin(a) * (18 + i * 6) + Math.cos(a) * o;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - Math.cos(a) * 16, by - Math.sin(a) * 16);
        ctx.stroke();
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = 'bold 18px -apple-system, system-ui, sans-serif';
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- ui glue
  let lastComboShown = 0;
  function updateHud() {
    els.dist.innerHTML = distanceM + '<small>m</small>';
    els.cents.innerHTML = centsEarned + '<small>¢</small>';
    const chain = Math.max(1, chainSwings);
    if (chain >= 2) {
      els.comboChip.textContent = 'x' + chain;
      els.comboChip.classList.remove('hidden');
      if (chain !== lastComboShown) {
        els.comboChip.style.animation = 'none';
        void els.comboChip.offsetWidth;
        els.comboChip.style.animation = '';
        lastComboShown = chain;
      }
    } else {
      els.comboChip.classList.add('hidden');
    }
  }

  function startGame() {
    reset();
    game.state = 'playing';
    els.menu.classList.add('hidden');
    els.gameover.classList.add('hidden');
    els.hud.style.opacity = '1';
    updateHud();
    Audio.big();
  }

  els.playBtn.addEventListener('click', startGame);
  els.retryBtn.addEventListener('click', startGame);
  els.muteBtn.addEventListener('click', () => {
    const m = Audio.toggle();
    els.muteBtn.textContent = m ? '🔈 Sound off' : '🔊 Sound on';
  });
  els.muteBtn.textContent = Audio.muted ? '🔈 Sound off' : '🔊 Sound on';

  els.shareBtn.addEventListener('click', async () => {
    const text = `I swung ${distanceM}m and banked ${centsEarned}¢ in HOOKED! Can you beat me?`;
    try {
      if (navigator.share) await navigator.share({ title: 'HOOKED', text });
      else { await navigator.clipboard.writeText(text); toast('Score copied!'); }
    } catch {}
  });

  // ---------------------------------------------------------------- menus
  function refreshMenu() {
    els.bestDist.textContent = save.bestDist;
    els.bestCents.textContent = save.bestCents;
  }
  refreshMenu();

  // ambient menu sim: a coin drifts to feel alive
  function menuAmbient(dt) {
    // gentle camera drift over a generated world for the backdrop
    game.camX += 24 * dt;
    while (genX < game.camX + W * 1.6) generateChunk();
    cullBehind();
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  let acc = 0;
  const FIXED = 1 / 120;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;           // clamp big stalls

    if (game.state === 'playing') {
      acc += dt;
      let guard = 0;
      while (acc >= FIXED && guard++ < 8) { step(FIXED); acc -= FIXED; }
    } else if (game.state === 'menu') {
      menuAmbient(dt);
    } else if (game.state === 'dead') {
      // let particles settle
      for (const p of particles) { p.life -= dt; p.vy += GRAV * 0.35 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      for (const f of floaters) { f.life -= dt; f.y += f.vy * dt; }
      game.shake = Math.max(0, game.shake - dt * 60);
      game.flash = Math.max(0, game.flash - dt * 2);
    }

    draw();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- color util
  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    return `rgb(${Math.round(lerp(ca[0], cb[0], t))},${Math.round(lerp(ca[1], cb[1], t))},${Math.round(lerp(ca[2], cb[2], t))})`;
  }
  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- boot
  // build a menu backdrop world
  reset();
  game.state = 'menu';
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- PWA
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.classList.remove('hidden');
  });
  els.installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.installBtn.classList.add('hidden');
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
