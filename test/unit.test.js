import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateInitData, buildInitData, signWebToken, verifyWebToken } from '../src/auth.js';
import { pickWeighted, upgradeChance, cryptoRng, CASE_ART, ITEM_ART, itemSlug, itemArtUrl } from '../src/game.js';
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

test('drop chances: a paid case returns ~90 % (its price is the nearest whole number of coins), the FREE case ~9 coins', () => {
  const seed = JSON.parse(readFileSync(new URL('../src/seed-data.json', import.meta.url)));
  const value = new Map(seed.items.map((i) => [i.name, i.value]));
  for (const c of seed.cases) {
    const ev = c.items.reduce((s, e) => s + (value.get(e.item) * e.chance) / 100, 0);
    if (c.price === 0) assert.ok(Math.abs(ev - 9.17) < 0.01, `free EV ${ev}`);
    else assert.equal(c.price, Math.round(ev / 0.9), `${c.slug} RTP ${ev / c.price}`);
  }
  const prices = Object.fromEntries(seed.cases.map((c) => [c.slug, c.price]));
  assert.deepEqual(prices, { free: 0, noob: 11, pro: 24, fish: 30, dlc: 135, halloween: 157, summer: 223, dragon: 178, mushroom: 383, griffin: 1160 });
  // market prices (FunPay, October 2026): the median price of the plain brainrot in rubles at 1.65 ₽ per
  // Telegram Star, 1 Star = 1 coin; the ones nobody sells (bought in the game itself) by rarity, from 1 coin
  const priceList = {
    Fluriflura: 1, 'Lirilì Larilà': 1, 'Noobini Pizzanini': 1, 'Pipi Kiwi': 1, 'Svinina Bombardino': 1, 'Talpa Di Fero': 1, 'Tim Cheese': 1,
    'Bandito Bobritto': 2, 'Boneca Ambalabu': 2, 'Cacto Hipopotamo': 2, 'Gangster Footera': 2, 'Ta Ta Ta Ta Sahur': 2,
    'Tric Trac Baraboom': 2, 'Trippi Troppi': 2, 'Avocadini Guffo': 3, 'Bambini Crostini': 3, 'Bananita Dolphinita': 3,
    'Brr Brr Patapim': 3, 'Brri Brri Bicus Dicus Bombicus': 3, 'Cappuccino Assassino': 3, Lavaka: 3, 'Perochello Lemonchello': 3,
    'Salamino Penguino': 3, 'Trulimero Trulicina': 3, 'Ballerina Cappuccina': 4, 'Blueberrinni Octopusini': 4, 'Burbaloni Loliloli': 4,
    'Chef Crabracadabra': 4, 'Chimpanzini Bananini': 4, 'Cocosini Mama': 4, 'Glorbo Fruttodrillo': 4, 'Lionel Cactuseli': 4,
    'Strawberelli Flamingelli': 4, 'Bombardiro Crocodilo': 5, 'Bombombini Gusini': 6, 'Frigo Camelo': 6, 'Gorillo Watermelondrillo': 6,
    'Orangutini Ananassini': 6, 'Rhino Toasterino': 6, 'Tigrilini Watermelini': 6, 'Cavallo Virtuoso': 8, 'Cocofanto Elefanto': 8,
    'La Vacca Saturno Saturnita': 8, Matteo: 8, 'Girafa Celestre': 9, 'Gattatino Neonino': 10, 'Odin Din Din Dun': 10,
    'Orcalero Orcala': 11, 'Chimpanzini Spiderini': 14, 'Graipuss Medussi': 17, 'Trenostruzzo Turbo 3000': 17, 'Tung Tung Tung Sahur': 20,
    'La Grande Combinasion': 21, 'Tralalero Tralala': 21, 'Los Tralaleritos': 22, 'Pot Hotspot': 22, 'Los Mariachis': 28,
    'Ketupat Kepat': 30, 'Nuclearo Dinossauro': 30, 'La Ginger Sekolah': 33, 'Spaghetti Tualetti': 33, 'Candy Slap': 36, 'Divane Slap': 36,
    'Ketchuru and Musturu': 36, 'Los Planitos': 38, 'La Taco Combinasion': 42, 'Gold Gold Gold': 47, 'Ventoliero Pavonero': 47,
    'Esok Sekolah': 48, 'Lava Blaster': 50, Eviledon: 51, 'Lovin Rose': 53, 'Los Tacoritas': 54, 'Wave Rider': 55, 'Cash or Card': 64,
    'W or L': 73, "Witch's Broom": 73, "Cupid's Wings": 74, 'Pizza and Ranch': 77, 'Los Primos': 78, 'Fragola La La La': 81,
    'Burguro and Fryuro': 91, 'Los Combinasionas': 95, 'Pop Pop Petalini': 100, 'Boppin Bunny': 102, 'Globa Steppa': 102,
    'Garama and Madundung': 104, 'Popcuru and Fizzuru': 109, 'Los Bros': 116, 'La Secret Combinasion': 122, 'Capitano Moby': 124,
    "Santa's Sleigh": 136, 'Los Chillis': 170, 'Bearito Cabinito': 178, Cerberus: 182, 'La Food Combinasion': 239, 'Examen Bros': 255,
    'Spooky and Pumpky': 262, 'Celestial Pegasus': 309, 'Los Amigos': 321, 'Rico Dinero': 324, 'Dug Dug Dug': 357, 'Cooki and Milki': 370,
    'Rosey and Teddy': 492, 'Rainbow Hammer': 502, Venuspino: 509, 'La Breakfast Combinasion': 529, 'Foxini Lanternini': 552,
    'Ketupat Bros': 561, Bumbatron: 583, 'Reinito Sleighito': 693, 'Dragon Cannelloni': 725, Grabatron: 728, 'Pancake and Syrup': 909,
    'La Casa Boo': 1002, 'Tirillikalika Tirillikalako': 1121, 'Bunny and Eggy': 1153, 'Hydra Dragon Cannelloni': 1221, 'Jelly Moby': 1296,
    'Digi Narwhal': 1319, 'Bloodmoon Hammer': 1384, 'Hydra Bunny': 1766, 'Fishino Clownino': 2030, Kraken: 2260, 'Moby Bros': 2389,
    'La Supreme Combinasion': 2582, 'Kalika Bros': 2614, Griffin: 2692, 'Love Love Bear': 5171, Arcadragon: 6646, 'Elefanto Frigo': 8182,
    Orchidox: 9419, 'Skibidi Toilet': 10309, Meowl: 13254, 'John Pork': 13506, 'Strawberry Elephant': 31367,
  };
  assert.equal(Object.keys(priceList).length, 136);
  for (const [n, v] of Object.entries(priceList)) assert.equal(value.get(n), v, n);
  assert.equal(seed.items.length, 136);
  assert.equal(value.size, 136, 'item names are unique');
  for (const i of seed.items) assert.ok(Number.isInteger(i.value) && i.value >= 1, i.name);
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

test('built-in case art: a light WebP for seeded cases only, in the shape of the case pictures (20:17)', async () => {
  const { readFileSync: rf, existsSync } = await import('node:fs');
  const seed = JSON.parse(rf(new URL('../src/seed-data.json', import.meta.url), 'utf8'));
  const slugs = new Set(seed.cases.map((c) => c.slug));
  assert.deepEqual(Object.keys(CASE_ART).sort(), ['dlc', 'dragon', 'griffin', 'halloween', 'mushroom', 'noob', 'pro', 'summer']);
  for (const [slug, v] of Object.entries(CASE_ART)) {
    assert.ok(slugs.has(slug), slug);
    assert.ok(Number.isInteger(v) && v > 0, slug);
    const url = new URL(`../web/img/cases/${slug}.webp`, import.meta.url);
    assert.ok(existsSync(url), slug);
    const b = rf(url);
    assert.equal(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 12), 'RIFFWEBP', slug);
    assert.ok(b.length < 32_000, `${slug}: ${b.length} bytes`);
    // VP8 (lossy) frame header: width and height in 14 bits each
    assert.equal(b.toString('latin1', 12, 16), 'VP8 ', slug);
    const w = b.readUInt16LE(26) & 0x3fff;
    const h = b.readUInt16LE(28) & 0x3fff;
    assert.deepEqual([w, h], [320, 272], slug);
  }
});

test('built-in brainrot pictures: one light square WebP with a transparent background for every seeded brainrot that has one', async () => {
  const { readFileSync: rf, readdirSync } = await import('node:fs');
  assert.deepEqual(
    ['Lirilì Larilà', "Cupid's Wings", 'W or L', 'Trenostruzzo Turbo 3000', '  Tim  Cheese '].map(itemSlug),
    ['lirili-larila', 'cupids-wings', 'w-or-l', 'trenostruzzo-turbo-3000', 'tim-cheese'],
  );
  const seed = JSON.parse(rf(new URL('../src/seed-data.json', import.meta.url), 'utf8'));
  const slugs = seed.items.map((i) => itemSlug(i.name));
  assert.equal(new Set(slugs).size, slugs.length, 'one file name per brainrot');
  // no picture yet: these keep their emoji
  const without = ['Rainbow Hammer', 'Wave Rider', "Cupid's Wings", 'Lavaka'];
  assert.deepEqual(seed.items.filter((i) => !ITEM_ART.has(itemSlug(i.name))).map((i) => i.name).sort(), [...without].sort());
  // every file belongs to a brainrot
  const files = readdirSync(new URL('../web/img/items/', import.meta.url));
  assert.deepEqual(files.filter((f) => !slugs.includes(f.replace(/\.webp$/, ''))), []);
  assert.equal(files.length, seed.items.length - without.length);
  for (const f of files) {
    const b = rf(new URL(`../web/img/items/${f}`, import.meta.url));
    assert.equal(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 12), 'RIFFWEBP', f);
    assert.ok(b.length < 32_000, `${f}: ${b.length} bytes`);
    // extended format with an alpha channel: canvas width and height minus one in 24 bits each
    assert.equal(b.toString('latin1', 12, 16), 'VP8X', f);
    assert.ok(b[20] & 0x10, `${f}: alpha`);
    assert.deepEqual([b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1], [256, 256], f);
    assert.equal(ITEM_ART.get(f.replace(/\.webp$/, '')), crypto.createHash('md5').update(b).digest('hex').slice(0, 8), `${f}: version`);
  }
  assert.match(itemArtUrl('Tung Tung Tung Sahur'), /^img\/items\/tung-tung-tung-sahur\.webp\?v=[0-9a-f]{8}$/);
  assert.equal(itemArtUrl('Lavaka'), null);
  assert.equal(itemArtUrl('Some New Brainrot'), null);
});
