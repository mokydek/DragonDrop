import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateInitData, buildInitData, signWebToken, verifyWebToken } from '../src/auth.js';
import { pickWeighted, upgradeChance, cryptoRng } from '../src/game.js';
import { rarityOf } from '../src/rarity.js';
import { resolveSsl } from '../src/db.js';
import { validateSetting } from '../src/settings.js';
import { pickLang } from '../src/texts.js';

const TOKEN = '42:ABCDEF';
const user = { id: 555, first_name: 'Тест', username: 'tester', language_code: 'ru' };

test('initData: valid data passes and returns the user', () => {
  const init = buildInitData(user, TOKEN);
  const r = validateInitData(init, TOKEN);
  assert.equal(r.user.id, 555);
  assert.equal(r.user.first_name, 'Тест');
});

test('initData: wrong token, tampering, missing hash and expiry are rejected', () => {
  const init = buildInitData(user, TOKEN);
  assert.equal(validateInitData(init, '42:OTHER'), null);
  const tampered = init.replace('tester', 'hacker');
  assert.notEqual(tampered, init);
  assert.equal(validateInitData(tampered, TOKEN), null);
  const p = new URLSearchParams(init);
  p.delete('hash');
  assert.equal(validateInitData(p.toString(), TOKEN), null);
  const old = buildInitData(user, TOKEN, Math.floor(Date.now() / 1000) - 90_000);
  assert.equal(validateInitData(old, TOKEN, 86400), null);
  assert.ok(validateInitData(old, TOKEN, 0), 'maxAge 0 disables the age check');
  assert.equal(validateInitData('', TOKEN), null);
  assert.equal(validateInitData('garbage', TOKEN), null);
});

test('initData: extra signature field is supported both ways', () => {
  // Signature included in the data-check-string
  const withSig = buildInitData(user, TOKEN, undefined, { signature: 'abc123' });
  assert.ok(validateInitData(withSig, TOKEN));
  // Signature excluded from the data-check-string (appended afterwards)
  const base = buildInitData(user, TOKEN);
  assert.ok(validateInitData(base + '&signature=zzz', TOKEN));
});

test('web token: roundtrip, tampering, expiry', () => {
  const secret = crypto.randomBytes(16).toString('hex');
  const t = signWebToken(99, 3, secret);
  assert.deepEqual(verifyWebToken(t, secret), { userId: 99, ver: 3 });
  assert.equal(verifyWebToken(t, 'other'), null);
  assert.equal(verifyWebToken(t.replace('99.', '98.'), secret), null);
  const expired = signWebToken(99, 3, secret, 10, Date.now() - 60_000);
  assert.equal(verifyWebToken(expired, secret), null);
  assert.equal(verifyWebToken('a.b.c', secret), null);
});

test('drop chances: 300k openings of every case match the configured odds (chi-square)', () => {
  const seed = JSON.parse(readFileSync(new URL('../src/seed-data.json', import.meta.url)));
  for (const c of seed.cases) {
    const entries = c.items.map((e, i) => ({ i, chance: e.chance }));
    const counts = new Array(entries.length).fill(0);
    const N = 300_000;
    for (let k = 0; k < N; k++) counts[pickWeighted(entries, cryptoRng).i]++;
    const sum = entries.reduce((s, e) => s + e.chance, 0);
    let chi = 0;
    entries.forEach((e, i) => {
      const exp = (N * e.chance) / sum;
      chi += (counts[i] - exp) ** 2 / exp;
    });
    const df = entries.length - 1;
    // Wilson–Hilferty approximation of the 99.99% chi-square quantile
    const z = 3.719;
    const crit = df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3;
    assert.ok(chi < crit, `${c.slug}: chi=${chi.toFixed(1)} crit=${crit.toFixed(1)}`);
    // Configured chances add up to exactly 100%
    assert.equal(Math.round(sum * 1000), 100000, `${c.slug} chances sum to ${sum}`);
  }
});

