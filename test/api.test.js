import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startApp, scriptedRng, users } from './helpers.js';
import { signWebToken } from '../src/auth.js';

const rng = scriptedRng();
let app;

before(async () => {
  app = await startApp({ dbName: 'bs_t_api', rng });
});
after(async () => {
  await app?.close();
});

function caseBySlug(slug) {
  for (const c of app.ctx.game.catalog.cases.values()) if (c.slug === slug) return c;
  throw new Error('no case ' + slug);
}
function itemByName(name) {
  for (const i of app.ctx.game.catalog.items.values()) if (i.name === name) return i;
  throw new Error('no item ' + name);
}
/** Queue an RNG value that makes the next case opening drop `itemName`. */
function forceDrop(slug, itemName) {
  const c = caseBySlug(slug);
  const target = itemByName(itemName).id;
  let offset = 0;
  for (const e of c.items) {
    if (e.item_id === target) break;
    offset += Math.max(1, Math.round(e.chance * 10000));
  }
  rng.queue.push(offset);
}

test('health and public endpoints', async () => {
  const h = await app.get('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.bot, 'DragonDrop_Bot');
  // the bot name is public: any site may read it (the old BrainrotSpin page links to this bot)
  const p = await app.call('GET', '/api/public', { headers: { Origin: 'https://brainrotspin.onrender.com' } });
  assert.deepEqual(p.body, { bot: 'DragonDrop_Bot', webUrl: 'https://app.dragondrop.test', maintenance: false });
  assert.equal(p.headers.get('access-control-allow-origin'), '*');
  const f = await app.get('/api/feed');
  assert.deepEqual(Object.keys(f.body).sort(), ['feed', 'online', 'top24']);
  const nf = await app.get('/api/nope');
  assert.equal(nf.status, 404);
});

test('auth: missing / broken credentials are rejected', async () => {
  assert.equal((await app.post('/api/bootstrap')).status, 401);
  assert.equal((await app.post('/api/bootstrap', { headers: { Authorization: 'tma hash=abc&user=%7B%7D' } })).status, 401);
  assert.equal((await app.post('/api/bootstrap', { headers: { Authorization: 'web 1.1.1.bad' } })).status, 401);
  assert.equal((await app.post('/api/bootstrap', { headers: { Authorization: 'Bearer x' } })).status, 401);
});

test('bootstrap creates the player and returns everything the app needs', async () => {
  const r = await app.post('/api/bootstrap', { user: users.alice });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.me.id, users.alice.id);
  assert.equal(b.me.name, 'Alice');
  assert.equal(b.me.lang, 'ru');
  assert.equal(b.me.theme, 'sunset');
  assert.equal(b.me.balance, 0);
  assert.equal(b.me.photo, users.alice.photo_url);
  assert.equal(b.cases.length, 12);
  assert.equal(b.cases[0].slug, 'free');
  assert.equal(b.cases[0].isFree, true);
  // the nick case comes right after the FREE case, free of charge, with the FREE case's loot
  assert.equal(b.cases[1].slug, 'nick');
  assert.equal(b.cases[1].isNick, true);
  assert.equal(b.cases[1].isFree, false);
  assert.equal(b.cases[1].price, 0);
  assert.deepEqual(b.cases[1].items, b.cases[0].items);
  assert.deepEqual(b.nick, { available: true, caseId: b.cases[1].id, nextAt: null, tag: 'DragonDrop' });
  // then the share case, the same way
  assert.equal(b.cases[2].slug, 'share');
  assert.equal(b.cases[2].isShare, true);
  assert.equal(b.cases[2].isFree, false);
  assert.equal(b.cases[2].isNick, false);
  assert.equal(b.cases[2].price, 0);
  assert.deepEqual(b.cases[2].items, b.cases[0].items);
  assert.deepEqual(b.share, { available: true, caseId: b.cases[2].id, nextAt: null, need: 5, have: 0, requireSub: false });
  assert.equal(b.cases.filter((c) => c.price > 0).length, 9);
  const griffin = b.cases.find((c) => c.slug === 'griffin');
  assert.equal(griffin.price, 1920);
  assert.equal(griffin.name.ru, 'Грифон кейс');
  assert.equal(griffin.items[0].item.name, 'Strawberry Elephant');
  const sum = griffin.items.reduce((s, e) => s + e.chance, 0);
  assert.ok(Math.abs(sum - 100) < 0.01);
  assert.equal(b.items.length, 136);
  assert.deepEqual(b.upgrade, { edge: 10, minChance: 1, maxChance: 80, luck: 1.06 });
  assert.equal(b.free.requireShare, true);
  assert.equal(b.free.requireSub, false, 'no channel configured yet');
  assert.equal(b.stats.casesOpened, 0);
  assert.deepEqual(b.inventory, []);
  assert.equal(b.bot, 'DragonDrop_Bot');

  for (const [u, lang] of [
    [users.bob, 'uk'],
    [users.carol, 'en'],
    [users.dave, 'en'],
  ]) {
    const x = await app.post('/api/bootstrap', { user: u });
    assert.equal(x.body.me.lang, lang);
  }
});

test('prefs: language and theme are saved and validated', async () => {
  const ok = await app.post('/api/prefs', { user: users.alice, body: { lang: 'en', theme: 'mint' } });
  assert.deepEqual(ok.body, { lang: 'en', theme: 'mint' });
  assert.equal((await app.post('/api/prefs', { user: users.alice, body: { lang: 'de' } })).status, 400);
  assert.equal((await app.post('/api/prefs', { user: users.alice, body: { theme: 'pink' } })).status, 400);
  const me = await app.get('/api/me', { user: users.alice });
  assert.equal(me.body.me.lang, 'en');
  assert.equal(me.body.me.theme, 'mint');
  await app.post('/api/prefs', { user: users.alice, body: { lang: 'ru', theme: 'sunset' } });
});

