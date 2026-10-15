import { tg, html, raw, render, $, $$, sleep, store, haptic, coin, chest, itemArt, initials, countdown, rgba } from './util.js';
import { t, setLang, lang, fmt, fmtDate, fmtDateTime, LANGS } from './i18n.js';
import * as API from './api.js';
import { startBubbles, setBubbleTint, setSkyMode } from './bubbles.js';
import { PUMPKIN, webSvg, SPIDER, NIGHT } from './halloween.js';
import { coins as sfxCoins, win as sfxWin, pop as sfxPop, tick as sfxTick, setSound, unlockAudio } from './sound.js';
import { fireworks } from './fireworks.js';

// ------------------------------------------------------------------ themes
export const THEMES = {
  // the DragonDrop look: dragon gold and fire on obsidian
  sunset: { a1: '#FFD23F', a2: '#FF7A1A', on: '#1d1300', bg1: '#0c0a0b', bg2: '#2a1509', bubble: '255,168,64' },
  graphite: { a1: '#E9EBEF', a2: '#8E96A3', on: '#0b0c0e', bg1: '#08090b', bg2: '#1d2027', bubble: '225,230,240' },
  mint: { a1: '#34F5A4', a2: '#1E90FF', on: '#00140d', bg1: '#02151a', bg2: '#05364a', bubble: '140,255,225' },
  redblue: { a1: '#FF4D6D', a2: '#3B82F6', on: '#ffffff', bg1: '#070a1c', bg2: '#0e2257', bubble: '185,200,255' },
  violet: { a1: '#C084FC', a2: '#F472B6', on: '#1b0626', bg1: '#0c0519', bg2: '#2a0c44', bubble: '240,185,255' },
  ocean: { a1: '#22D3EE', a2: '#3B82F6', on: '#001219', bg1: '#010e1c', bg2: '#023b66', bubble: '160,235,255' },
};

const ICON = {
  cases: '<svg viewBox="0 0 24 24"><path d="M3.5 9.5h17v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 9.5 6 4h12l2.5 5.5"/><path d="M10 13.5h4"/></svg>',
  upgrade: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8.3 11.2 12 7.5l3.7 3.7"/></svg>',
  profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.4-4 4.4-6 8-6s6.6 2 8 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  crash: '<svg viewBox="0 0 24 24"><path d="M13.5 5.5C16 3 19 2.5 21 3c.5 2 0 5-2.5 7.5L13 16l-5-5z"/><path d="M8 11 5 10.5 3 13l4 1M13 16l.5 3L11 21l-1-4"/><circle cx="16" cy="8" r="1.4"/><path d="M6 18c-1 .5-2 1.5-2 2.5 1 0 2-1 2.5-2"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10" cy="7.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  bolt: '<svg class="fill" viewBox="0 0 24 24"><path d="M13.5 2.5 5 13.5h6.5l-1 8 8.5-11h-6.5z"/></svg>',
  users:
    '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.9-3.6 3.4-5.5 6.5-5.5s5.6 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="8.6" cy="8.6" r="1.35" fill="currentColor"/><circle cx="12" cy="12" r="1.35" fill="currentColor"/><circle cx="15.4" cy="15.4" r="1.35" fill="currentColor"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a16.8 16.8 0 0 1-3.2 4.1M6.6 6.6A16.6 16.6 0 0 0 2.5 12S6 19 12 19c2 0 3.8-.6 5.3-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
};

// ------------------------------------------------------------------ state
const S = {
  me: null,
  cases: [],
  categories: [],
  items: [],
  itemsById: new Map(),
  withdrawIds: null, // brainrots that can be withdrawn; others are exchanged for one of them (null: server doesn't say)
  depositIds: null, // brainrots that can be picked in a deposit (null: server doesn't say — all)
  upgrade: { edge: 10, minChance: 1, maxChance: 80, luck: 1 },
  crash: { minBet: 100, maxBet: 100000, maxMult: 1000, speed: 0.00008 },
  dice: { minBet: 5, maxBet: 100000, colors: ['red', 'yellow', 'green', 'blue', 'purple', 'orange'], pays: [0, 2, 0, 4] }, // colour dice
  autoPromo: null, // the auto promo code of these hours: { code, pct, endsAt, hours, used } (null: none)
  tuCode: '', // code put in the top-up form when it opens (the auto promo code from its card)
  free: null,
  feed: [],
  top24: null,
  online: 0,
  stats: null,
  inventory: [],
  bot: null,
  links: {},
  topup: { starsRate: 1 },
  modes: { cases: true, upgrade: true, crash: true, dice: true, withdrawals: true }, // what the main admin left open
  mode: null, // 'tg' inside Telegram, 'web' on the website
  theme: 'sunset',
  busy: false,
  up: { sel: new Set(), target: null, tab: 'inv', pct: null },
  freeSub: null, // null unknown, true/false after a check
  openCount: 1, // how many times a paid case is opened at once (1, 2, 3 or 5)
  fast: store.getItem('bs_fast') === '1', // fast spin: cases and the upgrader stop in about a second (this device)
  partner: false, // has a referral code of their own: the "Referrals" screen in the profile
  refs: null, // that screen: the last /referrals/mine answer and which code is shown
  sound: store.getItem('bs_sound') !== '0', // sounds: coins when selling, the upgrader win (this device; on by default)
  streamer: store.getItem('bs_streamer') === '1', // streamer mode: balance, sums, own name / ID / Roblox nick and players' names hidden (this device)
  halloween: store.getItem('bs_hw') === '1', // Halloween look (admin switch); the last known state until the server answers
  maintenance: false, // maintenance (the main admin's switch; the server says so): only the logo and one line
  timers: [],
};
window.__BS = S; // handy for debugging in the browser console

const api = (p) => API.apiUrl(p);
const art = (item) => itemArt(item, api);
/** Case art: picture uploaded in the admin panel, otherwise a chest in the case colour. */
const caseImg = (c, size = 96) => {
  if (c && c.image) {
    const src = c.image.startsWith('/') ? api(c.image) : c.image;
    return html`<img class="case-img" src="${src}" alt="" decoding="async" width="${size}" height="${Math.round(size * 0.85)}">`;
  }
  return chest(c ? c.color : '', c ? c.emoji : '📦', size);
};

// ------------------------------------------------------------------ theme & language
function applyTheme(name, { save = false } = {}) {
  // Halloween keeps the player's accent colours and puts them on a night sky
  const th = { ...(THEMES[name] || THEMES.sunset), ...(S.halloween ? NIGHT : {}) };
  S.theme = THEMES[name] ? name : 'sunset';
  const r = document.documentElement.style;
  r.setProperty('--a1', th.a1);
  r.setProperty('--a2', th.a2);
  r.setProperty('--on', th.on);
  r.setProperty('--bg1', th.bg1);
  r.setProperty('--bg2', th.bg2);
  r.setProperty('--a1-soft', rgba(th.a1, 0.18));
  r.setProperty('--a2-soft', rgba(th.a2, 0.18));
  r.setProperty('--a1-glow', rgba(th.a1, 0.45));
  r.setProperty('--a1-faint', rgba(th.a1, 0.06)); // the lattice in the background
  r.setProperty('--a1-line', rgba(th.a1, 0.4)); // gold edges of the plates that matter
  r.setProperty('--a2-glow', rgba(th.a2, 0.3)); // the warm light from the top
  r.setProperty('--glass', rgba(th.bg1, 0.74));
  document.documentElement.dataset.theme = S.theme;
  setBubbleTint(th.bubble);
  try {
    tg?.setHeaderColor?.(th.bg1);
    tg?.setBackgroundColor?.(th.bg1);
    tg?.setBottomBarColor?.(th.bg1);
  } catch {
    /* older clients */
  }
  if (save) store.setItem('bs_theme', S.theme);
}

/**
 * Halloween (admins switch it on for everyone): night sky, bats and pumpkins instead of bubbles,
 * spider webs and a spider on the header, a pumpkin by the logo, the Halloween case first.
 */
function applyHalloween(on) {
  const next = !!on;
  const changed = next !== S.halloween;
  S.halloween = next;
  try {
    store.setItem('bs_hw', next ? '1' : '0');
  } catch {
    /* storage full or blocked */
  }
  document.documentElement.classList.toggle('halloween', next);
  setSkyMode(next ? 'halloween' : 'bubbles');
  applyTheme(S.theme);
  return changed;
}

function tgLang() {
  const c = tg?.initDataUnsafe?.user?.language_code || navigator.language || '';
  if (c.startsWith('uk')) return 'uk';
  if (c.startsWith('en')) return 'en';
  return 'ru';
}

// ------------------------------------------------------------------ small UI helpers
function toast(msg, type = 'info') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function errorText(e) {
  const code = e && e.code ? e.code : 'default';
  const key = 'e.' + code;
  const vars = {};
  for (const [k, v] of Object.entries((e && e.data) || {})) vars[k] = typeof v === 'number' ? fmt(v) : v;
  const s = t(key, vars);
  return s === key ? t('e.default') : s;
}

// errors of a part the main admin closed -> the part (S.modes)
const CLOSED_MODE = { cases_closed: 'cases', upgrade_closed: 'upgrade', crash_closed: 'crash', dice_closed: 'dice', withdrawals_closed: 'withdrawals' };

function showError(e) {
  if (e && e.code === 'maintenance') return showMaintenance();
  haptic.notify('error');
  toast(errorText(e), 'error');
  // closed while the screen was open: the screen shows it
  const mode = e && CLOSED_MODE[e.code];
  if (mode && S.modes[mode] !== false) {
    S.modes = { ...S.modes, [mode]: false };
    setTimeout(() => !S.busy && renderView(), 0);
  }
  if (e && e.code === 'topup_closed') {
    S.topup = { ...S.topup, starsOpen: false, brainrotsOpen: false };
    setTimeout(() => topupMenu(), 0);
  }
}

/**
 * Maintenance (the main admin's switch): the logo and one line, nothing else. Every 15 s it asks the
 * server whether the maintenance is over and then starts the app again.
 */
let maintTimer = null;
function showMaintenance() {
  S.maintenance = true;
  clearTimers();
  closeModal();
  try {
    tg?.BackButton?.hide();
  } catch {
    /* not in Telegram */
  }
  render(
    $('#app'),
    html`<div class="splash">
      <img class="splash-logo" src="img/logo.jpg" alt="" width="120" height="120">
      <div class="splash-name"><span>Dragon</span><span>Drop</span></div>
      <div class="splash-note">${t('e.maintenance')}</div>
    </div>`,
  );
  if (maintTimer) return;
  maintTimer = setInterval(async () => {
    try {
      if ((await API.get('/public')).maintenance === false) location.reload();
    } catch {
      /* offline: ask again later */
    }
  }, 15000);
}

let modalClose = null;
function openModal(tpl, { onClose, cls = '' } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal-backdrop" data-act="close-modal"></div><div class="sheet ${cls}" role="dialog" aria-modal="true"></div>`;
  root.appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  render(sheet, tpl);
  requestAnimationFrame(() => wrap.classList.add('show'));
  modalClose = onClose || null;
  return sheet;
}
function closeModal() {
  const wrap = $('#modal-root .modal-wrap');
  if (!wrap) return;
  const cb = modalClose;
  modalClose = null;
  wrap.classList.remove('show');
  setTimeout(() => wrap.remove(), 220);
  if (cb) cb();
}

function confirmModal(text) {
  return new Promise((resolve) => {
    let answered = false;
    const sheet = openModal(
      html`<div class="confirm"><p>${text}</p><div class="row2"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary" id="confirmYes">${t('yes')}</button></div></div>`,
      { onClose: () => !answered && resolve(false) },
    );
    sheet.querySelector('#confirmYes').addEventListener('click', () => {
      answered = true;
      closeModal();
      resolve(true);
    });
  });
}

