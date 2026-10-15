// Invite friends — the referral page: every player has a code of their own (they can change it) and a
// link with it; a new player who comes by the link, or types the code in («Промокод», a top-up form)
// before their first top-up, is that player's friend, and the inviter gets invite_pct % of the friend's
// top-ups (Stars, coins credited and brainrots given for a deposit request). A week's income is pending;
// on Saturday at 15:00 Astana time it goes to the referral balance, from where it is moved to the balance.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { payoutWindow } from '../src/invites.js';
import { migrate } from '../src/db.js';

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

const row = (u) => app.ctx.db.one('SELECT balance, inviter_id, invite_code, invite_earned FROM bs_users WHERE id = $1', [u.id]);
const state = async (u) => (await app.get('/api/invites', { user: u })).body;
const codeOf = async (u) => (await state(u)).code;
/** Saturday has come: what the friends brought so far is on the referral balance. */
const saturday = () => app.ctx.db.query("UPDATE bs_invite_rewards SET created_at = created_at - interval '8 days'");
/** Telegram tells the bot the invoice was paid. */
async function payStars(u, stars, charge, ref) {
  app.tg.reset();
  const r = await app.post('/api/topup/stars', { user: u, body: ref ? { stars, ref } : { stars } });
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

test('the payout: every Saturday at 10:00 UTC (15:00 in Astana)', () => {
  const w = (iso) => {
    const r = payoutWindow(Date.parse(iso));
    return [new Date(r.last).toISOString(), new Date(r.next).toISOString()];
  };
  assert.deepEqual(w('2026-10-15T14:00:00Z'), ['2026-10-10T10:00:00.000Z', '2026-10-17T10:00:00.000Z']);
  assert.deepEqual(w('2026-10-17T09:59:59Z'), ['2026-10-10T10:00:00.000Z', '2026-10-17T10:00:00.000Z']);
  assert.deepEqual(w('2026-10-17T10:00:00Z'), ['2026-10-17T10:00:00.000Z', '2026-10-24T10:00:00.000Z']);
  assert.deepEqual(w('2026-10-18T03:00:00Z'), ['2026-10-17T10:00:00.000Z', '2026-10-24T10:00:00.000Z']);
  assert.deepEqual(w('2026-12-31T23:00:00Z'), ['2026-12-26T10:00:00.000Z', '2027-01-02T10:00:00.000Z']);
});

test('every player has a code and a link of their own: the same each time, by the bot; the next payout', async () => {
  const s = await state(host);
  assert.equal(s.pct, 5, 'the inviter gets 5 % by default');
  assert.match(s.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(s.link, `https://t.me/DragonDrop_Bot?start=${s.code}`);
  assert.equal(s.payoutAt, new Date(payoutWindow().next).toISOString());
  assert.deepEqual({ ...s, code: undefined, link: undefined, payoutAt: undefined }, {
    pct: 5, code: undefined, link: undefined, payoutAt: undefined, friends: 0, paying: 0, earned: 0, pending: 0, balance: 0, list: [],
  });
  assert.equal((await state(host)).link, s.link, 'kept');
  assert.notEqual(await codeOf(lone), s.code, 'everyone has their own');
});

test('a new player who came by the link is the friend; an old player, the inviter themselves, a friend of theirs and wrong links are not tied', async () => {
  const code = await codeOf(host);
  // a new player presses Start in the bot by the link
  await app.message(friend, `/start ${code}`);
  assert.equal(Number((await row(friend)).inviter_id), host.id);
  // pressing it again or another link changes nothing
  await app.message(friend, `/start ${await codeOf(lone)}`);
  assert.equal(Number((await row(friend)).inviter_id), host.id);
  // a player who opened the app a few minutes ago is still new; the code in small letters works too
  await app.post('/api/bootstrap', { user: friend2 });
  await app.message(friend2, `/start ${code.toLowerCase()}`);
  assert.equal(Number((await row(friend2)).inviter_id), host.id);
  // an old player, the inviter themselves, garbage, the share link: nothing
  await app.message(old, `/start ${code}`);
  await app.message(host, `/start ${code}`);
  await app.message(lone, '/start inv_XXXXXXXX');
  await app.message(lone, '/start share');
  for (const u of [old, host, lone]) assert.equal((await row(u)).inviter_id, null, u.first_name);
  // the inviter can't become a friend of their own friend
  const back = { id: 7210, first_name: 'Обратно', language_code: 'ru' };
  await app.message(back, `/start ${code}`);
  assert.equal(Number((await row(back)).inviter_id), host.id);
  await app.ctx.db.query("UPDATE bs_users SET created_at = now(), inviter_id = NULL WHERE id = $1", [host.id]);
  await app.message(host, `/start ${await codeOf(back)}`);
  assert.equal((await row(host)).inviter_id, null, 'not a circle');
  await app.ctx.db.query("UPDATE bs_users SET created_at = now() - interval '1 day', inviter_id = NULL WHERE id = ANY($1)", [[host.id, back.id]]);
  const s = await state(host);
  assert.equal(s.friends, 2);
  assert.deepEqual(s.list.map((f) => f.name).sort(), ['Друг', 'Второй'].sort());
});

test('links sent before the codes could be changed (?start=inv_CODE, small letters) still tie; such codes become capitals', async () => {
  const p = { id: 7211, first_name: 'Старая ссылка', language_code: 'ru' };
  // a code made before: small and capital letters
  await app.ctx.db.query("UPDATE bs_users SET invite_code = 'aB3dE5gH' WHERE id = $1", [lone.id]);
  await migrate(app.ctx.db);
  assert.equal((await row(lone)).invite_code, 'AB3DE5GH');
  await app.message(p, '/start inv_aB3dE5gH');
  assert.equal(Number((await row(p)).inviter_id), lone.id);
  await app.ctx.db.query('UPDATE bs_users SET inviter_id = NULL WHERE id = $1', [p.id]);
});

test('an older code that reads the same as another one in capitals keeps its small letters: its links and the code typed as it is find its owner', async () => {
  const a = { id: 7220, first_name: 'Маленькие', language_code: 'ru' };
  const b = { id: 7221, first_name: 'Большие', language_code: 'ru' };
  for (const u of [a, b]) await app.message(u, '/start');
  await app.ctx.db.query('UPDATE bs_users SET invite_code = $2 WHERE id = $1', [a.id, 'qW3eR5tY']);
  await app.ctx.db.query('UPDATE bs_users SET invite_code = $2 WHERE id = $1', [b.id, 'QW3ER5TY']);
  await migrate(app.ctx.db);
  assert.equal((await row(a)).invite_code, 'qW3eR5tY', 'not made capital: it would read the same as the other one');
  assert.equal((await state(a)).link, 'https://t.me/DragonDrop_Bot?start=qW3eR5tY');
  const p = (id) => ({ id, first_name: `Новый ${id}`, language_code: 'ru' });
  await app.message(p(7222), '/start qW3eR5tY');
  await app.message(p(7223), '/start inv_qW3eR5tY');
  await app.message(p(7224), '/start QW3ER5TY');
  const tied = [];
  for (const id of [7222, 7223, 7224]) tied.push(Number((await row({ id })).inviter_id));
  assert.deepEqual(tied, [a.id, a.id, b.id]);
  await app.post('/api/bootstrap', { user: p(7225) });
  const r = await app.post('/api/promo', { user: p(7225), body: { code: 'qW3eR5tY' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { invite: { name: 'Маленькие' }, already: false });
});

test('the Mini App opened by a friend\'s link (?startapp=CODE) ties a new player too', async () => {
  const code = await codeOf(lone);
  const p = { id: 7206, first_name: 'Из приложения', language_code: 'ru' };
  const { buildInitData } = await import('../src/auth.js');
  const { BOT_TOKEN } = await import('./helpers.js');
  const init = buildInitData(p, BOT_TOKEN, undefined, { start_param: code });
  const res = await fetch(`${app.base}/api/bootstrap`, { method: 'POST', headers: { Authorization: `tma ${init}` } });
  assert.equal(res.status, 200);
  assert.equal(Number((await row(p)).inviter_id), lone.id);
});

test('the inviter gets 5 % of every top-up of a friend: pending till Saturday, then on the referral balance', async () => {
  // Stars: 100 ⭐ = 200 coins → 10 for the inviter
  await payStars(friend, 100, 'inv-charge-1');
  let s = await state(host);
  assert.deepEqual([s.pending, s.balance, s.earned], [10, 0, 10]);
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
  const fromBrainrots = 50 + Math.floor((it.value * 5) / 100);
  // a player nobody invited: nobody gets anything
  await payStars(lone, 50, 'inv-charge-2');
  assert.equal((await state(lone)).pending, 0);
  // a payment Telegram sends twice counts once
  await payStars(friend, 100, 'inv-charge-1');
  s = await state(host);
  assert.deepEqual([s.pending, s.balance, s.earned], [10 + fromBrainrots, 0, 10 + fromBrainrots]);
  assert.equal(s.paying, 2);
  assert.deepEqual(Object.fromEntries(s.list.map((f) => [f.name, f.earned])), { Друг: 10, Второй: fromBrainrots });
  // nothing to move before Saturday
  assert.equal((await app.post('/api/invites/claim', { user: host })).body.error, 'nothing_to_claim');
  // Saturday: on the referral balance; the next week starts empty
  await saturday();
  s = await state(host);
  assert.deepEqual([s.pending, s.balance, s.earned], [0, 10 + fromBrainrots, 10 + fromBrainrots]);
});

test('moving the referral balance to the balance: all at once, logged; then nothing to move', async () => {
  await wait(3100);
  const before = Number((await row(host)).balance);
  const owed = (await state(host)).balance;
  const r = await app.post('/api/invites/claim', { user: host });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { claimed: owed, balance: before + owed });
  assert.equal(Number((await row(host)).balance), before + owed);
  assert.deepEqual([(await state(host)).balance, (await state(host)).earned], [0, owed]);
  const log = await app.ctx.db.one("SELECT delta FROM bs_balance_log WHERE user_id = $1 AND reason = 'invites' ORDER BY id DESC LIMIT 1", [host.id]);
  assert.equal(Number(log.delta), owed);
  const again = await app.post('/api/invites/claim', { user: host });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, 'nothing_to_claim');
  // two at the same time: only one gets it
  await payStars(friend, 100, 'inv-charge-3');
  await saturday();
  await wait(3100);
  const both = await Promise.all([app.post('/api/invites/claim', { user: host }), app.post('/api/invites/claim', { user: host })]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 400]);
  assert.equal((await state(host)).balance, 0);
});

test('what the friends brought before the switch to Saturdays stays on the referral balance', async () => {
  const from = app.ctx.settings.get('_invite_weekly_from');
  assert.ok(from, 'set at the first start');
  // a reward of before the switch (counted then on the balance) and one of this week
  await app.ctx.db.query('INSERT INTO bs_invite_rewards (inviter_id, user_id, coins, created_at) VALUES ($1, $2, 7, $3::timestamptz - interval \'1 minute\'), ($1, $2, 3, now())', [lone.id, old.id, from]);
  const s = await state(lone);
  assert.deepEqual([s.balance, s.pending], [7, 3]);
  await app.ctx.db.query('DELETE FROM bs_invite_rewards WHERE inviter_id = $1', [lone.id]);
});

test('the player changes their code: capitals and digits, 4–16; not someone else\'s, a referral or a promo code; the link follows', async () => {
  await wait(3100);
  const set = (u, code) => app.post('/api/invites/code', { user: u, body: { code } });
  const was = await codeOf(lone);
  let r = await set(lone, ' mikhail7 ');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { code: 'MIKHAIL7', link: 'https://t.me/DragonDrop_Bot?start=MIKHAIL7' });
  assert.equal((await state(lone)).link, r.body.link);
  for (const bad of ['ABC', 'A'.repeat(17), 'ДРАКОН', 'MY CODE', 'share', '']) assert.equal((await set(lone, bad)).body.error, 'bad_code', bad);
  await wait(3100);
  assert.equal((await set(lone, await codeOf(host))).body.error, 'code_taken', "someone else's");
  await app.ctx.db.query("INSERT INTO bs_ref_codes (code, active) VALUES ('STREAMER', TRUE) ON CONFLICT DO NOTHING");
  await app.ctx.db.query("INSERT INTO bs_promo_codes (code, amount, max_uses) VALUES ('GIFT100', 100, 10) ON CONFLICT DO NOTHING");
  assert.equal((await set(lone, 'streamer')).body.error, 'code_taken', 'a referral code');
  assert.equal((await set(lone, 'gift100')).body.error, 'code_taken', 'a promo code');
  // the old link ties nobody now, the new one does
  const p = { id: 7212, first_name: 'По новой', language_code: 'ru' };
  await app.message(p, `/start ${was}`);
  assert.equal((await row(p)).inviter_id, null);
  await app.message(p, '/start MIKHAIL7');
  assert.equal(Number((await row(p)).inviter_id), lone.id);
});

