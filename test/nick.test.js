// The nick case: free, once per nick_cooldown_hours, only for players with the bot's name
// (setting nick_tag, "DragonDrop") in their Telegram name. The name is checked when opening,
// by asking Telegram (getChat), so taking the name out after opening the app doesn't work.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { nickKey, hasNickTag } from '../src/game.js';
import { addNickCaseOnce } from '../src/db.js';
import { createSettings } from '../src/settings.js';
import { signWebToken } from '../src/auth.js';

let app;
let nextId = 9001;

before(async () => {
  app = await startApp({ dbName: 'bs_t_nick' });
});
after(async () => {
  await app?.close();
});

/** A new player. The names are both signed in the Mini App data and what Telegram answers now (unless chat: false). */
async function player({ first_name = 'Миша', last_name, username, chat = true } = {}) {
  const u = { id: nextId++, first_name, ...(last_name ? { last_name } : {}), ...(username ? { username } : {}), language_code: 'ru' };
  await app.post('/api/bootstrap', { user: u });
  if (chat) app.tg.state.users.set(u.id, { first_name, last_name, username });
  return u;
}
const openNick = (u) => app.post('/api/nick/open', { user: u });
const userRow = (id) => app.ctx.db.one('SELECT nick_last_at, cases_opened, total_won, balance FROM bs_users WHERE id = $1', [id]);
const nickCase = () => app.ctx.game.nickCase();
const hours = (h) => h * 3600_000;
async function admin(name) {
  const a = await player({ first_name: name });
  await app.makeAdmin(a.id);
  return a;
}

test('migration: the nick case is added once per database, with the FREE case loot', async () => {
  const restart = async () => {
    const s = createSettings(app.ctx.db);
    await s.load();
    return s;
  };
  const loot = (id) => app.ctx.db.many('SELECT item_id, chance FROM bs_case_items WHERE case_id = $1 ORDER BY item_id', [id]);
  const freeId = (await app.ctx.db.one('SELECT id FROM bs_cases WHERE is_free')).id;
  const nickRows = () => app.ctx.db.many('SELECT id, slug, price, is_free, is_nick, enabled, sort FROM bs_cases WHERE is_nick');

  // done at the first start
  let rows = await nickRows();
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], id: 0 }, { id: 0, slug: 'nick', price: 0, is_free: false, is_nick: true, enabled: true, sort: 0 });
  assert.ok((await loot(rows[0].id)).length > 0);
  assert.deepEqual(await loot(rows[0].id), await loot(freeId));
  assert.equal(app.ctx.settings.get('_nick_case_1'), true);
  assert.equal(await addNickCaseOnce(app.ctx.db, await restart()), false, 'the next starts add nothing');

  // a database from before this version (no nick case, no marker) gets one
  await app.ctx.db.query('DELETE FROM bs_cases WHERE is_nick');
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_nick_case_1'");
  assert.equal(await addNickCaseOnce(app.ctx.db, await restart()), true);
  rows = await nickRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(await loot(rows[0].id), await loot(freeId));
  assert.equal((await restart()).get('_nick_case_1'), true);

  // the marker lost while the case is there: no second one
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_nick_case_1'");
  const s = await restart();
  assert.equal(await addNickCaseOnce(app.ctx.db, s), false);
  assert.equal((await nickRows()).length, 1);
  assert.equal(s.get('_nick_case_1'), true);
  await app.ctx.game.reloadCatalog();
  assert.equal(nickCase().id, rows[0].id);
});

test('the name check: any letter case, spaces and symbols ignored; first + last name or @username', () => {
  assert.equal(nickKey('Dragon_Drop 🎰'), 'dragondrop');
  assert.equal(nickKey('Миша-1 | X'), 'миша1x');
  assert.equal(nickKey(null), '');
  const tag = 'DragonDrop';
  const yes = [
    { first_name: 'DragonDrop' },
    { first_name: 'миша dragondrop' },
    { first_name: 'Миша | DRAGONDROP 🎰' },
    { first_name: 'Dragon_Drop' },
    { first_name: 'Dragon Drop' },
    { first_name: 'Dragon', last_name: 'Drop' },
    { first_name: 'Миша', last_name: 'DragonDrop' },
    { first_name: 'Миша', username: 'misha_dragondrop' },
    { first_name: 'xxDragonDropxx' },
  ];
  for (const n of yes) assert.equal(hasNickTag(n, tag), true, JSON.stringify(n));
  const no = [
    { first_name: 'Dragon' },
    { first_name: 'DragDrop' },
    { first_name: 'Drop Dragon' },
    { first_name: 'Dragon', username: 'drop' },
    { first_name: 'Миша' },
    { first_name: '' },
    {},
    null,
  ];
  for (const n of no) assert.equal(hasNickTag(n, tag), false, JSON.stringify(n));
  assert.equal(hasNickTag({ first_name: 'DragonDrop' }, 'dragon_drop'), true, 'the tag is normalised too');
  assert.equal(hasNickTag({ first_name: 'DragonDrop' }, ''), false);
  assert.equal(hasNickTag({ first_name: 'DragonDrop' }, '!!!'), false);
});