let popClose = null;
function openPop(anchor, tpl) {
  closePop();
  const pop = document.createElement('div');
  pop.className = 'pop';
  render(pop, tpl);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pw - 8, r.right - pw))}px`;
  requestAnimationFrame(() => pop.classList.add('show'));
  const onDoc = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePop();
  };
  setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  popClose = () => {
    document.removeEventListener('click', onDoc, true);
    pop.remove();
  };
  return pop;
}
function closePop() {
  if (popClose) popClose();
  popClose = null;
}

function fmtChance(c) {
  return new Intl.NumberFormat(lang() === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: c < 0.01 ? 4 : 3 }).format(c);
}
const money = (n, size = 14) => html`<span class="money">${coin(size)}<b class="priv">${fmt(n)}</b></span>`;
/** A coin amount next to a coin icon (item values, drops): blurred in streamer mode. */
const amount = (n) => html`<span class="priv">${fmt(n)}</span>`;
/**
 * Streamer mode blurs every coin amount (class «priv»): the balance, case and brainrot prices, wins
 * and sums. Names, nicks, ID and the brainrots themselves stay visible. Pointing at an amount (a tap
 * on phones) shows it.
 */
const caseName = (c) => (c ? c.name[lang()] || c.name.ru : '');

// ------------------------------------------------------------------ shell
function shell() {
  render(
    $('#app'),
    html`
    <header class="top${adminUi() ? ' adm' : ''}">
      <span class="hw-web l" aria-hidden="true">${raw(webSvg(64))}</span>
      <span class="hw-web r" aria-hidden="true">${raw(webSvg(64))}</span>
      <span class="hw-spider" aria-hidden="true"><i></i>${raw(SPIDER)}</span>
      <div class="brand">
        <span class="logo-wrap"><img class="logo" src="img/logo.jpg" alt="" width="40" height="40"><span class="logo-pk" aria-hidden="true">${raw(PUMPKIN)}</span></span>
        <div class="brand-text">
          <div class="brand-name"><span>Dragon</span><span>Drop</span></div>
        </div>
      </div>
      <div class="top-actions">
        <button class="bal" data-act="topup" aria-label="${t('topup')}">${coin(18)}<b id="bal" class="priv"></b><span class="plus">+</span></button>
        ${adminUi() ? html`<button class="icon-btn adm-btn" data-tab="admin" aria-label="${t('tab.admin')}">${raw(ICON.admin)}</button>` : ''}
        <button class="icon-btn lang-btn" data-act="lang" id="langBtn" aria-label="${t('language')}"></button>
        <button class="icon-btn" data-act="theme" id="themeBtn" aria-label="${t('theme')}">${raw(ICON.palette)}</button>
      </div>
    </header>
    <section class="live" id="live">
      <div class="live-title"><i class="dot pulse"></i><span>${t('liveDrops')}</span></div>
      <div class="live-row">
        <div class="top24" id="top24"></div>
        <div class="feed" id="feed"></div>
      </div>
    </section>
    <main id="view" class="view"></main>
    <nav class="tabbar" id="tabbar"></nav>`,
  );
  updateHeader();
  renderTop24();
  renderFeed();
  renderTabbar();
}

function updateHeader() {
  const bal = $('#bal');
  if (bal && S.me) bal.textContent = fmt(S.me.balance);
  const lb = $('#langBtn');
  if (lb) lb.textContent = (LANGS.find((l) => l.code === lang()) || LANGS[0]).label;
}

function setBalance(n) {
  if (!S.me || typeof n !== 'number') return;
  S.me.balance = n;
  const bal = $('#bal');
  if (bal) {
    bal.textContent = fmt(n);
    bal.parentElement.classList.remove('bump');
    void bal.parentElement.offsetWidth;
    bal.parentElement.classList.add('bump');
  }
}

/**
 * The dock at the bottom: the cases in the middle on a raised hexagon, two games on each side. The
 * admin panel is the shield in the header (admins only).
 */
const DOCK = ['upgrade', 'crash', 'cases', 'dice', 'profile'];
function renderTabbar() {
  const cur = route().tab;
  render(
    $('#tabbar'),
    html`${DOCK.map(
      (k) => html`<button class="${cur === k ? 'on' : ''}${k === 'cases' ? ' hub' : ''}" data-tab="${k}"><i class="tb-ico">${raw(ICON[k])}</i><span>${t('tab.' + k)}</span></button>`,
    )}`,
  );
  markTabs(cur);
}

/** The current tab lit in the dock and on the admin shield. */
function markTabs(cur) {
  $$('#tabbar [data-tab], .top [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));
}

// ------------------------------------------------------------------ live drops
/** Where a drop came from, shown over the tile on hover: the case (picture + name) or the upgrader. */
function dropSource(d, size) {
  if (d.kind === 'upgrade') {
    return html`<div class="drop-src up"><span class="src-art">${raw(ICON.upgrade)}</span><span class="src-name">${t('tab.upgrade')}</span></div>`;
  }
  const c = d.caseId ? S.cases.find((x) => x.id === d.caseId) : null;
  return html`<div class="drop-src"><span class="src-art">${caseImg(c, size)}</span><span class="src-name">${c ? caseName(c) : t('srcCase')}</span></div>`;
}

function dropTile(d, enter = false) {
  return html`<div class="drop r-${d.item.rarity}${enter ? ' enter' : ''}" title="${d.item.name}" data-src="${d.kind}">
    <div class="drop-art">${art(d.item)}</div>
    <div class="drop-val">${coin(10)}${amount(d.value)}</div>
    <div class="drop-user">${d.user.name}</div>
    ${dropSource(d, 40)}
  </div>`;
}

function renderFeed() {
  const el = $('#feed');
  if (!el) return;
  if (!S.feed.length) return render(el, html`<div class="feed-empty">${t('empty')}</div>`);
  render(el, html`${S.feed.slice(0, 20).map((d) => dropTile(d))}`);
}

function renderTop24() {
  const el = $('#top24');
  if (!el) return;
  const d = S.top24;
  el.className = `top24${d ? ' r-' + d.item.rarity : ''}`;
  render(
    el,
    html`<div class="top24-label">${t('top24')}</div>
    ${d
      ? html`<div class="top24-body"><div class="top24-art">${art(d.item)}</div><div class="top24-info"><div class="top24-val">${coin(12)}${amount(d.value)}</div><div class="top24-user">${d.user.name}</div></div></div>${dropSource(d, 44)}`
      : html`<div class="top24-empty">${t('empty')}</div>`}`,
  );
}

function onDrop(d) {
  if (!d || !d.item || S.feed.some((x) => x.id === d.id)) return;
  S.feed.unshift(d);
  S.feed.length = Math.min(S.feed.length, 30);
  const el = $('#feed');
  if (!el) return;
  if (el.querySelector('.feed-empty')) el.innerHTML = '';
  el.insertAdjacentHTML('afterbegin', dropTile(d, true).__html);
  while (el.children.length > 20) el.lastElementChild.remove();
}

// ------------------------------------------------------------------ routing
/** Admin tab: admins who see at least one section of the admin panel. */
function adminUi() {
  return !!(S.me && S.me.isAdmin && (!S.adminSections || S.adminSections.length));
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [tab, arg, arg2] = h.split('/');
  if (tab === 'case' && arg) return { tab: 'cases', view: 'case', id: Number(arg) };
  if (tab === 'upgrade') return { tab: 'upgrade', view: 'upgrade' };
  if (tab === 'crash') return { tab: 'crash', view: 'crash' };
  if (tab === 'dice') return { tab: 'dice', view: 'dice' };
  if (tab === 'profile') return { tab: 'profile', view: 'profile' };
  if (tab === 'refs' && S.partner) return { tab: 'profile', view: 'refs' };
  if (tab === 'admin' && adminUi()) return { tab: 'admin', view: 'admin', sub: arg || '', id: arg2 };
  return { tab: 'cases', view: 'cases' };
}
function go(hash) {
  if (location.hash === hash) renderView();
  else location.hash = hash;
}

function clearTimers() {
  for (const x of S.timers) clearInterval(x);
  S.timers = [];
}

let adminModule = null;
async function renderView() {
  if (S.maintenance) return;
  closePop();
  clearTimers();
  const r = route();
  markTabs(r.tab);
  $('#live')?.classList.toggle('hidden', r.tab === 'admin');
  const back = r.view === 'case' || r.view === 'refs' || (r.view === 'admin' && r.id);
  try {
    if (back) {
      tg?.BackButton?.show();
    } else tg?.BackButton?.hide();
  } catch {
    /* older clients */
  }
  const view = $('#view');
  view.dataset.view = r.view;
  if (r.view === 'cases') viewCases(view);
  else if (r.view === 'case') viewCase(view, r.id);
  else if (r.view === 'upgrade') viewUpgrade(view);
  else if (r.view === 'crash') viewCrash(view);
  else if (r.view === 'dice') viewDice(view);
  else if (r.view === 'profile') viewProfile(view);
  else if (r.view === 'refs') viewRefs(view);
  else if (r.view === 'admin') {
    if (!adminModule) adminModule = await import('./admin.js');
    adminModule.renderAdmin(view, r, adminCtx());
  }
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ cases
function freeCase() {
  return S.cases.find((c) => c.isFree);
}

/** The free cases (FREE, nick, share): no price, one opening at a time, each with its own cooldown. */
const noPrice = (c) => !!(c.isFree || c.isNick || c.isShare);
/** The player's state of a free case (when it opens again, tasks); null for a paid case. */
const freeOf = (c) => (c.isFree ? S.free : c.isNick ? S.nick : c.isShare ? S.share : null);

function freeStatusText() {
  const f = S.free;
  if (!f) return '';
  return f.nextAt && new Date(f.nextAt) > new Date() ? t('freeIn', { t: countdown(f.nextAt) }) : t('freeReady');
}

/** What the FREE case asks for: the subscription only with a channel set, the share only when it is on. */
function freeHint() {
  const f = S.free || {};
  if (f.requireSub && f.requireShare) return t('freeHint');
  if (f.requireShare) return t('freeHintShare');
  if (f.requireSub) return t('freeHintSub');
  return t('freeHintNone');
}

function caseCard(c) {
  return html`<button class="case-card" data-case="${c.id}" style="--cc:${c.color};--cca:${rgba(c.color, 0.34)}">
    <div class="case-glow"></div>
    <div class="case-art${c.image ? ' has-img' : ''}">${caseImg(c, 96)}</div>
    <div class="case-name">${caseName(c)}</div>
    <div class="case-price">${noPrice(c) ? html`<span class="money"><b>FREE</b></span>` : money(c.price, 15)}</div>
  </button>`;
}

/** Paid cases: those without a category first, then one titled block per category. */
/** The Halloween case (seeded with slug «halloween»): first on the cases screen while Halloween is on. */
const halloweenCase = () => (S.halloween ? S.cases.find((c) => c.slug === 'halloween' && !c.isFree) : null);

function caseSections() {
  const hw = halloweenCase();
  const paid = S.cases.filter((c) => !c.isFree && c !== hw);
  const known = new Set(S.categories.map((k) => k.id));
  const loose = (hw ? [hw] : []).concat(paid.filter((c) => !c.categoryId || !known.has(c.categoryId)));
  const out = [];
  if (loose.length) out.push(html`<div class="case-grid">${loose.map(caseCard)}</div>`);
  for (const k of S.categories) {
    const list = paid.filter((c) => c.categoryId === k.id);
    if (!list.length) continue;
    out.push(html`<section class="case-cat" data-cat="${k.id}"><h3 class="sec-title cat-title">${k.name}</h3><div class="case-grid">${list.map(caseCard)}</div></section>`);
  }
  return out;
}

// ------------------------------------------------------------------ auto promo code
// Every few hours the server makes up a new code with a bonus % to a top-up (once per player). The
// card shows it with the time left; «Пополнить» opens the top-up with the code already typed in.
let apFetchedAt = 0;

/** «Каждые 2 часа новый бонус к пополнению». */
function apTitle(n) {
  if (n === 1) return t('ap.title1');
  let form = 'many';
  try {
    const f = new Intl.PluralRules(lang()).select(n);
    if (f === 'one' || f === 'few') form = f;
  } catch {
    /* old webview */
  }
  return t('ap.title', { n: t('ap.h.' + form, { n }) });
}

function apCard() {
  const a = S.autoPromo;
  if (!a) return '';
  return html`<section class="ap-card" id="apCard">
    <span class="ap-tag">${t('ap.tag')}</span>
    <div class="ap-title">${apTitle(a.hours)}</div>
    <div class="ap-box">
      <div class="ap-cell"><small>${t('ap.left')}</small><b id="apLeft">${countdown(a.endsAt)}</b></div>
      <div class="ap-cell ap-code"><small>${t('ap.code')}</small><b id="apCode">${a.code}</b></div>
      <div class="ap-cell"><small>${t('ap.bonus')}</small><b id="apPct">+${a.pct}%</b></div>
    </div>
    <div class="ap-btns">
      <button type="button" class="btn ap-btn" data-act="ap-cases">${t('ap.cases')}</button>
      <button type="button" class="btn primary ap-btn" data-act="ap-topup">${t('ap.topup')}</button>
      <button type="button" class="btn ap-btn" data-act="promo">${t('promo')}</button>
    </div>
  </section>`;
}

/** Puts the card (or nothing) where it is on the cases screen. */
function apRender() {
  const el = $('#apCard');
  if (!el) return;
  const next = apCard();
  if (next) el.outerHTML = next.__html;
  else el.remove();
}

/** The time left; when it is over, the new code from the server. */
function apTick() {
  const a = S.autoPromo;
  const el = $('#apLeft');
  if (!a || !el) return;
  el.textContent = countdown(a.endsAt);
  if (new Date(a.endsAt).getTime() <= Date.now() && Date.now() - apFetchedAt > 5000) refreshAutoPromo();
}

async function refreshAutoPromo() {
  apFetchedAt = Date.now();
  try {
    const r = await API.get('/auto-promo');
    S.autoPromo = r.autoPromo || null;
    apRender();
  } catch {
    /* next tick */
  }
}

function viewCases(view) {
  const fc = freeCase();
  render(
    view,
    html`
    ${apCard()}
    ${fc
      ? html`<button class="free-card" data-case="${fc.id}">
          <div class="free-chest${fc.image ? ' has-img' : ''}">${caseImg(fc, 86)}</div>
          <div class="free-info">
            <div class="free-title">${caseName(fc)}</div>
            <div class="free-sub">${freeHint()}</div>
          </div>
          <div class="free-state ${S.free && S.free.nextAt && new Date(S.free.nextAt) > new Date() ? '' : 'ready'}" id="freeState">${freeStatusText()}</div>
        </button>`
      : ''}
    ${caseSections()}`,
  );
  if (fc) {
    S.timers.push(
      setInterval(() => {
        const el = $('#freeState');
        if (!el) return;
        el.textContent = freeStatusText();
        el.classList.toggle('ready', !(S.free && S.free.nextAt && new Date(S.free.nextAt) > new Date()));
      }, 1000),
    );
  }
  if (S.autoPromo) S.timers.push(setInterval(apTick, 1000));
}

// weighted random for the decorative roulette strip
function randomFromCase(c) {
  let r = Math.random() * 100;
  for (const e of c.items) {
    if ((r -= e.chance) <= 0) return e.item;
  }
  return c.items[c.items.length - 1].item;
}

const STRIP = 60;
const SPIN_TILES = 48; // how many brainrots pass the marker in a spin
const IDLE_LOOP = 20; // brainrots in one round of the drift before an opening
const IDLE_SPEED = 45; // px per second they drift
let idleAnims = []; // the drift of every strip (Web Animations)
const stripItems = []; // the brainrots on each strip, in order

function rouletteTile(item) {
  return html`<div class="r-tile r-${item.rarity}"><div class="item-art">${art(item)}</div><div class="r-name">${item.name}</div></div>`;
}

/** Random brainrots of the case after `prefix` (kept as it is), with `winner` at index `win`. */
function buildStrip(c, winner = null, { win = -1, length = STRIP, prefix = [] } = {}) {
  const list = prefix.slice();
  for (let i = list.length; i < length; i++) {
    if (i === win && winner) {
      list.push(winner);
      continue;
    }
    let it = randomFromCase(c);
    // avoid the same item twice in a row (purely cosmetic)
    for (let k = 0; k < 4 && c.items.length > 2 && (it.id === list[i - 1]?.id || (i + 1 === win && winner && it.id === winner.id)); k++) {
      it = randomFromCase(c);
    }
    list.push(it);
  }
  return list;
}

/** A strip for the drift: a round of IDLE_LOOP brainrots over and over, so it can loop without a seam. */
function idleStrip(c) {
  const round = buildStrip(c, null, { length: IDLE_LOOP });
  for (let k = 0; k < 4 && c.items.length > 2 && round[IDLE_LOOP - 1].id === round[0].id; k++) round[IDLE_LOOP - 1] = randomFromCase(c);
  return Array.from({ length: STRIP }, (_, i) => round[i % IDLE_LOOP]);
}

function itemTile(item, { chance, extra } = {}) {
  return html`<div class="item r-${item.rarity}">
    ${chance !== undefined ? html`<div class="item-chance">${fmtChance(chance)}%</div>` : ''}
    <div class="item-art">${art(item)}</div>
    <div class="item-name">${item.name}</div>
    <div class="item-val">${coin(12)}${amount(item.value)}</div>
    ${extra || ''}
  </div>`;
}

/** Subscribe to the channel (the FREE case and the share case use the same one). */
function subTask(num) {
  const ok = S.freeSub === true;
  const url = S.free && S.free.channelUrl;
  return html`<div class="task ${ok ? 'done' : ''}">
    <div class="task-num">${ok ? raw(ICON.check) : num}</div>
    <div class="task-text">${t('task1')}</div>
    ${ok
      ? ''
      : html`<div class="task-btns">
          ${url ? html`<button class="btn small ghost" data-act="subscribe">${t('subscribe')}</button>` : ''}
          <button class="btn small" data-act="check-sub">${t('check')}</button>
        </div>`}
  </div>`;
}

/** Share the bot link: once for the FREE case, `need` times for the share case. */
function shareTask(num, ok, text) {
  return html`<div class="task ${ok ? 'done' : ''}">
    <div class="task-num">${ok ? raw(ICON.check) : num}</div>
    <div class="task-text">${text}</div>
    ${ok ? '' : html`<div class="task-btns"><button class="btn small" data-act="share">${t('share')}</button></div>`}
  </div>`;
}

/** What the player has to do before opening the FREE case or the share case. */
function freeTasks(c) {
  const rows = [];
  if (c.isFree) {
    const f = S.free || {};
    if (f.requireSub) rows.push(subTask('1'));
    if (f.requireShare) rows.push(shareTask(f.requireSub ? '2' : '1', !!f.shared, t('task2')));
  } else if (c.isShare) {
    const s = S.share || {};
    if (s.requireSub) rows.push(subTask('1'));
    const text = html`${t('shareTask')} <span class="task-count">${s.have || 0}/${s.need}</span>`;
    rows.push(shareTask(s.requireSub ? '2' : '1', s.have >= s.need, text));
  }
  return rows.length ? html`<div class="tasks">${rows}</div>` : '';
}

/** An on / off switch button (fast spin, streamer mode). */
function toggleBtn(act, on, icon, label) {
  return html`<button class="tgl${on ? ' on' : ''}" data-act="${act}" aria-pressed="${on ? 'true' : 'false'}"><i></i>${raw(icon)}<span>${label}</span></button>`;
}

/** Shows a switch's new state on every copy of it on the screen. */
function markToggle(act, on) {
  for (const b of $$(`[data-act="${act}"]`)) {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/** Fast spin switch (under the Open and Upgrade buttons): the strips / the pointer stop in about a second. */
function fastToggle() {
  return html`<div class="fast-row">${toggleBtn('fast', S.fast, ICON.bolt, t('fastSpin'))}</div>`;
}

/** Streamer mode on <html>: everything private on the screen (and drawn later) is blurred at once. */
function applyStreamer() {
  document.documentElement.classList.toggle('streamer', S.streamer);
}

/** A tap on something blurred shows it for a moment (phones have nothing to point with). */
function peek(el) {
  el.classList.add('peek');
  clearTimeout(el.peekTimer);
  el.peekTimer = setTimeout(() => el.classList.remove('peek'), 2500);
}

function cooldownRow(nextAt) {
  return html`<div class="cooldown" id="cooldown">${t('nextFree', { t: countdown(nextAt) })}</div>`;
}

function openButton(c) {
  if (S.modes.cases === false) return html`<button class="btn primary big" disabled>${t('closedNow')}</button>`;
  if (noPrice(c)) {
    const st = freeOf(c) || {};
    if (st.nextAt && new Date(st.nextAt) > new Date()) return cooldownRow(st.nextAt);
    // the nick case: the name is checked by the server when opening (it asks Telegram), so the button is always on
    const ready = c.isFree
      ? (!st.requireShare || st.shared) && (!st.requireSub || S.freeSub !== false)
      : c.isShare
        ? st.have >= st.need && (!st.requireSub || S.freeSub !== false)
        : true;
    return html`<button class="btn primary big" data-act="open" data-id="${c.id}" ${ready ? '' : raw('disabled')}>${t('openFree')}</button>`;
  }
  const n = openCount(c);
  const enough = S.me.balance >= c.price * n;
  return enough
    ? html`<button class="btn primary big" data-act="open" data-id="${c.id}">${t('open')} ${money(c.price * n, 18)}</button>`
    : html`<button class="btn primary big" disabled>${t('notEnough')}</button>`;
}

const OPEN_COUNTS = [1, 2, 3, 5];
/** Openings at once for this case: the chosen number, or fewer when the balance can't cover it. */
function openCount(c) {
  if (!c || noPrice(c)) return 1;
  for (let i = OPEN_COUNTS.length - 1; i > 0; i--) {
    const n = OPEN_COUNTS[i];
    if (n <= S.openCount && S.me.balance >= c.price * n) return n;
  }
  return 1;
}

function countSeg(c) {
  if (noPrice(c)) return '';
  const cur = openCount(c);
  return html`${OPEN_COUNTS.map(
    (n) => html`<button data-act="count" data-n="${n}" class="${n === cur ? 'on' : ''}" ${n > 1 && S.me.balance < c.price * n ? raw('disabled') : ''}>x${n}</button>`,
  )}`;
}

function roulettesHtml(c, n) {
  stripItems.length = 0;
  const one = (i) => {
    stripItems[i] = idleStrip(c);
    return html`<div class="roulette" ${i === 0 ? raw('id="roulette"') : ''} data-r="${i}" style="--cc:${c.color}">
      <div class="r-track" ${i === 0 ? raw('id="track"') : ''}>${stripItems[i].map(rouletteTile)}</div>
      <div class="r-marker"></div>
    </div>`;
  };
  return html`${Array.from({ length: n }, (_, i) => one(i))}`;
}

function viewCase(view, id) {
  const c = S.cases.find((x) => x.id === id);
  if (!c) return go('#/cases');
  render(
    view,
    html`
    <div class="view-head case-hero${openCount(c) > 1 ? ' compact' : ''}" style="--cc:${c.color};--cca:${rgba(c.color, 0.34)}">
      <button class="back" data-act="back" aria-label="${t('back')}">${raw(ICON.back)}</button>
      <div class="vh-art${c.image ? ' has-img' : ''}">${caseImg(c, 112)}</div>
      <div class="vh-title">${caseName(c)}</div>
      <div class="vh-price">${noPrice(c) ? 'FREE' : money(c.price, 15)}</div>
    </div>
    <div class="roulettes n${openCount(c)}" id="roulettes">${roulettesHtml(c, openCount(c))}</div>
    <div id="freeTasks">${freeTasks(c)}</div>
    ${noPrice(c) ? '' : html`<div class="seg count-seg" id="countSeg">${countSeg(c)}</div>`}
    <div class="open-row" id="openRow">${openButton(c)}</div>
    ${fastToggle()}
    <div class="sec-row"><h3 class="sec-title">${t('contents')}</h3><button class="btn small ghost odds-btn" data-act="odds" aria-pressed="false">${t('odds')}</button></div>
    <div class="grid items odds-hidden" id="caseItems">${c.items.map((e) => itemTile(e.item, { chance: e.chance }))}</div>`,
  );
  positionIdle();
  if (noPrice(c)) {
    S.timers.push(
      setInterval(() => {
        const cd = $('#cooldown');
        if (!cd) return;
        const nextAt = (freeOf(c) || {}).nextAt;
        if (nextAt && new Date(nextAt) > new Date()) cd.textContent = t('nextFree', { t: countdown(nextAt) });
        else refreshOpenRow(c);
      }, 1000),
    );
    const st = freeOf(c);
    if ((c.isFree || c.isShare) && st && st.requireSub && S.freeSub !== true) checkSub(true);
  }
}

function refreshOpenRow(c, { keepStrips = false } = {}) {
  const row = $('#openRow');
  if (row) render(row, openButton(c));
  const tasks = $('#freeTasks');
  if (tasks) render(tasks, freeTasks(c));
  const seg = $('#countSeg');
  if (seg) render(seg, countSeg(c));
  if (!keepStrips) setRoulettes(c);
}

/** Shows as many idle strips as there will be openings (with several the case head gets small). */
function setRoulettes(c, n = openCount(c)) {
  $('.case-hero')?.classList.toggle('compact', n > 1);
  const wrap = $('#roulettes');
  if (!wrap || wrap.children.length === n) return;
  wrap.className = `roulettes n${n}`;
  render(wrap, roulettesHtml(c, n));
  positionIdle();
}

function tileStep(box) {
  const track = box.querySelector('.r-track');
  const tile = track && track.querySelector('.r-tile');
  if (!tile) return 110;
  const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 8;
  return tile.offsetWidth + gap;
}

/**
 * Where brainrot `index` sits on its strip: its left edge from the strip's start and its width, read
 * from the layout (not index × width), so a strip lands right even if a brainrot came out wider.
 */
function tileAt(track, index) {
  const tiles = track.children;
  const t = tiles[index];
  if (!t) return { left: index * 110, width: 100 };
  return { left: t.offsetLeft - tiles[0].offsetLeft, width: t.offsetWidth };
}

/** The strip offset that puts brainrot `index` under the marker, `jitter` px off its middle. */
function offsetFor(box, index, jitter = 0) {
  const { left, width } = tileAt(box.querySelector('.r-track'), index);
  return box.clientWidth / 2 - left - width / 2 - jitter;
}

/** Before an opening the brainrots drift along the strips, round after round. */
function positionIdle() {
  stopIdle();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const box of $$('#roulettes .roulette')) {
    const track = box.querySelector('.r-track');
    track.style.transition = 'none';
    const from = offsetFor(box, 6);
    track.style.transform = `translateX(${from}px)`;
    if (still || typeof track.animate !== 'function') continue;
    const len = tileAt(track, 6 + IDLE_LOOP).left - tileAt(track, 6).left; // one round: the loop has no seam
    idleAnims.push(
      track.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${from - len}px)` }], {
        duration: Math.round((len / IDLE_SPEED) * 1000),
        iterations: Infinity,
      }),
    );
  }
}