test("a friend's code typed in «Промокод»: before the first top-up, once, not one's own, not the other way round", async () => {
  const code = await codeOf(lone); // MIKHAIL7
  const promo = (u, c) => app.post('/api/promo', { user: u, body: { code: c } });
  const a = { id: 7213, first_name: 'Ввёл код', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: a });
  await app.ctx.db.query("UPDATE bs_users SET created_at = now() - interval '3 days' WHERE id = $1", [a.id]); // not new: a link would not tie
  let r = await promo(a, code.toLowerCase());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { invite: { name: 'Один' }, already: false });
  assert.equal(Number((await row(a)).inviter_id), lone.id);
  assert.deepEqual((await promo(a, code)).body, { invite: { name: 'Один' }, already: true }, 'again: fine');
  assert.equal((await promo(a, await codeOf(host))).body.error, 'invite_taken');
  assert.equal((await promo(lone, code)).body.error, 'invite_self');
  // the other way round: the inviter typing their friend's code
  await app.ctx.db.query('UPDATE bs_users SET inviter_id = NULL WHERE id = $1', [lone.id]);
  assert.equal((await promo(lone, await codeOf(a))).body.error, 'invite_mutual');
  // after a top-up: too late
  const b = { id: 7214, first_name: 'Уже платил', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: b });
  await payStars(b, 10, 'inv-charge-late');
  await wait(3100);
  assert.equal((await promo(b, code)).body.error, 'invite_late');
  assert.equal((await row(b)).inviter_id, null);
  // a promo code of the admins still comes first; garbage is still «no such promo code»
  r = await promo(b, 'gift100');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.amount, 100);
  assert.equal((await promo(b, 'NOSUCHCODE')).body.error, 'promo_invalid');
});

