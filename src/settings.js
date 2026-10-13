// Admin-editable settings stored in bs_settings (JSONB), cached in memory.
import { ADMIN_SECTIONS } from './access.js';
import { DEFAULT_BUFFS, BUFFS_MAX, BUFF_PCT_MIN, BUFF_PCT_MAX } from './buffs.js';

const url = { type: 'string', max: 300, url: true };

export const SETTINGS_SCHEMA = {
  channel: { type: 'string', max: 100, def: '' }, // @username or -100… id used for the subscription check
  channel_url: { ...url, def: '' }, // link opened by the "subscribe" button
  news_url: { ...url, def: '' }, // "News" button in /start (falls back to channel_url)
  support_url: { ...url, def: '' }, // "Support" button in /start
  halloween: { type: 'boolean', def: false }, // Halloween look for every player: app decorations, the Halloween case first, bot /start and shares
  free_cooldown_hours: { type: 'number', min: 1, max: 720, def: 24 },
  free_require_sub: { type: 'boolean', def: true },
  free_require_share: { type: 'boolean', def: true },
  nick_tag: { type: 'string', max: 32, def: 'DragonDrop' }, // the nick case opens for players with this in their Telegram name
  nick_cooldown_hours: { type: 'number', min: 1, max: 720, def: 24 },
  share_case_count: { type: 'number', min: 1, max: 50, def: 5, int: true }, // the share case opens after this many shares of the bot
  share_cooldown_hours: { type: 'number', min: 1, max: 720, def: 24 },
  share_require_sub: { type: 'boolean', def: true }, // the share case also needs the channel subscription
  upgrade_edge: { type: 'number', min: 0, max: 90, def: 10 }, // % kept by the upgrader
  upgrade_min_chance: { type: 'number', min: 0.01, max: 50, def: 1 },
  upgrade_max_chance: { type: 'number', min: 1, max: 95, def: 80 },
  upgrade_luck: { type: 'number', min: 1, max: 10, def: 1.06 }, // every upgrade chance is this many times lower
  crash_edge: { type: 'number', min: 0, max: 90, def: 20 }, // rocket: % kept on average (P(reach x) = (1 − edge) / x)
  crash_min_bet: { type: 'number', min: 1, max: 1_000_000_000, def: 100, int: true },
  crash_max_bet: { type: 'number', min: 1, max: 1_000_000_000, def: 100_000, int: true },
  crash_max_mult: { type: 'number', min: 2, max: 10_000, def: 1000 }, // the rocket explodes here at the latest
  dice_min_bet: { type: 'number', min: 1, max: 1_000_000_000, def: 5, int: true }, // colour dice: the smallest stake
  dice_max_bet: { type: 'number', min: 1, max: 1_000_000_000, def: 100_000, int: true }, // colour dice: the biggest stake
  start_balance: { type: 'number', min: 0, max: 1_000_000, def: 0, int: true },
  stars_rate: { type: 'number', min: 0.01, max: 1_000_000, def: 1 }, // coins for 1 Telegram Star
  welcome_ru: { type: 'string', max: 1000, def: '' },
  welcome_uk: { type: 'string', max: 1000, def: '' },
  welcome_en: { type: 'string', max: 1000, def: '' },
  admin_hidden: { type: 'list', values: ADMIN_SECTIONS, def: [] }, // admin sections the other admins don't see
  ref_count_stars: { type: 'boolean', def: true }, // Telegram Stars payments count for referral codes
  deposits_brainrots_open: { type: 'boolean', def: true }, // players can send brainrot deposit requests (admins close it for a while)
  // auto promo code (main admin): every auto_promo_hours a new code made up by the server, with a bonus of
  // auto_promo_min..auto_promo_max % to one top-up of each player who types it in
  auto_promo: { type: 'boolean', def: true },
  auto_promo_min: { type: 'number', min: 1, max: 100, def: 5, int: true },
  auto_promo_max: { type: 'number', min: 1, max: 100, def: 15, int: true },
  auto_promo_hours: { type: 'number', min: 1, max: 48, def: 2, int: true },
  // referral levels (main admin): from how many players of a code who topped up, its players get +pct% on top-ups
  ref_levels: {
    type: 'levels',
    def: [
      { from: 0, pct: 10 },
      { from: 50, pct: 25 },
      { from: 150, pct: 35 },
    ],
  },
  // buffs on deposited brainrots (main admin): each adds its % of the brainrot's price (some take it off)
  buffs: { type: 'buffs', def: DEFAULT_BUFFS },
};