function stopIdle() {
  for (const a of idleAnims) a.cancel();
  idleAnims = [];
}

/** Spins every strip to its own winner at the same time. */
async function spinTo(c, winners) {
  const boxes = $$('#roulettes .roulette');
  // on short screens the Open button may be below the strips: bring them into view
  const head = $('.top');
  const top = $('#roulettes').getBoundingClientRect().top - (head ? head.offsetHeight : 0) - 8;
  if (top < 0) window.scrollTo({ top: window.scrollY + top, behavior: 'smooth' });
  const fast = S.fast;
  const duration = fast ? 1200 : 5600;
  // the strips go on from where they are (drifting or stopped on the last drop): the brainrots in view
  // stay, new ones follow, the winner comes SPIN_TILES brainrots later
  const plans = boxes.map((box, i) => {
    const track = box.querySelector('.r-track');
    const tiles = [...track.children];
    const at = tiles.map((t) => t.offsetLeft - tiles[0].offsetLeft);
    let x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
    const right = (k) => x + at[k] + tiles[k].offsetWidth; // where brainrot k ends on screen
    let gone = 0; // the brainrots already passed on the left
    while (gone < tiles.length - 1 && right(gone) <= 0) gone++;
    let center = gone; // the one under the marker
    while (center < tiles.length - 1 && right(center) <= box.clientWidth / 2) center++;
    let seen = center; // the last one in view
    while (seen < tiles.length - 1 && x + at[seen + 1] < box.clientWidth) seen++;
    // those passed go but two (the strip would grow with every opening), those in view stay
    const drop = Math.max(0, gone - 2);
    x += at[drop];
    const keep = Math.min(tiles.length, seen + 2) - drop;
    const win = center - drop + SPIN_TILES;
    const items = buildStrip(c, winners[i], { win, length: win + 8, prefix: (stripItems[i] || []).slice(drop, drop + keep) });
    return { box, track, x, drop, keep, win, items };
  });
  // all in one go before the next frame: nothing in view moves or changes
  for (const p of plans) {
    p.track.style.transition = 'none';
    p.track.style.transform = `translateX(${p.x}px)`;
  }
  stopIdle();
  plans.forEach((p, i) => {
    for (const w of p.track.querySelectorAll('.win')) w.classList.remove('win'); // the last drop, still in view
    for (let k = 0; k < p.drop; k++) p.track.firstElementChild.remove();
    while (p.track.children.length > p.keep) p.track.lastElementChild.remove();
    p.track.insertAdjacentHTML('beforeend', p.items.slice(p.track.children.length).map((it) => rouletteTile(it).__html).join(''));
    stripItems[i] = p.items;
  });
  void boxes[0].offsetWidth;
  // where each strip stops: its winner under the marker, a little off its middle
  const ends = plans.map((p) => offsetFor(p.box, p.win, (Math.random() - 0.5) * Math.max(0, tileAt(p.track, p.win).width - 22)));
  plans.forEach((p, i) => {
    p.track.style.transition = `transform ${duration + Math.round(Math.random() * (fast ? 60 : 300))}ms cubic-bezier(0.1, 0.72, 0.12, 1)`;
    p.track.style.transform = `translateX(${ends[i]}px)`;
  });
  // a tick (sound and haptic) each time a brainrot passes the marker (first strip)
  const box = boxes[0];
  const track = box.querySelector('.r-track');
  const step = tileStep(box);
  const start = performance.now();
  let lastIdx = -1;
  let lastTick = 0;
  await new Promise((resolve) => {
    const tick = (now) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      const idx = Math.floor((-m.m41 + box.clientWidth / 2) / step);
      if (idx !== lastIdx && now - lastTick > 45) {
        lastIdx = idx;
        lastTick = now;
        haptic.tick();
        sfxTick();
      }
      if (now - start < duration + (fast ? 100 : 360)) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  for (const p of plans) p.track.children[p.win]?.classList.add('win');
  await sleep(fast ? 150 : 350);
}

async function openCase(id) {
  const c = S.cases.find((x) => x.id === id);
  if (!c || S.busy) return;
  S.busy = true;
  const btn = $('[data-act="open"]');
  if (btn) btn.disabled = true;
  haptic.impact('medium');
  const count = openCount(c);
  try {
    const res = c.isFree
      ? await API.post('/free/open')
      : c.isNick
        ? await API.post('/nick/open')
        : c.isShare
          ? await API.post('/share/open')
          : await API.post(`/case/${c.id}/open`, { count });
    const drops = res.drops || [{ invId: res.invId, item: res.item }];
    setRoulettes(c, drops.length); // one strip per opening
    if (!noPrice(c)) setBalance(res.balance);
    await spinTo(c, drops.map((d) => d.item));
    for (const d of drops) S.inventory.unshift({ invId: d.invId, item: d.item, at: new Date().toISOString() });
    if (S.stats) {
      for (const d of drops) {
        S.stats.casesOpened++;
        S.stats.totalWon += d.item.value;
        if (!noPrice(c)) S.stats.totalSpent += c.price;
        if (!S.stats.bestDrop || d.item.value > S.stats.bestDrop.value) S.stats.bestDrop = d.item;
      }
    }
    if (c.isFree) {
      S.free.nextAt = res.nextAt;
      S.free.shared = false;
    }
    if (c.isNick) S.nick.nextAt = res.nextAt;
    if (c.isShare) Object.assign(S.share, { nextAt: res.nextAt, have: 0 }); // the shares are used up
    showResult(drops);
  } catch (e) {
    showError(e);
    if (e.code === 'need_sub') S.freeSub = false;
    if (e.code === 'cooldown' && e.data.nextAt && freeOf(c)) freeOf(c).nextAt = e.data.nextAt;
    if (e.code === 'need_shares' && typeof e.data.have === 'number') Object.assign(S.share, { have: e.data.have, need: e.data.need });
    if (e.code === 'not_enough' && typeof e.data.balance === 'number') setBalance(e.data.balance);
  } finally {
    S.busy = false;
    // the strips keep showing the drops; the next opening sets their number again
    if (!afterBusy() && route().view === 'case' && route().id === id) refreshOpenRow(c, { keepStrips: true });
  }
}

function showResult(drops) {
  if (drops.length > 1) return showResults(drops);
  const { item, invId } = drops[0];
  const big = ['legendary', 'mythic', 'secret'].includes(item.rarity);
  haptic.notify(big ? 'success' : 'warning');
  haptic.impact('heavy');
  openModal(
    html`<div class="result r-${item.rarity}">
      <div class="result-title">${t('youWon')}</div>
      <div class="result-stage"><div class="rays"></div><div class="result-art">${art(item)}</div></div>
      <div class="result-rarity">${t('r.' + item.rarity)}</div>
      <div class="result-name">${item.name}</div>
      <div class="result-val">${money(item.value, 20)}</div>
      <div class="row2">
        <button class="btn ghost" data-act="sell-won" data-inv="${invId}">${t('sellFor')} ${money(item.value, 14)}</button>
        <button class="btn primary" data-act="close-modal">${t('keep')}</button>
      </div>
    </div>`,
    { cls: 'result-sheet' },
  );
}

/** Result of opening a case several times at once. */
function showResults(drops) {
  const big = drops.some((d) => ['legendary', 'mythic', 'secret'].includes(d.item.rarity));
  haptic.notify(big ? 'success' : 'warning');
  haptic.impact('heavy');
  const total = drops.reduce((s, d) => s + d.item.value, 0);
  openModal(
    html`<div class="result multi">
      <div class="result-title">${t('youWon')}</div>
      <div class="result-items n${drops.length}">${drops.map(
        (d) => html`<div class="item r-${d.item.rarity}">
          <div class="item-art">${art(d.item)}</div>
          <div class="item-name">${d.item.name}</div>
          <div class="item-val">${coin(12)}${amount(d.item.value)}</div>
        </div>`,
      )}</div>
      <div class="row2">
        <button class="btn ghost" data-act="sell-won" data-inv="${drops.map((d) => d.invId).join(',')}">${t('sellFor')} ${money(total, 14)}</button>
        <button class="btn primary" data-act="close-modal">${t('keep')}</button>
      </div>
    </div>`,
    { cls: 'result-sheet' },
  );
}

async function sellItems(ids) {
  const res = await API.post('/sell', { ids });
  setBalance(res.balance);
  const set = new Set(ids.map(Number));
  S.inventory = S.inventory.filter((i) => !set.has(i.invId));
  for (const id of set) S.up.sel.delete(id);
  if (S.stats) S.stats.soldValue += res.amount;
  haptic.notify('success');
  sfxCoins(set.size);
  toast(t('sold', { n: fmt(res.amount) }), 'ok');
  return res;
}

// ------------------------------------------------------------------ free case actions
/** After a subscription check or a share: redraws the tasks and the button of the case page on screen. */
function refreshFreePage() {
  const r = route();
  const c = r.view === 'case' && !S.busy && S.cases.find((x) => x.id === r.id);
  if (c && noPrice(c)) refreshOpenRow(c);
}

async function checkSub(silent = false) {
  try {
    const r = await API.post('/free/check');
    S.freeSub = r.subscribed;
    Object.assign(S.free, { requireSub: r.requireSub, requireShare: r.requireShare, shared: r.shared, nextAt: r.nextAt, channelUrl: r.channelUrl });
    if (r.share) S.share = { ...S.share, ...r.share };
    if (!silent) {
      if (r.subscribed) haptic.notify('success');
      else showError({ code: 'need_sub' });
    }
  } catch (e) {
    if (!silent) showError(e);
  }
  refreshFreePage();
}

async function doShare() {
  try {
    const r = await API.post('/free/share');
    const done = async () => {
      const { share, ...free } = await API.post('/free/shared');
      Object.assign(S.free, free);
      if (share) S.share = { ...S.share, ...share };
      haptic.notify('success');
      refreshFreePage();
    };
    if (r.preparedId && tg && tg.shareMessage && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')) {
      tg.shareMessage(r.preparedId, (sent) => {
        if (sent) done().catch(showError);
        else toast(t('e.share_failed'), 'error');
      });
    } else {
      if (tg && tg.openTelegramLink) tg.openTelegramLink(r.url);
      else window.open(r.url, '_blank', 'noopener');
      await done();
    }
  } catch (e) {
    showError(e);
  }
}

// ------------------------------------------------------------------ upgrader
/** Same formula as upgradeChance() in src/game.js: the shown chance is the real one. */
function upChance(bet, target) {
  if (!(bet > 0) || !(target > 0)) return 0;
  const raw = (bet / target) * (100 - S.upgrade.edge);
  return Math.floor((Math.min(S.upgrade.maxChance, raw) / (S.upgrade.luck || 1)) * 100) / 100;
}

function upBet() {
  let sum = 0;
  for (const inv of S.inventory) if (S.up.sel.has(inv.invId)) sum += inv.item.value;
  return sum;
}

function upTargets(bet) {
  return S.items.filter((i) => i.value > bet && upChance(bet, i.value) >= S.upgrade.minChance).sort((a, b) => a.value - b.value);
}

const GAUGE_R = 84;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function viewUpgrade(view) {
  // drop selections that are no longer in the inventory
  const have = new Set(S.inventory.map((i) => i.invId));
  for (const id of [...S.up.sel]) if (!have.has(id)) S.up.sel.delete(id);
  const bet = upBet();
  if (S.up.pct) {
    // the bet may have changed elsewhere (items sold): pick again for the same percentage
    const it = bet ? targetForChance(bet, S.up.pct) : null;
    S.up.target = it ? it.id : null;
  }
  const target = S.up.target ? S.itemsById.get(S.up.target) : null;
  if (target && target.value <= bet) S.up.target = null;
  render(
    view,
    html`
    <div class="gauge-wrap">
      <svg class="gauge" viewBox="0 0 200 200" aria-hidden="true">
        <defs><linearGradient id="gGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--a1)"/><stop offset="1" style="stop-color:var(--a2)"/></linearGradient></defs>
        <circle class="g-ticks" cx="100" cy="100" r="97"/>
        <circle class="g-bg" cx="100" cy="100" r="${GAUGE_R}"/>
        <circle class="g-win" id="gWin" cx="100" cy="100" r="${GAUGE_R}" stroke-dasharray="0 ${GAUGE_C}"/>
        <g class="g-ptr" id="gPtr"><path d="M100 5l8 11-8 11-8-11z"/></g>
      </svg>
      <div class="g-center"><div class="g-pct" id="gPct">0%</div><div class="g-lbl">${t('chance')}</div></div>
    </div>
    <div class="up-slots" id="upSlots"></div>
    <div class="seg up-pcts" id="upPcts"></div>
    <div class="up-range"><input type="range" id="upRange" min="${upRangeMin()}" max="${upRangeMax()}" step="1" aria-label="${t('chance')}"><b id="upRangeVal"></b></div>
    <div class="open-row"><button class="btn primary big" data-act="do-upgrade" id="upBtn">${t('upgrade')}</button></div>
    ${fastToggle()}
    <div class="seg" id="upSeg"></div>
    <div id="upGrid"></div>`,
  );
  $('#upRange').addEventListener('input', (e) => setUpPct(Number(e.target.value), { quiet: true }));
  updateUpgrade();
}

function updateUpgrade() {
  const bet = upBet();
  let target = S.up.target ? S.itemsById.get(S.up.target) : null;
  if (target && (target.value <= bet || upChance(bet, target.value) < S.upgrade.minChance)) {
    S.up.target = null;
    target = null;
  }
  const chance = target ? upChance(bet, target.value) : 0;
  const win = $('#gWin');
  if (win) win.setAttribute('stroke-dasharray', `${(GAUGE_C * chance) / 100} ${GAUGE_C}`);
  const pct = $('#gPct');
  if (pct) pct.textContent = `${fmt(chance)}%`;
  const selItems = S.inventory.filter((i) => S.up.sel.has(i.invId)).map((i) => i.item);
  render(
    $('#upSlots'),
    html`
    <div class="slot">
      <div class="slot-lbl">${t('bet')}</div>
      <div class="slot-art">${selItems.length ? selItems.slice(0, 3).map((i) => html`<span class="mini r-${i.rarity}">${art(i)}</span>`) : html`<span class="slot-ph">${t('pickItems')}</span>`}</div>
      <div class="slot-val">${bet ? money(bet, 13) : ''}</div>
    </div>
    <div class="slot-arrow">${raw(ICON.arrow)}</div>
    <div class="slot ${target ? 'r-' + target.rarity : ''}">
      <div class="slot-lbl">${t('target')}</div>
      <div class="slot-art">${target ? html`<span class="mini r-${target.rarity}">${art(target)}</span>` : html`<span class="slot-ph">${t('pickTarget')}</span>`}</div>
      <div class="slot-val">${target ? money(target.value, 13) : ''}</div>
    </div>`,
  );
  const btn = $('#upBtn');
  if (btn) btn.disabled = !(bet > 0 && target) || S.busy;
  if (btn && S.modes.upgrade === false) {
    btn.disabled = true;
    btn.textContent = t('closedNow');
  }
  if (!target) S.up.pct = null;
  const pcts = $('#upPcts');
  const lo = upRangeMin();
  const hi = upRangeMax();
  if (pcts) render(pcts, html`${UP_PCTS.filter((p) => p >= lo && p <= hi).map((p) => html`<button data-act="up-pct" data-p="${p}" class="${S.up.pct === p ? 'on' : ''}">${p}%</button>`)}`);
  const range = $('#upRange');
  if (range) {
    // the slider shows the chosen percentage, or the chance of a hand-picked target
    const v = S.up.pct || (target ? Math.round(chance) : Math.round((lo + hi) / 2));
    range.disabled = !bet || S.busy;
    range.value = String(Math.min(hi, Math.max(lo, v)));
    $('#upRangeVal').textContent = `${range.value}%`;
  }
  render(
    $('#upSeg'),
    html`<button data-act="up-tab" data-v="inv" class="${S.up.tab === 'inv' ? 'on' : ''}">${t('myItems')} <span class="cnt">${S.inventory.length}</span></button>
    <button data-act="up-tab" data-v="targets" class="${S.up.tab === 'targets' ? 'on' : ''}">${t('targets')}</button>`,
  );
  const grid = $('#upGrid');
  if (!grid) return;
  if (S.up.tab === 'inv') {
    if (!S.inventory.length) {
      render(grid, html`<div class="empty-box"><p>${t('emptyInv')}</p><button class="btn small" data-act="to-cases">${t('toCases')}</button></div>`);
      return;
    }
    render(
      grid,
      html`<div class="grid items">${S.inventory.map(
        (inv) => html`<button class="item pick r-${inv.item.rarity} ${S.up.sel.has(inv.invId) ? 'sel' : ''}" data-act="up-pick" data-inv="${inv.invId}">
          <div class="pick-mark">${raw(ICON.check)}</div>
          <div class="item-art">${art(inv.item)}</div>
          <div class="item-name">${inv.item.name}</div>
          <div class="item-val">${coin(12)}${amount(inv.item.value)}</div>
        </button>`,
      )}</div>`,
    );
  } else {
    const list = bet > 0 ? upTargets(bet) : [];
    if (!bet) {
      render(grid, html`<div class="empty-box"><p>${t('pickItems')}</p></div>`);
      return;
    }
    if (!list.length) {
      render(grid, html`<div class="empty-box"><p>${t('noTargets')}</p></div>`);
      return;
    }
    render(
      grid,
      html`<div class="grid items">${list.map(
        (it) => html`<button class="item pick r-${it.rarity} ${S.up.target === it.id ? 'sel' : ''}" data-act="up-target" data-id="${it.id}">
          <div class="item-chance">${fmt(upChance(bet, it.value))}%</div>
          <div class="pick-mark">${raw(ICON.check)}</div>
          <div class="item-art">${art(it)}</div>
          <div class="item-name">${it.name}</div>
          <div class="item-val">${coin(12)}${amount(it.value)}</div>
        </button>`,
      )}</div>`,
    );
  }
}

const UP_PCTS = [75, 50, 30];
const upRangeMin = () => Math.max(1, Math.ceil(S.upgrade.minChance));
const upRangeMax = () => Math.max(upRangeMin(), Math.floor(S.upgrade.maxChance / (S.upgrade.luck || 1)));

/** Choose the target whose chance is the closest to `pct` (buttons and the slider). */
function setUpPct(pct, { quiet = false } = {}) {
  if (S.busy) return;
  const bet = upBet();
  if (!bet) return quiet ? updateUpgrade() : toast(t('pickItems'));
  const it = targetForChance(bet, pct);
  if (!it) return quiet ? updateUpgrade() : toast(t('noTargets'));
  if (S.up.target !== it.id || !quiet) haptic.tick();
  S.up.target = it.id;
  S.up.pct = pct;
  updateUpgrade();
}

/** The target whose chance with the current bet is the closest to `pct`. */
function targetForChance(bet, pct) {
  let best = null;
  for (const it of upTargets(bet)) {
    const d = Math.abs(upChance(bet, it.value) - pct);
    if (!best || d < best.d || (d === best.d && it.value > best.it.value)) best = { it, d };
  }
  return best ? best.it : null;
}

async function doUpgrade() {
  const ids = [...S.up.sel];
  const target = S.up.target;
  if (!ids.length || !target || S.busy) return;
  S.busy = true;
  $('#upBtn').disabled = true;
  $('#upRange').disabled = true;
  haptic.impact('medium');
  try {
    const tItem = S.itemsById.get(target);
    const res = await API.post('/upgrade', { ids, target, chance: upChance(upBet(), tItem ? tItem.value : 0) });
    const ptr = $('#gPtr');
    const fast = S.fast;
    const angle = 360 * (fast ? 2 : 6) + (res.roll / 100) * 360;
    ptr.style.transition = 'none';
    ptr.style.transform = 'rotate(0deg)';
    void ptr.getBoundingClientRect();
    ptr.style.transition = `transform ${fast ? 1.1 : 4.6}s cubic-bezier(0.12, 0.75, 0.18, 1)`;
    ptr.style.transform = `rotate(${angle}deg)`;
    await sleep(fast ? 1250 : 4750);
    const set = new Set(ids);
    S.inventory = S.inventory.filter((i) => !set.has(i.invId));
    S.up.sel.clear();
    S.up.tab = 'inv';
    if (res.won) S.inventory.unshift({ invId: res.invId, item: res.item, at: new Date().toISOString() });
    if (S.stats) {
      S.stats.upgradesTotal++;
      if (res.won) {
        S.stats.upgradesWon++;
        if (!S.stats.bestDrop || res.item.value > S.stats.bestDrop.value) S.stats.bestDrop = res.item;
      }
    }
    $('.gauge-wrap')?.classList.add(res.won ? 'won' : 'lost');
    haptic.notify(res.won ? 'success' : 'error');
    openModal(
      html`<div class="result ${res.won ? 'r-' + res.item.rarity : 'lost'}">
        <div class="result-title">${res.won ? t('upWin') : t('upLose')}</div>
        <div class="result-stage">${res.won ? html`<div class="rays"></div>` : ''}<div class="result-art">${res.won ? art(res.item) : raw('<span class="emo">💨</span>')}</div></div>
        ${res.won ? html`<div class="result-name">${res.item.name}</div><div class="result-val">${money(res.item.value, 20)}</div>` : ''}
        <div class="row2 one"><button class="btn primary" data-act="close-modal">OK</button></div>
      </div>`,
      {
        cls: 'result-sheet',
        onClose: () => {
          S.up.target = null;
          if (route().view === 'upgrade') viewUpgrade($('#view'));
        },
      },
    );
    // the upgrade went in: a victory sound and fireworks
    if (res.won) {
      sfxWin();
      fireworks({ onBurst: sfxPop });
    }
  } catch (e) {
    showError(e);
    if (e.code === 'items_missing') await refreshInventory();
    if (e.code === 'chance_changed') {
      // settings or prices changed since the app loaded: show the current chance before a new try
      await reloadCatalog().catch(() => {});
      if (route().view === 'upgrade') {
        S.busy = false;
        viewUpgrade($('#view'));
      }
    }
  } finally {
    S.busy = false;
    if (!afterBusy()) {
      const btn = $('#upBtn');
      if (btn) btn.disabled = !(S.up.sel.size && S.up.target);
      const rg = $('#upRange');
      if (rg) rg.disabled = !upBet();
    }
  }
}

/** Cases, items and the upgrader / top-up settings as they are on the server now. */
async function reloadCatalog() {
  const r = await API.get('/catalog');
  S.cases = r.cases;
  S.categories = r.categories || [];
  if (r.withdrawIds) S.withdrawIds = r.withdrawIds;
  if (r.depositIds) S.depositIds = r.depositIds;
  S.items = r.items;
  S.itemsById = new Map(r.items.map((i) => [i.id, i]));
  S.upgrade = r.upgrade;
  if (r.crash) S.crash = r.crash;
  if (r.dice) S.dice = r.dice;
  if ('autoPromo' in r) S.autoPromo = r.autoPromo;
  if (r.topup) S.topup = r.topup;
  if (r.modes) S.modes = { ...S.modes, ...r.modes };
  if (typeof r.halloween === 'boolean') applyHalloween(r.halloween);
}

// ------------------------------------------------------------------ rocket (crash)
// The server draws where the rocket explodes and decides every cash-out by its own clock; the app
// draws the same multiplier curve (e^(speed · ms)) and learns about the explosion from a long poll.
const crashMult = (ms) => (ms > 0 ? Math.floor(Math.exp(S.crash.speed * ms) * 100 + 1e-6) / 100 : 1);
const crashTimeOf = (m) => (m > 1 ? Math.log(m) / S.crash.speed : 0); // ms of flight to reach multiplier m
const fmtMult = (m) => `${(Math.floor(m * 100 + 1e-6) / 100).toFixed(2).replace('.', lang() === 'en' ? '.' : ',')}x`;
let crashRun = null; // { id, bet, kind, t0, done, end: {kind, mult, win, item, coins} }
const crashSel = new Set(); // inventory ids staked in brainrots mode

function viewCrash(view) {
  const run = crashRun && !crashRun.done ? crashRun : null;
  const mode = run ? run.kind : S.crashMode || 'coins';
  const bet = S.crashBet || Math.max(S.crash.minBet, Math.min(100, S.crash.maxBet));
  // drop staked brainrots that are no longer in the inventory
  const have = new Set(S.inventory.map((i) => i.invId));
  for (const id of [...crashSel]) if (!have.has(id)) crashSel.delete(id);
  render(
    view,
    html`<div class="crash-stage" id="crStage">
      <svg class="crash-sky" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="crGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--a1);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--a2);stop-opacity:0"/></linearGradient></defs>
        <path class="cr-area" id="crArea" d="M0 200Z"/><path class="cr-line" id="crLine" d="M0 200"/>
      </svg>
      <div class="crash-rocket" id="crRocket"><span>🚀</span></div>
      <div class="crash-mult" id="crMult">${fmtMult(1)}</div>
      <div class="crash-note" id="crNote"></div>
    </div>
    <div class="seg cr-seg" id="crSeg">
      <button type="button" data-act="cr-mode" data-m="coins" class="${mode === 'coins' ? 'on' : ''}" ${run ? raw('disabled') : ''}>${t('crash.coins')}</button>
      <button type="button" data-act="cr-mode" data-m="brainrots" class="${mode === 'brainrots' ? 'on' : ''}" ${run ? raw('disabled') : ''}>${t('crash.brainrots')}</button>
    </div>
    ${mode === 'coins'
      ? html`<label class="crash-bet"><span>${t('bet')}</span><input class="input" id="crBet" type="number" inputmode="numeric" min="${S.crash.minBet}" max="${S.crash.maxBet}" step="1" value="${bet}" ${run ? raw('disabled') : ''}></label>`
      : run
        ? html`<div class="cr-bet-row"><span>${t('bet')}</span><b>${money(run.bet, 13)}</b></div>`
        : html`<div class="cr-bet-row"><span>${t('bet')}</span><b id="crBetVal">${money(crashBetValue(), 13)}</b></div>
          <div class="grid items" id="crGrid">${S.inventory.map(
            (inv) => html`<button type="button" class="item pick r-${inv.item.rarity} ${crashSel.has(inv.invId) ? 'sel' : ''}" data-act="cr-pick" data-inv="${inv.invId}">
              <div class="pick-mark">${raw(ICON.check)}</div>
              <div class="item-art">${art(inv.item)}</div>
              <div class="item-name">${inv.item.name}</div>
              <div class="item-val">${coin(12)}${amount(inv.item.value)}</div>
            </button>`,
          )}</div>`}
    <div class="open-row"><button class="btn primary big" data-act="crash-go" id="crBtn"></button></div>`,
  );
  crashButton();
  if (run) crashLoop(run);
  else {
    crashDraw(0, 1);
    if (crashRun && crashRun.end) crashShowEnd(crashRun.end);
    // a rocket may still be in the air (the app was reloaded)
    API.get('/crash/active')
      .then((r) => {
        if (r.round && route().view === 'crash' && !(crashRun && !crashRun.done)) crashFly(r.round);
      })
      .catch(() => {});
  }
}

/** Total value of the brainrots staked in brainrots mode. */
function crashBetValue() {
  let sum = 0;
  for (const inv of S.inventory) if (crashSel.has(inv.invId)) sum += inv.item.value;
  return sum;
}

function crashButton() {
  const btn = $('#crBtn');
  if (!btn) return;
  const flying = crashRun && !crashRun.done;
  btn.classList.toggle('cash', !!flying);
  if (!flying && S.modes.crash === false) {
    render(btn, html`${t('closedNow')}`);
    btn.disabled = true;
    return;
  }
  if (flying) render(btn, html`${t('crash.cashout')} <span class="money">${coin(16)}<b id="crWin" class="priv">${fmt(crashRun.bet)}</b></span>`);
  else render(btn, html`${t('crash.start')}`);
  btn.disabled = !!(crashRun && crashRun.pending) || (!flying && (S.crashMode || 'coins') === 'brainrots' && crashSel.size === 0);
}

/** Curve from the start to `ms`; the scale grows with the flight like on a chart. */
function crashDraw(ms, m) {
  const W = 300;
  const H = 200;
  const tMax = Math.max(8000, ms * 1.15);
  const mMax = Math.max(2, m * 1.25);
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const tt = (ms * i) / 40;
    const mm = Math.exp(S.crash.speed * tt);
    pts.push([(tt / tMax) * W, H - ((mm - 1) / (mMax - 1)) * (H - 24) - 12]);
  }
  const d = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
  $('#crLine')?.setAttribute('d', d);
  $('#crArea')?.setAttribute('d', `${d} L${pts[pts.length - 1][0].toFixed(1)} ${H} L0 ${H}Z`);
  const stage = $('#crStage');
  const rocket = $('#crRocket');
  if (!stage || !rocket) return;
  const [x, y] = pts[pts.length - 1];
  const [px, py] = pts[Math.max(0, pts.length - 4)];
  const sx = stage.clientWidth / W;
  const sy = stage.clientHeight / H;
  const angle = ms > 0 ? (Math.atan2((py - y) * sy, (x - px) * sx) * 180) / Math.PI : 20;
  rocket.style.left = `${(x / W) * 100}%`;
  rocket.style.top = `${(y / H) * 100}%`;
  rocket.firstElementChild.style.transform = `rotate(${45 - angle}deg)`;
}

/** One animation loop per rocket (the screen may be drawn again meanwhile). */
function crashLoop(run) {
  if (run.looping) return;
  run.looping = true;
  const tick = () => {
    if (run.done || crashRun !== run) {
      run.looping = false;
      return;
    }
    const ms = performance.now() - run.t0;
    const m = crashMult(ms);
    const el = $('#crMult');
    if (el) el.textContent = fmtMult(m);
    const w = $('#crWin');
    if (w) w.textContent = fmt(Math.floor(run.bet * m));
    crashDraw(ms, m);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function crashFly(round) {
  crashRun = { id: round.id, bet: round.bet, kind: round.kind || 'coins', t0: performance.now() - (round.elapsed || 0), done: false, pending: false };
  S.busy = true;
  if (route().view === 'crash') viewCrash($('#view')); // renders the flying layout and starts the loop
  const stage = $('#crStage');
  if (stage) stage.className = 'crash-stage flying';
  crashPoll(crashRun);
}

/** Waits for the explosion (the server answers right when it happens). */
async function crashPoll(run) {
  while (!run.done) {
    try {
      const r = await API.post(`/crash/${run.id}/wait`);
      if (run.done) return;
      if (r.round.status === 'crashed') return crashEnd(run, { kind: 'boom', mult: r.round.crashPoint });
      if (r.round.status === 'cashed') return crashEnd(run, { kind: 'won', mult: r.round.mult, win: r.round.win, item: r.round.item, coins: r.round.coins });
    } catch {
      await sleep(1500);
    }
  }
}

async function crashEnd(run, end, balance) {
  if (run.done) return;
  run.done = true;
  run.end = end;
  S.busy = false;
  if (typeof balance === 'number') setBalance(balance);
  if (run.kind === 'brainrots') await refreshInventory(); // staked brainrots gone, a won one added
  haptic.notify(end.kind === 'won' ? 'success' : 'error');
  if (route().view !== 'crash' || afterBusy()) return;
  if (run.kind === 'brainrots') {
    viewCrash($('#view')); // picker back with the current inventory; its else-branch re-applies the result
  } else {
    crashShowEnd(end);
    const inp = $('#crBet');
    if (inp) inp.disabled = false;
    crashButton();
  }
}

function crashShowEnd(end) {
  crashDraw(crashTimeOf(end.mult), end.mult); // keep the curve frozen at the final multiplier
  const stage = $('#crStage');
  if (stage) stage.className = `crash-stage ${end.kind}`;
  const el = $('#crMult');
  if (el) el.textContent = fmtMult(end.mult);
  const note = $('#crNote');
  if (!note) return;
  if (end.kind !== 'won') return render(note, html`${t('crash.boom', { m: fmtMult(end.mult) })}`);
  if (end.item) {
    render(
      note,
      html`${t('crash.won', { m: fmtMult(end.mult) })} <span class="cr-win-item r-${end.item.rarity}">${art(end.item)}<b>${end.item.name}</b></span>${end.coins > 0 ? html` <span class="money">${coin(14)}<b class="priv">+${fmt(end.coins)}</b></span>` : ''}`,
    );
  } else {
    render(note, html`${t('crash.won', { m: fmtMult(end.mult) })} <span class="money">${coin(14)}<b class="priv">+${fmt(end.coins !== undefined ? end.coins : end.win)}</b></span>`);
  }
}

async function crashGo() {
  const run = crashRun && !crashRun.done ? crashRun : null;
  if (run) {
    if (run.pending) return;
    run.pending = true;
    crashButton();
    try {
      const r = await API.post(`/crash/${run.id}/cashout`);
      const end = r.round.status === 'cashed' ? { kind: 'won', mult: r.round.mult, win: r.round.win, item: r.round.item, coins: r.round.coins } : { kind: 'boom', mult: r.round.crashPoint };
      run.pending = false;
      crashEnd(run, end, r.balance);
    } catch (e) {
      run.pending = false;
      crashButton();
      showError(e);
    }
    return;
  }
  const mode = S.crashMode || 'coins';
  let payload;
  if (mode === 'brainrots') {
    const ids = [...crashSel];
    const value = crashBetValue();
    if (!ids.length) {
      showError({ code: 'bad_bet', data: { min: S.crash.minBet, max: S.crash.maxBet } });
      return;
    }
    if (value < S.crash.minBet || value > S.crash.maxBet) {
      showError({ code: 'bad_bet', data: { min: S.crash.minBet, max: S.crash.maxBet } });
      return;
    }
    payload = { ids };
  } else {
    const inp = $('#crBet');
    const bet = Number(inp ? inp.value : 0);
    if (!Number.isSafeInteger(bet) || bet < S.crash.minBet || bet > S.crash.maxBet) {
      showError({ code: 'bad_bet', data: { min: S.crash.minBet, max: S.crash.maxBet } });
      return;
    }
    if (S.me && bet > S.me.balance) {
      showError({ code: 'not_enough' });
      return;
    }
    S.crashBet = bet;
    payload = { bet };
  }
  const btn = $('#crBtn');
  if (btn) btn.disabled = true;
  try {
    const r = await API.post('/crash/start', payload);
    setBalance(r.balance);
    if (mode === 'brainrots') {
      crashSel.clear();
      refreshInventory();
    }
    haptic.impact('medium');
    crashFly(r.round);
  } catch (e) {
    if (btn) btn.disabled = false;
    if (e.code === 'crash_active' && e.data && e.data.round) crashFly(e.data.round);
    else if (e.code === 'items_missing') {
      await refreshInventory();
      if (route().view === 'crash') viewCrash($('#view'));
      showError(e);
    } else showError(e);
  }
}

// ------------------------------------------------------------------ colour dice
// The player picks a colour and a stake; the server throws three dice (each shows one of six colours)
// and pays ×2 / ×4 for 1 / 3 dice of the colour; two dice of one colour (a pair) lose. The app only
// shows the throw it got back.
const DICE_HEX = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7', orange: '#f97316' };
let diceLast = null; // the last throw, shown on the dice until another one
const diceSel = new Set(); // inventory ids staked in brainrots mode

function dieHtml(c, i, last) {
  const cls = !c ? ' blank' : last ? (last.win > 0 && c === last.color ? ' hit' : ' miss') : '';
  return html`<div class="die${cls}" data-i="${i}" style="--dc:${c ? DICE_HEX[c] : 'transparent'}">${c ? '' : '?'}</div>`;
}

/** What the last throw brought, under the dice. */
function diceNote(r) {
  // lost: the colour did not come up, or it did but two dice showed one colour
  if (!r.win) return html`<span class="dn-lost">${t(r.matches ? 'dice.pair' : 'dice.lost')}</span>`;
  const head = html`<b class="dn-won">${t('dice.won', { n: r.matches, m: r.mult })}</b>`;
  if (r.kind === 'brainrots') {
    return html`${head} ${r.item ? html`<span class="cr-win-item r-${r.item.rarity}">${art(r.item)}<b>${r.item.name}</b></span>` : ''}${r.coins > 0 ? html` <span class="money">${coin(14)}<b class="priv">+${fmt(r.coins)}</b></span>` : ''}`;
  }
  return html`${head} <span class="money">${coin(14)}<b class="priv">+${fmt(r.win)}</b></span>`;
}

function viewDice(view) {
  const color = S.diceColor || 'red';
  const mode = S.diceMode || 'coins';
  const bet = S.diceBet || Math.max(S.dice.minBet, Math.min(100, S.dice.maxBet));
  // drop staked brainrots that are no longer in the inventory
  const have = new Set(S.inventory.map((i) => i.invId));
  for (const id of [...diceSel]) if (!have.has(id)) diceSel.delete(id);
  render(
    view,
    html`<div class="dice-stage" id="dcStage">
      <div class="dice-row">${[0, 1, 2].map((i) => dieHtml(diceLast ? diceLast.dice[i] : null, i, diceLast))}</div>
      <div class="dice-note" id="dcNote">${diceLast ? diceNote(diceLast) : ''}</div>
    </div>
    <div class="dice-colors" id="dcColors">${S.dice.colors.map(
      (c) => html`<button type="button" class="dc-chip${c === color ? ' on' : ''}" data-act="dc-color" data-c="${c}" style="--dc:${DICE_HEX[c] || '#888'}" aria-pressed="${c === color ? 'true' : 'false'}"><i></i><span>${t('dice.c.' + c)}</span></button>`,
    )}</div>
    <div class="dice-pays">${[1, 2, 3].map((k) => html`<span>${t(`dice.pay${k}`)} <b>×${S.dice.pays[k]}</b></span>`)}</div>
    <div class="seg cr-seg">
      <button type="button" data-act="dc-mode" data-m="coins" class="${mode === 'coins' ? 'on' : ''}">${t('crash.coins')}</button>
      <button type="button" data-act="dc-mode" data-m="brainrots" class="${mode === 'brainrots' ? 'on' : ''}">${t('crash.brainrots')}</button>
    </div>
    ${mode === 'coins'
      ? html`<label class="crash-bet"><span>${t('bet')}</span><input class="input" id="dcBet" type="number" inputmode="numeric" min="${S.dice.minBet}" max="${S.dice.maxBet}" step="1" value="${bet}"></label>`
      : html`<div class="cr-bet-row"><span>${t('bet')}</span><b id="dcBetVal">${money(diceBetValue(), 13)}</b></div>
        <div class="grid items" id="dcGrid">${S.inventory.map(
          (inv) => html`<button type="button" class="item pick r-${inv.item.rarity} ${diceSel.has(inv.invId) ? 'sel' : ''}" data-act="dc-pick" data-inv="${inv.invId}">
            <div class="pick-mark">${raw(ICON.check)}</div>
            <div class="item-art">${art(inv.item)}</div>
            <div class="item-name">${inv.item.name}</div>
            <div class="item-val">${coin(12)}${amount(inv.item.value)}</div>
          </button>`,
        )}</div>`}
    <div class="open-row"><button class="btn primary big" data-act="dice-go" id="dcBtn">${t('dice.roll')}</button></div>`,
  );
  diceButton();
}

/** Total value of the brainrots staked in brainrots mode. */
function diceBetValue() {
  let sum = 0;
  for (const inv of S.inventory) if (diceSel.has(inv.invId)) sum += inv.item.value;
  return sum;
}

function diceButton() {
  const btn = $('#dcBtn');
  if (!btn) return;
  btn.disabled = S.busy || ((S.diceMode || 'coins') === 'brainrots' && diceSel.size === 0);
  if (S.modes.dice === false && !S.busy) {
    btn.disabled = true;
    btn.textContent = t('closedNow');
  }
}

async function diceGo() {
  if (S.busy) return;
  const color = S.diceColor || 'red';
  const mode = S.diceMode || 'coins';
  const limits = { code: 'bad_bet', data: { min: S.dice.minBet, max: S.dice.maxBet } };
  let payload;
  if (mode === 'brainrots') {
    const value = diceBetValue();
    if (!diceSel.size || value < S.dice.minBet || value > S.dice.maxBet) return showError(limits);
    payload = { color, ids: [...diceSel] };
  } else {
    const inp = $('#dcBet');
    const bet = Number(inp ? inp.value : 0);
    if (!Number.isSafeInteger(bet) || bet < S.dice.minBet || bet > S.dice.maxBet) return showError(limits);
    if (S.me && bet > S.me.balance) return showError({ code: 'not_enough' });
    S.diceBet = bet;
    payload = { color, bet };
  }
  S.busy = true;
  diceButton();
  haptic.impact('medium');
  const dice = $$('#dcStage .die');
  const note = $('#dcNote');
  if (note) render(note, html``);
  // the dice tumble, flicking colours, until the throw comes back
  for (const d of dice) {
    d.className = 'die rolling';
    d.textContent = '';
  }
  const flick = setInterval(() => {
    for (const d of dice) d.style.setProperty('--dc', DICE_HEX[S.dice.colors[Math.floor(Math.random() * S.dice.colors.length)]]);
  }, 90);
  const t0 = performance.now();
  let rerender = false;
  try {
    const r = await API.post('/dice/roll', payload);
    await sleep(Math.max(0, (S.fast ? 450 : 1100) - (performance.now() - t0)));
    clearInterval(flick);
    // they land one after another
    for (let i = 0; i < dice.length; i++) {
      dice[i].style.setProperty('--dc', DICE_HEX[r.roll.dice[i]]);
      dice[i].className = 'die landed';
      await sleep(S.fast ? 70 : 170);
    }
    diceLast = r.roll;
    dice.forEach((d, i) => d.classList.add(r.roll.win > 0 && r.roll.dice[i] === r.roll.color ? 'hit' : 'miss'));
    if (note && note.isConnected) render(note, diceNote(r.roll));
    setBalance(r.balance);
    if (r.roll.win > 0) {
      haptic.notify('success');
      sfxCoins(r.roll.matches * 2);
    } else haptic.notify('error');
    if (mode === 'brainrots') {
      diceSel.clear();
      await refreshInventory();
      rerender = true;
    }
  } catch (e) {
    clearInterval(flick);
    rerender = true;
    if (e.code === 'items_missing') await refreshInventory();
    if (e.code === 'not_enough' && e.data && typeof e.data.balance === 'number') setBalance(e.data.balance);
    showError(e);
  } finally {
    S.busy = false;
    if (!afterBusy() && route().view === 'dice') {
      if (rerender) viewDice($('#view'));
      else diceButton();
    }
  }
}

// ------------------------------------------------------------------ profile
function viewProfile(view) {
  const me = S.me;
  const st = S.stats || {};
  const invValue = S.inventory.reduce((s, i) => s + i.item.value, 0);
  render(
    view,
    html`
    <div class="p-card">
      <div class="avatar">${me.photo ? html`<img src="${me.photo}" alt="" referrerpolicy="no-referrer">` : initials(me.name)}</div>
      <div class="p-info">
        <div class="p-name">${me.name}</div>
        <div class="p-sub">${me.username ? '@' + me.username + ' · ' : ''}ID ${me.id}</div>
      </div>
      <div class="p-bal">${money(me.balance, 18)}</div>
    </div>
    <div class="p-tools">${toggleBtn('streamer', S.streamer, ICON.eyeOff, t('streamerMode'))}${toggleBtn('sound', S.sound, ICON.sound, t('sound'))}${
      S.partner ? html`<a class="p-link" href="#/refs">${raw(ICON.users)}<span>${t('refs')}</span>${raw(ICON.chevron)}</a>` : ''
    }</div>
    <h3 class="sec-title">${t('stats')}</h3>
    <div class="stats">
      <div class="stat"><div class="s-val">${fmt(st.casesOpened || 0)}</div><div class="s-lbl">${t('casesOpened')}</div></div>
      <div class="stat"><div class="s-val">${money(st.totalWon || 0, 15)}</div><div class="s-lbl">${t('totalWon')}</div></div>
      <div class="stat best ${st.bestDrop ? 'r-' + st.bestDrop.rarity : ''}">
        <div class="s-val">${st.bestDrop ? html`<span class="best-art">${art(st.bestDrop)}</span><span class="best-name">${st.bestDrop.name}</span>` : '—'}</div>
        <div class="s-lbl">${t('bestDrop')}</div>
      </div>
      <div class="stat"><div class="s-val">${fmt(st.upgradesWon || 0)} / ${fmt(st.upgradesTotal || 0)}</div><div class="s-lbl">${t('upgrades')}</div></div>
      <div class="stat"><div class="s-val">${money(st.soldValue || 0, 15)}</div><div class="s-lbl">${t('soldFor')}</div></div>
      <div class="stat"><div class="s-val">${st.since ? fmtDate(st.since) : '—'}</div><div class="s-lbl">${t('since')}</div></div>
    </div>
    <div class="inv-head">
      <h3 class="sec-title">${t('inventory')} <span class="cnt">${S.inventory.length}</span>${S.inventory.length ? html` <span class="inv-sum">${money(invValue, 13)}</span>` : ''}</h3>
      ${S.inventory.length
        ? html`<div class="inv-btns">${S.modes.withdrawals === false
            ? html`<button class="btn small" disabled>${t('wdClosed')}</button>`
            : html`<button class="btn small" data-act="withdraw">${t('withdraw')}</button>`}<button class="btn small ghost" data-act="sell-all">${t('sellAll')}</button></div>`
        : ''}
    </div>
    ${S.inventory.length
      ? html`<div class="grid items">${S.inventory.map(
          (inv) => html`<div class="item r-${inv.item.rarity}">
            <div class="item-art">${art(inv.item)}</div>
            <div class="item-name">${inv.item.name}</div>
            <button class="sell-btn" data-act="sell" data-inv="${inv.invId}">${t('sell')} ${coin(11)}${amount(inv.item.value)}</button>
          </div>`,
        )}</div>`
      : html`<div class="empty-box"><p>${t('emptyInv')}</p><button class="btn small" data-act="to-cases">${t('toCases')}</button></div>`}`,
  );
}

// ------------------------------------------------------------------ referrals (partners)
/** The partner's codes: what the players get, the level, the stats and the players. */
async function viewRefs(view) {
  if (!S.refs) render(view, html`${refsHead()}<div class="spinner"></div>`);
  else drawRefs(view);
  try {
    const r = await API.get('/referrals/mine');
    S.refs = { i: S.refs ? S.refs.i : 0, codes: r.codes };
  } catch (e) {
    if (!S.refs) return showError(e);
  }
  if (route().view === 'refs') drawRefs(view);
}

function refsHead() {
  return html`<div class="view-head">
    <button class="back" data-act="back" aria-label="${t('back')}">${raw(ICON.back)}</button>
    <div class="vh-title">${t('refs')}</div>
  </div>`;
}

function drawRefs(view) {
  const codes = S.refs.codes;
  if (!codes.length) return render(view, html`${refsHead()}<div class="empty-box"><p>${t('refNone')}</p></div>`);
  const i = Math.min(S.refs.i, codes.length - 1);
  const c = codes[i];
  const s = c.stats;
  const stat = (v, k) => html`<div class="stat"><div class="s-val">${v}</div><div class="s-lbl">${t(k)}</div></div>`;
  const toNext = c.next ? Math.min(100, Math.round((s.paying / c.next.from) * 100)) : 100;
  render(
    view,
    html`${refsHead()}
    ${codes.length > 1 ? html`<div class="seg">${codes.map((x, k) => html`<button class="${k === i ? 'on' : ''}" data-act="refs-code" data-i="${k}">${x.code}</button>`)}</div>` : ''}
    <div class="ref-card">
      <div class="ref-lbl">${t('refYourCode')}</div>
      <button class="ref-code" data-act="copy-ref" data-code="${c.code}">${c.code}${raw(ICON.copy)}</button>
      <div class="ref-gives">${t('refGives', { p: fmt(c.pct) })}</div>
      ${c.active ? '' : html`<div class="ref-off">${t('refOff')}</div>`}
    </div>
    <h3 class="sec-title">${t('stats')}</h3>
    <div class="stats">
      ${stat(fmt(s.players), 'refCame')}${stat(fmt(s.paying), 'refPaying')}
      ${stat(money(s.deposits, 15), 'refDeposits')}${stat(money(s.withdrawals, 15), 'refWithdrawals')}
      ${stat(money(s.bets, 15), 'refBets')}${stat(money(s.bonus, 15), 'refBonus')}
    </div>
    <h3 class="sec-title">${t('refLevels')}</h3>
    <div class="lvl-next">
      <div class="lvl-next-top"><span>${c.next ? t('refToNext', { n: c.next.n }) : t('refMax')}</span>${c.next ? html`<b>${fmt(s.paying)} / ${fmt(c.next.from)}</b>` : ''}</div>
      <div class="lvl-bar"><i style="width:${toNext}%"></i></div>
      <div class="lvl-note">${t('refLevelsNote')}</div>
    </div>
    <div class="lvls">${c.levels.map(
      (l) => html`<div class="lvl${l.n === c.level.n ? ' on' : l.n < c.level.n ? ' done' : ''}">
        <span class="lvl-mark">${l.n <= c.level.n ? raw(ICON.check) : l.n}</span>
        <span class="lvl-main"><b>${t('refLevel', { n: l.n })}</b><small>${t('refFrom', { n: fmt(l.from) })}</small></span>
        <span class="lvl-pct">+${fmt(l.pct)}%</span>
      </div>`,
    )}</div>
    ${c.own ? html`<div class="ref-own">${t('refOwnNote', { p: fmt(c.pct) })}</div>` : ''}
    <h3 class="sec-title">${t('refPlayers')} <span class="cnt">${fmt(s.players)}</span></h3>
    ${c.players.length
      ? html`<div class="list ref-players">${c.players.map(
          (p) => html`<div class="row"><span class="row-main"><b>${p.name}</b><small>${fmtDate(p.at)}</small></span><span class="badge ${p.paid ? 'ok' : 'off'}">${t(p.paid ? 'refPaid' : 'refNotPaid')}</span></div>`,
        )}</div>`
      : html`<div class="empty-box"><p>${t('refNone')}</p></div>`}`,
  );
}

async function refreshInventory() {
  try {
    const r = await API.get('/inventory');
    S.inventory = r.inventory;
  } catch {
    /* keep the old list */
  }
}

async function refreshMe() {
  try {
    const r = await API.get('/me');
    S.me = r.me;
    S.adminSections = Array.isArray(r.adminSections) ? r.adminSections : null;
    S.stats = r.stats;
    S.free = { ...S.free, ...r.free };
    S.nick = { ...S.nick, ...r.nick };
    S.share = { ...S.share, ...r.share };
    if (r.topup) S.topup = r.topup;
    // a part closed or opened again by the main admin: the screen shows it at once
    if (r.modes && JSON.stringify({ ...S.modes, ...r.modes }) !== JSON.stringify(S.modes)) {
      S.modes = { ...S.modes, ...r.modes };
      if (!S.busy) renderView();
    }
    const partner = !!r.partner;
    if (partner !== S.partner) {
      S.partner = partner;
      if (route().view === 'profile' || (!partner && route().view === 'refs')) renderView();
    }
    updateHeader();
  } catch (e) {
    if (e && e.code === 'maintenance') showMaintenance(); // the maintenance began while the app was open
  }
}

// ------------------------------------------------------------------ popovers & modals
function openLang(anchor) {
  const pop = openPop(
    anchor,
    html`<div class="pop-title">${t('language')}</div>${LANGS.map(
      (l) => html`<button class="pop-item ${l.code === lang() ? 'on' : ''}" data-lang="${l.code}"><b>${l.label}</b><span>${l.name}</span></button>`,
    )}`,
  );
  pop.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    closePop();
    const l = b.dataset.lang;
    setLang(l);
    store.setItem('bs_lang', l);
    haptic.tick();
    shell();
    renderView();
    API.post('/prefs', { lang: l }).catch(() => {});
    if (S.me) S.me.lang = l;
  });
}

function openTheme(anchor) {
  const pop = openPop(
    anchor,
    html`<div class="pop-title">${t('theme')}</div><div class="swatches">${Object.entries(THEMES).map(
      ([k, v]) => html`<button class="swatch ${k === S.theme ? 'on' : ''}" data-theme="${k}">
        <i style="background:linear-gradient(135deg, ${v.a1}, ${v.a2});box-shadow:0 0 0 3px ${v.bg2}"></i><span>${t('theme.' + k)}</span>
      </button>`,
    )}</div>`,
  );
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    applyTheme(b.dataset.theme, { save: true });
    haptic.tick();
    $$('.swatch', pop).forEach((s) => s.classList.toggle('on', s.dataset.theme === S.theme));
    API.post('/prefs', { theme: S.theme }).catch(() => {});
  });
}

