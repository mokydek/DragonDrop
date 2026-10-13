// Fireworks over the whole screen for a big moment (an upgrader win): rockets fly up and burst
// into sparks. Drawn on a canvas that lets taps through; it removes itself when the last spark fades.

const HUES = [46, 28, 330, 190, 275, 125, 4]; // gold, orange, pink, cyan, violet, green, red

/**
 * @param {object} o
 * @param {number} [o.bursts] how many rockets
 * @param {Function} [o.onBurst] called when a rocket bursts (the pop sound)
 * @returns {HTMLCanvasElement|null}
 */
export function fireworks({ bursts = 6, onBurst = null } = {}) {
  let n = bursts;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) n = Math.min(n, 2);
  } catch {
    /* old webview */
  }
  const cv = document.createElement('canvas');
  cv.className = 'fireworks';
  cv.setAttribute('aria-hidden', 'true');
  const g = cv.getContext && cv.getContext('2d');
  if (!g) return null;
  document.body.appendChild(cv);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const t0 = performance.now();
  const rockets = Array.from({ length: n }, (_, i) => ({
    at: t0 + 80 + i * 240 + Math.random() * 140,
    x0: W * (0.18 + Math.random() * 0.64),
    x1: W * (0.12 + Math.random() * 0.76),
    y1: H * (0.1 + Math.random() * 0.26),
    hue: HUES[i % HUES.length] + Math.random() * 16 - 8,
    done: false,
  }));
  const sparks = [];

  function burst(x, y, hue) {
    const count = 54 + Math.floor(Math.random() * 18);
    const speed = 2.7 + Math.random() * 1.5;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.25;
      const v = speed * (0.45 + Math.random() * 0.55);
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1,
        decay: 0.011 + Math.random() * 0.009,
        hue: hue + Math.random() * 30 - 15,
        r: 1.5 + Math.random() * 1.4,
      });
    }
    // a bright flash in the middle
    sparks.push({ x, y, vx: 0, vy: 0, life: 1, decay: 0.16, hue, r: 5, flash: true });
    if (onBurst) {
      try {
        onBurst();
      } catch {
        /* the sound is optional */
      }
    }
  }

  let last = t0;
  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.67);
    last = now;
    // fade what was drawn before: the sparks leave short trails
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0, 0, 0, 0.3)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (const r of rockets) {
      if (r.done || now < r.at) continue;
      const p = Math.min(1, (now - r.at) / 620);
      const e = 1 - Math.pow(1 - p, 2.4); // slows down near the top
      const x = r.x0 + (r.x1 - r.x0) * e;
      const y = H + 8 + (r.y1 - H - 8) * e;
      g.fillStyle = `hsla(${r.hue}, 100%, 75%, 0.95)`;
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
      if (p >= 1) {
        r.done = true;
        burst(x, y, r.hue);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      const drag = Math.pow(0.984, dt);
      s.vx *= drag;
      s.vy = s.vy * drag + 0.045 * dt; // gravity
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= s.decay * dt;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      g.fillStyle = s.flash ? `hsla(${s.hue}, 100%, 88%, ${s.life * 0.55})` : `hsla(${s.hue}, 100%, ${52 + 28 * s.life}%, ${Math.min(1, s.life * 1.5)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.flash ? s.r * (2 - s.life) : s.r * (0.55 + 0.45 * s.life), 0, Math.PI * 2);
      g.fill();
    }
    if ((rockets.every((r) => r.done) && !sparks.length) || now - t0 > 7000) {
      cv.remove();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return cv;
}
