// The share case: free, once per share_cooldown_hours, after the player shared the bot
// share_case_count times (5) since they last opened it; like the FREE case it can also need the
// channel subscription. Telegram only reports that a share went through, so confirmed shares are counted.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { addShareCaseOnce } from '../src/db.js';
import { createSettings } from '../src/settings.js';

let app;
let nextId = 9501;

before(async () => {
  app = await startApp({ dbName: 'bs_t_share' });
});
after(async () => {
  await app?.close();
});

async function player(first_name = 'Петя') {
  const u = { id: nextId++, first_name, language_code: 'ru' };
  await app.post('/api/bootstrap', { user: u });
  return u;
}
async function admin(name) {
  const a = await player(name);
  await app.makeAdmin(a.id);
  return a;
}
const shared = (u) => app.post('/api/free/shared', { user: u });
const openShare = (u) => app.post('/api/share/open', { user: u });
const setShares = (u, n) => app.ctx.db.query('UPDATE bs_users SET share_n = $2 WHERE id = $1', [u.id, n]);
const userRow = (id) => app.ctx.db.one('SELECT share_n, share_last_at, cases_opened, total_won, balance FROM bs_users WHERE id = $1', [id]);
const shareCase = () => app.ctx.game.shareCase();
const hours = (h) => h * 3600_000;

test('migration: the share case is added once per database, with the FREE case loot', async () => {
  const restart = async () => {
    const s = createSettings(app.ctx.db);
    await s.load();
    return s;
  };
  const loot = (id) => app.ctx.db.many('SELECT item_id, chance FROM bs_case_items WHERE case_id = $1 ORDER BY item_id', [id]);
  const freeId = (await app.ctx.db.one('SELECT id FROM bs_cases WHERE is_free')).id;
  const shareRows = () => app.ctx.db.many('SELECT id, slug, name_ru, price, is_free, is_nick, is_share, enabled, sort FROM bs_cases WHERE is_share');

  // done at the first start
  let rows = await shareRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0], id: 0 },
    { id: 0, slug: 'share', name_ru: 'Кейс за репосты', price: 0, is_free: false, is_nick: false, is_share: true, enabled: true, sort: 0 },
  );
  assert.ok((await loot(rows[0].id)).length > 0);
  assert.deepEqual(await loot(rows[0].id), await loot(freeId));
  assert.equal(app.ctx.settings.get('_share_case_1'), true);
  assert.equal(await addShareCaseOnce(app.ctx.db, await restart()), false, 'the next starts add nothing');
  // on the cases screen: FREE, the nick case, the share case, then the paid ones
  assert.deepEqual(app.ctx.game.listCases().slice(0, 4).map((c) => c.slug), ['free', 'nick', 'share', 'noob']);

  // a database from before this version (no share case, no marker) gets one
  await app.ctx.db.query('DELETE FROM bs_cases WHERE is_share');
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_share_case_1'");
  assert.equal(await addShareCaseOnce(app.ctx.db, await restart()), true);
  rows = await shareRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(await loot(rows[0].id), await loot(freeId));
  assert.equal((await restart()).get('_share_case_1'), true);

  // the marker lost while the case is there: no second one
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_share_case_1'");
  const s = await restart();
  assert.equal(await addShareCaseOnce(app.ctx.db, s), false);
  assert.equal((await shareRows()).length, 1);
  assert.equal(s.get('_share_case_1'), true);
  assert.equal((await app.ctx.db.many('SELECT 1 FROM bs_cases WHERE is_nick')).length, 1, 'the nick case is left alone');
  await app.ctx.game.reloadCatalog();
  assert.equal(shareCase().id, rows[0].id);
});