// Internal keys (prefixed with _) are never exposed through the admin API.
const INTERNAL = /^_/;

export class SettingsError extends Error {
  constructor(key, reason) {
    super(`${key}: ${reason}`);
    this.key = key;
    this.code = 'bad_setting';
  }
}

/**
 * Referral levels: 1–10 steps, the first from 0 players, each next one from more players than the one
 * before; the bonus is 0–500 % (two decimals).
 */
function cleanLevels(key, value) {
  const bad = (why) => new SettingsError(key, why);
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw bad('1 to 10 levels expected');
  const out = value.map((l) => {
    if (!l || typeof l !== 'object') throw bad('level {from, pct} expected');
    const from = typeof l.from === 'string' && l.from.trim() !== '' ? Number(l.from) : l.from;
    const pct = typeof l.pct === 'string' && l.pct.trim() !== '' ? Number(l.pct.replace(',', '.')) : l.pct;
    if (!Number.isInteger(from) || from < 0 || from > 1_000_000) throw bad('from: whole number 0..1000000 expected');
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 500) throw bad('pct: 0..500 expected');
    return { from, pct: Math.round(pct * 100) / 100 };
  });
  if (out[0].from !== 0) throw bad('the first level starts from 0');
  for (let i = 1; i < out.length; i++) if (out[i].from <= out[i - 1].from) throw bad('each level needs more players than the one before');
  return out;
}

/**
 * Buffs: up to 200 of {name, pct, emoji}; a name (1–32 characters) only once, the % from −90 to +500
 * (two decimals), the emoji optional.
 */
function cleanBuffs(key, value) {
  const bad = (why) => new SettingsError(key, why);
  if (!Array.isArray(value) || value.length > BUFFS_MAX) throw bad(`up to ${BUFFS_MAX} buffs expected`);
  const seen = new Set();
  return value.map((x) => {
    if (!x || typeof x !== 'object') throw bad('buff {name, pct, emoji} expected');
    const name = typeof x.name === 'string' ? x.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 32) throw bad('name: 1..32 characters expected');
    if (seen.has(name.toLowerCase())) throw bad(`${name}: the same name twice`);
    seen.add(name.toLowerCase());
    const pct = typeof x.pct === 'string' && x.pct.trim() !== '' ? Number(x.pct.trim().replace(',', '.').replace('−', '-')) : x.pct;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < BUFF_PCT_MIN || pct > BUFF_PCT_MAX) throw bad(`pct: ${BUFF_PCT_MIN}..${BUFF_PCT_MAX} expected`);
    const emoji = x.emoji === undefined || x.emoji === null ? '' : typeof x.emoji === 'string' ? x.emoji.trim() : null;
    if (emoji === null || emoji.length > 16) throw bad('emoji: up to 16 characters expected');
    return { name, pct: Math.round(pct * 100) / 100, emoji };
  });
}

export function validateSetting(key, value) {
  const s = SETTINGS_SCHEMA[key];
  if (!s) throw new SettingsError(key, 'unknown');
  if (s.type === 'boolean') {
    if (typeof value !== 'boolean') throw new SettingsError(key, 'boolean expected');
    return value;
  }
  if (s.type === 'levels') return cleanLevels(key, value);
  if (s.type === 'buffs') return cleanBuffs(key, value);
  if (s.type === 'list') {
    if (!Array.isArray(value) || value.some((v) => !s.values.includes(v))) throw new SettingsError(key, `list of ${s.values.join(', ')} expected`);
    return s.values.filter((v) => value.includes(v));
  }
  if (s.type === 'number') {
    const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new SettingsError(key, 'number expected');
    if (n < s.min || n > s.max) throw new SettingsError(key, `must be ${s.min}..${s.max}`);
    return s.int ? Math.round(n) : Math.round(n * 1000) / 1000;
  }
  if (typeof value !== 'string') throw new SettingsError(key, 'string expected');
  const v = value.trim();
  if (v.length > s.max) throw new SettingsError(key, 'too long');
  if (s.url && v && !/^https:\/\/\S+$/i.test(v) && !/^tg:\/\/\S+$/i.test(v)) {
    throw new SettingsError(key, 'https link expected');
  }
  if (key === 'channel' && v && !/^(@[A-Za-z0-9_]{4,64}|-100\d{5,20})$/.test(v)) {
    throw new SettingsError(key, '@username or -100… id expected');
  }
  if (key === 'nick_tag' && v.replace(/[^\p{L}\p{N}]+/gu, '').length < 2) {
    throw new SettingsError(key, 'at least 2 letters or digits expected');
  }
  return v;
}

