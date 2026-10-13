// Shared helpers: safe HTML templates, formatting, Telegram bridge, art.

export const tg = typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

// ---------------------------------------------------------------- templates
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export function raw(s) {
  return { __html: String(s) };
}
function part(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (typeof v === 'object' && '__html' in v) return v.__html;
  return esc(v);
}
/** Tagged template: interpolations are escaped unless wrapped in raw()/html``. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return raw(out);
}
export function render(el, tpl) {
  el.innerHTML = tpl && tpl.__html !== undefined ? tpl.__html : '';
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- misc
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function safeStorage() {
  try {
    const k = '__bs_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  }
}
export const store = safeStorage();

// ---------------------------------------------------------------- haptics
export const haptic = {
  tick() {
    try {
      tg?.HapticFeedback?.selectionChanged();
    } catch {
      /* not in Telegram */
    }
  },
  impact(style = 'medium') {
    try {
      tg?.HapticFeedback?.impactOccurred(style);
    } catch {
      /* not in Telegram */
    }
  },
  notify(type = 'success') {
    try {
      tg?.HapticFeedback?.notificationOccurred(type);
    } catch {
      /* not in Telegram */
    }
  },
};

// ---------------------------------------------------------------- rarity
export const RARITY = {
  common: { c: '#9aa6b8', a: 'rgba(154,166,184,.28)' },
  uncommon: { c: '#4ade80', a: 'rgba(74,222,128,.28)' },
  rare: { c: '#38bdf8', a: 'rgba(56,189,248,.30)' },
  epic: { c: '#a78bfa', a: 'rgba(167,139,250,.32)' },
  legendary: { c: '#fbbf24', a: 'rgba(251,191,36,.32)' },
  mythic: { c: '#f87171', a: 'rgba(248,113,113,.34)' },
  secret: { c: '#f472b6', a: 'rgba(244,114,182,.36)' },
};

// ---------------------------------------------------------------- art
export function coin(size = 16) {
  return raw(
    `<svg class="coin" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#b8741a"/><circle cx="12" cy="11.2" r="10" fill="url(#bs-coin)"/><circle cx="12" cy="11.2" r="7" fill="none" stroke="#fff3c4" stroke-opacity=".55" stroke-width="1.2"/><path d="M12 6.6l1.35 2.9 3.15.35-2.35 2.15.65 3.1L12 13.5l-2.8 1.6.65-3.1L7.5 9.85l3.15-.35z" fill="#fff6d6"/></svg>`,
  );
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(hex, withHex, t) {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  const m = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Treasure chest in the case colour with the case emoji on the lid. */
export function chest(color, emoji, size = 96) {
  const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : '#f59e0b';
  const light = mix(safe, '#ffffff', 0.35);
  const dark = mix(safe, '#000000', 0.45);
  const mid = mix(safe, '#000000', 0.15);
  return raw(`<svg class="chest" width="${size}" height="${Math.round(size * 0.92)}" viewBox="0 0 120 110" aria-hidden="true">
  <ellipse cx="60" cy="101" rx="46" ry="7" fill="rgba(0,0,0,.35)"/>
  <path d="M16 52h88v38a8 8 0 0 1-8 8H24a8 8 0 0 1-8-8z" fill="${mid}"/>
  <path d="M16 52h88v14H16z" fill="${dark}" opacity=".55"/>
  <path d="M14 52c0-22 18-36 46-36s46 14 46 36z" fill="${safe}"/>
  <path d="M22 44c3-14 17-22 38-22s35 8 38 22" fill="none" stroke="${light}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <rect x="12" y="48" width="96" height="9" rx="3" fill="url(#bs-gold)"/>
  <rect x="31" y="17" width="9" height="81" rx="2" fill="url(#bs-gold)" opacity=".95"/>
  <rect x="80" y="17" width="9" height="81" rx="2" fill="url(#bs-gold)" opacity=".95"/>
  <rect x="49" y="46" width="22" height="24" rx="5" fill="url(#bs-gold)"/>
  <path d="M60 55a3 3 0 0 1 1.5 5.6V64h-3v-3.4A3 3 0 0 1 60 55z" fill="#5b3a06"/>
  <path d="M16 90a8 8 0 0 0 8 8h72a8 8 0 0 0 8-8" fill="none" stroke="${dark}" stroke-width="2" opacity=".6"/>
  <text x="60" y="41" font-size="19" text-anchor="middle" class="emo">${esc(emoji)}</text>
</svg>`);
}

/** Item art: uploaded image or emoji. */
export function itemArt(item, api) {
  if (item && item.image) {
    const src = item.image.startsWith('/') ? api(item.image) : item.image;
    return html`<img class="art-img" src="${src}" alt="" loading="lazy" decoding="async">`;
  }
  return html`<span class="emo">${item ? item.emoji : '❔'}</span>`;
}

export function initials(name) {
  const s = String(name || '?').trim();
  return (s[0] || '?').toUpperCase();
}

/** hh:mm:ss until a date */
export function countdown(iso) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