function openPromo() {
  const sheet = openModal(
    html`<div class="promo">
      <div class="sheet-title">${t('promo')}</div>
      <form id="promoForm" autocomplete="off">
        <input class="input" id="promoInput" maxlength="40" placeholder="${t('promoPh')}" autocapitalize="characters" spellcheck="false">
        <button class="btn primary big" type="submit">${t('activate')}</button>
      </form>
    </div>`,
  );
  const input = sheet.querySelector('#promoInput');
  setTimeout(() => input.focus(), 250);
  sheet.querySelector('#promoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    try {
      const r = await API.post('/promo', { code });
      setBalance(r.balance);
      haptic.notify('success');
      closeModal();
      toast(t('promoOk', { n: fmt(r.amount) }), 'ok');
      if (route().view === 'case' || route().view === 'profile') renderView();
    } catch (err) {
      showError(err);
    }
  });
}

// ------------------------------------------------------------------ top-up & withdrawal
const STARS_MAX = 10000;
const starsCoins = (n) => Math.floor(n * (S.topup.starsRate || 0) + 1e-9);
const tuHead = (title) =>
  html`<div class="tu-head"><button type="button" class="back" data-act="tu-menu" aria-label="${t('back')}">${raw(ICON.back)}</button><div class="sheet-title">${title}</div><span></span></div>`;