/**
 * Once per database: the upgrader bad luck goes down to 1.06 if it is higher, so the 75% upgrade
 * is there again (80 / 1.06 = 75.4%). After that the main admin changes it as usual.
 */
export async function lowerLuckOnce(settings) {
  if (settings.get('_luck_106')) return false;
  const lower = settings.get('upgrade_luck') > 1.06;
  if (lower) await settings.update({ upgrade_luck: 1.06 });
  await settings.setInternal('_luck_106', true);
  return lower;
}

/**
 * Once per database: the rocket wins less often (house edge up to 20 %) and needs at least a 100-coin
 * bet, unless the main admin already set something stricter. After that the main admin changes it as usual.
 */
export async function tuneRocketOnce(settings) {
  if (settings.get('_rocket_tuned_1')) return false;
  const patch = {};
  if (settings.get('crash_edge') < 20) patch.crash_edge = 20;
  if (settings.get('crash_min_bet') < 100) patch.crash_min_bet = 100;
  if (Object.keys(patch).length) await settings.update(patch);
  await settings.setInternal('_rocket_tuned_1', true);
  return patch;
}

/**
 * Once per database: colour dice start from 5 coins (the first release had 100), unless a lower
 * minimum was set already. After that the main admin changes it as usual.
 */
export async function diceFromFiveOnce(settings) {
  if (settings.get('_dice_min_5')) return false;
  const lower = settings.get('dice_min_bet') > 5;
  if (lower) await settings.update({ dice_min_bet: 5 });
  await settings.setInternal('_dice_min_5', true);
  return lower;
}

export function createSettings(db) {
  const cache = {};
  for (const [k, s] of Object.entries(SETTINGS_SCHEMA)) cache[k] = s.def;

  return {
    async load() {
      const rows = await db.many('SELECT key, value FROM bs_settings');
      for (const r of rows) cache[r.key] = r.value;
    },
    get(key) {
      return cache[key];
    },
    /** Public (admin-visible) settings only. */
    all() {
      const out = {};
      for (const k of Object.keys(SETTINGS_SCHEMA)) out[k] = cache[k];
      return out;
    },
    async update(patch) {
      const clean = {};
      for (const [k, v] of Object.entries(patch || {})) clean[k] = validateSetting(k, v);
      if (clean.upgrade_min_chance !== undefined || clean.upgrade_max_chance !== undefined || clean.upgrade_luck !== undefined) {
        const min = clean.upgrade_min_chance ?? cache.upgrade_min_chance;
        const max = clean.upgrade_max_chance ?? cache.upgrade_max_chance;
        const luck = clean.upgrade_luck ?? cache.upgrade_luck;
        if (min >= max) throw new SettingsError('upgrade_min_chance', 'must be lower than max chance');
        // the highest chance a player can get must stay above the minimum
        if (min >= max / luck) throw new SettingsError('upgrade_luck', 'max chance / luck must be above min chance');
      }
      if (clean.crash_min_bet !== undefined || clean.crash_max_bet !== undefined) {
        const min = clean.crash_min_bet ?? cache.crash_min_bet;
        const max = clean.crash_max_bet ?? cache.crash_max_bet;
        if (min > max) throw new SettingsError('crash_min_bet', 'must not be above the max bet');
      }
      if (clean.dice_min_bet !== undefined || clean.dice_max_bet !== undefined) {
        const min = clean.dice_min_bet ?? cache.dice_min_bet;
        const max = clean.dice_max_bet ?? cache.dice_max_bet;
        if (min > max) throw new SettingsError('dice_min_bet', 'must not be above the max bet');
      }
      if (clean.auto_promo_min !== undefined || clean.auto_promo_max !== undefined) {
        const min = clean.auto_promo_min ?? cache.auto_promo_min;
        const max = clean.auto_promo_max ?? cache.auto_promo_max;
        if (min > max) throw new SettingsError('auto_promo_min', 'must not be above the max bonus');
      }
      for (const [k, v] of Object.entries(clean)) {
        await db.query(
          'INSERT INTO bs_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [k, JSON.stringify(v)],
        );
        cache[k] = v;
      }
      return this.all();
    },
    /** Internal values (file ids, profile hashes). */
    async setInternal(key, value) {
      if (!INTERNAL.test(key)) throw new Error('internal keys must start with _');
      await db.query(
        'INSERT INTO bs_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, JSON.stringify(value)],
      );
      cache[key] = value;
    },
  };
}
