// The dragon's lair: embers rising from the lava glow, on a canvas (tinted by the colour theme).
// On Halloween (admin switch): bats and pumpkins instead.
import { PUMPKIN, batPath } from './halloween.js';

let tint = '255,168,64';
let mode = 'bubbles'; // or 'halloween'
let onMode = null; // set by startBubbles: refills the sky when the mode changes

export function setBubbleTint(rgb) {
  tint = rgb;
}

/** 'bubbles' (usual: the embers) or 'halloween' (bats and pumpkins). */
export function setSkyMode(m) {
  const next = m === 'halloween' ? 'halloween' : 'bubbles';
  if (next === mode) return;
  mode = next;
  if (onMode) onMode();
}

// Halloween sprites: the pumpkin drawn once into an image, bat outlines cached per wing position.
let pumpkinImg = null;
function pumpkin() {
  if (!pumpkinImg && typeof Image !== 'undefined') {
    pumpkinImg = new Image();
    pumpkinImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(PUMPKIN.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="120" '));
  }
  return pumpkinImg;
}
const batCache = new Map();
function batShape(flap) {
  const k = Math.round(flap * 10); // -10..10
  if (!batCache.has(k)) batCache.set(k, new Path2D(batPath(30, k / 10)));
  return batCache.get(k);
}

export function startBubbles(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let bubbles = [];
  let pumpkins = [];
  let bats = [];
  let raf = 0;
  let last = performance.now();

  // an ember: a small hot spark (now and then a bigger, softer one) drifting up and flickering
  function spawn(initial) {
    const big = Math.random() < 0.16;
    const r = big ? 2.8 + Math.random() * 2.6 : 0.9 + Math.random() * 1.7;
    return {
      x: Math.random() * w,
      y: initial ? h * (0.15 + Math.random() * 0.85) : h + 10 + Math.random() * 40,
      r,
      speed: (big ? 12 : 22) + Math.random() * 34, // px per second
      phase: Math.random() * Math.PI * 2,
      wobble: 8 + Math.random() * 22,
      freq: 0.35 + Math.random() * 0.9,
      flicker: 5 + Math.random() * 7,
      alpha: big ? 0.2 + Math.random() * 0.22 : 0.55 + Math.random() * 0.45,
    };
  }

  function spawnPumpkin(initial) {
    const size = 9 + Math.random() * 15; // px wide
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : h + size + Math.random() * 60,
      size,
      speed: 10 + size * 0.9 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      wobble: 8 + Math.random() * 16,
      freq: 0.4 + Math.random() * 0.7,
      alpha: 0.16 + (size - 9) / 70 + Math.random() * 0.12, // faint: they float behind see-through cards
    };
  }

  function spawnBat(initial) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const span = 11 + Math.random() * 13; // half wingspan, px
    return {
      x: initial ? Math.random() * w : dir > 0 ? -span * 2 - Math.random() * w * 0.5 : w + span * 2 + Math.random() * w * 0.5,
      y: 40 + Math.random() * Math.max(80, h - 160),
      dir,
      span,
      speed: 28 + Math.random() * 40,
      phase: Math.random() * Math.PI * 2,
      wave: 8 + Math.random() * 22,
      flap: Math.random() * Math.PI * 2,
      flapRate: 9 + Math.random() * 6, // wing beats, rad per second
      alpha: 0.5 + Math.random() * 0.35,
    };
  }

  function fill() {
    const area = w * h;
    if (mode === 'halloween') {
      const np = Math.round(Math.min(16, Math.max(6, area / 40000)));
      const nb = Math.round(Math.min(10, Math.max(4, area / 60000)));
      while (pumpkins.length < np) pumpkins.push(spawnPumpkin(true));
      pumpkins.length = np;
      while (bats.length < nb) bats.push(spawnBat(true));
      bats.length = nb;
    } else {
      const target = Math.round(Math.min(64, Math.max(24, area / 12000)));
      while (bubbles.length < target) bubbles.push(spawn(true));
      bubbles.length = target;
    }
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fill();
  }

  function drawPumpkin(p, x) {
    const img = pumpkin();
    if (!img || !img.complete || !img.naturalWidth) return;
    const ph = p.size * (60 / 64);
    ctx.save();
    ctx.globalAlpha = Math.min(0.9, p.alpha);
    ctx.translate(x, p.y);
    ctx.rotate(Math.sin(p.phase) * 0.22);
    ctx.drawImage(img, -p.size / 2, -ph / 2, p.size, ph);
    ctx.restore();
  }

  function drawBat(b, y) {
    const scale = b.span / 30;
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.translate(b.x, y);
    ctx.scale(scale, scale);
    const shape = batShape(Math.sin(b.flap));
    ctx.fillStyle = '#12061d';
    ctx.fill(shape);
    ctx.lineWidth = 1.2 / scale; // a thin rim lit by the pumpkins, so the bats show on the night sky
    ctx.strokeStyle = 'rgba(255,150,60,0.55)';
    ctx.stroke(shape);
    ctx.restore();
  }

  function frameHalloween(dt) {
    for (let i = 0; i < pumpkins.length; i++) {
      const p = pumpkins[i];
      if (!reduce) {
        p.y -= p.speed * dt;
        p.phase += p.freq * dt;
      }
      if (p.y < -p.size * 2) pumpkins[i] = spawnPumpkin(false);
      drawPumpkin(pumpkins[i], pumpkins[i].x + Math.sin(pumpkins[i].phase) * pumpkins[i].wobble);
    }
    for (let i = 0; i < bats.length; i++) {
      const b = bats[i];
      if (!reduce) {
        b.x += b.dir * b.speed * dt;
        b.phase += dt * 1.4;
        b.flap += b.flapRate * dt;
      }
      if ((b.dir > 0 && b.x > w + b.span * 2) || (b.dir < 0 && b.x < -b.span * 2)) bats[i] = spawnBat(false);
      drawBat(bats[i], bats[i].y + Math.sin(bats[i].phase) * bats[i].wave);
    }
  }

  function drawBubble(b, x) {
    // fades out on the way up, flickers like a spark
    const life = Math.max(0, Math.min(1, b.y / (h * 0.92)));
    const a = b.alpha * (0.25 + 0.75 * life) * (0.7 + 0.3 * Math.sin(b.phase * b.flicker));
    if (a <= 0.01) return;
    const glow = b.r * 4.2;
    const g = ctx.createRadialGradient(x, b.y, 0, x, b.y, glow);
    g.addColorStop(0, `rgba(255,246,222,${a})`);
    g.addColorStop(0.18, `rgba(${tint},${a * 0.9})`);
    g.addColorStop(0.45, `rgba(${tint},${a * 0.25})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - glow, b.y - glow, glow * 2, glow * 2);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    if (mode === 'halloween') {
      frameHalloween(dt);
      if (!reduce) raf = requestAnimationFrame(frame);
      return;
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      if (!reduce) {
        b.y -= b.speed * dt;
        b.phase += b.freq * dt;
      }
      if (b.y < -b.r * 6) bubbles[i] = spawn(false);
      drawBubble(bubbles[i], bubbles[i].x + Math.sin(bubbles[i].phase) * bubbles[i].wobble);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!reduce) raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  onMode = () => {
    fill();
    if (!reduce) return;
    // no animation: draw the still sky once more when the pumpkin picture is ready
    const img = mode === 'halloween' ? pumpkin() : null;
    if (img && !img.complete) img.onload = () => frame(performance.now());
    frame(performance.now());
  };
  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });
  start();
  return { redraw: () => (reduce ? frame(performance.now()) : null) };
}
