// Auto promo code: a new code every few hours (made up by the server) with a +5..15 % bonus to one
// top-up per player; typed in the top-up form (Stars or brainrots), apart from the referral bonus.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, scriptedRng } from './helpers.js';
import { parseStarsPayload } from '../src/requests.js';
import { AUTO_WORDS } from '../src/autopromo.js';

const HOUR = 3_600_000;
const clock = { t: Date.UTC(2026, 9, 11, 13, 30) }; // 13:30 UTC: the 2-hour code runs 12:00 → 14:00
const words = scriptedRng(); // which word and which % the server picks
let app;
const boss = { id: 6101, first_name: 'Босс', username: 'ap_boss', language_code: 'ru' };
const helper = { id: 6102, first_name: 'Помощник', username: 'ap_helper', language_code: 'ru' };
const p1 = { id: 6201, first_name: 'Игрок', language_code: 'ru' };
const p2 = { id: 6202, first_name: 'Второй', language_code: 'ru' };
const p3 = { id: 6203, first_name: 'Третий', language_code: 'ru' };
const p4 = { id: 6204, first_name: 'Четвёртый', language_code: 'ru' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  words.queue.push(0, 2); // the first code (made when the players first open the app): the first word, 5 + 2 = 7 %
  app = await startApp({ dbName: 'bs_t_autopromo', now: () => clock.t, autoPromoRng: words, env: { OWNER_USERNAMES: 'ap_boss' } });
  for (const u of [boss, helper, p1, p2, p3, p4]) await app.post('/api/bootstrap', { user: u });
  await app.makeAdmin(boss.id);
  await app.makeAdmin(helper.id);
});
after(async () => {
  await app?.close();
});