test('drop chances: cases return ~90% (free case EV 8)', () => {
  const seed = JSON.parse(readFileSync(new URL('../src/seed-data.json', import.meta.url)));
  const value = new Map(seed.items.map((i) => [i.name, i.value]));
  for (const c of seed.cases) {
    const ev = c.items.reduce((s, e) => s + (value.get(e.item) * e.chance) / 100, 0);
    if (c.price === 0) assert.ok(Math.abs(ev - 8) < 0.05, `free EV ${ev}`);
    else assert.ok(Math.abs(ev / c.price - 0.9) < 0.002, `${c.slug} RTP ${ev / c.price}`);
  }
  const prices = Object.fromEntries(seed.cases.map((c) => [c.slug, c.price]));
  assert.deepEqual(prices, { free: 0, noob: 10, pro: 25, fish: 65, dlc: 200, halloween: 250, summer: 350, dragon: 450, mushroom: 750, griffin: 2000 });
  // the owner's price list (01.10.2026) — every entry is in the catalogue with exactly this price
  const priceList = {
    Lavaka: 5, 'Candy Slap': 7, 'Divane Slap': 9, 'Spaghetti Tualetti': 10, 'Tralalero Tralala': 15, 'Ketupat Kepat': 20,
    'Ketchuru and Musturu': 22, 'Ventoliero Pavonero': 30, 'Lava Blaster': 31, 'Los Planitos': 32, 'Los Mariachis': 39, Eviledon: 42,
    'W or L': 40, 'Los Bros': 35, 'Gold Gold Gold': 46, 'La Ginger Sekolah': 47, 'Los Primos': 55, 'Pizza and Ranch': 57,
    'La Secret Combinasion': 60, 'Wave Rider': 61, "Cupid's Wings": 61, 'Garama and Madundung': 65, "Witch's Broom": 61, 'Cash or Card': 65,
    "Santa's Sleigh": 80, 'Los Tacoritas': 95, 'Burguro and Fryuro': 100, 'La Food Combinasion': 103, 'Pop Pop Petalini': 105,
    'La Taco Combinasion': 125, 'Capitano Moby': 140, 'Popcuru and Fizzuru': 140, 'Celestial Pegasus': 140, 'Lovin Rose': 110, Cerberus: 150,
    'Boppin Bunny': 130, 'Fragola La La La': 160, 'Cooki and Milki': 190, 'Spooky and Pumpky': 200, 'Globa Steppa': 234, 'Reinito Sleighito': 280,
    'Los Amigos': 320, 'Bearito Cabinito': 350, 'Examen Bros': 400, 'La Breakfast Combinasion': 450, 'Rico Dinero': 500, 'Foxini Lanternini': 540,
    Venuspino: 555, 'Los Chillis': 600, Bumbatron: 625, 'Rosey and Teddy': 680, 'La Casa Boo': 721, 'Dug Dug Dug': 500, 'Rainbow Hammer': 520,
    'Ketupat Bros': 810, 'Dragon Cannelloni': 1100, 'Bloodmoon Hammer': 1170, Grabatron: 1300, 'Hydra Dragon Cannelloni': 1350, 'Jelly Moby': 1482,
    'Bunny and Eggy': 1606, 'Pancake and Syrup': 1850, 'Tirillikalika Tirillikalako': 1850, 'Hydra Bunny': 2400, 'La Supreme Combinasion': 2450,
    Kraken: 2500, 'Moby Bros': 2600, 'Digi Narwhal': 2700, 'Fishino Clownino': 3000, 'Kalika Bros': 4000, Griffin: 5000, Orchidox: 6000,
    'Love Love Bear': 8500, Arcadragon: 12500, 'Elefanto Frigo': 13500, 'Skibidi Toilet': 16500, 'John Pork': 18500, Meowl: 20000,
    'Strawberry Elephant': 50000,
  };
  assert.equal(Object.keys(priceList).length, 79);
  for (const [n, v] of Object.entries(priceList)) assert.equal(value.get(n), v, n);
  assert.equal(seed.items.length, 136);
  assert.equal(value.size, 136, 'item names are unique');
  // every item drops from at least one case
  const inCases = new Set(seed.cases.flatMap((c) => c.items.map((e) => e.item)));
  for (const i of seed.items) assert.ok(inCases.has(i.name), `${i.name} is in no case`);
});

test('upgrade chance formula', () => {
  assert.equal(upgradeChance(50, 100, 10, 80), 45);
  assert.equal(upgradeChance(90, 100, 10, 80), 80); // capped
  assert.equal(upgradeChance(1, 16500, 10, 80), 0);
  assert.equal(upgradeChance(0, 100, 10, 80), 0);
  assert.equal(upgradeChance(10, 30, 10, 80), 30);
  // bad luck: every chance 1.3 times lower, the cap too
  assert.equal(upgradeChance(55, 200, 10, 80, 1.3), 19.03);
  assert.equal(upgradeChance(90, 100, 10, 80, 1.3), 61.53);
  // the default 1.06 keeps a real 75%
  assert.equal(upgradeChance(90, 100, 10, 80, 1.06), 75.47);
  assert.equal(upgradeChance(50, 100, 10, 80, 1), 45);
  assert.equal(upgradeChance(1, 3, 0, 95), 33.33);
});

