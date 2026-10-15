// Main admin (OWNER_USERNAMES / OWNER_IDS): always admin, can't be banned or demoted.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, users } from './helpers.js';
import { DEFAULT_BUFFS } from '../src/buffs.js';

let app;
const owner = { id: 3001, first_name: 'Михаил', username: 'Mokydel', language_code: 'ru' };
const admin = { id: 3002, first_name: 'Помощник', username: 'helper', language_code: 'ru' };
const impostor = { id: 3003, first_name: 'Фейк', username: 'mokydel', language_code: 'ru' };
const pinnedById = { id: 3004, first_name: 'Второй', language_code: 'ru' };

before(async () => {
  app = await startApp({ dbName: 'bs_t_owner', env: { OWNER_USERNAMES: '@mokydel', OWNER_IDS: String(pinnedById.id) } });
});
after(async () => {
  await app?.close();
});

const row = (id) => app.ctx.db.one('SELECT is_admin, is_banned FROM bs_users WHERE id = $1', [id]);
const settingsOf = async (u) => (await app.get('/api/admin/settings', { user: u })).body.settings;

test('the main admin becomes an admin by username and looks like any other admin', async () => {
  const r = await app.post('/api/bootstrap', { user: owner });
  assert.equal(r.status, 200);
  assert.equal(r.body.me.isAdmin, true);
  assert.deepEqual(Object.keys(r.body.me).sort(), ['balance', 'createdAt', 'id', 'isAdmin', 'lang', 'name', 'nick', 'photo', 'ref', 'theme', 'username']);
  await app.post('/api/bootstrap', { user: admin });
  await app.makeAdmin(admin.id);
  const list = (await app.get('/api/admin/users', { user: admin })).body.users;
  const o = list.find((u) => u.id === owner.id);
  const a = list.find((u) => u.id === admin.id);
  assert.deepEqual(Object.keys(o).sort(), Object.keys(a).sort(), 'no extra fields that would give it away');
  assert.equal(o.isAdmin, true);
  // not exposed in the admin settings either
  const s = (await app.get('/api/admin/settings', { user: admin })).body.settings;
  assert.ok(!JSON.stringify(s).toLowerCase().includes('mokydel'));
});

test('other admins can neither ban nor demote the main admin', async () => {
  const ban = await app.post(`/api/admin/users/${owner.id}/flags`, { user: admin, body: { is_banned: true } });
  assert.equal(ban.status, 403);
  assert.equal(ban.body.error, 'forbidden');
  const demote = await app.post(`/api/admin/users/${owner.id}/flags`, { user: admin, body: { is_admin: false } });
  assert.equal(demote.status, 403);
  assert.deepEqual(await row(owner.id), { is_admin: true, is_banned: false });
  // harmless flags still work
  assert.equal((await app.post(`/api/admin/users/${owner.id}/flags`, { user: admin, body: { is_admin: true } })).status, 200);
  // the main admin can still ban and demote everyone else
  const b = await app.post(`/api/admin/users/${admin.id}/flags`, { user: owner, body: { is_banned: true } });
  assert.equal(b.status, 200);
  assert.equal((await row(admin.id)).is_banned, true);
  await app.post(`/api/admin/users/${admin.id}/flags`, { user: owner, body: { is_banned: false } });
  assert.equal((await app.post(`/api/admin/users/${admin.id}/flags`, { user: owner, body: { is_admin: false } })).status, 200);
  assert.equal((await row(admin.id)).is_admin, false);
  await app.makeAdmin(admin.id);
});

test('even a direct database change is undone on the next visit (app and bot)', async () => {
  await app.ctx.db.query('UPDATE bs_users SET is_admin = FALSE, is_banned = TRUE WHERE id = $1', [owner.id]);
  const r = await app.get('/api/me', { user: owner });
  assert.equal(r.status, 200);
  assert.equal(r.body.me.isAdmin, true);
  assert.deepEqual(await row(owner.id), { is_admin: true, is_banned: false });

  await app.ctx.db.query('UPDATE bs_users SET is_banned = TRUE WHERE id = $1', [owner.id]);
  app.tg.reset();
  await app.message(owner, '/start');
  const sent = app.tg.calls('sendPhoto').concat(app.tg.calls('sendMessage')).map((c) => c.payload);
  assert.ok(sent.some((p) => /Добро пожаловать/.test(p.caption || '')), 'welcome, not "access restricted"');
  assert.equal((await row(owner.id)).is_banned, false);
});