const state = async (u = p1) => (await app.post('/api/bootstrap', { user: u })).body.autoPromo;
const bal = async (u) => Number((await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [u.id])).balance);
const nowSec = () => Math.floor(Date.now() / 1000);
/** Telegram tells the bot the invoice was paid (the payload is the one of the invoice the app got). */
async function pay(u, payload, stars, charge) {
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
/** Asks for a Stars invoice with a code; returns the app's answer and the payload of the invoice made. */
async function invoice(u, stars, ref) {
  app.tg.reset();
  const r = await app.post('/api/topup/stars', { user: u, body: ref === undefined ? { stars } : { stars, ref } });
  const call = app.tg.calls('createInvoiceLink')[0];
  return { r, payload: call ? call.payload.payload : null };
}

test('a new code every 2 hours from midnight UTC: a word from the list and a whole % from 5 to 15; the same until it ends', async () => {
  const a = await state();
  assert.deepEqual(a, { code: AUTO_WORDS[0], pct: 7, endsAt: '2026-10-11T14:00:00.000Z', hours: 2, used: false });
  // later in the same 2 hours: the same code
  clock.t = Date.UTC(2026, 9, 11, 13, 59, 59);
  assert.deepEqual(await state(p2), a);
  // 14:00: the next one, another word
  clock.t = Date.UTC(2026, 9, 11, 14, 0, 0);
  words.queue.push(0, 10);
  const b = await state();
  assert.equal(b.code, AUTO_WORDS[1], 'not the word just used');
  assert.equal(b.pct, 15);
  assert.equal(b.endsAt, '2026-10-11T16:00:00.000Z');
  // every code: a word nobody uses as a referral or promo code, never the one before, 5..15 %
  assert.equal((await app.post('/api/admin/referrals', { user: boss, body: { code: AUTO_WORDS[2] } })).status, 200);
  assert.equal((await app.post('/api/admin/promos', { user: boss, body: { code: AUTO_WORDS[3], amount: 10, maxUses: 5 } })).status, 200);
  let prev = b.code;
  for (let i = 1; i <= 40; i++) {
    clock.t = Date.UTC(2026, 9, 11, 14) + i * 2 * HOUR;
    const c = await state();
    assert.ok(AUTO_WORDS.includes(c.code) && ![AUTO_WORDS[2], AUTO_WORDS[3], prev].includes(c.code), c.code);
    assert.ok(Number.isInteger(c.pct) && c.pct >= 5 && c.pct <= 15, String(c.pct));
    assert.equal(new Date(c.endsAt).getTime() % (2 * HOUR), 0);
    prev = c.code;
  }
  const n = (await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_auto_promos')).n;
  assert.equal(n, 42, 'one code per 2 hours, made once');
});

test('the main admin sets it: on / off, the % range (min not above max), how many hours; other admins do not see it', async () => {
  const s = (await app.get('/api/admin/settings', { user: boss })).body.settings;
  assert.deepEqual([s.auto_promo, s.auto_promo_min, s.auto_promo_max, s.auto_promo_hours], [true, 5, 15, 2]);
  const h = (await app.get('/api/admin/settings', { user: helper })).body.settings;
  assert.ok(!('auto_promo' in h) && !('auto_promo_min' in h) && !('auto_promo_hours' in h));
  await app.put('/api/admin/settings', { user: helper, body: { auto_promo: false, auto_promo_min: 50, auto_promo_max: 60 } });
  assert.deepEqual([app.ctx.settings.get('auto_promo'), app.ctx.settings.get('auto_promo_min')], [true, 5], 'not changed by a helper');
  assert.equal((await app.put('/api/admin/settings', { user: boss, body: { auto_promo_min: 20, auto_promo_max: 10 } })).body.error, 'bad_setting');
  // 3 hours, 20..30 %: the running code (14:00 → 16:00) stays; the next one starts right after it
  // and runs until the next 3-hour mark (18:00)
  clock.t = Date.UTC(2026, 9, 15, 15, 30);
  const cur = await state();
  assert.equal(cur.endsAt, '2026-10-15T16:00:00.000Z');
  assert.equal((await app.put('/api/admin/settings', { user: boss, body: { auto_promo_hours: 3, auto_promo_min: 20, auto_promo_max: 30 } })).status, 200);
  assert.deepEqual(await state(), { ...cur, hours: 3 });
  clock.t = Date.UTC(2026, 9, 15, 16, 0, 1);
  words.queue.push(0, 4);
  const next = await state();
  assert.deepEqual([next.pct, next.endsAt, next.hours], [24, '2026-10-15T18:00:00.000Z', 3]);
  const row = await app.ctx.db.one('SELECT starts_at FROM bs_auto_promos WHERE code = $1 ORDER BY id DESC LIMIT 1', [next.code]);
  assert.equal(new Date(row.starts_at).toISOString(), '2026-10-15T16:00:00.000Z', 'right after the last one');
  // off: no code in the app
  await app.put('/api/admin/settings', { user: boss, body: { auto_promo: false } });
  assert.equal(await state(), null);
  assert.deepEqual((await app.get('/api/auto-promo', { user: p1 })).body, { autoPromo: null });
  await app.put('/api/admin/settings', { user: boss, body: { auto_promo: true, auto_promo_hours: 2, auto_promo_min: 5, auto_promo_max: 15 } });
});

test('Stars: the code typed in gives +pct % once per player (also with two invoices at once); the referral bonus comes on top', async () => {
  clock.t = Date.UTC(2026, 9, 20, 9, 15);
  words.queue.push(5, 5); // 10 %
  const c = await state(p1);
  assert.equal(c.pct, 10);
  // typed in lower case: the invoice remembers the code, the player is not tied to any referral code
  const b0 = await bal(p1);
  const { r, payload } = await invoice(p1, 200, ` ${c.code.toLowerCase()} `);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.promo, r.body.ref], [{ code: c.code, pct: 10 }, null]);
  const promoId = (await app.ctx.db.one('SELECT id FROM bs_auto_promos WHERE code = $1 ORDER BY id DESC LIMIT 1', [c.code])).id;
  assert.equal(parseStarsPayload(payload).promoId, Number(promoId));
  // paid an hour later (another code by then): the bonus of the code typed in
  clock.t += HOUR;
  await pay(p1, payload, 200, 'ap-charge-1');
  assert.equal(await bal(p1), b0 + 220);
  assert.deepEqual((await app.get(`/api/topup/stars/${r.body.invoice}`, { user: p1 })).body, { paid: true, coins: 220, balance: b0 + 220 });
  const reply = app.tg.calls('sendMessage').filter((x) => Number(x.payload.chat_id) === p1.id).at(-1).payload.text;
  assert.match(reply, /\+220 🪙/);
  const req = await app.ctx.db.one("SELECT id, coins, bonus, promo_code, promo_pct, promo_bonus FROM bs_requests WHERE charge_id = 'ap-charge-1'");
  assert.deepEqual([Number(req.coins), Number(req.bonus), req.promo_code, req.promo_pct, Number(req.promo_bonus)], [200, 0, c.code, 10, 20]);
  const log = await app.ctx.db.many('SELECT delta, reason FROM bs_balance_log WHERE user_id = $1 ORDER BY id', [p1.id]);
  assert.deepEqual(log.slice(-2).map((l) => [Number(l.delta), l.reason]), [[200, `stars:#${req.id}`], [20, `autopromo:#${req.id}`]]);
  assert.equal((await app.ctx.db.one('SELECT ref_code FROM bs_users WHERE id = $1', [p1.id])).ref_code, null);

  // the next code: the player can use it again; the old one now says «expired»
  clock.t = Date.UTC(2026, 9, 20, 11, 5);
  words.queue.push(0, 0); // 5 %
  const c2 = await state(p1);
  assert.notEqual(c2.code, c.code);
  assert.equal(c2.used, false);
  await wait(3100); // player actions are rate limited
  assert.equal((await invoice(p1, 100, c.code)).r.body.error, 'promo_expired');
  assert.equal((await invoice(p1, 100, 'NOSUCHCODE')).r.body.error, 'bad_ref');
  // two invoices before paying: only the first payment gets the bonus
  const i1 = await invoice(p1, 100, c2.code);
  const i2 = await invoice(p1, 100, c2.code);
  assert.equal(i2.r.status, 200);
  const b1 = await bal(p1);
  await pay(p1, i1.payload, 100, 'ap-charge-2');
  await pay(p1, i2.payload, 100, 'ap-charge-3');
  assert.equal(await bal(p1), b1 + 105 + 100);
  assert.equal((await state(p1)).used, true);
  assert.equal((await invoice(p1, 100, c2.code)).r.body.error, 'promo_used');

  // tied to a referral code (10 % by the first level): both bonuses; the partner's stats count only theirs
  await wait(3100);
  assert.equal((await app.post('/api/admin/referrals', { user: boss, body: { code: 'APREF' } })).status, 200);
  const tie = await invoice(p2, 10, 'apref');
  assert.equal(tie.r.body.ref, 'APREF', JSON.stringify(tie.r.body));
  const b2 = await bal(p2);
  const both = await invoice(p2, 300, c2.code);
  assert.deepEqual([both.r.body.ref, both.r.body.promo], ['APREF', { code: c2.code, pct: 5 }]);
  await pay(p2, both.payload, 300, 'ap-charge-4');
  assert.equal(await bal(p2), b2 + 300 + 30 + 15);
  const stats = (await app.get('/api/admin/referrals/APREF', { user: boss })).body.code.stats;
  assert.equal(stats.bonus, 30, 'the auto promo bonus is not the code\'s');
  // a tied player: another referral code changes nothing, an unknown one is a mistake
  assert.equal((await invoice(p2, 10, AUTO_WORDS[2])).r.body.ref, 'APREF');
  assert.equal((await invoice(p2, 10, 'TYPO')).r.body.error, 'bad_ref');
  // switched off: the code is just an unknown code
  await wait(3100);
  await app.put('/api/admin/settings', { user: boss, body: { auto_promo: false } });
  assert.equal((await invoice(p3, 10, c2.code)).r.body.error, 'bad_ref');
  await app.put('/api/admin/settings', { user: boss, body: { auto_promo: true } });
});