test('every confirmed share counts; before 5 the case does not open and nothing changes', async () => {
  const u = await player();
  const c = shareCase();
  const b = (await app.post('/api/bootstrap', { user: u })).body;
  assert.deepEqual(b.share, { available: true, caseId: c.id, nextAt: null, need: 5, have: 0, requireSub: false });
  const card = b.cases.find((x) => x.id === c.id);
  assert.equal(card.isShare, true);
  assert.equal(card.price, 0);
  assert.equal(b.cases.filter((x) => x.isShare).length, 1);

  assert.deepEqual((await openShare(u)).body, { error: 'need_shares', have: 0, need: 5 });
  // the paid-case endpoint refuses it too
  assert.equal((await app.post(`/api/case/${c.id}/open`, { user: u, body: {} })).body.error, 'use_free_endpoint');
  for (let i = 1; i <= 4; i++) {
    const s = await shared(u);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.share.have, i);
    assert.equal(s.body.shared, true, 'a share counts for the FREE case as well');
  }
  const r = await openShare(u);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'need_shares', have: 4, need: 5 });
  const x = await userRow(u.id);
  assert.equal(x.share_n, 4);
  assert.equal(x.share_last_at, null);
  assert.equal(x.cases_opened, 0);
  assert.equal((await app.get('/api/inventory', { user: u })).body.inventory.length, 0);
  assert.equal((await app.get('/api/me', { user: u })).body.share.have, 4);
});

test('after 5 shares it opens for free; the brainrot is from the share case and the shares are used up', async () => {
  const u = await player();
  const c = shareCase();
  await setShares(u, 4);
  assert.equal((await shared(u)).body.share.have, 5);
  await app.setBalance(u.id, 70);
  const t0 = Date.now();
  const r = await openShare(u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(c.items.some((e) => e.item_id === r.body.item.id), 'a brainrot from the share case');
  assert.equal(r.body.balance, 70, 'free: no coins taken');
  assert.ok(Math.abs(new Date(r.body.nextAt).getTime() - (t0 + hours(24))) < 60_000, r.body.nextAt);
  assert.deepEqual(await app.ctx.db.many('SELECT item_id, source, case_id FROM bs_inventory WHERE user_id = $1', [u.id]), [
    { item_id: r.body.item.id, source: 'share', case_id: c.id },
  ]);
  assert.deepEqual(await app.ctx.db.one('SELECT kind, case_id FROM bs_drops WHERE user_id = $1', [u.id]), { kind: 'share', case_id: c.id });
  const x = await userRow(u.id);
  assert.equal(x.share_n, 0, 'the shares are used up');
  assert.equal(x.cases_opened, 1);
  assert.equal(Number(x.total_won), r.body.item.value);
  assert.equal(Number(x.balance), 70);
  // the app learns when it opens again
  const me = (await app.get('/api/me', { user: u })).body.share;
  assert.equal(me.nextAt, r.body.nextAt);
  assert.equal(me.have, 0);
  assert.equal((await app.post('/api/bootstrap', { user: u })).body.share.nextAt, r.body.nextAt);
});

test('once per 24 hours; shares made meanwhile count for the next opening, extra ones are not kept', async () => {
  const u = await player();
  await setShares(u, 5);
  const first = await openShare(u);
  assert.equal(first.status, 200);
  await setShares(u, 7);
  assert.equal((await app.get('/api/me', { user: u })).body.share.have, 5, 'shown up to the 5 needed');
  const again = await openShare(u);
  assert.equal(again.status, 400);
  assert.deepEqual(again.body, { error: 'cooldown', nextAt: first.body.nextAt });
  assert.equal((await userRow(u.id)).share_n, 7, 'nothing used up');
  // 24 hours later it opens with the shares made meanwhile
  await app.ctx.db.query("UPDATE bs_users SET share_last_at = now() - interval '24 hours 1 minute' WHERE id = $1", [u.id]);
  assert.equal((await openShare(u)).status, 200);
  assert.equal((await userRow(u.id)).share_n, 0);
  // the next time 5 new shares are needed
  await app.ctx.db.query("UPDATE bs_users SET share_last_at = now() - interval '25 hours' WHERE id = $1", [u.id]);
  assert.deepEqual((await openShare(u)).body, { error: 'need_shares', have: 0, need: 5 });
  // the counter can't grow without end
  await setShares(u, 1000);
  await shared(u);
  assert.equal((await userRow(u.id)).share_n, 1000);
});

test('parallel opens give one brainrot and use the shares once', async () => {
  const u = await player();
  await setShares(u, 5);
  const rs = await Promise.all([openShare(u), openShare(u), openShare(u)]);
  assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.body)));
  assert.ok(rs.filter((r) => r.status !== 200).every((r) => r.body.error === 'cooldown'), JSON.stringify(rs.map((r) => r.body)));
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE user_id = $1', [u.id])).n, 1);
  const x = await userRow(u.id);
  assert.equal(x.cases_opened, 1);
  assert.equal(x.share_n, 0);
});