let tuSheet = null;
function tuBox() {
  return tuSheet && tuSheet.isConnected ? tuSheet.querySelector('#topup') : null;
}

function openTopup(code = '') {
  S.tuCode = code;
  tuSheet = openModal(html`<div class="topup" id="topup"></div>`, { onClose: () => (tuSheet = null) });
  topupMenu();
}

function topupMenu() {
  const box = tuBox();
  if (!box) return;
  box.closest('.sheet')?.classList.remove('tall');
  render(
    box,
    html`<div class="sheet-title">${t('topup')}</div>
    <div class="tu-opts">
      ${S.topup.starsOpen === false
        ? html`<button type="button" class="tu-opt stars closed" data-act="tu-stars" disabled><span class="tu-ico emo">⭐</span><b>${t('tu.stars')}</b><small>${t('tu.closed')}</small></button>`
        : html`<button type="button" class="tu-opt stars" data-act="tu-stars"><span class="tu-ico emo">⭐</span><b>${t('tu.stars')}</b></button>`}
      ${S.topup.brainrotsOpen === false
        ? html`<button type="button" class="tu-opt brainrots closed" data-act="tu-brainrots" disabled><span class="tu-ico emo">🧠</span><b>${t('tu.brainrots')}</b><small>${t('tu.closed')}</small></button>`
        : html`<button type="button" class="tu-opt brainrots" data-act="tu-brainrots"><span class="tu-ico emo">🧠</span><b>${t('tu.brainrots')}</b></button>`}
    </div>
    <button type="button" class="btn ghost tu-promo" data-act="promo">${t('promo')}</button>`,
  );
}