test('the account is pinned by id: a new holder of the username gets nothing', async () => {
  // the owner renames their account
  const renamed = { ...owner, username: 'mokydel_new' };
  assert.equal((await app.post('/api/bootstrap', { user: renamed })).body.me.isAdmin, true);
  // someone else takes the old username
  const r = await app.post('/api/bootstrap', { user: impostor });
  assert.equal(r.body.me.isAdmin, false);
  assert.equal((await app.post(`/api/admin/users/${impostor.id}/flags`, { user: admin, body: { is_banned: true } })).status, 200);
  assert.equal((await app.post(`/api/admin/users/${renamed.id}/flags`, { user: admin, body: { is_banned: true } })).status, 403);
  assert.equal((await app.get('/api/me', { user: impostor })).status, 403, 'impostor is banned');
});

test('OWNER_IDS works without a username; regular admins are unaffected', async () => {
  assert.equal((await app.post('/api/bootstrap', { user: pinnedById })).body.me.isAdmin, true);
  assert.equal((await app.post(`/api/admin/users/${pinnedById.id}/flags`, { user: admin, body: { is_admin: false } })).status, 403);
  await app.post('/api/bootstrap', { user: users.alice });
  assert.equal((await app.post('/api/bootstrap', { user: users.alice })).body.me.isAdmin, false);
});

test('Stars rate: only the main admin sees and changes it', async () => {
  const s = settingsOf;
  assert.ok(!('stars_rate' in (await s(admin))), 'a regular admin does not even see the field');
  assert.equal((await s(owner)).stars_rate, 2);
  // a regular admin's save never touches the rate, the rest is saved
  const r = await app.put('/api/admin/settings', { user: admin, body: { stars_rate: 999, start_balance: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!('stars_rate' in r.body.settings));
  assert.equal(r.body.settings.start_balance, 7);
  assert.equal(app.ctx.settings.get('stars_rate'), 2);
  // the main admin changes it; players get the new rate
  const o = await app.put('/api/admin/settings', { user: owner, body: { stars_rate: 2.5 } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal(o.body.settings.stars_rate, 2.5);
  assert.equal((await app.get('/api/catalog', { user: users.alice })).body.topup.starsRate, 2.5);
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { stars_rate: 0 } })).status, 400, 'still validated');
  await app.put('/api/admin/settings', { user: owner, body: { stars_rate: 2, start_balance: 0 } });
  assert.equal(app.ctx.settings.get('stars_rate'), 2);
});