test('brainrots: the request keeps the code, every credit pays +pct %; admins see it; one request per code', async () => {
  await wait(3100);
  clock.t = Date.UTC(2026, 9, 21, 16, 40);
  words.queue.push(0, 7); // 12 %
  const c = await state(p3);
  const offer = [{ itemId: [...app.ctx.game.catalog.items.values()].find((i) => i.enabled && i.depositable).id, count: 1 }];
  const dep = await app.post('/api/requests/deposit', { user: p3, body: { nick: 'ThirdRBX', offer, ref: c.code } });
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  assert.deepEqual(dep.body.request.promo, { code: c.code, pct: 12, bonus: 0 });
  assert.equal(dep.body.ref, null);
  const id = dep.body.request.id;
  const b0 = await bal(p3);
  assert.equal((await app.post(`/api/admin/requests/${id}/credit`, { user: boss, body: { amount: 1000 } })).status, 200);
  assert.equal((await app.post(`/api/admin/requests/${id}/credit`, { user: boss, body: { amount: 50 } })).status, 200);
  assert.equal(await bal(p3), b0 + 1000 + 120 + 50 + 6);
  const d = (await app.get(`/api/admin/requests/${id}`, { user: boss })).body.request;
  assert.deepEqual(d.promo, { code: c.code, pct: 12, bonus: 126 });
  const log = await app.ctx.db.many("SELECT delta FROM bs_balance_log WHERE reason = $1 ORDER BY id", [`autopromo:#${id}`]);
  assert.deepEqual(log.map((l) => Number(l.delta)), [120, 6]);
  // the same code again: refused, no request made
  const again = await app.post('/api/requests/deposit', { user: p3, body: { nick: 'ThirdRBX', offer, ref: c.code } });
  assert.equal(again.body.error, 'promo_used');
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_requests WHERE user_id = $1', [p3.id])).n, 1);
  // a Stars invoice with it is refused too (already used)
  assert.equal((await invoice(p3, 10, c.code)).r.body.error, 'promo_used');
  // another player can still use it
  const other = await app.post('/api/requests/deposit', { user: p4, body: { nick: 'FourthRBX', offer, ref: c.code } });
  assert.deepEqual(other.body.request.promo, { code: c.code, pct: 12, bonus: 0 });
});