test('without the bot name in the Telegram name the case does not open and nothing changes', async () => {
  const u = await player({ first_name: 'Миша' });
  const r = await openNick(u);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'need_nick', tag: 'DragonDrop' });
  const x = await userRow(u.id);
  assert.equal(x.nick_last_at, null);
  assert.equal(x.cases_opened, 0);
  assert.equal((await app.get('/api/inventory', { user: u })).body.inventory.length, 0);
  // the paid-case endpoint refuses it too
  assert.equal((await app.post(`/api/case/${nickCase().id}/open`, { user: u, body: {} })).body.error, 'use_free_endpoint');
});

test('with the bot name it opens for free once per 24 hours; the brainrot is from the nick case', async () => {
  const u = await player({ first_name: 'Миша | DragonDrop' });
  await app.setBalance(u.id, 50);
  const c = nickCase();
  const t0 = Date.now();
  const r = await openNick(u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(c.items.some((e) => e.item_id === r.body.item.id), 'a brainrot from the nick case');
  assert.equal(r.body.balance, 50, 'free: no coins taken');
  assert.ok(Math.abs(new Date(r.body.nextAt).getTime() - (t0 + hours(24))) < 60_000, r.body.nextAt);
  assert.deepEqual(await app.ctx.db.many('SELECT item_id, source, case_id FROM bs_inventory WHERE user_id = $1', [u.id]), [
    { item_id: r.body.item.id, source: 'nick', case_id: c.id },
  ]);
  assert.deepEqual(await app.ctx.db.one('SELECT kind, case_id FROM bs_drops WHERE user_id = $1', [u.id]), { kind: 'nick', case_id: c.id });
  const x = await userRow(u.id);
  assert.equal(x.cases_opened, 1);
  assert.equal(Number(x.total_won), r.body.item.value);
  assert.equal(Number(x.balance), 50);
  // the app learns when it opens again
  assert.equal((await app.get('/api/me', { user: u })).body.nick.nextAt, r.body.nextAt);
  assert.equal((await app.post('/api/bootstrap', { user: u })).body.nick.nextAt, r.body.nextAt);
  // too early: refused without asking Telegram
  app.tg.reset();
  const again = await openNick(u);
  assert.equal(again.status, 400);
  assert.deepEqual(again.body, { error: 'cooldown', nextAt: r.body.nextAt });
  assert.equal(app.tg.calls('getChat').length, 0);
  // 24 hours later it opens again
  await app.ctx.db.query("UPDATE bs_users SET nick_last_at = now() - interval '24 hours 1 minute' WHERE id = $1", [u.id]);
  assert.equal((await openNick(u)).status, 200);
  assert.equal((await userRow(u.id)).cases_opened, 2);
});

test('Telegram is asked for the current name: putting it in, opening the app and taking it out does not work', async () => {
  // the Mini App was opened with the name (signed by Telegram), then the player took it out
  const u = { id: nextId++, first_name: 'Миша DragonDrop', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: u });
  app.tg.state.users.set(u.id, { first_name: 'Миша' });
  app.tg.reset();
  assert.deepEqual((await openNick(u)).body, { error: 'need_nick', tag: 'DragonDrop' });
  const calls = app.tg.calls('getChat');
  assert.equal(calls.length, 1);
  assert.equal(Number(calls[0].payload.chat_id), u.id);
  // put back in: opens right away, no need to reopen the app
  app.tg.state.users.set(u.id, { first_name: 'Миша', last_name: 'DragonDrop' });
  assert.equal((await openNick(u)).status, 200);
  // and the other way round: added after the app was opened counts too
  const v = { id: nextId++, first_name: 'Вася', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: v });
  app.tg.state.users.set(v.id, { first_name: 'Вася', username: 'vasya_dragondrop' });
  assert.equal((await openNick(v)).status, 200);
});

test('without a chat with the bot: the names signed in the Mini App count; on the website the saved profile', async () => {
  assert.equal((await openNick(await player({ first_name: 'DragonDrop Аня', chat: false }))).status, 200);
  assert.equal((await openNick(await player({ first_name: 'Боря', chat: false }))).body.error, 'need_nick');
  // website login (no Mini App data)
  const web = async (u) => app.call('POST', '/api/nick/open', { token: signWebToken(u.id, 1, app.ctx.config.sessionSecret) });
  assert.equal((await web(await player({ first_name: 'Dragon Drop Кира', chat: false }))).status, 200);
  assert.equal((await web(await player({ first_name: 'Дима', chat: false }))).body.error, 'need_nick');
  // Telegram's answer wins over the saved profile on the website too
  const k = await player({ first_name: 'Коля DragonDrop' });
  app.tg.state.users.set(k.id, { first_name: 'Коля' });
  assert.equal((await web(k)).body.error, 'need_nick');
});