/** The code field in the top-up forms: the auto promo code, or a referral code until the player has one. */
const refField = () =>
  html`<label>${t(S.me && S.me.ref ? 'promoCode' : 'refCode')}<input class="input" id="refIn" maxlength="32" autocapitalize="characters" autocorrect="off" spellcheck="false" value="${S.tuCode || ''}"></label>`;
const refValue = (box) => String(box.querySelector('#refIn')?.value || '').trim();

function topupStars() {
  const box = tuBox();
  if (!box) return;
  box.closest('.sheet')?.classList.remove('tall');
  const def = 100;
  render(
    box,
    html`${tuHead(t('tu.stars'))}
    <form class="form tu-form" id="starsForm" autocomplete="off">
      <label>${t('starsAmount')}<span class="stars-in"><span class="emo">⭐</span><input class="input" id="starsInput" type="number" inputmode="numeric" min="1" max="${STARS_MAX}" step="1" value="${def}"></span></label>
      <div class="tu-get"><span>=</span><span id="starsGet">${money(starsCoins(def), 20)}</span></div>
      ${refField()}
      <div id="starsPayRow"><button class="btn primary big" type="submit" id="starsPay">${t('pay')} <span class="emo">⭐</span><b id="starsN">${fmt(def)}</b></button></div>
    </form>`,
  );
  const input = box.querySelector('#starsInput');
  const value = () => {
    const n = Number(input.value);
    return Number.isInteger(n) && n >= 1 && n <= STARS_MAX && starsCoins(n) >= 1 ? n : 0;
  };
  const payBtn = () =>
    html`<button class="btn primary big" type="submit" id="starsPay">${t('pay')} <span class="emo">⭐</span><b id="starsN">${fmt(def)}</b></button>`;
  input.addEventListener('input', () => {
    const n = value();
    render(box.querySelector('#starsGet'), money(n ? starsCoins(n) : 0, 20));
    // the amount changed after the invoice link was made: that link is for the old amount
    if (box.querySelector('#starsLink')) render(box.querySelector('#starsPayRow'), payBtn());
    box.querySelector('#starsN').textContent = n ? fmt(n) : '—';
    box.querySelector('#starsPay').disabled = !n;
  });
  box.querySelector('#starsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = value();
    if (!n) return showError({ code: 'bad_stars' });
    payStars(n, box);
  });
}