test('with a channel set it also needs the subscription (setting share_require_sub)', async () => {
  const a = await admin('Админ');
  const set = await app.put('/api/admin/settings', { user: a, body: { channel: '@dragondrop_news', free_require_sub: false } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  try {
    // shares are checked first, Telegram is not asked for nothing
    const z = await player();
    app.tg.reset();
    assert.deepEqual((await openShare(z)).body, { error: 'need_shares', have: 0, need: 5 });
    assert.equal(app.tg.calls('getChatMember').length, 0);

    const u = await player();
    await setShares(u, 5);
    let chk = await app.post('/api/free/check', { user: u });
    assert.equal(chk.body.requireSub, false, 'the FREE case does not need it now');
    assert.equal(chk.body.share.requireSub, true);
    assert.equal(chk.body.subscribed, false, 'checked for the share case');
    assert.equal((await openShare(u)).body.error, 'need_sub');
    assert.equal((await userRow(u.id)).share_n, 5, 'nothing used up');
    app.tg.state.members.add(u.id);
    chk = await app.post('/api/free/check', { user: u });
    assert.equal(chk.body.subscribed, true);
    assert.equal((await openShare(u)).status, 200);
    assert.equal(app.tg.calls('getChatMember').at(-1).payload.chat_id, '@dragondrop_news');

    // switched off: no subscription needed
    assert.equal((await app.put('/api/admin/settings', { user: a, body: { share_require_sub: false } })).status, 200);
    const v = await player();
    await setShares(v, 5);
    assert.equal((await app.post('/api/bootstrap', { user: v })).body.share.requireSub, false);
    assert.equal((await app.post('/api/free/check', { user: v })).body.subscribed, true, 'nothing needs it: not asked');
    assert.equal((await openShare(v)).status, 200);
  } finally {
    await app.ctx.settings.update({ channel: '', free_require_sub: true, share_require_sub: true });
  }
});

test('the FREE, nick and share cases have their own cooldowns; the share for the FREE case counts here too', async () => {
  const u = await player('DragonDrop');
  app.tg.state.users.set(u.id, { first_name: 'DragonDrop' });
  await shared(u);
  assert.equal((await app.post('/api/free/open', { user: u })).status, 200);
  assert.equal((await userRow(u.id)).share_n, 1, 'opening the FREE case keeps the count');
  await setShares(u, 5);
  assert.equal((await openShare(u)).status, 200, 'the FREE case does not use up the share case');
  assert.equal((await app.post('/api/nick/open', { user: u })).status, 200, 'nor does the share case use up the nick case');
  assert.equal((await app.post('/api/free/open', { user: u })).body.error, 'cooldown');
  await setShares(u, 5);
  assert.equal((await openShare(u)).body.error, 'cooldown');
  assert.equal((await app.post('/api/nick/open', { user: u })).body.error, 'cooldown');
  assert.equal((await userRow(u.id)).cases_opened, 3);
});

test('settings: admins set how many shares and the cooldown', async () => {
  const a = await admin('Админ2');
  const s = (await app.get('/api/admin/settings', { user: a })).body.settings;
  assert.equal(s.share_case_count, 5);
  assert.equal(s.share_cooldown_hours, 24);
  assert.equal(s.share_require_sub, true);
  for (const bad of [0, 51, -1, 'x', null]) {
    assert.equal((await app.put('/api/admin/settings', { user: a, body: { share_case_count: bad } })).body.error, 'bad_setting', String(bad));
  }
  assert.equal((await app.put('/api/admin/settings', { user: a, body: { share_cooldown_hours: 0 } })).body.error, 'bad_setting');
  assert.equal((await app.put('/api/admin/settings', { user: a, body: { share_require_sub: 'yes' } })).body.error, 'bad_setting');
  const put = await app.put('/api/admin/settings', { user: a, body: { share_case_count: 2.4, share_cooldown_hours: 2 } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(app.ctx.settings.get('share_case_count'), 2, 'whole shares');
  try {
    const u = await player();
    await shared(u);
    assert.deepEqual((await openShare(u)).body, { error: 'need_shares', have: 1, need: 2 });
    await shared(u);
    const t0 = Date.now();
    const r = await openShare(u);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Math.abs(new Date(r.body.nextAt).getTime() - (t0 + hours(2))) < 60_000, r.body.nextAt);
  } finally {
    await app.ctx.settings.update({ share_case_count: 5, share_cooldown_hours: 24 });
  }
});

test('admins edit the share case like the FREE case: always free, cannot be deleted, can be switched off', async () => {
  const a = await admin('Админ3');
  const c = shareCase();
  const ac = (await app.get('/api/admin/cases', { user: a })).body.cases.find((x) => x.id === c.id);
  assert.equal(ac.is_share, true);
  assert.equal(ac.is_free, false);
  assert.equal(ac.is_nick, false);
  assert.equal(ac.price, 0);
  assert.equal(ac.rtp, null);
  const body = { name_ru: 'Репост кейс', name_uk: ac.name_uk, name_en: ac.name_en, emoji: ac.emoji, color: ac.color, sort: ac.sort, enabled: true, price: 500, items: ac.items };
  const put = await app.put(`/api/admin/cases/${c.id}`, { user: a, body });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.case.price, 0, 'a price sent by mistake is ignored');
  assert.equal(put.body.case.name_ru, 'Репост кейс');
  assert.equal(put.body.case.is_share, true);
  assert.equal((await app.del(`/api/admin/cases/${c.id}`, { user: a })).body.error, 'cannot_delete_free');
  // switched off: gone from the app and can't be opened
  assert.equal((await app.put(`/api/admin/cases/${c.id}`, { user: a, body: { ...body, enabled: false } })).status, 200);
  const u = await player();
  await setShares(u, 5);
  const b = (await app.post('/api/bootstrap', { user: u })).body;
  assert.equal(b.cases.some((x) => x.isShare), false);
  assert.deepEqual(b.share, { available: false, caseId: null, nextAt: null, need: 5, have: 5, requireSub: false });
  assert.equal((await openShare(u)).status, 404);
  assert.equal((await app.put(`/api/admin/cases/${c.id}`, { user: a, body: { ...body, name_ru: 'Кейс за репосты', enabled: true } })).status, 200);
  assert.equal((await openShare(u)).status, 200);
});

test('admin: share case openings count in the overview; the player card says where the brainrot came from', async () => {
  const a = await admin('Админ4');
  const before = (await app.get('/api/admin/overview', { user: a })).body.opened24;
  const u = await player();
  await setShares(u, 5);
  assert.equal((await openShare(u)).status, 200);
  assert.equal((await app.get('/api/admin/overview', { user: a })).body.opened24, before + 1);
  const card = (await app.get(`/api/admin/users/${u.id}`, { user: a })).body.inventory;
  assert.equal(card.length, 1);
  assert.equal(card[0].from.type, 'share');
  assert.equal(card[0].from.case.id, shareCase().id);
});
