// Renders the /start pictures from the DragonDrop logo (assets/logo-original.png, transparent):
//   web/img/banner.jpg            — the logo on a dark background with a golden glow
//   web/img/banner-halloween.jpg  — the same logo on a Halloween night (moon, bats, webs, pumpkins, coins)
// node scripts/make-banner.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { coin } from '../web/js/util.js';
import { PUMPKIN, batSvg, webSvg } from '../web/js/halloween.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const logo = 'data:image/png;base64,' + readFileSync(path.join(root, 'assets', 'logo-original.png')).toString('base64');
const W = 1280;
const H = 640;
const LOGO_W = 1080; // the logo is 1208 × 234

// deterministic pseudo-random so the pictures are reproducible
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const defs = `<svg width="0" height="0" style="position:absolute"><defs>
  <linearGradient id="bs-coin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="0.55" stop-color="#ffc233"/><stop offset="1" stop-color="#e8940f"/></linearGradient>
  <linearGradient id="bs-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset="0.5" stop-color="#f6c343"/><stop offset="1" stop-color="#c98912"/></linearGradient>
</defs></svg>`;

const page = (body, background) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { position: relative; background: ${background}; }
  .abs { position: absolute; }
  .abs svg { display: block; width: 100%; height: auto; }
  .logo { position: absolute; left: ${(W - LOGO_W) / 2}px; top: 50%; width: ${LOGO_W}px; transform: translateY(-50%);
    filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.55)); }
  .logo img { display: block; width: 100%; height: auto; }
</style></head><body>${defs}${body}<div class="logo"><img src="${logo}" alt=""></div></body></html>`;

const at = (x, y, w, inner, extra = '') => `<div class="abs" style="left:${x}px;top:${y}px;width:${w}px;${extra}">${inner}</div>`;
const coinAt = (x, y, size) => at(x, y, size, coin(size).__html, 'filter:drop-shadow(0 0 8px rgba(255,200,60,.55))');
const pumpkinAt = (x, y, w, rot = 0) => at(x, y, w, PUMPKIN, `transform:rotate(${rot}deg);filter:drop-shadow(0 0 18px rgba(255,140,30,.55))`);
const batAt = (x, y, w, flap, rot = 0, op = 1) => at(x, y, w, batSvg(w, '#0d0414', flap), `transform:rotate(${rot}deg);opacity:${op}`);

// ------------------------------------------------------------------ the usual one
const usual = page(
  '',
  `radial-gradient(46% 42% at 50% 50%, rgba(255, 190, 40, 0.24), transparent 70%),
   radial-gradient(90% 80% at 50% 50%, #1b1810 0%, #100f14 70%)`,
);

// ------------------------------------------------------------------ Halloween
const stars = Array.from({ length: 70 }, () => {
  const x = rnd() * W;
  const y = rnd() * H;
  const r = 0.6 + rnd() * 1.6;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" opacity="${(0.25 + rnd() * 0.55).toFixed(2)}"/>`;
}).join('');
const halloween = page(
  `<svg class="abs" style="left:0;top:0" width="${W}" height="${H}">${stars}</svg>
  <div class="abs" style="left:1060px;top:34px;width:104px;height:104px;border-radius:50%;
    background:radial-gradient(circle at 38% 36%, #fff8dc 0%, #ffe9a8 45%, #f7c860 100%);
    box-shadow:0 0 40px 12px rgba(255,220,140,.45), 0 0 120px 40px rgba(255,170,60,.25)"></div>
  <div class="abs" style="left:0;top:0;width:230px;color:rgba(255,255,255,.28)">${webSvg(230)}</div>
  <div class="abs" style="right:0;top:0;width:170px;color:rgba(255,255,255,.28);transform:scaleX(-1)">${webSvg(170)}</div>
  ${batAt(1000, 96, 70, 0.6, -8)}${batAt(940, 36, 40, 0.2, -4, 0.85)}${batAt(255, 66, 62, -0.5, 6)}${batAt(350, 118, 40, 0.7, -10, 0.85)}${batAt(170, 148, 34, 0.1, 4, 0.75)}
  ${pumpkinAt(26, 500, 120, -6)}${pumpkinAt(150, 548, 70, 8)}${pumpkinAt(1138, 494, 118, 6)}${pumpkinAt(1060, 552, 64, -8)}${pumpkinAt(470, 560, 56, -4)}${pumpkinAt(752, 556, 60, 6)}
  ${coinAt(96, 128, 34)}${coinAt(438, 92, 30)}${coinAt(822, 70, 30)}
  ${coinAt(280, 560, 34)}${coinAt(560, 580, 30)}${coinAt(670, 590, 28)}${coinAt(978, 566, 34)}`,
  `radial-gradient(46% 40% at 50% 50%, rgba(255, 128, 32, 0.42), transparent 70%),
   radial-gradient(70% 60% at 50% 0%, #3d0f6b 0%, transparent 70%),
   radial-gradient(60% 50% at 0% 100%, rgba(255, 110, 20, 0.22), transparent 70%),
   radial-gradient(60% 50% at 100% 100%, rgba(255, 110, 20, 0.22), transparent 70%),
   linear-gradient(180deg, #250a40 0%, #0d0517 100%)`,
);

const browser = await pw.chromium.launch();
const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
for (const [name, html] of [['banner.jpg', usual], ['banner-halloween.jpg', halloween]]) {
  await tab.setContent(html, { waitUntil: 'load' });
  await tab.waitForTimeout(300);
  const out = path.join(root, 'web', 'img', name);
  await tab.screenshot({ path: out, type: 'jpeg', quality: 90 });
  console.log('written', out);
}
await browser.close();