async function payStars(stars, box) {
  const btn = box.querySelector('#starsPay');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  haptic.impact('light');
  let r;
  try {
    const ref = refValue(box);
    r = await API.post('/topup/stars', ref ? { stars, ref } : { stars });
  } catch (e) {
    btn.disabled = false;
    return showError(e);
  }
  if (r.ref) S.me.ref = r.ref;
  if (S.mode === 'tg' && tg && typeof tg.openInvoice === 'function') {
    tg.openInvoice(r.link, (status) => {
      if (btn.isConnected) btn.disabled = false;
      if (status === 'paid') {
        closeModal();
        awaitCredit(r.invoice, 30);
      } else if (status === 'failed') showError({ code: 'pay_failed' });
    });
    return;
  }
  // Website: the invoice opens in Telegram; a real link avoids popup blockers.
  render(
    box.querySelector('#starsPayRow'),
    html`<a class="btn primary big" id="starsLink" href="${r.link}" target="_blank" rel="noopener">${t('pay')} <span class="emo">⭐</span><b>${fmt(stars)}</b></a>`,
  );
  box.querySelector('#starsLink').addEventListener('click', () => {
    closeModal();
    awaitCredit(r.invoice, 300);
  });
}

/** Polls the invoice until the bot has credited the Stars payment. */
let creditWatch = 0;
async function awaitCredit(invoice, seconds) {
  const my = ++creditWatch;
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until && my === creditWatch) {
    await sleep(1500);
    try {
      const r = await API.get('/topup/stars/' + encodeURIComponent(invoice));
      if (r.paid) {
        setBalance(r.balance);
        haptic.notify('success');
        toast(t('starsOk', { n: fmt(r.coins) }), 'ok');
        if (S.autoPromo) refreshAutoPromo();
        const v = route().view;
        if (!S.busy && (v === 'case' || v === 'profile')) renderView();
        return;
      }
    } catch {
      /* try again */
    }
  }
}

const OFFER_MAX = 20; // different brainrots in one deposit request
const OFFER_COUNT_MAX = 99;

// Buffs (mutations and traits) of a deposited brainrot, as in Brainrot Battle: each adds its % of the
// brainrot's price, a few take some off; the %s of one brainrot add up. The player picks nothing — the
// admin who takes the brainrot sees its buffs and credits the price with them.
const BUFF_TIERS = [
  ['low', (p) => p < 0],
  ['top', (p) => p >= 30],
  ['high', (p) => p >= 15],
  ['mid', (p) => p >= 5],
  ['base', () => true],
];
/** The buffs in groups: the ones that lower the price, then from the biggest extra down. */
function buffTiers(buffs = S.topup.buffs || []) {
  const tiers = BUFF_TIERS.map(([key]) => ({ key, list: [] }));
  for (const b of buffs) tiers[BUFF_TIERS.findIndex(([, fits]) => fits(b.pct))].list.push(b);
  for (const x of tiers) x.list.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  return tiers.filter((x) => x.list.length);
}
const buffPct = (p) => `${p < 0 ? '−' : '+'}${fmt(Math.abs(p))}%`;
/** One buff: emoji, name and what it adds (or takes off). */
const buffChip = (b, extra = '') =>
  html`<span class="buff${b.pct < 0 ? ' neg' : ''}"><span class="buff-emo emo">${b.emoji || '✨'}</span><span class="buff-name">${b.name}</span><span class="buff-sub"><b class="buff-pct">${buffPct(b.pct)}</b>${extra}</span></span>`;

/** "Extra for buffs" in the brainrot deposit form: the groups open on a tap, the ones lowering the price are open. */
function buffsInfo() {
  const tiers = buffTiers();
  if (!tiers.length) return '';
  return html`<details class="buffs" id="buffs">
    <summary class="buffs-head"><span class="emo">✨</span><b>${t('buffs.title')}</b>${raw(ICON.chevron)}</summary>
    <div class="buffs-body">
      <p class="buffs-note">${t('buffs.note')}</p>
      ${tiers.map(
        (x) => html`<details class="bt bt-${x.key}" data-tier="${x.key}" ${x.key === 'low' ? raw('open') : ''}>
          <summary><b class="bt-name">${t('buffs.t.' + x.key)}</b><small>${t('buffs.s.' + x.key)}</small><span class="bt-n">${x.list.length}</span>${raw(ICON.chevron)}</summary>
          <div class="bt-list">${x.list.map((b) => buffChip(b))}</div>
        </details>`,
      )}
    </div>
  </details>`;
}

/** Deposit by brainrots: nick + the brainrots the player will give (picked from the list). */
function topupBrainrots() {
  const box = tuBox();
  if (!box) return;
  const can = S.depositIds ? new Set(S.depositIds) : null; // admins choose which brainrots are taken
  const list = S.items.filter((i) => !can || can.has(i.id)).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const byId = new Map(list.map((i) => [i.id, i]));
  const picked = new Map(); // itemId -> count
  render(
    box,
    html`${tuHead(t('tu.brainrots'))}
    <form class="form tu-form" id="depForm" autocomplete="off">
      <label>${t('nick')}<input class="input nick-input" name="nick" maxlength="32" value="${S.me.nick || ''}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      ${refField()}
      ${buffsInfo()}
      <div class="fld-lbl">${t('depWhat')}</div>
      <div class="dep-sel" id="depSel"></div>
      <input class="input" id="depSearch" type="search" placeholder="${t('depSearch')}" autocapitalize="off" autocorrect="off" spellcheck="false">
      <div class="grid items" id="depGrid">${list.map(
        (it) => html`<button type="button" class="item pick r-${it.rarity}" data-dep="${it.id}" data-name="${it.name.toLowerCase()}">
          <div class="pick-mark">${raw(ICON.check)}</div>
          <div class="item-art">${art(it)}</div>
          <div class="item-name">${it.name}</div>
          <div class="item-val">${coin(12)}${amount(it.value)}</div>
        </button>`,
      )}</div>
      <div class="wd-foot"><button class="btn primary big" type="submit" id="depBtn" disabled>${t('sendReq')}</button></div>
    </form>`,
  );
  box.closest('.sheet')?.classList.add('tall');
  const form = box.querySelector('#depForm');
  const btn = form.querySelector('#depBtn');
  const update = () => {
    render(
      form.querySelector('#depSel'),
      html`${[...picked].map(([id, n]) => {
        const it = byId.get(id);
        return html`<div class="dep-row r-${it.rarity}" data-row="${id}">
          <span class="lr-art">${art(it)}</span>
          <span class="lr-name"><b>${it.name}</b><small>${money(it.value, 11)}</small></span>
          <span class="dep-cnt"><button type="button" class="icon-btn small" data-dep-dec="${id}" aria-label="−">−</button><b>${n}</b><button type="button" class="icon-btn small" data-dep-inc="${id}" aria-label="+" ${n >= OFFER_COUNT_MAX ? raw('disabled') : ''}>+</button></span>
        </div>`;
      })}`,
    );
    for (const el of form.querySelectorAll('[data-dep]')) el.classList.toggle('sel', picked.has(Number(el.dataset.dep)));
    btn.disabled = picked.size === 0;
  };
  form.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-dep]');
    const inc = e.target.closest('[data-dep-inc]');
    const dec = e.target.closest('[data-dep-dec]');
    if (tile) {
      const id = Number(tile.dataset.dep);
      if (picked.has(id)) picked.delete(id);
      else if (picked.size >= OFFER_MAX) return toast(t('depMax', { n: OFFER_MAX }));
      else picked.set(id, 1);
    } else if (inc) {
      const id = Number(inc.dataset.depInc);
      picked.set(id, Math.min(OFFER_COUNT_MAX, (picked.get(id) || 0) + 1));
    } else if (dec) {
      const id = Number(dec.dataset.depDec);
      const n = (picked.get(id) || 0) - 1;
      if (n > 0) picked.set(id, n);
      else picked.delete(id);
    } else return;
    haptic.tick();
    update();
  });
  form.querySelector('#depSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const el of form.querySelectorAll('[data-dep]')) el.classList.toggle('hidden', !!q && !el.dataset.name.includes(q));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nick = String(new FormData(form).get('nick') || '').trim();
    if (nick.replace(/^@+/, '').length < 3) return showError({ code: 'bad_nick' });
    if (!picked.size) return showError({ code: 'bad_offer' });
    const offer = [...picked].map(([itemId, count]) => ({ itemId, count }));
    btn.disabled = true;
    try {
      const ref = refValue(form);
      const r = await API.post('/requests/deposit', ref ? { nick, offer, ref } : { nick, offer });
      S.me.nick = r.request.nick;
      if (r.ref) S.me.ref = r.ref;
      if (r.request.promo && S.autoPromo && S.autoPromo.code === r.request.promo.code) S.autoPromo.used = true;
      closeModal();
      haptic.notify('success');
      toast(t('reqSent', { id: r.request.id }), 'ok');
    } catch (err) {
      btn.disabled = false;
      showError(err);
      // closed by the admins while the form was open: back to the choice, marked closed
      if (err.code === 'deposits_closed') {
        S.topup = { ...S.topup, brainrotsOpen: false };
        topupMenu();
      }
    }
  });
}

function openWithdraw() {
  if (!S.inventory.length) return;
  const sel = new Set();
  let target = null; // brainrot chosen in exchange for the ones that can't be withdrawn
  const sheet = openModal(
    html`<div class="wd" id="wdPage">
      <div class="sheet-title">${t('wdTitle')}</div>
      <form class="form tu-form" id="wdForm" autocomplete="off">
        <label>${t('nick')}<input class="input nick-input" name="nick" maxlength="32" value="${S.me.nick || ''}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <div class="fld-lbl">${t('wdPick')}</div>
        <div class="grid items" id="wdGrid">${S.inventory.map(
          (inv) => html`<button type="button" class="item pick r-${inv.item.rarity}" data-wd="${inv.invId}">
            <div class="pick-mark">${raw(ICON.check)}</div>
            <div class="item-art">${art(inv.item)}</div>
            <div class="item-name">${inv.item.name}</div>
            <div class="item-val">${coin(12)}${amount(inv.item.value)}</div>
          </button>`,
        )}</div>
        <div class="wd-foot"><button class="btn primary big" type="submit" id="wdBtn" disabled>${t('withdraw')}</button></div>
      </form>
    </div>
    <div class="wd hidden" id="wdSwap"></div>`,
    { cls: 'tall' },
  );
  const btn = sheet.querySelector('#wdBtn');
  const allowed = new Set(S.withdrawIds || []);
  let serverValue = null; // value the server counted for the exchange (wins over the local estimate)
  const picked = () => S.inventory.filter((i) => sel.has(i.invId));
  const swapValue = () => serverValue ?? picked().filter((i) => !allowed.has(i.item.id)).reduce((s, i) => s + i.item.value, 0);
  const nickValue = () => String(new FormData(sheet.querySelector('#wdForm')).get('nick') || '').trim();

  /** Step 2: the picked brainrots can't be withdrawn — choose one that can, the rest goes to the balance. */
  function showSwap() {
    const value = swapValue();
    const box = sheet.querySelector('#wdSwap');
    const options = (S.withdrawIds || []).map((id) => S.itemsById.get(id)).filter(Boolean).sort((a, b) => b.value - a.value);
    if (target && target.value > value) target = null;
    render(
      box,
      html`<div class="tu-head"><button type="button" class="back" id="wdBack" aria-label="${t('back')}">${raw(ICON.back)}</button><div class="sheet-title">${t('wdChoose')}</div><span></span></div>
      <div class="grid items" id="wdTargets">${options.map(
        (it) => html`<button type="button" class="item pick r-${it.rarity} ${target && target.id === it.id ? 'sel' : ''}" data-wt="${it.id}" ${it.value > value ? raw('disabled') : ''}>
          <div class="pick-mark">${raw(ICON.check)}</div>
          <div class="item-art">${art(it)}</div>
          <div class="item-name">${it.name}</div>
          <div class="item-val">${coin(12)}${amount(it.value)}</div>
          ${it.value <= value ? html`<div class="wd-rest">${t('wdRest')} +${amount(value - it.value)}</div>` : ''}
        </button>`,
      )}</div>
      <div class="wd-foot"><button class="btn primary big" type="button" id="wdGo" ${target ? '' : raw('disabled')}>${t('withdraw')}</button></div>`,
    );
    sheet.querySelector('#wdPage').classList.add('hidden');
    box.classList.remove('hidden');
    sheet.scrollTop = 0;
  }
  sheet.querySelector('#wdSwap').addEventListener('click', (e) => {
    if (e.target.closest('#wdBack')) {
      sheet.querySelector('#wdSwap').classList.add('hidden');
      sheet.querySelector('#wdPage').classList.remove('hidden');
      return;
    }
    const b = e.target.closest('[data-wt]');
    if (b && !b.disabled) {
      target = S.itemsById.get(Number(b.dataset.wt)) || null;
      haptic.tick();
      showSwap();
      return;
    }
    const go = e.target.closest('#wdGo');
    if (go && !go.disabled && target) send(go, target.id);
  });

  async function send(button, exchangeTo) {
    const nick = nickValue();
    button.disabled = true;
    try {
      const r = await API.post('/requests/withdraw', { nick, ids: [...sel], ...(exchangeTo ? { exchangeTo } : {}) });
      const gone = new Set(r.removed);
      S.inventory = S.inventory.filter((i) => !gone.has(i.invId));
      for (const id of gone) S.up.sel.delete(id);
      S.me.nick = r.request.nick;
      if (typeof r.balance === 'number') setBalance(r.balance);
      closeModal();
      haptic.notify('success');
      toast(t('reqSent', { id: r.request.id }), 'ok');
      if (route().view === 'profile') viewProfile($('#view'));
    } catch (err) {
      button.disabled = false;
      if (err.code === 'need_exchange') {
        if (typeof err.data.value === 'number') serverValue = err.data.value;
        return showSwap();
      }
      showError(err);
      if (err.code === 'items_missing') {
        await refreshInventory();
        closeModal();
        if (route().view === 'profile') viewProfile($('#view'));
      }
    }
  }
  const update = () => {
    const total = S.inventory.filter((i) => sel.has(i.invId)).reduce((s, i) => s + i.item.value, 0);
    render(btn, sel.size ? html`${t('withdraw')} ${money(total, 18)}` : html`${t('withdraw')}`);
    btn.disabled = !sel.size;
  };
  sheet.querySelector('#wdGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wd]');
    if (!b) return;
    const id = Number(b.dataset.wd);
    if (sel.has(id)) sel.delete(id);
    else if (sel.size >= 100) return;
    else sel.add(id);
    serverValue = null;
    b.classList.toggle('sel', sel.has(id));
    haptic.tick();
    update();
  });
  const form = sheet.querySelector('#wdForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (nickValue().replace(/^@+/, '').length < 3) return showError({ code: 'bad_nick' });
    if (!sel.size) return;
    if (S.withdrawIds && picked().some((i) => !allowed.has(i.item.id))) return showSwap();
    send(btn, null);
  });
}