test('opening a case needs coins, charges the price and records the drop', async () => {
  const noob = caseBySlug('noob');
  const no = await app.post(`/api/case/${noob.id}/open`, { user: users.alice });
  assert.equal(no.status, 400);
  assert.equal(no.body.error, 'not_enough');

  await app.setBalance(users.alice.id, 100);
  forceDrop('noob', 'W or L');
  const r = await app.post(`/api/case/${noob.id}/open`, { user: users.alice });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.item.name, 'W or L');
  assert.equal(r.body.item.value, 120);
  assert.equal(r.body.item.rarity, 'rare');
  assert.equal(r.body.balance, 80);

  const inv = await app.get('/api/inventory', { user: users.alice });
  assert.equal(inv.body.inventory.length, 1);
  assert.equal(inv.body.inventory[0].invId, r.body.invId);

  const me = await app.get('/api/me', { user: users.alice });
  assert.equal(me.body.stats.casesOpened, 1);
  assert.equal(me.body.stats.totalSpent, 20);
  assert.equal(me.body.stats.totalWon, 120);
  assert.equal(me.body.stats.bestDrop.name, 'W or L');

  const feed = await app.get('/api/feed');
  assert.equal(feed.body.feed[0].item.name, 'W or L');
  assert.equal(feed.body.feed[0].user.name, 'Alice');
  assert.equal(feed.body.top24.item.name, 'W or L');

  const bad = await app.post('/api/case/999999/open', { user: users.alice });
  assert.equal(bad.status, 404);
  const free = await app.post(`/api/case/${caseBySlug('free').id}/open`, { user: users.alice });
  assert.equal(free.body.error, 'use_free_endpoint');
});