test('buffs on deposited brainrots: every player sees them, only the main admin changes them', async () => {
  const pub = async () => (await app.get('/api/catalog', { user: users.alice })).body.topup.buffs;
  assert.deepEqual(await pub(), DEFAULT_BUFFS);
  assert.ok(DEFAULT_BUFFS.length >= 70, 'mutations and traits');
  assert.deepEqual(
    DEFAULT_BUFFS.filter((b) => b.pct < 0).map((b) => [b.name, b.pct]),
    [['Claws', -7.5], ['Taco', -15]],
    'as in Brainrot Battle: the taco takes 15 % off, the claws 7.5 %',
  );
  assert.equal(new Set(DEFAULT_BUFFS.map((b) => b.name.toLowerCase())).size, DEFAULT_BUFFS.length, 'every name once');
  assert.ok(!('buffs' in (await settingsOf(admin))), 'a regular admin does not even see the field');
  assert.deepEqual((await settingsOf(owner)).buffs, DEFAULT_BUFFS);
  // a regular admin's save never touches them
  assert.equal((await app.put('/api/admin/settings', { user: admin, body: { buffs: [] } })).status, 200);
  assert.deepEqual(await pub(), DEFAULT_BUFFS);
  // the main admin changes them: names trimmed, "," and "−" understood, two decimals, the emoji optional
  const o = await app.put('/api/admin/settings', {
    user: owner,
    body: {
      buffs: [
        { name: '  Rainbow   Star ', pct: '30', emoji: '🌈' },
        { name: 'Taco', pct: '−12,5', emoji: ' 🌮 ' },
        { name: 'Gold', pct: 2.346 },
      ],
    },
  });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const want = [
    { name: 'Rainbow Star', pct: 30, emoji: '🌈' },
    { name: 'Taco', pct: -12.5, emoji: '🌮' },
    { name: 'Gold', pct: 2.35, emoji: '' },
  ];
  assert.deepEqual(o.body.settings.buffs, want);
  assert.deepEqual(await pub(), want, 'players get the new list');
  for (const bad of [
    'x',
    [{ name: '', pct: 5 }],
    [{ name: 'A'.repeat(33), pct: 5 }],
    [{ name: 'Gold', pct: 5 }, { name: 'gold', pct: 6 }],
    [{ name: 'Gold', pct: -91 }],
    [{ name: 'Gold', pct: 501 }],
    [{ name: 'Gold', pct: 'abc' }],
    [{ name: 'Gold' }],
    [{ name: 'Gold', pct: 5, emoji: 5 }],
    [{ name: 'Gold', pct: 5, emoji: '🥇'.repeat(9) }],
    [null],
    Array.from({ length: 201 }, (_, i) => ({ name: 'B' + i, pct: 1 })),
  ]) {
    const res = await app.put('/api/admin/settings', { user: owner, body: { buffs: bad } });
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 80));
    assert.equal(res.body.error, 'bad_setting');
  }
  assert.deepEqual(await pub(), want, 'a refused list changes nothing');
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { buffs: [] } })).status, 200, 'an empty list is allowed');
  assert.deepEqual(await pub(), []);
  await app.put('/api/admin/settings', { user: owner, body: { buffs: DEFAULT_BUFFS } });
  assert.deepEqual(await pub(), DEFAULT_BUFFS);
});