// ------------------------------------------------------------------ admin context
function adminCtx() {
  return {
    S,
    API,
    t,
    fmt,
    fmtDateTime,
    html,
    raw,
    render,
    $,
    $$,
    coin,
    chest,
    caseArt: caseImg,
    art,
    money,
    toast,
    showError,
    openModal,
    closeModal,
    confirmModal,
    go,
    fmtChance,
    buffTiers,
    buffChip,
    buffPct,
    ICON,
    openTg(url) {
      if (tg && tg.openTelegramLink && S.mode === 'tg' && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
      else window.open(url, '_blank', 'noopener');
    },
    reloadCatalog,
    async reloadMe() {
      await refreshMe();
    },
  };
}

// ------------------------------------------------------------------ events
const actions = {
  'close-modal': () => closeModal(),
  back: () => {
    if (S.busy) return;
    if (history.length > 1) history.back();
    else go(route().view === 'refs' ? '#/profile' : '#/cases');
  },
  promo: () => openPromo(),
  topup: () => openTopup(),
  // the auto promo card: to the cases, the top-up with the code typed in (unless it is used already)
  'ap-cases': () => {
    haptic.tick();
    const grid = $('#view .case-grid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'ap-topup': () => {
    haptic.tick();
    openTopup(S.autoPromo && !S.autoPromo.used ? S.autoPromo.code : '');
  },
  'tu-menu': () => topupMenu(),
  'tu-stars': () => topupStars(),
  'tu-brainrots': () => topupBrainrots(),
  withdraw: () => openWithdraw(),
  lang: (el) => openLang(el),
  theme: (el) => openTheme(el),
  open: (el) => openCase(Number(el.dataset.id)),
  count: (el) => {
    if (S.busy) return;
    const r = route();
    const c = r.view === 'case' && S.cases.find((x) => x.id === r.id);
    if (!c) return;
    S.openCount = OPEN_COUNTS.includes(Number(el.dataset.n)) ? Number(el.dataset.n) : 1;
    haptic.tick();
    refreshOpenRow(c);
  },
  subscribe: () => {
    const url = S.free && S.free.channelUrl;
    if (!url) return;
    if (tg && tg.openTelegramLink && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
    else window.open(url, '_blank', 'noopener');
  },
  'check-sub': () => checkSub(false),
  share: () => doShare(),
  fast: () => {
    S.fast = !S.fast;
    store.setItem('bs_fast', S.fast ? '1' : '0');
    haptic.tick();
    markToggle('fast', S.fast);
  },
  sound: () => {
    S.sound = !S.sound;
    store.setItem('bs_sound', S.sound ? '1' : '0');
    setSound(S.sound);
    haptic.tick();
    markToggle('sound', S.sound);
  },
  streamer: () => {
    S.streamer = !S.streamer;
    store.setItem('bs_streamer', S.streamer ? '1' : '0');
    haptic.tick();
    applyStreamer();
    updateHeader();
    renderFeed();
    renderTop24();
    if (route().view === 'profile') viewProfile($('#view'));
    markToggle('streamer', S.streamer);
  },
  'sell-won': async (el) => {
    el.disabled = true;
    try {
      await sellItems(el.dataset.inv.split(',').map(Number));
      closeModal();
      const r = route();
      if (r.view === 'case') {
        const c = S.cases.find((x) => x.id === r.id);
        if (c) refreshOpenRow(c);
      }
    } catch (e) {
      el.disabled = false;
      showError(e);
    }
  },
  sell: async (el) => {
    el.disabled = true;
    try {
      await sellItems([Number(el.dataset.inv)]);
      if (route().view === 'profile') viewProfile($('#view'));
    } catch (e) {
      el.disabled = false;
      showError(e);
    }
  },
  'sell-all': async () => {
    const total = S.inventory.reduce((s, i) => s + i.item.value, 0);
    if (!(await confirmModal(t('confirmSellAll', { c: S.inventory.length, n: fmt(total) })))) return;
    try {
      const res = await API.post('/sell', { all: true });
      setBalance(res.balance);
      sfxCoins(S.inventory.length);
      S.inventory = [];
      S.up.sel.clear();
      if (S.stats) S.stats.soldValue += res.amount;
      toast(t('sold', { n: fmt(res.amount) }), 'ok');
      haptic.notify('success');
      if (route().view === 'profile') viewProfile($('#view'));
    } catch (e) {
      showError(e);
    }
  },
  'to-cases': () => go('#/cases'),
  // colour dice
  'dc-color': (b) => {
    if (S.busy) return;
    S.diceColor = b.dataset.c;
    haptic.tick();
    for (const x of $$('#dcColors .dc-chip')) {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    }
  },
  'dc-mode': (b) => {
    if (S.busy || (S.diceMode || 'coins') === b.dataset.m) return;
    const inp = $('#dcBet');
    if (inp && Number(inp.value) > 0) S.diceBet = Number(inp.value);
    S.diceMode = b.dataset.m;
    haptic.tick();
    viewDice($('#view'));
  },
  'dc-pick': (b) => {
    if (S.busy) return;
    const id = Number(b.dataset.inv);
    if (diceSel.has(id)) diceSel.delete(id);
    else if (diceSel.size < 12) diceSel.add(id);
    b.classList.toggle('sel', diceSel.has(id));
    haptic.tick();
    const v = $('#dcBetVal');
    if (v) render(v, money(diceBetValue(), 13));
    diceButton();
  },
  'dice-go': () => diceGo(),
  // the case contents: the chances show on a tap
  odds: (b) => {
    const grid = $('#caseItems');
    if (!grid) return;
    const show = grid.classList.contains('odds-hidden');
    grid.classList.toggle('odds-hidden', !show);
    b.classList.toggle('on', show);
    b.setAttribute('aria-pressed', show ? 'true' : 'false');
    haptic.tick();
  },
  'refs-code': (b) => {
    S.refs.i = Number(b.dataset.i) || 0;
    drawRefs($('#view'));
  },
  'copy-ref': async (b) => {
    haptic.tick();
    try {
      await navigator.clipboard.writeText(b.dataset.code);
      toast(t('copied'), 'ok');
    } catch {
      /* no clipboard: the code is on the screen */
    }
  },
  'up-tab': (el) => {
    S.up.tab = el.dataset.v;
    haptic.tick();
    updateUpgrade();
  },
  'up-pick': (el) => {
    if (S.busy) return;
    const id = Number(el.dataset.inv);
    if (S.up.sel.has(id)) S.up.sel.delete(id);
    else if (S.up.sel.size >= 6) return toast(t('maxItems'));
    else S.up.sel.add(id);
    // a chosen percentage follows the new bet
    if (S.up.pct) {
      const it = upBet() ? targetForChance(upBet(), S.up.pct) : null;
      S.up.target = it ? it.id : null;
    }
    haptic.tick();
    updateUpgrade();
  },
  'up-target': (el) => {
    if (S.busy) return;
    const id = Number(el.dataset.id);
    S.up.target = S.up.target === id ? null : id;
    S.up.pct = null;
    haptic.tick();
    updateUpgrade();
  },
  'up-pct': (el) => setUpPct(Number(el.dataset.p)),
  'do-upgrade': () => doUpgrade(),
  'crash-go': () => crashGo(),
  'cr-mode': (el) => {
    if (crashRun && !crashRun.done) return;
    S.crashMode = el.dataset.m;
    if (route().view === 'crash') viewCrash($('#view'));
  },
  'cr-pick': (el) => {
    if (crashRun && !crashRun.done) return;
    const id = Number(el.dataset.inv);
    if (crashSel.has(id)) crashSel.delete(id);
    else crashSel.add(id);
    haptic.tick();
    el.classList.toggle('sel', crashSel.has(id));
    const v = $('#crBetVal');
    if (v) render(v, money(crashBetValue(), 13));
    crashButton();
  },
};

// touch screens have no hover: a tap on a live drop shows where it came from
const NO_HOVER = window.matchMedia ? window.matchMedia('(hover: none)') : { matches: false };

document.addEventListener('click', (e) => {
  if (S.streamer) {
    const host = e.target.closest('.priv') ? null : e.target.closest('.money, .bal, .item-val, .sell-btn, .drop-val, .top24-val');
    const pv = e.target.closest('.priv') || (host && host.querySelector('.priv'));
    if (pv) peek(pv);
  }
  const live = e.target.closest('.drop, .top24');
  if (live && live.querySelector('.drop-src') && NO_HOVER.matches) {
    const on = !live.classList.contains('show-src');
    for (const x of $$('.show-src')) x.classList.remove('show-src');
    live.classList.toggle('show-src', on);
    haptic.tick();
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab && !S.busy) {
    haptic.tick();
    const k = tab.dataset.tab;
    go(k === 'cases' ? '#/cases' : `#/${k}`);
    return;
  }
  const card = e.target.closest('[data-case]');
  if (card) {
    haptic.tick();
    go(`#/case/${card.dataset.case}`);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (a && actions[a.dataset.act] && !a.disabled) {
    actions[a.dataset.act](a, e);
  }
});

window.addEventListener('hashchange', () => {
  if (S.busy) {
    S.routeChanged = true;
    return;
  }
  closeModal();
  renderView();
});

/** Re-render if the URL changed while an animation was running. */
function afterBusy() {
  if (S.routeChanged) {
    S.routeChanged = false;
    renderView();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ boot
/** ?go=admin/deposits/12 (buttons in bot notifications) opens that screen. */
function openFromLink() {
  try {
    const u = new URL(location.href);
    const go = u.searchParams.get('go');
    if (go === null) return;
    u.searchParams.delete('go');
    const hash = /^[a-z0-9/_-]{1,80}$/i.test(go) ? '#/' + go : u.hash;
    history.replaceState(null, '', u.pathname + u.search + hash);
  } catch {
    /* ignore malformed URLs */
  }
}
function splash(noteKey) {
  render(
    $('#app'),
    html`<div class="splash">
      <img class="splash-logo" src="img/logo.jpg" alt="" width="120" height="120">
      <div class="splash-name"><span>Dragon</span><span>Drop</span></div>
      <div class="splash-note" id="splashNote">${t(noteKey || 'loading')}</div>
    </div>`,
  );
}

async function showNoAuth() {
  let bot = null;
  try {
    bot = (await API.get('/public')).bot;
  } catch {
    /* offline */
  }
  render(
    $('#app'),
    html`<div class="splash">
      <img class="splash-logo" src="img/logo.jpg" alt="" width="120" height="120">
      <div class="splash-name"><span>Dragon</span><span>Drop</span></div>
      <div class="splash-note">${t('openInTg')}</div>
      ${bot ? html`<a class="btn primary big" href="https://t.me/${bot}">${t('openBot')}</a>` : ''}
    </div>`,
  );
}

function applyBootstrap(b) {
  S.me = b.me;
  S.adminSections = Array.isArray(b.adminSections) ? b.adminSections : null;
  S.cases = b.cases;
  S.categories = b.categories || [];
  S.withdrawIds = Array.isArray(b.withdrawIds) ? b.withdrawIds : null;
  S.depositIds = Array.isArray(b.depositIds) ? b.depositIds : null;
  S.items = b.items;
  S.itemsById = new Map(b.items.map((i) => [i.id, i]));
  S.upgrade = b.upgrade;
  if (b.crash) S.crash = b.crash;
  if (b.dice) S.dice = b.dice;
  S.autoPromo = b.autoPromo || null;
  applyHalloween(!!b.halloween);
  S.free = b.free;
  S.nick = b.nick || { available: false, nextAt: null };
  S.share = b.share || { available: false, nextAt: null, need: 5, have: 0 };
  S.feed = b.live.feed;
  S.top24 = b.live.top24;
  S.online = b.live.online;
  S.stats = b.stats;
  S.inventory = b.inventory;
  S.bot = b.bot;
  S.links = b.links || {};
  S.partner = !!b.partner;
  if (b.topup) S.topup = b.topup;
  if (b.modes) S.modes = { ...S.modes, ...b.modes };
  if (b.me.lang && b.me.lang !== lang() && !store.getItem('bs_lang')) setLang(b.me.lang);
  if (b.me.theme && !store.getItem('bs_theme')) applyTheme(b.me.theme);
}

async function boot() {
  const storedLang = store.getItem('bs_lang');
  setLang(storedLang || tgLang());
  applyTheme(store.getItem('bs_theme') || 'sunset');
  if (S.halloween) applyHalloween(true);
  applyStreamer();
  setSound(S.sound);
  // browsers keep audio muted until a tap
  for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  startBubbles($('#bubbles'));
  try {
    tg?.ready();
    tg?.expand();
    tg?.disableVerticalSwipes?.();
    tg?.BackButton?.onClick(() => actions.back());
  } catch {
    /* not in Telegram */
  }
  splash();
  const mode = API.initAuth();
  S.mode = mode;
  if (!mode) return showNoAuth();
  const wakeTimer = setTimeout(() => {
    const n = $('#splashNote');
    if (n) n.textContent = t('waking');
  }, 4000);
  try {
    const b = await API.post('/bootstrap');
    clearTimeout(wakeTimer);
    // Server-side language wins unless the user picked one on this device.
    if (!storedLang && b.me.lang) setLang(b.me.lang);
    applyBootstrap(b);
  } catch (e) {
    clearTimeout(wakeTimer);
    if (e.code === 'unauthorized' && mode === 'web') {
      API.clearWebAuth();
      return showNoAuth();
    }
    if (e.code === 'maintenance') return showMaintenance();
    render(
      $('#app'),
      html`<div class="splash">
        <img class="splash-logo" src="img/logo.jpg" alt="" width="120" height="120">
        <div class="splash-name"><span>Dragon</span><span>Drop</span></div>
        <div class="splash-note">${errorText(e)}</div>
        ${e.code !== 'banned' && e.code !== 'unauthorized' ? html`<button class="btn primary big" onclick="location.reload()">${t('retry')}</button>` : ''}
      </div>`,
    );
    return;
  }
  openFromLink();
  shell();
  renderView();
  const live = API.stream({
    drop: onDrop,
    online: (n) => {
      S.online = n;
      updateHeader();
    },
    top24: (d) => {
      S.top24 = d;
      renderTop24();
    },
  });
  live.start(S.feed.length ? S.feed[0].id : 0);
  const ping = () => {
    if (document.hidden) return;
    API.post('/ping')
      .then((r) => {
        S.online = r.online;
        updateHeader();
      })
      .catch(() => {});
  };
  setInterval(ping, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      ping();
      refreshMe();
    }
  });
}

boot();