test('opening a case 2, 3 or 5 times at once charges every opening', async () => {
  const u = users.dave;
  await app.post('/api/bootstrap', { user: u });
  const noob = caseBySlug('noob');
  await app.setBalance(u.id, 50);
  const tooMany = await app.post(`/api/case/${noob.id}/open`, { user: u, body: { count: 3 } });
  assert.equal(tooMany.body.error, 'not_enough', '3 × 20 > 50');
  for (const count of [0, 4, 6, 10, 1.5, 'x']) {
    assert.equal((await app.post(`/api/case/${noob.id}/open`, { user: u, body: { count } })).body.error, 'bad_request', String(count));
  }
  forceDrop('noob', 'Tung Tung Tung Sahur');
  forceDrop('noob', 'W or L');
  const r = await app.post(`/api/case/${noob.id}/open`, { user: u, body: { count: 2 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.balance, 10);
  assert.deepEqual(r.body.drops.map((d) => d.item.name), ['Tung Tung Tung Sahur', 'W or L']);
  assert.equal(r.body.item.name, 'Tung Tung Tung Sahur', 'first drop kept for older clients');
  const inv = (await app.get('/api/inventory', { user: u })).body.inventory;
  assert.deepEqual(inv.map((i) => i.invId).sort(), r.body.drops.map((d) => d.invId).sort());
  const st = (await app.get('/api/me', { user: u })).body.stats;
  assert.equal(st.casesOpened, 2);
  assert.equal(st.totalSpent, 40);
  assert.equal(st.totalWon, 35 + 120);
  assert.equal(st.bestDrop.name, 'W or L');
  const feed = (await app.get('/api/feed')).body.feed.slice(0, 2).map((d) => d.item.name);
  assert.deepEqual(feed.sort(), ['Tung Tung Tung Sahur', 'W or L']);
  // the default is still one opening
  await app.setBalance(u.id, 30);
  const one = await app.post(`/api/case/${noob.id}/open`, { user: u });
  assert.equal(one.body.drops.length, 1);
  assert.equal(one.body.balance, 10);
  // x5: five drops, 5 × price, all in the inventory
  await app.setBalance(u.id, 99);
  assert.equal((await app.post(`/api/case/${noob.id}/open`, { user: u, body: { count: 5 } })).body.error, 'not_enough', '5 × 20 > 99');
  await app.setBalance(u.id, 105);
  const invBefore = (await app.get('/api/inventory', { user: u })).body.inventory.length;
  const five = await app.post(`/api/case/${noob.id}/open`, { user: u, body: { count: 5 } });
  assert.equal(five.status, 200, JSON.stringify(five.body));
  assert.equal(five.body.drops.length, 5);
  assert.equal(five.body.balance, 5);
  assert.equal(new Set(five.body.drops.map((d) => d.invId)).size, 5);
  assert.equal((await app.get('/api/inventory', { user: u })).body.inventory.length, invBefore + 5);
  assert.equal((await app.get('/api/me', { user: u })).body.stats.casesOpened, 2 + 1 + 5);
  await app.setBalance(u.id, 0); // later tests count on an empty balance
});

test('selling items adds their value to the balance', async () => {
  const inv = (await app.get('/api/inventory', { user: users.alice })).body.inventory;
  const r = await app.post('/api/sell', { user: users.alice, body: { ids: [inv[0].invId] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { sold: 1, amount: 120, balance: 200 });
  const again = await app.post('/api/sell', { user: users.alice, body: { ids: [inv[0].invId] } });
  assert.equal(again.body.error, 'items_missing');
  assert.equal((await app.post('/api/sell', { user: users.alice, body: { ids: ['x'] } })).status, 400);

  // Bob can't sell Alice's items
  forceDrop('noob', 'Noobini Pizzanini');
  const o = await app.post(`/api/case/${caseBySlug('noob').id}/open`, { user: users.alice });
  const steal = await app.post('/api/sell', { user: users.bob, body: { ids: [o.body.invId] } });
  assert.equal(steal.body.error, 'items_missing');

  const all = await app.post('/api/sell', { user: users.alice, body: { all: true } });
  assert.deepEqual(all.body, { sold: 1, amount: 5, balance: 185 });
  const me = await app.get('/api/me', { user: users.alice });
  assert.equal(me.body.stats.soldValue, 125);
});

test('parallel openings never overdraw the balance', async () => {
  await app.setBalance(users.bob.id, 20);
  const noob = caseBySlug('noob');
  const results = await Promise.all(Array.from({ length: 6 }, () => app.post(`/api/case/${noob.id}/open`, { user: users.bob })));
  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error === 'not_enough' || r.body.error === 'rate_limited'));
  const me = await app.get('/api/me', { user: users.bob });
  assert.equal(me.body.me.balance, 0);
  assert.equal((await app.get('/api/inventory', { user: users.bob })).body.inventory.length, 1);
});

test('upgrader: validation, win and loss', async () => {
  const u = users.carol;
  await app.post('/api/bootstrap', { user: u });
  const give = async (name) => {
    const it = itemByName(name);
    const r = await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [u.id, it.id]);
    return r.id;
  };
  const a = await give('Ketupat Kepat'); // 50
  const b = await give('La Taco Combinasion'); // 70
  const spooky = itemByName('Rico Dinero'); // 535
  const cheap = itemByName('Tim Cheese'); // 5
  const toilet = itemByName('Skibidi Toilet'); // 17010

  assert.equal((await app.post('/api/upgrade', { user: u, body: { ids: [a, b], target: cheap.id } })).body.error, 'target_too_cheap');
  assert.equal((await app.post('/api/upgrade', { user: u, body: { ids: [a, b], target: toilet.id } })).body.error, 'chance_too_low');
  assert.equal((await app.post('/api/upgrade', { user: u, body: { ids: [a, 999999], target: spooky.id } })).body.error, 'items_missing');
  assert.equal((await app.post('/api/upgrade', { user: u, body: { ids: [], target: spooky.id } })).status, 400);
  assert.equal((await app.post('/api/upgrade', { user: u, body: { ids: [1, 2, 3, 4, 5, 6, 7], target: spooky.id } })).status, 400);
  assert.equal((await app.post('/api/upgrade', { user: u, body: { ids: [a], target: 999999 } })).status, 404);

  // 120 / 535 * 90 = 20.19%, 1.06 times lower: 19.04% chance
  // the request carries the chance the player was shown; a different one is refused, nothing is spent
  const stale = await app.post('/api/upgrade', { user: u, body: { ids: [a, b], target: spooky.id, chance: 20 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'chance_changed');
  assert.equal(stale.body.chance, 19.04);
  assert.equal((await app.post('/api/upgrade', { user: u, body: { ids: [a, b], target: spooky.id } })).body.error, 'chance_changed', 'no chance sent');
  assert.equal((await app.get('/api/inventory', { user: u })).body.inventory.length, 2, 'nothing spent');
  // roll 0.000 wins
  rng.queue.push(0);
  const win = await app.post('/api/upgrade', { user: u, body: { ids: [a, b], target: spooky.id, chance: 19.04 } });
  assert.equal(win.status, 200, JSON.stringify(win.body));
  assert.equal(win.body.won, true);
  assert.equal(win.body.chance, 19.04);
  assert.equal(win.body.bet, 120);
  assert.equal(win.body.item.name, 'Rico Dinero');
  let inv = (await app.get('/api/inventory', { user: u })).body.inventory;
  assert.deepEqual(inv.map((i) => i.item.name), ['Rico Dinero']);

  // Roll 19.040 is exactly on the edge -> loss (strictly lower wins)
  const c = await give('Ketupat Kepat');
  const d = await give('La Taco Combinasion');
  rng.queue.push(19040);
  const lose = await app.post('/api/upgrade', { user: u, body: { ids: [c, d], target: spooky.id, chance: 19.04 } });
  assert.equal(lose.body.won, false);
  assert.equal(lose.body.roll, 19.04);
  inv = (await app.get('/api/inventory', { user: u })).body.inventory;
  assert.deepEqual(inv.map((i) => i.item.name), ['Rico Dinero']);

  const me = await app.get('/api/me', { user: u });
  assert.equal(me.body.stats.upgradesTotal, 2);
  assert.equal(me.body.stats.upgradesWon, 1);
  assert.equal(me.body.stats.bestDrop.name, 'Rico Dinero');
  const feed = await app.get('/api/feed');
  assert.equal(feed.body.feed[0].kind, 'upgrade');
});

test('free case: share + subscription + cooldown', async () => {
  const u = { id: 2001, first_name: 'Frida', language_code: 'ru' };
  const boot = await app.post('/api/bootstrap', { user: u });
  assert.equal(boot.body.free.shared, false);
  assert.equal(boot.body.free.nextAt, null);

  assert.equal((await app.post('/api/free/open', { user: u })).body.error, 'need_share');

  const share = await app.post('/api/free/share', { user: u });
  assert.equal(share.body.preparedId, 'prep_2001');
  assert.match(share.body.url, /^https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Ft\.me%2FDragonDrop_Bot/);
  const prep = app.tg.calls('savePreparedInlineMessage').at(-1).payload;
  assert.equal(prep.result.type, 'photo');
  assert.equal(prep.result.photo_url, 'https://api.dragondrop.test/img/banner.jpg');
  assert.equal(prep.result.reply_markup.inline_keyboard[0][0].url, 'https://t.me/DragonDrop_Bot?start=share');

  const shared = await app.post('/api/free/shared', { user: u });
  assert.equal(shared.body.shared, true);

  const open = await app.post('/api/free/open', { user: u });
  assert.equal(open.status, 200, JSON.stringify(open.body));
  const freeNames = caseBySlug('free').items.map((e) => app.ctx.game.catalog.items.get(e.item_id).name);
  assert.ok(freeNames.includes(open.body.item.name));
  assert.equal(open.body.balance, 0, 'free case does not cost coins');
  const hours = (new Date(open.body.nextAt) - Date.now()) / 3600e3;
  assert.ok(hours > 23.9 && hours <= 24, `next in ${hours}h`);

  const again = await app.post('/api/free/open', { user: u });
  assert.equal(again.body.error, 'cooldown');
  assert.ok(again.body.nextAt);

  // Admin enables the channel check and sets a 1 hour cooldown (0 is not allowed)
  await app.makeAdmin(users.alice.id);
  assert.equal((await app.put('/api/admin/settings', { user: users.alice, body: { free_cooldown_hours: 0 } })).body.error, 'bad_setting');
  const s = await app.put('/api/admin/settings', { user: users.alice, body: { channel: '@dragondrop_news', free_cooldown_hours: 1 } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const rewind = () => app.ctx.db.query("UPDATE bs_users SET free_last_at = now() - interval '2 hours', shared_at = LEAST(shared_at, now() - interval '3 hours') WHERE id = $1", [u.id]);
  await rewind();
  // Previous share was used up by the claim
  assert.equal((await app.post('/api/free/open', { user: u })).body.error, 'need_share');
  await app.post('/api/free/shared', { user: u });
  const chk = await app.post('/api/free/check', { user: u });
  assert.equal(chk.body.requireSub, true);
  assert.equal(chk.body.subscribed, false);
  assert.equal((await app.post('/api/free/open', { user: u })).body.error, 'need_sub');
  app.tg.state.members.add(u.id);
  assert.equal((await app.post('/api/free/check', { user: u })).body.subscribed, true);
  const ok = await app.post('/api/free/open', { user: u });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const gcm = app.tg.calls('getChatMember').at(-1).payload;
  assert.equal(gcm.chat_id, '@dragondrop_news');

  // Parallel claims: only one wins, the rest hit the cooldown
  await new Promise((r) => setTimeout(r, 3100)); // let the per-user rate limit window pass
  await rewind();
  await app.post('/api/free/shared', { user: u });
  const par = await Promise.all([1, 2, 3].map(() => app.post('/api/free/open', { user: u })));
  assert.equal(par.filter((r) => r.status === 200).length, 1, JSON.stringify(par.map((r) => r.body)));
  assert.ok(par.filter((r) => r.status !== 200).every((r) => r.body.error === 'cooldown'));

  await app.put('/api/admin/settings', { user: users.alice, body: { channel: '', free_cooldown_hours: 24 } });
});

test('promo codes: limits, expiry, reuse and case-insensitivity', async () => {
  const admin = users.alice;
  const bad = await app.post('/api/promo', { user: users.bob, body: { code: 'NOPE123' } });
  assert.equal(bad.body.error, 'promo_invalid');

  const created = await app.post('/api/admin/promos', { user: admin, body: { code: 'spin50', amount: 50, maxUses: 2 } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.promo.code, 'SPIN50');
  assert.equal((await app.post('/api/admin/promos', { user: admin, body: { code: 'SPIN50', amount: 5 } })).body.error, 'promo_exists');

  const r1 = await app.post('/api/promo', { user: users.bob, body: { code: ' spin50 ' } });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.amount, 50);
  const r2 = await app.post('/api/promo', { user: users.bob, body: { code: 'SPIN50' } });
  assert.equal(r2.body.error, 'promo_used');
  assert.equal((await app.post('/api/promo', { user: users.carol, body: { code: 'spin50' } })).status, 200);
  assert.equal((await app.post('/api/promo', { user: users.dave, body: { code: 'spin50' } })).body.error, 'promo_limit');

  const auto = await app.post('/api/admin/promos', { user: admin, body: { amount: 7, maxUses: 100, expiresHours: 1 } });
  assert.match(auto.body.promo.code, /^[0-9A-F]{8}$/);
  await app.ctx.db.query("UPDATE bs_promo_codes SET expires_at = now() - interval '1 minute' WHERE code = $1", [auto.body.promo.code]);
  assert.equal((await app.post('/api/promo', { user: users.dave, body: { code: auto.body.promo.code } })).body.error, 'promo_expired');

  await app.patch('/api/admin/promos/SPIN50', { user: admin, body: { active: false } });
  const list = await app.get('/api/admin/promos', { user: admin });
  const spin = list.body.promos.find((p) => p.code === 'SPIN50');
  assert.equal(spin.uses, 2);
  assert.equal(spin.active, false);
  assert.equal((await app.del('/api/admin/promos/SPIN50', { user: admin })).status, 200);

  const log = await app.ctx.db.many("SELECT * FROM bs_balance_log WHERE reason = 'promo:SPIN50'");
  assert.equal(log.length, 2);
});

test('admin API is closed for players', async () => {
  for (const [m, p] of [
    ['get', '/api/admin/overview'],
    ['get', '/api/admin/cases'],
    ['put', '/api/admin/settings'],
    ['post', '/api/admin/promos'],
    ['post', '/api/admin/users/1001/balance'],
  ]) {
    const r = await app[m](p, { user: users.dave, body: m === 'get' ? undefined : {} });
    assert.equal(r.status, 403, p);
  }
  assert.equal((await app.get('/api/admin/overview')).status, 401);
});

test('admin: overview, cases and odds editing', async () => {
  const admin = users.alice;
  const ov = await app.get('/api/admin/overview', { user: admin });
  assert.equal(ov.status, 200);
  assert.ok(ov.body.users >= 5);
  assert.ok(ov.body.opened24 >= 3);

  const cases = (await app.get('/api/admin/cases', { user: admin })).body.cases;
  const noob = cases.find((c) => c.slug === 'noob');
  assert.equal(noob.rtp, 89.27, 'up to 90 %: the price is rounded up to a multiple of 5');
  assert.equal(noob.chanceSum, 100);

  // Remove the rarest item and give the top item 50% (then the display normalises)
  const items = noob.items.slice(1).map((e, i) => ({ itemId: e.itemId, chance: i === 0 ? 50 : e.chance }));
  const upd = await app.put(`/api/admin/cases/${noob.id}`, {
    user: admin,
    body: { ...noob, price: 12, items },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.case.price, 12);
  assert.equal(upd.body.case.items.length, noob.items.length - 1);

  const pub = (await app.post('/api/bootstrap', { user: users.bob })).body.cases.find((c) => c.slug === 'noob');
  assert.equal(pub.price, 12);
  const total = pub.items.reduce((s, e) => s + e.chance, 0);
  assert.ok(Math.abs(total - 100) < 0.01, `normalised ${total}`);
  assert.ok(!pub.items.some((e) => e.item.id === noob.items[0].itemId), 'removed item is gone');

  // Validation
  assert.equal((await app.put(`/api/admin/cases/${noob.id}`, { user: admin, body: { ...noob, price: 0 } })).body.error, 'bad_field');
  assert.equal((await app.put(`/api/admin/cases/${noob.id}`, { user: admin, body: { ...noob, items: [{ itemId: 1, chance: 0 }] } })).body.error, 'bad_field');
  assert.equal((await app.put(`/api/admin/cases/${noob.id}`, { user: admin, body: { ...noob, color: 'red' } })).body.error, 'bad_field');
  const free = cases.find((c) => c.slug === 'free');
  assert.equal((await app.del(`/api/admin/cases/${free.id}`, { user: admin })).body.error, 'cannot_delete_free');

  // New case, then disable it
  const created = await app.post('/api/admin/cases', {
    user: admin,
    body: { name_ru: 'Тест', name_uk: 'Тест', name_en: 'Test', emoji: '🧪', color: '#123456', enabled: true, price: 5, sort: 50, items: [{ itemId: 1, chance: 70 }, { itemId: 2, chance: 30 }] },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.match(created.body.case.slug, /^test-[0-9a-f]{6}$/);
  let pubCases = (await app.get('/api/catalog', { user: users.bob })).body.cases;
  assert.ok(pubCases.some((c) => c.id === created.body.case.id));
  await app.put(`/api/admin/cases/${created.body.case.id}`, { user: admin, body: { ...created.body.case, enabled: false } });
  pubCases = (await app.get('/api/catalog', { user: users.bob })).body.cases;
  assert.ok(!pubCases.some((c) => c.id === created.body.case.id), 'disabled case hidden');
  const opened = await app.post(`/api/case/${created.body.case.id}/open`, { user: users.bob });
  assert.equal(opened.status, 404);
  assert.equal((await app.del(`/api/admin/cases/${created.body.case.id}`, { user: admin })).status, 200);

  // Restore the noob case to the original odds
  await app.put(`/api/admin/cases/${noob.id}`, { user: admin, body: noob });
});

test('admin: case categories — create, fill, rename, move a case, delete', async () => {
  const A = { user: users.alice };
  const ids = (slugs) => slugs.map((sl) => caseBySlug(sl).id);
  assert.equal((await app.post('/api/admin/categories', { user: users.bob, body: { name: 'X' } })).status, 403);
  assert.equal((await app.post('/api/admin/categories', { ...A, body: { name: ' ' } })).body.error, 'bad_field');
  assert.equal((await app.post('/api/admin/categories', { ...A, body: { name: 'X', caseIds: [999999] } })).body.error, 'bad_field');

  const cheap = await app.post('/api/admin/categories', { ...A, body: { name: 'Дешёвые', sort: 2, caseIds: ids(['noob', 'pro']) } });
  assert.equal(cheap.status, 200, JSON.stringify(cheap.body));
  const top = await app.post('/api/admin/categories', { ...A, body: { name: 'Топ', sort: 1, caseIds: ids(['griffin', 'dragon']) } });
  const boot = (await app.post('/api/bootstrap', { user: users.bob })).body;
  assert.deepEqual(boot.categories.map((k) => k.name), ['Топ', 'Дешёвые'], 'ordered by sort');
  const cat = (sl) => boot.cases.find((c) => c.slug === sl).categoryId;
  assert.equal(cat('noob'), cheap.body.category.id);
  assert.equal(cat('griffin'), top.body.category.id);
  assert.equal(cat('fish'), null);

  // rename and set the exact list of cases (pro leaves, fish joins)
  const upd = await app.put(`/api/admin/categories/${cheap.body.category.id}`, { ...A, body: { name: 'Недорогие', sort: 2, caseIds: ids(['noob', 'fish']) } });
  assert.equal(upd.body.category.name, 'Недорогие');
  const cases = (await app.get('/api/catalog', { user: users.bob })).body.cases;
  assert.equal(cases.find((c) => c.slug === 'pro').categoryId, null);
  assert.equal(cases.find((c) => c.slug === 'fish').categoryId, cheap.body.category.id);

  // a case can also be moved from its editor
  const pro = (await app.get('/api/admin/cases', A)).body.cases.find((c) => c.slug === 'pro');
  const body = { ...pro, items: pro.items.map((e) => ({ itemId: e.itemId, chance: e.chance })), category_id: top.body.category.id };
  const saved = await app.put(`/api/admin/cases/${pro.id}`, { ...A, body });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.case.category_id, top.body.category.id);
  assert.equal((await app.put(`/api/admin/cases/${pro.id}`, { ...A, body: { ...body, category_id: 999999 } })).body.error, 'bad_field');
  // saving without the field keeps the category
  const { category_id: _omit, ...noCat } = body;
  assert.equal((await app.put(`/api/admin/cases/${pro.id}`, { ...A, body: noCat })).body.case.category_id, top.body.category.id);

  // deleting a category keeps its cases, without a category
  assert.equal((await app.del(`/api/admin/categories/${top.body.category.id}`, A)).status, 200);
  const after = (await app.post('/api/bootstrap', { user: users.bob })).body;
  assert.deepEqual(after.categories.map((k) => k.name), ['Недорогие']);
  assert.equal(after.cases.find((c) => c.slug === 'griffin').categoryId, null);
  assert.equal(after.cases.find((c) => c.slug === 'pro').categoryId, null);
  assert.equal((await app.del(`/api/admin/categories/${top.body.category.id}`, A)).status, 404);
  await app.del(`/api/admin/categories/${cheap.body.category.id}`, A);
});

test('admin: case picture upload, public URL, removal; without an upload the built-in art shows', async () => {
  const admin = users.alice;
  const dragon = (await app.get('/api/admin/cases', { user: admin })).body.cases.find((c) => c.slug === 'dragon');
  assert.equal(dragon.image, 'img/cases/dragon.webp?v=1');
  assert.equal(dragon.hasUpload, false);
  // the built-in art is a file of the web app
  const art = await fetch(app.base + '/' + dragon.image);
  assert.equal(art.status, 200);
  assert.match(art.headers.get('content-type'), /^image\/webp/);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  // players cannot upload, bad data is rejected, unknown case is 404
  assert.equal((await app.post(`/api/admin/cases/${dragon.id}/image`, { user: users.bob, body: { dataUrl: png } })).status, 403);
  assert.equal((await app.post(`/api/admin/cases/${dragon.id}/image`, { user: admin, body: { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' } })).body.error, 'bad_field');
  assert.equal((await app.post('/api/admin/cases/999999/image', { user: admin, body: { dataUrl: png } })).status, 404);

  const up = await app.post(`/api/admin/cases/${dragon.id}/image`, { user: admin, body: { dataUrl: png } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.match(up.body.case.image, new RegExp(`^/api/img/case/${dragon.id}\\?v=[0-9a-f]{8}$`));
  assert.equal(up.body.case.hasUpload, true);
  // the rest of the case is untouched
  assert.equal(up.body.case.price, dragon.price);
  assert.equal(up.body.case.items.length, dragon.items.length);

  const pub = (await app.get('/api/catalog', { user: users.bob })).body.cases.find((c) => c.slug === 'dragon');
  assert.equal(pub.image, up.body.case.image);
  const others = (await app.get('/api/catalog', { user: users.bob })).body.cases;
  assert.equal(others.find((c) => c.slug === 'noob').image, 'img/cases/noob.webp?v=1');
  assert.equal(others.find((c) => c.slug === 'free').image, null, 'no art yet: the chest in the case colour');
  const img = await fetch(app.base + pub.image);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /immutable/);
  assert.equal((await img.arrayBuffer()).byteLength, 70);
  assert.equal((await fetch(app.base + '/api/img/case/999999')).status, 404);

  // saving the case form keeps the picture
  const saved = await app.put(`/api/admin/cases/${dragon.id}`, { user: admin, body: { ...dragon, price: dragon.price } });
  assert.equal(saved.body.case.image, up.body.case.image);

  const del = await app.del(`/api/admin/cases/${dragon.id}/image`, { user: admin });
  assert.equal(del.status, 200);
  assert.deepEqual([del.body.case.image, del.body.case.hasUpload], ['img/cases/dragon.webp?v=1', false], 'back to the built-in art');
  assert.equal((await fetch(app.base + pub.image)).status, 404);
  assert.equal((await app.get('/api/catalog', { user: users.bob })).body.cases.find((c) => c.slug === 'dragon').image, 'img/cases/dragon.webp?v=1');
});

test('admin: items, images, players, balance, bans, gifts', async () => {
  const admin = users.alice;
  const it = await app.post('/api/admin/items', { user: admin, body: { name: 'Test Brainrot', value: 333, emoji: '🧠' } });
  assert.equal(it.status, 200, JSON.stringify(it.body));
  assert.equal(it.body.item.rarity, 'epic');
  const id = it.body.item.id;
  const upd = await app.put(`/api/admin/items/${id}`, { user: admin, body: { name: 'Test Brainrot 2', value: 334, emoji: '🧠', rarity: 'secret', enabled: true } });
  assert.equal(upd.body.item.rarity, 'secret');
  assert.equal((await app.put(`/api/admin/items/${id}`, { user: admin, body: { name: '', value: 1 } })).status, 400);
  assert.equal((await app.put(`/api/admin/items/${id}`, { user: admin, body: { name: 'x', value: 1, image_url: 'javascript:alert(1)' } })).status, 400);

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const img = await app.post(`/api/admin/items/${id}/image`, { user: admin, body: { dataUrl: png } });
  assert.equal(img.status, 200);
  assert.match(img.body.item.image, /^\/api\/img\/item\/\d+\?v=/);
  const fetched = await fetch(app.base + img.body.item.image);
  assert.equal(fetched.headers.get('content-type'), 'image/png');
  assert.equal((await fetched.arrayBuffer()).byteLength, 70);
  assert.equal((await app.post(`/api/admin/items/${id}/image`, { user: admin, body: { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' } })).status, 400);

  const huge = await app.get('/api/admin/users?q=99999999999999999999', { user: admin });
  assert.equal(huge.status, 200);
  assert.deepEqual(huge.body.users, []);
  const search = await app.get('/api/admin/users?q=bob', { user: admin });
  assert.equal(search.body.users[0].id, users.bob.id);
  assert.equal((await app.get(`/api/admin/users?q=${users.carol.id}`, { user: admin })).body.users[0].name, 'Carol');
  assert.equal((await app.get('/api/admin/users?q=%25', { user: admin })).body.users.length, 0, 'wildcards are escaped');

  const add = await app.post(`/api/admin/users/${users.dave.id}/balance`, { user: admin, body: { mode: 'add', amount: 500 } });
  assert.equal(add.body.balance, 500);
  const set = await app.post(`/api/admin/users/${users.dave.id}/balance`, { user: admin, body: { mode: 'set', amount: 42 } });
  assert.equal(set.body.balance, 42);
  assert.equal((await app.post(`/api/admin/users/${users.dave.id}/balance`, { user: admin, body: { mode: 'add', amount: -100 } })).body.error, 'negative_balance');

  const gift = await app.post(`/api/admin/users/${users.dave.id}/give`, { user: admin, body: { itemId: id } });
  assert.equal(gift.status, 200);
  const detail = await app.get(`/api/admin/users/${users.dave.id}`, { user: admin });
  assert.equal(detail.body.user.balance, 42);
  assert.equal(detail.body.inventory[0].item.name, 'Test Brainrot 2');
  assert.equal(detail.body.log.length, 2);
  assert.equal(detail.body.log[0].reason, 'admin:set');
  assert.equal((await app.del(`/api/admin/users/${users.dave.id}/inventory/${gift.body.invId}`, { user: admin })).status, 200);

  const ban = await app.post(`/api/admin/users/${users.dave.id}/flags`, { user: admin, body: { is_banned: true } });
  assert.equal(ban.body.user.isBanned, true);
  assert.equal((await app.get('/api/me', { user: users.dave })).status, 403);
  await app.post(`/api/admin/users/${users.dave.id}/flags`, { user: admin, body: { is_banned: false } });
  assert.equal((await app.get('/api/me', { user: users.dave })).status, 200);
  assert.equal((await app.post(`/api/admin/users/${admin.id}/flags`, { user: admin, body: { is_admin: false } })).body.error, 'cannot_demote_self');
  const promote = await app.post(`/api/admin/users/${users.carol.id}/flags`, { user: admin, body: { is_admin: true } });
  assert.equal(promote.body.user.isAdmin, true);
  assert.equal((await app.get('/api/admin/overview', { user: users.carol })).status, 200);
  await app.post(`/api/admin/users/${users.carol.id}/flags`, { user: admin, body: { is_admin: false } });
});

test('brainrots show their built-in pictures; a link or an upload in the admin panel replaces one, removing the upload brings it back', async () => {
  const admin = users.alice;
  await app.post('/api/bootstrap', { user: admin });
  await app.makeAdmin(admin.id);
  const all = async () => new Map((await app.get('/api/admin/items', { user: admin })).body.items.map((i) => [i.name, i]));
  const items = await all();
  const tim = items.get('Tim Cheese');
  const ver = crypto.createHash('md5').update(readFileSync(new URL('../web/img/items/tim-cheese.webp', import.meta.url))).digest('hex').slice(0, 8);
  assert.equal(tim.image, `img/items/tim-cheese.webp?v=${ver}`);
  assert.equal(tim.hasUpload, false);
  // a file of the web app
  const file = await fetch(`${app.base}/${tim.image}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /^image\/webp/);
  // every seeded brainrot but four has one; those keep their emoji
  const seed = JSON.parse(readFileSync(new URL('../src/seed-data.json', import.meta.url), 'utf8')).items;
  const without = seed.filter((i) => !items.get(i.name).image).map((i) => i.name).sort();
  assert.deepEqual(without, ["Cupid's Wings", 'Lavaka', 'Rainbow Hammer', 'Wave Rider']);
  assert.equal(items.get('Lavaka').emoji, seed.find((i) => i.name === 'Lavaka').emoji);
  for (const { name } of seed) if (items.get(name).image) assert.match(items.get(name).image, /^img\/items\/[a-z0-9-]+\.webp\?v=[0-9a-f]{8}$/, name);
  // players see the same pictures (cases, the live feed, inventories go through the same item view)
  const cat = (await app.get('/api/catalog', { user: users.bob })).body;
  const inCase = cat.cases.flatMap((c) => c.items.map((e) => e.item)).find((i) => i.name === 'Tim Cheese');
  assert.equal(inCase.image, tim.image);

  // a link wins over the built-in picture, and so does an upload; removing them brings it back
  const body = { name: tim.name, value: tim.value, emoji: tim.emoji, rarity: tim.rarityOverride, enabled: tim.enabled, withdrawable: tim.withdrawable, depositable: tim.depositable };
  const linked = await app.put(`/api/admin/items/${tim.id}`, { user: admin, body: { ...body, image_url: 'https://example.com/tim.png' } });
  assert.equal(linked.body.item.image, 'https://example.com/tim.png');
  assert.equal((await app.put(`/api/admin/items/${tim.id}`, { user: admin, body: { ...body, image_url: null } })).body.item.image, tim.image);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await app.post(`/api/admin/items/${tim.id}/image`, { user: admin, body: { dataUrl: png } });
  assert.match(up.body.item.image, /^\/api\/img\/item\/\d+\?v=/);
  assert.equal((await all()).get('Tim Cheese').hasUpload, true);
  const del = await app.del(`/api/admin/items/${tim.id}/image`, { user: admin });
  assert.equal(del.body.item.image, tim.image, 'back to the built-in picture');
  assert.equal((await all()).get('Tim Cheese').hasUpload, false);
});

test('admin: settings and channel check', async () => {
  const admin = users.alice;
  const s = await app.get('/api/admin/settings', { user: admin });
  assert.equal(s.body.settings.free_cooldown_hours, 24);
  // no main admin configured (OWNER_IDS / OWNER_USERNAMES): every admin has the main admin's settings
  assert.equal(s.body.settings.stars_rate, 2);
  assert.equal((await app.put('/api/admin/settings', { user: admin, body: { upgrade_min_chance: 90 } })).body.error, 'bad_setting');
  assert.equal((await app.put('/api/admin/settings', { user: admin, body: { support_url: 'ftp://x' } })).body.error, 'bad_setting');
  assert.equal((await app.post('/api/admin/check-channel', { user: admin })).body.error, 'no_channel');
  await app.put('/api/admin/settings', { user: admin, body: { channel: '@dragondrop_news', upgrade_edge: 5 } });
  const chk = await app.post('/api/admin/check-channel', { user: admin });
  assert.deepEqual(chk.body, { title: 'DragonDrop News', botIsAdmin: true });
  const boot = await app.post('/api/bootstrap', { user: users.bob });
  assert.equal(boot.body.upgrade.edge, 5);
  assert.equal(boot.body.free.channelUrl, 'https://t.me/dragondrop_news');
  await app.put('/api/admin/settings', { user: admin, body: { channel: '', upgrade_edge: 10 } });
});

test('web login token (Play on website) works and can be revoked', async () => {
  const u = await app.ctx.db.one('SELECT * FROM bs_users WHERE id = $1', [users.bob.id]);
  const token = signWebToken(u.id, u.web_ver, app.ctx.config.sessionSecret);
  const r = await app.post('/api/bootstrap', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.me.id, users.bob.id);
  await app.makeAdmin(users.alice.id);
  await app.post(`/api/admin/users/${users.bob.id}/flags`, { user: users.alice, body: { revoke_web: true } });
  assert.equal((await app.post('/api/bootstrap', { token })).status, 401);
});

test('live stream pushes new drops and online count', async () => {
  const events = [];
  const req = http.get(app.base + '/api/stream');
  await new Promise((resolve) => {
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => events.push(chunk));
      resolve();
    });
  });
  await app.setBalance(users.carol.id, 1000);
  forceDrop('fish', 'Moby Bros');
  await app.post(`/api/case/${caseBySlug('fish').id}/open`, { user: users.carol });
  await new Promise((r) => setTimeout(r, 200));
  req.destroy();
  const text = events.join('');
  assert.match(text, /event: online/);
  assert.match(text, /event: drop\ndata: .*Moby Bros/);
  assert.match(text, /event: top24\ndata: .*Moby Bros/);
  const ping = await app.post('/api/ping', { user: users.carol });
  assert.ok(ping.body.online >= 1);
});

test("admins' drops are kept (stats) but never shown: not in the stream, the feed or the top of the day, also after a restart", async () => {
  // users.alice is an admin by now; the most valuable brainrot any case has
  let best = null;
  for (const c of app.ctx.game.catalog.cases.values()) {
    if (c.is_free || c.is_nick || c.is_share || !c.enabled) continue;
    for (const e of c.items) {
      const it = app.ctx.game.catalog.items.get(e.item_id);
      if (!best || it.value > best.it.value) best = { c, it };
    }
  }
  const events = [];
  const req = http.get(app.base + '/api/stream');
  await new Promise((resolve) => {
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => events.push(chunk));
      resolve();
    });
  });
  await app.setBalance(users.alice.id, best.c.price);
  forceDrop(best.c.slug, best.it.name);
  const opened = await app.post(`/api/case/${best.c.id}/open`, { user: users.alice });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.item.name, best.it.name);
  await new Promise((r) => setTimeout(r, 200));
  req.destroy();
  assert.ok(!events.join('').includes(best.it.name), 'not streamed');
  // kept for the stats
  const drop = await app.ctx.db.one('SELECT id FROM bs_drops WHERE user_id = $1 AND item_id = $2 ORDER BY id DESC LIMIT 1', [users.alice.id, best.it.id]);
  assert.ok(drop);
  const shown = async (live = app.ctx.live) => {
    const snap = live.snapshot();
    return snap.feed.some((d) => d.id === drop.id) || (snap.top24 && snap.top24.id === drop.id);
  };
  assert.equal(await shown(), false);
  await app.ctx.live.refreshTop();
  assert.equal(await shown(), false);
  assert.notEqual((await app.get('/api/feed')).body.top24?.item.name, best.it.name);
  // after a restart (the feed and the top read from the database)
  const { createLive } = await import('../src/live.js');
  const fresh = createLive({ db: app.ctx.db, getPublicItem: (id) => app.ctx.game.publicItem(app.ctx.game.catalog.items.get(id)) });
  await fresh.init();
  assert.equal(await shown(fresh), false);
  assert.ok(fresh.snapshot().feed.length > 0, "players' drops are there");
  // a player made an admin: their drops leave the top on the next refresh
  const top = fresh.snapshot().top24;
  const owner = await app.ctx.db.one('SELECT user_id FROM bs_drops WHERE id = $1', [top.id]);
  await app.ctx.db.query('UPDATE bs_users SET is_admin = TRUE WHERE id = $1', [owner.user_id]);
  await fresh.refreshTop();
  assert.notEqual(fresh.snapshot().top24?.id, top.id);
  await app.ctx.db.query('UPDATE bs_users SET is_admin = FALSE WHERE id = $1', [owner.user_id]);
  fresh.stop();
});

test('rate limiting kicks in on spam', async () => {
  await app.setBalance(users.carol.id, 100000);
  const noob = caseBySlug('noob');
  const res = await Promise.all(Array.from({ length: 20 }, () => app.post(`/api/case/${noob.id}/open`, { user: users.carol })));
  assert.ok(res.some((r) => r.status === 429));
  assert.ok(res.some((r) => r.status === 200));
});

test('CORS allows the web app origin only', async () => {
  const ok = await app.call('OPTIONS', '/api/bootstrap', { headers: { Origin: 'https://app.dragondrop.test' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.dragondrop.test');
  const evil = await app.call('OPTIONS', '/api/bootstrap', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('static files: the page, scripts and styles are re-checked on every load (304 when unchanged); pictures and fonts are cached', async () => {
  // plain http: fetch() marks a request with its own If-None-Match as a reload
  const get = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      http
        .get(app.base + path, { headers }, (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
        })
        .on('error', reject);
    });
  for (const path of ['/', '/js/app.js', '/js/i18n.js', '/css/app.css', '/config.js']) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers['cache-control'], 'no-cache', path);
    assert.ok(r.headers.etag, path);
    assert.equal((await get(path, { 'If-None-Match': r.headers.etag })).status, 304, path);
  }
  for (const path of ['/img/logo.jpg', '/fonts/manrope-latin-700-normal.woff2', '/fonts/unbounded-cyrillic-800-normal.woff2']) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers['cache-control'], 'public, max-age=3600', path);
  }
});
