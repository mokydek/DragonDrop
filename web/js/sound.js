// Sounds made on the fly with Web Audio (no files to download): ticks while a case strip spins,
// coins when brainrots are sold, a fanfare and firework pops when an upgrade wins. Off with the
// "Sound" switch in the profile.

let ctx = null;
let bus = null;
let on = true;
let noise = null;

export function setSound(v) {
  on = !!v;
}

/** Tells the page (and the tests) which sound just played. */
function emit(name) {
  try {
    window.dispatchEvent(new CustomEvent('bs:sfx', { detail: name }));
  } catch {
    /* old webview */
  }
}

function audio() {
  if (!on) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      // everything goes through a soft limiter, so stacked sounds never clip
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      bus = ctx.createGain();
      bus.gain.value = 0.7;
      bus.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers start audio muted until the first touch: called on every tap until it runs. */
export function unlockAudio() {
  if (!on || (ctx && ctx.state === 'running')) return;
  const ac = audio();
  if (!ac) return;
  try {
    const b = ac.createBuffer(1, 1, 22050);
    const s = ac.createBufferSource();
    s.buffer = b;
    s.connect(ac.destination);
    s.start(0);
  } catch {
    /* nothing to unlock */
  }
}

function noiseBuffer(ac) {
  if (noise && noise.sampleRate === ac.sampleRate) return noise;
  noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** A short burst of filtered noise. */
function hiss(ac, t, { type = 'highpass', freq = 5000, q = 0.7, vol = 0.1, dur = 0.04 } = {}) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

/** One coin hitting the others: a few bright inharmonic partials that ring out fast. */
function clink(ac, t, freq, vol, ring = 1) {
  const parts = [
    [1, 0.36],
    [1.47, 0.25],
    [2.09, 0.17],
    [2.56, 0.12],
    [3.18, 0.08],
  ].map(([r, d]) => [r, d * ring]);
  parts.forEach(([ratio, decay], i) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol / (i + 1.3), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + decay + 0.02);
  });
  hiss(ac, t, { freq: 6000, vol: vol * 0.5, dur: 0.025 });
}

/** A brainrot passing the marker of a case strip: a short dry click (fewer as the strip slows down). */
export function tick() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.003;
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(1650, t);
  o.frequency.exponentialRampToValueAtTime(700, t + 0.035);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + 0.06);
  hiss(ac, t, { type: 'bandpass', freq: 3200, q: 1.2, vol: 0.12, dur: 0.018 });
  emit('tick');
}

/** Coins: a few for one brainrot, a whole handful when many are sold at once. */
export function coins(count = 1) {
  const ac = audio();
  if (!ac) return;
  const n = Math.min(3 + Math.floor(Math.log2(Math.max(1, count)) * 2), 10);
  const t0 = ac.currentTime + 0.01;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 0.055 + Math.random() * 0.03;
    clink(ac, t, 2100 + Math.random() * 1500, 0.15 + Math.random() * 0.07);
  }
  // the last coin rings out a little longer
  clink(ac, t0 + n * 0.055 + 0.03, 3300, 0.17, 1.8);
  emit('coins');
}

/** A note with a soft brassy edge; `hold` notes get a little vibrato. */
function note(ac, out, freq, t, dur, vol, hold = false) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.setValueAtTime(vol, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  const oscs = [
    ['triangle', 1],
    ['square', 0.16],
    ['sine', 0.35, 2],
  ].map(([type, level, mult = 1]) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    const lg = ac.createGain();
    lg.gain.value = level;
    o.connect(lg).connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  });
  if (hold) {
    const lfo = ac.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ac.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(freq * 0.007, t + 0.25);
    lfo.connect(depth);
    for (const o of oscs) depth.connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
}

/** A high glassy ping (the sparkle over the fanfare). */
function ping(ac, t, freq, vol) {
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + 0.2);
}

/** The upgrade went in: a rising run up to a held major chord with a sparkle on top. */
export function win() {
  const ac = audio();
  if (!ac) return;
  const out = ac.createBiquadFilter();
  out.type = 'lowpass';
  out.frequency.value = 3800;
  out.connect(bus);
  const t0 = ac.currentTime + 0.02;
  const run = [392, 523.25, 659.25, 783.99];
  run.forEach((f, i) => note(ac, out, f, t0 + i * 0.085, 0.17, 0.2));
  const tc = t0 + run.length * 0.085 + 0.02;
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => note(ac, out, f, tc, 0.9, 0.11, true));
  for (let i = 0; i < 8; i++) ping(ac, tc + 0.04 + i * 0.065 + Math.random() * 0.03, 1900 + Math.random() * 2300, 0.035);
  emit('win');
}

/** A firework bursting: a soft thump, the bang and a little crackle. */
export function pop() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + 0.25);
  hiss(ac, t, { type: 'bandpass', freq: 1300, q: 0.6, vol: 0.12, dur: 0.16 });
  for (let i = 0; i < 6; i++) hiss(ac, t + 0.12 + Math.random() * 0.35, { freq: 4000 + Math.random() * 3000, vol: 0.025, dur: 0.02 });
  emit('pop');
}