test("a friend's code in a top-up form ties the player before that top-up: the friend gets their share of it", async () => {
  const code = await codeOf(lone);
  const c = { id: 7215, first_name: 'Код при пополнении', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: c });
  const before = await state(lone);
  await payStars(c, 100, 'inv-charge-topup', code);
  assert.equal(Number((await row(c)).inviter_id), lone.id);
  assert.equal((await state(lone)).pending, before.pending + 10);
  assert.equal(Number((await row(c)).balance), 200, 'the top-up itself is as usual');
});

test("the bot: a friend's code sent after «Ввести промокод»", async () => {
  const d = { id: 7216, first_name: 'Из бота', language_code: 'ru' };
  await app.message(d, '/start');
  const ask = async () =>
    app.sendUpdate({
      callback_query: { id: 'cb' + Date.now(), from: { is_bot: false, ...d }, chat_instance: 'x', data: 'promo', message: { message_id: 1, date: 0, chat: { id: d.id, type: 'private' }, text: 'x' } },
    });
  const last = () => app.tg.calls('sendMessage').filter((x) => Number(x.payload.chat_id) === d.id).at(-1).payload.text;
  await ask();
  await app.message(d, (await codeOf(lone)).toLowerCase());
  assert.equal(last(), '✅ Код друга принят: Один');
  assert.equal(Number((await row(d)).inviter_id), lone.id);
  await ask();
  await app.message(d, await codeOf(host));
  assert.equal(last(), '⚠️ Тебя уже пригласил другой игрок.');
  await ask();
  await app.message(d, 'NOSUCHCODE');
  assert.equal(last(), '❌ Такого промокода нет.');
});

test("the share message carries the player's own link", async () => {
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
  const was = (await state(host)).pending;
  await payStars(friend, 50, 'inv-charge-4'); // 100 coins → 10
  assert.equal((await state(host)).pending, was + 10);
  assert.equal((await state(host)).pct, 10);
  await app.put('/api/admin/settings', { user: boss, body: { invite_pct: 0 } });
  await payStars(friend, 50, 'inv-charge-5');
  assert.equal((await state(host)).pending, was + 10, 'switched off: nothing more');
  assert.equal((await state(host)).pct, 0);
  await app.put('/api/admin/settings', { user: boss, body: { invite_pct: 5 } });
});

test('the admin player card: who invited the player, how many friends they brought, what it gave, pending and not moved', async () => {
  const card = async (u) => (await app.get(`/api/admin/users/${u.id}`, { user: helper })).body.invites;
  assert.deepEqual(await card(friend), { inviter: { id: host.id, name: 'Хозяин' }, friends: 0, earned: 0, pending: 0, balance: 0 });
  const s = await state(host);
  assert.deepEqual(await card(host), { inviter: null, friends: 2, earned: s.earned, pending: s.pending, balance: s.balance });
  assert.ok(s.pending > 0);
});
