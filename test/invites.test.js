// Invite friends: every player has a link of their own; a new player who comes by it is that player's
// friend, and the inviter gets invite_pct % of the friend's top-ups (Stars, coins credited and brainrots
// given for a deposit request), kept apart until moved to the balance.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
const boss = { id: 7101, first_name: 'Босс', username: 'inv_boss', language_code: 'ru' };
const helper = { id: 7102, first_name: 'Помощник', username: 'inv_helper', language_code: 'ru' };
const host = { id: 7201, first_name: 'Хозяин', username: 'host', language_code: 'ru' };
const friend = { id: 7202, first_name: 'Друг', language_code: 'ru' };
const friend2 = { id: 7203, first_name: 'Второй', username: 'second', language_code: 'en' };
const old = { id: 7204, first_name: 'Старожил', language_code: 'ru' };
const lone = { id: 7205, first_name: 'Один', language_code: 'ru' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  app = await startApp({ dbName: 'bs_t_invites', env: { OWNER_USERNAMES: 'inv_boss' } });
  for (const u of [boss, helper, host, old, lone]) {
    await app.post('/api/bootstrap', { user: u });
    await app.message(u, '/start');
  }
  await app.makeAdmin(boss.id);
  await app.makeAdmin(helper.id);
  // the rewards below are counted in coins of 2 per Star
  await app.ctx.settings.update({ stars_rate: 2 });
  // an old player: came more than an hour ago
  await app.ctx.db.query("UPDATE bs_users SET created_at = now() - interval '2 hours' WHERE id = $1", [old.id]);
});
after(async () => {
  await app?.close();
});

const row = (u) => app.ctx.db.one('SELECT balance, inviter_id, invite_balance, invite_earned FROM bs_users WHERE id = $1', [u.id]);
const state = async (u) => (await app.get('/api/invites', { user: u })).body;
/** Telegram tells the bot the invoice was paid. */
async function payStars(u, stars, charge) {
  app.tg.reset();
  const r = await app.post('/api/topup/stars', { user: u, body: { stars } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const payload = app.tg.calls('createInvoiceLink')[0].payload.payload;
  await app.sendUpdate({
    message: {
      message_id: 900,
      date: 0,
      chat: { id: u.id, type: 'private' },
      from: { is_bot: false, ...u },
      successful_payment: { currency: 'XTR', total_amount: stars, invoice_payload: payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '' },
    },
  });
}

test('every player has a link of their own: the same each time, by the bot', async () => {
  const s = await state(host);
  assert.equal(s.pct, 5, 'the inviter gets 5 % by default');
  assert.match(s.link, /^https:\/\/t\.me\/DragonDrop_Bot\?start=inv_[A-Za-z0-9]{8}$/);
  assert.deepEqual({ ...s, link: undefined }, { pct: 5, link: undefined, friends: 0, paying: 0, earned: 0, balance: 0, list: [] });
  assert.equal((await state(host)).link, s.link, 'kept');
  assert.notEqual((await state(lone)).link, s.link, 'everyone has their own');
});

test('a new player who came by the link is the friend; an old player, the inviter themselves and wrong links are not tied', async () => {
  const code = (await state(host)).link.split('start=')[1];
  // a new player presses Start in the bot by the link
  await app.message(friend, `/start ${code}`);
  assert.equal(Number((await row(friend)).inviter_id), host.id);
  // pressing it again or another link changes nothing
  await app.message(friend, `/start ${(await state(lone)).link.split('start=')[1]}`);
  assert.equal(Number((await row(friend)).inviter_id), host.id);
  // a player who opened the app a few minutes ago is still new
  await app.post('/api/bootstrap', { user: friend2 });
  await app.message(friend2, `/start ${code}`);
  assert.equal(Number((await row(friend2)).inviter_id), host.id);
  // an old player, the inviter themselves, garbage: nothing
  await app.message(old, `/start ${code}`);
  await app.message(host, `/start ${code}`);
  await app.message(lone, '/start inv_XXXXXXXX');
  await app.message(lone, '/start share');
  for (const u of [old, host, lone]) assert.equal((await row(u)).inviter_id, null, u.first_name);
  const s = await state(host);
  assert.equal(s.friends, 2);
  assert.deepEqual(s.list.map((f) => f.name).sort(), ['Друг', 'Второй'].sort());
});

test('the Mini App opened by a friend\'s link (?startapp=inv_…) ties a new player too', async () => {
  const code = (await state(lone)).link.split('start=')[1];
  const p = { id: 7206, first_name: 'Из приложения', language_code: 'ru' };
  const { buildInitData } = await import('../src/auth.js');
  const { BOT_TOKEN } = await import('./helpers.js');
  const init = buildInitData(p, BOT_TOKEN, undefined, { start_param: code });
  const res = await fetch(`${app.base}/api/bootstrap`, { method: 'POST', headers: { Authorization: `tma ${init}` } });
  assert.equal(res.status, 200);
  assert.equal(Number((await row(p)).inviter_id), lone.id);
});

test('the inviter gets 5 % of every top-up of a friend: Stars, coins credited, brainrots given; nothing from others', async () => {
  // Stars: 100 ⭐ = 200 coins → 10 for the inviter
  await payStars(friend, 100, 'inv-charge-1');
  let h = await row(host);
  assert.deepEqual([Number(h.invite_balance), Number(h.invite_earned)], [10, 10]);
  assert.equal(Number((await row(friend)).balance), 200, 'the friend gets the whole top-up');
  // a brainrot deposit: coins credited and a brainrot given by an admin
  await wait(3100);
  const offer = [{ itemId: [...app.ctx.game.catalog.items.values()].find((i) => i.enabled && i.depositable).id, count: 1 }];
  const dep = await app.post('/api/requests/deposit', { user: friend2, body: { nick: 'FriendRBX', offer } });
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  const id = dep.body.request.id;
  assert.equal((await app.post(`/api/admin/requests/${id}/credit`, { user: boss, body: { amount: 1000 } })).status, 200);
  const it = [...app.ctx.game.catalog.items.values()].find((i) => i.value >= 100);
  assert.equal((await app.post(`/api/admin/requests/${id}/give`, { user: boss, body: { itemId: it.id } })).status, 200);
  h = await row(host);
  const fromBrainrots = 50 + Math.floor((it.value * 5) / 100);
  assert.equal(Number(h.invite_balance), 10 + fromBrainrots);
  // a player nobody invited: nobody gets anything
  await payStars(lone, 50, 'inv-charge-2');
  assert.equal(Number((await row(lone)).invite_balance), 0);
  // a payment Telegram sends twice counts once
  await payStars(friend, 100, 'inv-charge-1');
  h = await row(host);
  assert.equal(Number(h.invite_earned), 10 + fromBrainrots);
  // what the screen shows: who topped up and what each brought
  const s = await state(host);
  assert.equal(s.paying, 2);
  assert.equal(s.earned, 10 + fromBrainrots);
  assert.equal(s.balance, 10 + fromBrainrots);
  assert.deepEqual(Object.fromEntries(s.list.map((f) => [f.name, f.earned])), { Друг: 10, Второй: fromBrainrots });
});

test('moving it to the balance: all at once, logged; then nothing to move', async () => {
  await wait(3100);
  const before = Number((await row(host)).balance);
  const owed = Number((await row(host)).invite_balance);
  const r = await app.post('/api/invites/claim', { user: host });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { claimed: owed, balance: before + owed });
  const h = await row(host);
  assert.deepEqual([Number(h.balance), Number(h.invite_balance), Number(h.invite_earned)], [before + owed, 0, owed]);
  const log = await app.ctx.db.one("SELECT delta FROM bs_balance_log WHERE user_id = $1 AND reason = 'invites' ORDER BY id DESC LIMIT 1", [host.id]);
  assert.equal(Number(log.delta), owed);
  const again = await app.post('/api/invites/claim', { user: host });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, 'nothing_to_claim');
  // two at the same time: only one gets it
  await payStars(friend, 100, 'inv-charge-3');
  await wait(3100);
  const both = await Promise.all([app.post('/api/invites/claim', { user: host }), app.post('/api/invites/claim', { user: host })]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 400]);
  assert.equal(Number((await row(host)).invite_balance), 0);
});