test('rarity by value and override', () => {
  assert.equal(rarityOf(1), 'common');
  assert.equal(rarityOf(10), 'uncommon');
  assert.equal(rarityOf(60), 'rare');
  assert.equal(rarityOf(200), 'epic');
  assert.equal(rarityOf(1100), 'legendary');
  assert.equal(rarityOf(5000), 'mythic');
  assert.equal(rarityOf(16500), 'secret');
  assert.equal(rarityOf(1, 'secret'), 'secret');
  assert.equal(rarityOf(1, 'bogus'), 'common');
});

test('database TLS settings', () => {
  assert.equal(resolveSsl('postgres://u:p@localhost:5432/db').ssl, false);
  assert.equal(resolveSsl('postgres://u:p@dpg-abc123-a/db').ssl, false);
  assert.deepEqual(resolveSsl('postgres://u:p@db.x.supabase.co:5432/postgres').ssl, { rejectUnauthorized: false });
  const r = resolveSsl('postgres://u:p@host.example.com/db?sslmode=require');
  assert.deepEqual(r.ssl, { rejectUnauthorized: false });
  assert.ok(!r.connectionString.includes('sslmode'));
  assert.equal(resolveSsl('postgres://u:p@host.example.com/db?sslmode=disable').ssl, false);
  assert.equal(resolveSsl('postgres://u:p@host.example.com/db', 'verify-full').ssl, true);
});

test('settings validation', () => {
  assert.equal(validateSetting('channel', '@brainrot_news'), '@brainrot_news');
  assert.equal(validateSetting('channel', '-1001234567890'), '-1001234567890');
  assert.throws(() => validateSetting('channel', 'brainrot news'));
  assert.equal(validateSetting('free_cooldown_hours', '12'), 12);
  assert.throws(() => validateSetting('free_cooldown_hours', -1));
  assert.throws(() => validateSetting('support_url', 'http://insecure.example'));
  assert.equal(validateSetting('support_url', 'https://t.me/helper'), 'https://t.me/helper');
  assert.throws(() => validateSetting('nope', 1));
  assert.equal(validateSetting('start_balance', 10.6), 11);
  assert.throws(() => validateSetting('free_require_sub', 'yes'));
});

test('language detection', () => {
  assert.equal(pickLang('uk'), 'uk');
  assert.equal(pickLang('ru'), 'ru');
  assert.equal(pickLang('en-US'), 'en');
  assert.equal(pickLang('be'), 'ru');
  assert.equal(pickLang('de'), 'en');
  assert.equal(pickLang(undefined), 'ru');
});