test('case odds: every admin changes them; the upgrader settings: only the main admin', async () => {
  const noob = [...app.ctx.game.catalog.cases.values()].find((c) => c.slug === 'noob');
  const byId = (a) => [...a].sort((x, y) => x.itemId - y.itemId);
  const lootOf = () => byId(app.ctx.game.catalog.cases.get(noob.id).items.map((e) => ({ itemId: e.item_id, chance: e.chance })));
  const body = (over = {}) => ({
    name_ru: noob.name_ru, name_uk: noob.name_uk, name_en: noob.name_en, emoji: noob.emoji, color: noob.color,
    sort: noob.sort, enabled: true, price: noob.price, items: lootOf(), ...over,
  });
  const loot0 = lootOf();
  const put = (u, b) => app.put(`/api/admin/cases/${noob.id}`, { user: u, body: b });

  // a regular admin edits the case and its odds: change a chance, remove and add a drop
  const changed = loot0.map((e, i) => (i === 0 ? { ...e, chance: e.chance + 1 } : e));
  const extra = [...app.ctx.game.catalog.items.keys()].find((id) => !loot0.some((e) => e.itemId === id));
  for (const items of [changed, loot0.slice(1), [...loot0, { itemId: extra, chance: 1 }]]) {
    const r = await put(admin, body({ price: noob.price + 1, items }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(lootOf(), byId(items));
    assert.equal(app.ctx.game.catalog.cases.get(noob.id).price, noob.price + 1);
  }
  // players see the new chances
  await put(admin, body({ price: noob.price, items: changed }));
  const pub = (await app.get('/api/catalog', { user: users.alice })).body.cases.find((c) => c.id === noob.id);
  const sum = changed.reduce((s, e) => s + e.chance, 0);
  assert.equal(pub.items.find((e) => e.item.id === changed[0].itemId).chance, Math.round((changed[0].chance / sum) * 100000) / 1000);
  // and creates cases with drops
  const fresh = { name_ru: 'Новый', name_uk: 'Новий', name_en: 'New', emoji: '📦', color: '#f59e0b', sort: 500, price: 10 };
  const created = await app.post('/api/admin/cases', { user: admin, body: { ...fresh, enabled: true, items: [{ itemId: loot0[0].itemId, chance: 100 }] } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await put(admin, body({ price: noob.price, items: loot0 }));
  assert.deepEqual(lootOf(), loot0);

  // upgrader settings: other admins see edge / min / max, but only the main admin changes them;
  // the bad-luck factor is not even shown to them
  const s0 = (await app.get('/api/admin/settings', { user: admin })).body.settings;
  assert.ok(!('stars_rate' in s0), 'the Stars rate stays hidden from regular admins');
  assert.ok(!('upgrade_luck' in s0), 'so does the upgrader luck');
  assert.equal(s0.upgrade_edge, 10);
  const same = await app.put('/api/admin/settings', { user: admin, body: { ...s0, start_balance: 5 } });
  assert.equal(same.status, 200, 'the form with unchanged upgrader values saves');
  assert.equal(app.ctx.settings.get('start_balance'), 5);
  for (const [k, v] of [['upgrade_edge', 25], ['upgrade_min_chance', 2], ['upgrade_max_chance', 66], ['crash_edge', 7], ['crash_max_bet', 50], ['crash_max_mult', 50]]) {
    const r = await app.put('/api/admin/settings', { user: admin, body: { ...s0, start_balance: 6, [k]: v } });
    assert.equal(r.status, 403, k);
    assert.equal(app.ctx.settings.get(k), s0[k], `${k} unchanged`);
  }
  assert.equal(app.ctx.settings.get('start_balance'), 5, 'nothing saved');
  const sneak = await app.put('/api/admin/settings', { user: admin, body: { upgrade_luck: 1 } });
  assert.equal(sneak.status, 200);
  assert.equal(app.ctx.settings.get('upgrade_luck'), 1.06, 'luck from a regular admin is ignored');
  // the main admin: luck 1.06 by default, can change it and the rest; players get it
  const so = (await app.get('/api/admin/settings', { user: owner })).body.settings;
  assert.equal(so.upgrade_luck, 1.06);
  const o = await app.put('/api/admin/settings', { user: owner, body: { upgrade_luck: 2, upgrade_edge: 25, start_balance: 0 } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const up = (await app.get('/api/catalog', { user: users.alice })).body.upgrade;
  assert.deepEqual(up, { edge: 25, minChance: 1, maxChance: 80, luck: 2 });
  // the highest possible chance (max / luck) must stay above the minimum
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { upgrade_luck: 10, upgrade_max_chance: 5 } })).body.error, 'bad_setting');
  await app.put('/api/admin/settings', { user: owner, body: { upgrade_luck: 1.06, upgrade_edge: s0.upgrade_edge } });
  assert.equal(app.ctx.settings.get('upgrade_luck'), 1.06);
});

test('account bad luck: only the main admin sees and sets it; that player gets the lower chance', async () => {
  const p = users.alice;
  await app.post('/api/bootstrap', { user: p });
  await app.post('/api/bootstrap', { user: users.bob });
  // regular admins neither see nor change it
  const seen = (await app.get(`/api/admin/users/${p.id}`, { user: admin })).body;
  assert.ok(seen.user && !('luck' in seen), 'not shown to regular admins');
  const deny = await app.post(`/api/admin/users/${p.id}/luck`, { user: admin, body: { luck: 2 } });
  assert.equal(deny.status, 403);
  assert.equal(deny.body.error, 'forbidden');
  // the main admin: 1 (as everyone) by default, from 1 to 10
  assert.equal((await app.get(`/api/admin/users/${p.id}`, { user: owner })).body.luck, 1);
  for (const bad of [0.5, 11, 'x', null]) {
    const r = await app.post(`/api/admin/users/${p.id}/luck`, { user: owner, body: { luck: bad } });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.error, 'bad_field');
  }
  assert.equal((await app.post('/api/admin/users/999999/luck', { user: owner, body: { luck: 2 } })).status, 404);
  const set = await app.post(`/api/admin/users/${p.id}/luck`, { user: owner, body: { luck: 2 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body, { luck: 2 });
  assert.equal((await app.get(`/api/admin/users/${p.id}`, { user: owner })).body.luck, 2);
  // that player: 1.06 × 2; everyone else keeps 1.06; nothing about it in the player's profile
  assert.equal((await app.get('/api/catalog', { user: p })).body.upgrade.luck, 2.12);
  const boot = (await app.post('/api/bootstrap', { user: p })).body;
  assert.equal(boot.upgrade.luck, 2.12);
  assert.ok(!('luck' in boot.me) && !('upgrade_luck' in boot.me));
  assert.equal((await app.get('/api/catalog', { user: users.bob })).body.upgrade.luck, 1.06);
  // the upgrade rolls the very chance that player is shown: 120 / 535 * 90 = 20.19% -> / 2.12 = 9.52%
  const item = (name) => [...app.ctx.game.catalog.items.values()].find((i) => i.name === name).id;
  const put = async (name) =>
    (await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [p.id, item(name)])).id;
  const ids = [await put('Ketupat Kepat'), await put('La Taco Combinasion')];
  const target = item('Rico Dinero');
  const stale = await app.post('/api/upgrade', { user: p, body: { ids, target, chance: 19.04 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.chance, 9.52);
  const up = await app.post('/api/upgrade', { user: p, body: { ids, target, chance: 9.52 } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.chance, 9.52);
  assert.equal((await app.ctx.db.one('SELECT chance FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [p.id])).chance, 9.52);
  // back to normal
  assert.deepEqual((await app.post(`/api/admin/users/${p.id}/luck`, { user: owner, body: { luck: '1' } })).body, { luck: 1 });
  assert.equal((await app.get('/api/catalog', { user: p })).body.upgrade.luck, 1.06);
});

test('the main admin chooses what the other admins see: sections, requests by kind, bot notifications', async () => {
  const p = users.alice;
  await app.post('/api/bootstrap', { user: p });
  for (const u of [owner, admin, p]) await app.message(u, '/start'); // so the bot can write to them
  const ALL = ['overview', 'deposits_brainrots', 'deposits_stars', 'withdrawals', 'cases', 'items', 'users', 'referrals', 'promos', 'settings', 'broadcast'];
  const sectionsOf = async (u) => (await app.post('/api/bootstrap', { user: u })).body.adminSections;
  assert.deepEqual(await sectionsOf(admin), ALL, 'everything by default');
  assert.deepEqual(await sectionsOf(owner), ALL);
  assert.ok(!('adminSections' in (await app.post('/api/bootstrap', { user: p })).body), 'players get nothing');
  assert.deepEqual((await app.get('/api/me', { user: admin })).body.adminSections, ALL);

  // only the main admin sees and changes the setting
  assert.ok(!('admin_hidden' in (await settingsOf(admin))));
  assert.equal((await app.put('/api/admin/settings', { user: admin, body: { admin_hidden: ['cases'] } })).status, 200);
  assert.deepEqual(app.ctx.settings.get('admin_hidden'), [], 'ignored from a regular admin');
  assert.deepEqual((await settingsOf(owner)).admin_hidden, []);
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: ['cases', 'nope'] } })).body.error, 'bad_setting');
  const set = async (hidden) => {
    const r = await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: hidden } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.settings.admin_hidden;
  };
  assert.deepEqual(await set(['settings', 'cases', 'withdrawals', 'deposits_stars', 'cases']), ['deposits_stars', 'withdrawals', 'cases', 'settings']);
  assert.deepEqual(await sectionsOf(admin), ['overview', 'deposits_brainrots', 'items', 'users', 'referrals', 'promos', 'broadcast']);
  assert.deepEqual(await sectionsOf(owner), ALL, 'the main admin always sees everything');

  // hidden sections are refused by the server, the rest works
  const st = async (method, path, u = admin, body) => (await app.call(method, '/api/admin' + path, { user: u, body })).status;
  for (const path of ['/cases', '/categories', '/settings', '/CASES', '/Settings/', '/cases/']) assert.equal(await st('GET', path), 403, path);
  assert.equal(await st('PUT', '/settings', admin, { start_balance: 0 }), 403);
  assert.equal(await st('POST', '/check-channel'), 403);
  assert.equal(await st('POST', '/cases', admin, {}), 403);
  for (const path of ['/overview', '/items', '/users', `/users/${p.id}`, '/promos', '/broadcast']) assert.equal(await st('GET', path), 200, path);
  for (const path of ['/cases', '/settings']) assert.equal(await st('GET', path, owner), 200, path);

  // requests: brainrot deposits are seen, Stars payments and withdrawals are not
  app.tg.reset();
  const dep = await app.post('/api/requests/deposit', { user: p, body: { nick: 'AliceRBX', details: 'Cerberus' } });
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  const depId = dep.body.request.id;
  const toAdmin = () => app.tg.calls('sendMessage').filter((c) => Number(c.payload.chat_id) === admin.id).map((c) => c.payload.text);
  const toOwner = () => app.tg.calls('sendMessage').filter((c) => Number(c.payload.chat_id) === owner.id).map((c) => c.payload.text);
  assert.equal(toAdmin().length, 1, 'a brainrot deposit reaches the admin');
  assert.equal(toOwner().length, 1);
  const stars = (
    await app.ctx.db.one("INSERT INTO bs_requests (user_id, kind, method, status, stars, coins, charge_id) VALUES ($1, 'deposit', 'stars', 'done', 50, 50, 'chg-vis-1') RETURNING id", [p.id])
  ).id;
  await app.ctx.db.query('INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, 50, $2)', [p.id, `stars:#${stars}`]);
  const wd = (await app.ctx.db.one("INSERT INTO bs_requests (user_id, kind, nick) VALUES ($1, 'withdraw', 'AliceRBX') RETURNING id", [p.id])).id;
  const ids = async (u, kind) => (await app.get(`/api/admin/requests?kind=${kind}&scope=all`, { user: u })).body.requests.map((x) => x.id);
  assert.deepEqual(await ids(admin, 'deposit'), [depId]);
  assert.deepEqual((await ids(owner, 'deposit')).sort(), [depId, stars].sort());
  assert.equal((await app.get('/api/admin/requests?kind=withdraw', { user: admin })).status, 403);
  assert.deepEqual(await ids(owner, 'withdraw'), [wd]);
  assert.equal(await st('GET', `/requests/${depId}`), 200);
  assert.equal(await st('GET', `/requests/${stars}`), 403);
  assert.equal(await st('GET', `/requests/${wd}`), 403);
  assert.equal(await st('POST', `/requests/${wd}/status`, admin, { status: 'rejected' }), 403);
  assert.equal(await st('POST', `/requests/${wd}/messages`, admin, { text: 'hi' }), 403);
  assert.equal((await app.ctx.db.one('SELECT status FROM bs_requests WHERE id = $1', [wd])).status, 'new', 'nothing done');
  assert.equal(await st('GET', `/requests/${stars}`, owner), 200);
  assert.equal(await st('GET', '/requests/999999'), 404);
  const counts = async (u) => (await app.get('/api/admin/requests/counts', { user: u })).body.counts;
  assert.deepEqual(await counts(admin), { deposit: 1, withdraw: 0 });
  assert.deepEqual(await counts(owner), { deposit: 1, withdraw: 1 });
  // the player card: no Stars payments in the balance log
  const logOf = async (u) => (await app.get(`/api/admin/users/${p.id}`, { user: u })).body.log.map((l) => l.reason);
  assert.ok(!(await logOf(admin)).some((x) => x.startsWith('stars:')));
  assert.ok((await logOf(owner)).includes(`stars:#${stars}`));
  // the player answers about the withdrawal: only the main admin hears about it
  app.tg.reset();
  const pu = await app.ctx.db.one('SELECT * FROM bs_users WHERE id = $1', [p.id]);
  await app.ctx.requests.userReply(pu, wd, 'где мой брейнрот?');
  assert.equal(toAdmin().length, 0);
  assert.equal(toOwner().length, 1);
  await app.ctx.requests.userReply(pu, depId, 'жду');
  assert.equal(toAdmin().length, 1, 'about the deposit both hear');

  // brainrot deposits hidden too: the deposits list is closed, new ones go to the main admin only
  assert.deepEqual(await set(['deposits_brainrots', 'deposits_stars', 'withdrawals']), ['deposits_brainrots', 'deposits_stars', 'withdrawals']);
  assert.equal((await app.get('/api/admin/requests?kind=deposit', { user: admin })).status, 403);
  assert.deepEqual(await counts(admin), { deposit: 0, withdraw: 0 });
  app.tg.reset();
  const dep2 = await app.post('/api/requests/deposit', { user: p, body: { nick: 'AliceRBX', details: 'Tim Cheese' } });
  assert.equal(dep2.status, 200, JSON.stringify(dep2.body));
  assert.equal(toAdmin().length, 0);
  assert.equal(toOwner().length, 1);

  // items hidden, cases shown: the case editor still reads the item list, but items can't be changed
  await set(['items']);
  assert.equal(await st('GET', '/items'), 200);
  assert.equal(await st('POST', '/items', admin, {}), 403);
  assert.equal(await st('GET', '/cases'), 200);

  await set([]);
  assert.deepEqual(await sectionsOf(admin), ALL);
});

test('bad luck goes down to 1.06 once on an existing database; later changes stay', async () => {
  const { createSettings, lowerLuckOnce } = await import('../src/settings.js');
  assert.equal(app.ctx.settings.get('_luck_106'), true, 'done at the first start');
  assert.equal(app.ctx.settings.get('upgrade_luck'), 1.06);
  // a database from the previous version: 1.3 saved, not lowered yet
  const restart = async () => {
    const s = createSettings(app.ctx.db);
    await s.load();
    return s;
  };
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_luck_106'");
  await app.ctx.settings.update({ upgrade_luck: 1.3 });
  let s = await restart();
  assert.equal(s.get('upgrade_luck'), 1.3);
  assert.equal(await lowerLuckOnce(s), true);
  assert.equal(s.get('upgrade_luck'), 1.06);
  assert.equal((await restart()).get('upgrade_luck'), 1.06, 'saved');
  // the main admin sets it again: the next starts leave it alone
  await s.update({ upgrade_luck: 1.3 });
  s = await restart();
  assert.equal(await lowerLuckOnce(s), false);
  assert.equal(s.get('upgrade_luck'), 1.3);
  // a lower value is never raised
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_luck_106'");
  await s.update({ upgrade_luck: 1 });
  s = await restart();
  assert.equal(await lowerLuckOnce(s), false);
  assert.equal(s.get('upgrade_luck'), 1);
  assert.equal((await restart()).get('_luck_106'), true);
  await app.ctx.settings.update({ upgrade_luck: 1.06 });
});

test('the rocket is tuned once on an existing database (edge up to 20%, min bet up to 100); later changes stay', async () => {
  const { createSettings, tuneRocketOnce } = await import('../src/settings.js');
  assert.equal(app.ctx.settings.get('_rocket_tuned_1'), true, 'done at the first start');
  const restart = async () => {
    const s = createSettings(app.ctx.db);
    await s.load();
    return s;
  };
  // a database from before: a generous 5% edge and a 1-coin minimum, not tuned yet
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_rocket_tuned_1'");
  await app.ctx.settings.update({ crash_edge: 5, crash_min_bet: 1 });
  let s = await restart();
  assert.deepEqual(await tuneRocketOnce(s), { crash_edge: 20, crash_min_bet: 100 });
  assert.equal(s.get('crash_edge'), 20);
  assert.equal(s.get('crash_min_bet'), 100);
  assert.equal((await restart()).get('crash_edge'), 20, 'saved');
  // the main admin sets stricter values: the next starts leave them alone
  await s.update({ crash_edge: 30, crash_min_bet: 250 });
  s = await restart();
  assert.equal(await tuneRocketOnce(s), false);
  assert.equal(s.get('crash_edge'), 30);
  assert.equal(s.get('crash_min_bet'), 250);
  // values already at or above the target are never lowered
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_rocket_tuned_1'");
  await s.update({ crash_edge: 40, crash_min_bet: 500 });
  s = await restart();
  assert.deepEqual(await tuneRocketOnce(s), {});
  assert.equal(s.get('crash_edge'), 40);
  assert.equal(s.get('crash_min_bet'), 500);
  assert.equal((await restart()).get('_rocket_tuned_1'), true);
  await app.ctx.settings.update({ crash_edge: 20, crash_min_bet: 100 });
});

test('closing brainrot deposits: only admins who handle them', async () => {
  const gate = (u, open) => app.put('/api/admin/deposit-gate', { user: u, body: { open } });
  await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: ['deposits_brainrots'] } });
  assert.equal((await gate(admin, false)).status, 403);
  assert.ok(!('brainrotsOpen' in (await app.get('/api/admin/requests?kind=deposit', { user: admin })).body), 'Stars deposits only');
  assert.equal(app.ctx.settings.get('deposits_brainrots_open'), true);
  assert.equal((await gate(owner, false)).status, 200, 'the main admin always can');
  await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: [] } });
  assert.equal((await app.get('/api/admin/requests?kind=deposit', { user: admin })).body.brainrotsOpen, false);
  assert.equal((await gate(admin, true)).status, 200);
  assert.equal(app.ctx.settings.get('deposits_brainrots_open'), true);
});