test('parallel opens give one brainrot', async () => {
  const u = await player({ first_name: 'DragonDrop' });
  const rs = await Promise.all([openNick(u), openNick(u), openNick(u)]);
  assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.body)));
  assert.equal(rs.filter((r) => r.body.error === 'cooldown').length, 2);
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE user_id = $1', [u.id])).n, 1);
  assert.equal((await userRow(u.id)).cases_opened, 1);
});

test('the FREE case and the nick case have their own cooldowns', async () => {
  const u = await player({ first_name: 'DragonDrop' });
  await app.post('/api/free/shared', { user: u });
  assert.equal((await app.post('/api/free/open', { user: u })).status, 200);
  assert.equal((await openNick(u)).status, 200, 'the FREE case does not use up the nick case');
  assert.equal((await app.post('/api/free/open', { user: u })).body.error, 'cooldown');
  assert.equal((await openNick(u)).body.error, 'cooldown');
  assert.equal((await userRow(u.id)).cases_opened, 2);
});

test('settings: admins set the text and the cooldown; the text needs letters', async () => {
  const a = await admin('Админ');
  for (const bad of ['', ' ', 'x', '!!!', '🎰🎰']) {
    assert.equal((await app.put('/api/admin/settings', { user: a, body: { nick_tag: bad } })).body.error, 'bad_setting', JSON.stringify(bad));
  }
  assert.equal((await app.put('/api/admin/settings', { user: a, body: { nick_cooldown_hours: 0 } })).body.error, 'bad_setting');
  const s = (await app.get('/api/admin/settings', { user: a })).body.settings;
  assert.equal(s.nick_tag, 'DragonDrop');
  assert.equal(s.nick_cooldown_hours, 24);
  assert.equal((await app.put('/api/admin/settings', { user: a, body: { nick_tag: 'SuperSpin', nick_cooldown_hours: 2 } })).status, 200);
  assert.deepEqual((await openNick(await player({ first_name: 'DragonDrop' }))).body, { error: 'need_nick', tag: 'SuperSpin' });
  const t0 = Date.now();
  const r = await openNick(await player({ first_name: 'super_spin' }));
  assert.equal(r.status, 200);
  assert.ok(Math.abs(new Date(r.body.nextAt).getTime() - (t0 + hours(2))) < 60_000, r.body.nextAt);
  await app.ctx.settings.update({ nick_tag: 'DragonDrop', nick_cooldown_hours: 24 });
});

test('admins edit the nick case like the FREE case: always free, cannot be deleted, can be switched off', async () => {
  const a = await admin('Админ2');
  const c = nickCase();
  const ac = (await app.get('/api/admin/cases', { user: a })).body.cases.find((x) => x.id === c.id);
  assert.equal(ac.is_nick, true);
  assert.equal(ac.is_free, false);
  assert.equal(ac.price, 0);
  assert.equal(ac.rtp, null);
  const body = { name_ru: 'Ник кейс', name_uk: ac.name_uk, name_en: ac.name_en, emoji: ac.emoji, color: ac.color, sort: ac.sort, enabled: true, price: 500, items: ac.items };
  const put = await app.put(`/api/admin/cases/${c.id}`, { user: a, body });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.case.price, 0, 'a price sent by mistake is ignored');
  assert.equal(put.body.case.name_ru, 'Ник кейс');
  assert.equal(put.body.case.is_nick, true);
  assert.equal((await app.del(`/api/admin/cases/${c.id}`, { user: a })).body.error, 'cannot_delete_free');
  // switched off: gone from the app and can't be opened
  assert.equal((await app.put(`/api/admin/cases/${c.id}`, { user: a, body: { ...body, enabled: false } })).status, 200);
  const u = await player({ first_name: 'DragonDrop' });
  const b = (await app.post('/api/bootstrap', { user: u })).body;
  assert.equal(b.cases.some((x) => x.isNick), false);
  assert.deepEqual(b.nick, { available: false, caseId: null, nextAt: null, tag: 'DragonDrop' });
  assert.equal((await openNick(u)).status, 404);
  assert.equal((await app.put(`/api/admin/cases/${c.id}`, { user: a, body: { ...body, name_ru: 'DragonDrop в нике', enabled: true } })).status, 200);
  assert.equal((await openNick(u)).status, 200);
});

test('admin: nick case openings count in the overview; the player card says where the brainrot came from', async () => {
  const a = await admin('Админ3');
  const before = (await app.get('/api/admin/overview', { user: a })).body.opened24;
  const u = await player({ first_name: 'DragonDrop' });
  const r = await openNick(u);
  assert.equal(r.status, 200);
  assert.equal((await app.get('/api/admin/overview', { user: a })).body.opened24, before + 1);
  const card = (await app.get(`/api/admin/users/${u.id}`, { user: a })).body.inventory;
  assert.equal(card.length, 1);
  assert.equal(card[0].from.type, 'nick');
  assert.equal(card[0].from.case.id, nickCase().id);
});
