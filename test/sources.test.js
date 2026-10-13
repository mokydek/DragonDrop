// Admin player card: where every brainrot in the inventory came from.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, scriptedRng, users } from './helpers.js';
import { backfillInventorySources, migrate } from '../src/db.js';

const rng = scriptedRng();
let app;
const admin = { id: 4001, first_name: 'Модер', username: 'moder', language_code: 'ru' };
const player = { id: 4002, first_name: 'Игрок', username: 'igrok', language_code: 'ru' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  app = await startApp({ dbName: 'bs_t_src', rng });
  for (const u of [admin, player]) {
    await app.post('/api/bootstrap', { user: u });
    await app.message(u, '/start');
  }
  await app.makeAdmin(admin.id);
});
after(async () => {
  await app?.close();
});

const caseBySlug = (slug) => [...app.ctx.game.catalog.cases.values()].find((c) => c.slug === slug);
const itemByName = (name) => [...app.ctx.game.catalog.items.values()].find((i) => i.name === name);
const card = async () => (await app.get(`/api/admin/users/${player.id}`, { user: admin })).body.inventory;
const byInv = (inv, id) => inv.find((i) => i.invId === id);

test('player card: case, free case, upgrader, admin gift, deposit and returned withdrawal', async () => {
  // case
  await app.setBalance(player.id, 30);
  const noob = caseBySlug('noob');
  const opened = await app.post(`/api/case/${noob.id}/open`, { user: player, body: { count: 2 } });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));

  // free case (no share / subscription needed for this test)
  await app.ctx.settings.update({ free_require_sub: false, free_require_share: false });
  const free = await app.post('/api/free/open', { user: player });
  assert.equal(free.status, 200, JSON.stringify(free.body));
  await app.ctx.settings.update({ free_require_sub: true, free_require_share: true });

  // upgrader: 55 / 200 * 90 = 24.75%, 1.06 times lower = 23.34%; roll 0 wins
  const put = async (name) =>
    (await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [player.id, itemByName(name).id])).id;
  const a = await put('Salamino Penguino');
  const b = await put('Chimpanzini Bananini');
  rng.queue.push(0);
  const up = await app.post('/api/upgrade', { user: player, body: { ids: [a, b], target: itemByName('Spooky and Pumpky').id, chance: 23.34 } });
  assert.equal(up.body.won, true, JSON.stringify(up.body));

  // admin gift
  const gift = await app.post(`/api/admin/users/${player.id}/give`, { user: admin, body: { itemId: itemByName('Tim Cheese').id } });
  assert.equal(gift.status, 200);

  // deposit: the admin gives a brainrot through the request
  await wait(3100); // player actions are rate limited
  const dep = await app.post('/api/requests/deposit', { user: player, body: { nick: 'IgrokRBX', details: 'Cerberus' } });
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  const depId = dep.body.request.id;
  await app.post(`/api/admin/requests/${depId}/give`, { user: admin, body: { itemId: itemByName('Cerberus').id } });

  // withdrawal declined: the brainrot comes back
  const keep = await put('Capitano Moby');
  const wd = await app.post('/api/requests/withdraw', { user: player, body: { nick: 'IgrokRBX', ids: [keep] } });
  assert.equal(wd.status, 200, JSON.stringify(wd.body));
  const wdId = wd.body.request.id;
  assert.equal((await app.post(`/api/admin/requests/${wdId}/status`, { user: admin, body: { status: 'rejected' } })).status, 200);

  const inv = await card();
  const fromOf = (pred) => inv.filter(pred).map((i) => i.from);
  // case: both drops, with the case name in every language
  const caseRows = inv.filter((i) => opened.body.drops.some((d) => d.invId === i.invId));
  assert.equal(caseRows.length, 2);
  for (const r of caseRows) assert.deepEqual(r.from, { type: 'case', case: { id: noob.id, name: { ru: noob.name_ru, uk: noob.name_uk, en: noob.name_en } } });
  const fc = caseBySlug('free');
  assert.deepEqual(byInv(inv, free.body.invId).from, { type: 'free', case: { id: fc.id, name: { ru: fc.name_ru, uk: fc.name_uk, en: fc.name_en } } });
  assert.deepEqual(byInv(inv, up.body.invId).from, { type: 'upgrade', upgrade: { chance: 23.34, bet: 55 } });
  assert.deepEqual(byInv(inv, gift.body.invId).from, { type: 'admin', admin: { id: admin.id, name: 'Модер' } });
  assert.deepEqual(fromOf((i) => i.item.name === 'Cerberus'), [{ type: 'deposit', requestId: depId }]);
  assert.deepEqual(fromOf((i) => i.item.name === 'Capitano Moby'), [{ type: 'refund', requestId: wdId }]);
  for (const r of inv) assert.ok(r.at && r.item && r.invId);

  // the player's own inventory doesn't expose any of this
  const own = (await app.get('/api/inventory', { user: player })).body.inventory;
  assert.ok(own.every((i) => !('from' in i)));
});

test('older brainrots (from before sources were saved) are matched up on the first start', async () => {
  const before = await card();
  // wipe what was saved, as if these rows were written by the old version
  await app.ctx.db.query("UPDATE bs_inventory SET case_id = NULL, ref_id = NULL WHERE user_id = $1 AND source <> 'admin'", [player.id]);
  const wiped = await card();
  assert.ok(wiped.some((i) => i.from.type === 'case' && !i.from.case));
  const client = await app.ctx.db.pool.connect();
  try {
    await backfillInventorySources(client);
  } finally {
    client.release();
  }
  assert.deepEqual(await card(), before, 'everything restored from drops, upgrades and request history');
});

test('a deleted case leaves just "case"', async () => {
  const c = await app.post('/api/admin/cases', {
    user: admin,
    body: { name_ru: 'Временный', name_uk: 'Тимчасовий', name_en: 'Temp', price: 1, emoji: '📦', color: '#f59e0b', sort: 999, enabled: true, items: [{ itemId: itemByName('Tim Cheese').id, chance: 100 }] },
  });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = c.body.case.id;
  await app.setBalance(player.id, 1);
  const r = await app.post(`/api/case/${id}/open`, { user: player });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(byInv(await card(), r.body.invId).from.case.name.ru, 'Временный');
  const del = await app.del(`/api/admin/cases/${id}`, { user: admin });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.deepEqual(byInv(await card(), r.body.invId).from, { type: 'case' });
});

test('updating a live database: the new columns are added and filled in once', async () => {
  const before = await card();
  // the database as the previous version left it
  await app.ctx.db.query('ALTER TABLE bs_inventory DROP COLUMN case_id, DROP COLUMN ref_id');
  await migrate(app.ctx.db);
  const after = await card();
  const gifts = before.filter((i) => i.from.type === 'admin').map((i) => i.invId);
  assert.ok(gifts.length >= 1);
  // the old version didn't keep who gave a brainrot: that one is just "given by an admin"
  assert.deepEqual(
    after,
    before.map((i) => (gifts.includes(i.invId) ? { ...i, from: { type: 'admin' } } : i)),
  );
  // a second start doesn't touch anything
  await app.ctx.db.query("UPDATE bs_inventory SET ref_id = NULL WHERE user_id = $1 AND source = 'upgrade'", [player.id]);
  await migrate(app.ctx.db);
  assert.ok((await card()).filter((i) => i.from.type === 'upgrade').every((i) => !i.from.upgrade), 'backfill only runs when the columns are new');
});