test('the share message carries the player\'s own link', async () => {
  await wait(3100);
  const s = await state(host);
  app.tg.reset();
  const r = await app.post('/api/invites/share', { user: host });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.preparedId);
  const msg = app.tg.calls('savePreparedInlineMessage')[0].payload;
  const result = typeof msg.result === 'string' ? JSON.parse(msg.result) : msg.result;
  assert.equal(result.reply_markup.inline_keyboard[0][0].url, s.link);
  assert.equal(r.body.url, `https://t.me/share/url?url=${encodeURIComponent(s.link)}&text=${encodeURIComponent('🎁 Залетай в DragonDrop — открывай кейсы с брейнротами из «Steal a Brainrot»!')}`);
});

test('the main admin sets the %: 0 switches it off; other admins neither see nor change it', async () => {
  const seen = async (u) => (await app.get('/api/admin/settings', { user: u })).body.settings;
  assert.equal((await seen(boss)).invite_pct, 5);
  assert.ok(!('invite_pct' in (await seen(helper))));
  await app.put('/api/admin/settings', { user: helper, body: { invite_pct: 40 } });
  assert.equal(app.ctx.settings.get('invite_pct'), 5, 'a regular admin changes nothing');
  assert.equal((await app.put('/api/admin/settings', { user: boss, body: { invite_pct: 51 } })).status, 400);
  assert.equal((await app.put('/api/admin/settings', { user: boss, body: { invite_pct: 10 } })).status, 200);
  await payStars(friend, 50, 'inv-charge-4'); // 100 coins → 10
  assert.equal(Number((await row(host)).invite_balance), 10);
  assert.equal((await state(host)).pct, 10);
  await app.put('/api/admin/settings', { user: boss, body: { invite_pct: 0 } });
  await payStars(friend, 50, 'inv-charge-5');
  assert.equal(Number((await row(host)).invite_balance), 10, 'switched off: nothing more');
  assert.equal((await state(host)).pct, 0);
  await app.put('/api/admin/settings', { user: boss, body: { invite_pct: 5 } });
});

test('the admin player card: who invited the player, how many friends they brought and what it gave', async () => {
  const card = async (u) => (await app.get(`/api/admin/users/${u.id}`, { user: helper })).body.invites;
  assert.deepEqual(await card(friend), { inviter: { id: host.id, name: 'Хозяин' }, friends: 0, earned: 0, balance: 0 });
  const h = await row(host);
  assert.deepEqual(await card(host), { inviter: null, friends: 2, earned: Number(h.invite_earned), balance: Number(h.invite_balance) });
});