test('UI texts: RU/UK/EN have the same keys and every key used in the app exists', async () => {
  const { DICTS } = await import('../web/js/i18n.js');
  const { SETTINGS_SCHEMA } = await import('../src/settings.js');
  const { readFileSync: rf } = await import('node:fs');
  const ru = Object.keys(DICTS.ru).sort();
  assert.deepEqual(Object.keys(DICTS.uk).sort(), ru, 'uk keys');
  assert.deepEqual(Object.keys(DICTS.en).sort(), ru, 'en keys');
  for (const l of ['ru', 'uk', 'en']) for (const [k, v] of Object.entries(DICTS[l])) assert.ok(v && v.trim(), `${l}.${k} empty`);

  const src = rf(new URL('../web/js/app.js', import.meta.url), 'utf8') + rf(new URL('../web/js/admin.js', import.meta.url), 'utf8');
  const used = new Set([...src.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.')));
  const dynamic = [
    ...['cases', 'upgrade', 'crash', 'dice', 'profile', 'admin'].map((k) => 'tab.' + k),
    ...['red', 'yellow', 'green', 'blue', 'purple', 'orange'].map((k) => 'dice.c.' + k),
    ...[1, 2, 3].map((k) => 'dice.pay' + k),
    'dice.lost',
    'dice.pair',
    ...['one', 'few', 'many'].map((k) => 'ap.h.' + k),
    ...['low', 'top', 'high', 'mid', 'base'].flatMap((k) => ['buffs.t.' + k, 'buffs.s.' + k]),
    ...['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'].map((k) => 'r.' + k),
    ...['sunset', 'graphite', 'mint', 'redblue', 'violet', 'ocean'].map((k) => 'theme.' + k),
    ...['overview', 'deposits', 'withdrawals', 'cases', 'items', 'users', 'referrals', 'promos', 'settings', 'broadcast'].map((k) => 'a.' + k),
    'e.bad_ref',
    'a.e.ref_exists',
    'a.e.partner_not_found',
    ...['deposit', 'withdraw'].map((k) => 'a.r.' + k),
    ...['active', 'done', 'rejected'].map((k) => 'a.r.sc.' + k),
    ...['new', 'active', 'done', 'rejected'].map((k) => 'a.r.st.' + k),
    ...['created', 'credit', 'give', 'done', 'rejected'].map((k) => 'a.r.sys.' + k),
    ...['users', 'new24', 'online', 'opened24', 'upgrades24', 'coins', 'items_value'].map((k) => 'a.st.' + k),
    ...Object.keys(SETTINGS_SCHEMA).map((k) => 'a.s.' + k),
    'a.sec.depBrainrots',
    'a.sec.depStars',
  ];
  for (const k of [...used, ...dynamic]) assert.ok(k in DICTS.ru, `missing text key: ${k}`);

  // every error code the player API can return has a message
  const server = ['game.js', 'api.js', 'crash.js', 'dice.js', 'autopromo.js'].map((f) => rf(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n');
  const codes = new Set([...server.matchAll(/GameError\('([a-z_]+)'/g)].map((m) => m[1]));
  const handledElsewhere = new Set(['use_free_endpoint', 'bad_request', 'item_not_found', 'unauthorized', 'not_found']);
  for (const c of codes) if (!handledElsewhere.has(c)) assert.ok('e.' + c in DICTS.ru, `no message for error ${c}`);
  const admin = rf(new URL('../src/admin.js', import.meta.url), 'utf8');
  const adminCodes = new Set([...admin.matchAll(/GameError\('([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of adminCodes) if (!['not_found', 'forbidden'].includes(c)) assert.ok('a.e.' + c in DICTS.ru, `no admin message for ${c}`);

  // deposits / withdrawals: player errors have a message, admin-only errors an admin message
  const req = rf(new URL('../src/requests.js', import.meta.url), 'utf8');
  const reqCodes = new Set([...req.matchAll(/(?:GameError\(|cleanText\([^;]*?, )'([a-z_]+)'/g)].map((m) => m[1]));
  const playerSide = ['bad_nick', 'bad_details', 'bad_offer', 'too_many_requests', 'bad_stars', 'bot_disabled', 'invoice_failed', 'items_missing', 'need_exchange', 'exchange_too_expensive', 'not_withdrawable', 'deposits_closed', 'promo_used'];
  for (const c of playerSide) {
    assert.ok(reqCodes.has(c), `requests.js no longer throws ${c}`);
    assert.ok('e.' + c in DICTS.ru, `no message for error ${c}`);
  }
  for (const c of reqCodes) {
    if (playerSide.includes(c) || ['not_found', 'bad_request'].includes(c)) continue;
    assert.ok('a.e.' + c in DICTS.ru, `no admin message for ${c}`);
  }
});

test('config: without bot token or secret, login tokens use a random secret', async () => {
  const { loadConfig } = await import('../src/config.js');
  const a = loadConfig({ DATABASE_URL: 'postgres://x' });
  const b = loadConfig({ DATABASE_URL: 'postgres://x' });
  assert.notEqual(a.sessionSecret, b.sessionSecret);
  const forged = signWebToken(1, 1, crypto.createHmac('sha256', 'dev-secret').update('session').digest('hex'));
  assert.equal(verifyWebToken(forged, a.sessionSecret), null);
  const c = loadConfig({ DATABASE_URL: 'postgres://x', BOT_TOKEN: '1:A' });
  assert.equal(c.sessionSecret, loadConfig({ DATABASE_URL: 'postgres://x', BOT_TOKEN: '1:A' }).sessionSecret, 'stable when derived from the token');
});

test('live feed shows a drop only after the opening animation', async () => {
  const { createLive } = await import('../src/live.js');
  const fakeDb = { many: async () => [], one: async () => null };
  const live = createLive({ db: fakeDb, getPublicItem: () => null, revealDelayMs: 150 });
  await live.init();
  live.pushDrop({ id: 1, item: { name: 'X', rarity: 'common' }, value: 5, user: { name: 'u' }, at: new Date().toISOString() });
  assert.equal(live.snapshot().feed.length, 0, 'hidden while the player is still spinning');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(live.snapshot().feed.length, 1);
  assert.equal(live.snapshot().top24.id, 1);
  live.stop();
});
