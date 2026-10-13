// Referral codes: made by admins, typed in by players when topping up, counted in the admin panel.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { starsPayload } from '../src/requests.js';
import { levelsOnce } from '../src/referrals.js';

let app;
const owner = { id: 9001, first_name: 'Главный', username: 'boss_ref', language_code: 'ru' };
const admin = { id: 9002, first_name: 'Помощник', username: 'helper_ref', language_code: 'ru' };
const p1 = { id: 9101, first_name: 'Первый', language_code: 'ru' };
const p2 = { id: 9102, first_name: 'Второй', username: 'second', language_code: 'ru' };
const p3 = { id: 9103, first_name: 'Третий', language_code: 'ru' };
const p4 = { id: 9104, first_name: 'Четвёртый', language_code: 'ru' };
const nowSec = () => Math.floor(Date.now() / 1000);
const item = (name) => [...app.ctx.game.catalog.items.values()].find((i) => i.name === name);

before(async () => {
  app = await startApp({ dbName: 'bs_t_ref', env: { OWNER_USERNAMES: 'boss_ref' } });
  for (const u of [owner, admin, p1, p2, p3, p4]) await app.post('/api/bootstrap', { user: u });
  await app.makeAdmin(admin.id);
});
after(async () => {
  await app?.close();
});

const list = async (u = admin) => (await app.get('/api/admin/referrals', { user: u })).body;
const codeIn = async (u, code) => (await list(u)).codes.find((c) => c.code === code);
const refOf = async (u) => (await app.get('/api/me', { user: u })).body.me.ref;
const pay = (u, stars, coins, charge) =>
  app.sendUpdate({
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      date: 0,
      chat: { id: u.id, type: 'private' },
      from: { is_bot: false, ...u },
      successful_payment: {
        currency: 'XTR',
        total_amount: stars,
        invoice_payload: starsPayload(u.id, stars, coins, nowSec(), 'abc' + String(charge).replace(/\D/g, '').padStart(9, '0')),
        telegram_payment_charge_id: charge,
        provider_payment_charge_id: '',
      },
    },
  });
/** The admin completes a brainrot deposit: coins and a brainrot. */
async function complete(id, coins, itemName) {
  if (coins) assert.equal((await app.post(`/api/admin/requests/${id}/credit`, { user: owner, body: { amount: coins } })).status, 200);
  if (itemName) assert.equal((await app.post(`/api/admin/requests/${id}/give`, { user: owner, body: { itemId: item(itemName).id } })).status, 200);
  assert.equal((await app.post(`/api/admin/requests/${id}/status`, { user: owner, body: { status: 'done' } })).status, 200);
}

test('admins make codes; a player types one in when topping up and keeps it', async () => {
  const c = await app.post('/api/admin/referrals', { user: admin, body: { code: ' streamer ', note: 'Стример Вася' } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body.codes.map((x) => [x.code, x.note, x.active, x.players]), [['STREAMER', 'Стример Вася', true, 0]]);
  assert.equal((await app.post('/api/admin/referrals', { user: admin, body: { code: 'Streamer' } })).body.error, 'ref_exists');
  for (const bad of ['ab', 'with space?', 'x'.repeat(33), '']) {
    assert.equal((await app.post('/api/admin/referrals', { user: admin, body: { code: bad } })).body.error, 'bad_field', bad);
  }
  assert.equal((await app.post('/api/admin/referrals', { user: admin, body: { code: 'OTHER' } })).status, 200);
  assert.equal(await refOf(p1), null);

  // a wrong code stops the deposit, nothing is created
  const bad = await app.post('/api/requests/deposit', { user: p1, body: { nick: 'FirstRBX', details: 'Cerberus', ref: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_ref');
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_requests WHERE user_id = $1', [p1.id])).n, 0);
  // the right one ties the player (any case, spaces around)
  const dep = await app.post('/api/requests/deposit', { user: p1, body: { nick: 'FirstRBX', details: 'Cerberus', ref: ' streamer' } });
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  assert.equal(dep.body.ref, 'STREAMER');
  assert.equal(await refOf(p1), 'STREAMER');
  // a code typed in later doesn't change it
  const later = await app.post('/api/topup/stars', { user: p1, body: { stars: 10, ref: 'OTHER' } });
  assert.equal(later.status, 200, JSON.stringify(later.body));
  assert.equal(later.body.ref, 'STREAMER');
  // without a code: nothing changes, ref stays null
  const plain = await app.post('/api/topup/stars', { user: p4, body: { stars: 10 } });
  assert.equal(plain.body.ref, null);
  assert.equal(await refOf(p4), null);
  // admins see it on the request and on the player card
  assert.equal((await app.get(`/api/admin/requests/${dep.body.request.id}`, { user: admin })).body.request.user.ref, 'STREAMER');
  assert.equal((await app.get(`/api/admin/users/${p1.id}`, { user: admin })).body.user.ref, 'STREAMER');
});

test('what a code brought: brainrot deposits and Stars payments after the player got the code', async () => {
  // p1: brainrot deposit done with 500 coins + a brainrot
  const dep1 = (await app.ctx.db.one("SELECT id FROM bs_requests WHERE user_id = $1 AND kind = 'deposit'", [p1.id])).id;
  await complete(dep1, 500, 'Tim Cheese');
  // p2: comes with the code through Stars, pays 150
  const inv = await app.post('/api/topup/stars', { user: p2, body: { stars: 150, ref: 'STREAMER' } });
  assert.equal(inv.body.ref, 'STREAMER');
  await pay(p2, 150, 150, 'ref-charge-1');
  // p3: a deposit done before having a code doesn't count
  const dep3 = await app.post('/api/requests/deposit', { user: p3, body: { nick: 'ThirdRBX', details: 'что-то' } });
  await complete(dep3.body.request.id, 1000);
  await app.ctx.db.query("UPDATE bs_requests SET created_at = now() - interval '1 minute' WHERE id = $1", [dep3.body.request.id]);
  assert.equal((await app.post('/api/topup/stars', { user: p3, body: { stars: 5, ref: 'streamer' } })).body.ref, 'STREAMER');
  // someone without a code: not counted anywhere
  await pay(p4, 40, 40, 'ref-charge-2');

  const value = 500 + item('Tim Cheese').value;
  const s = await codeIn(owner, 'STREAMER');
  assert.deepEqual(
    { players: s.players, deposits: s.deposits, depositValue: s.depositValue, starsPayments: s.starsPayments, stars: s.stars, starsCoins: s.starsCoins },
    { players: 3, deposits: 1, depositValue: value, starsPayments: 1, stars: 150, starsCoins: 150 },
  );
  assert.equal((await list(owner)).stars, true);
  const other = await codeIn(owner, 'OTHER');
  assert.equal(other.players, 0);
  // one code: totals and each player
  const d = (await app.get('/api/admin/referrals/streamer', { user: admin })).body;
  assert.equal(d.code.code, 'STREAMER');
  assert.equal(d.code.depositValue, value);
  assert.deepEqual(
    d.players.map((p) => [p.id, p.deposits, p.depositValue, p.stars]).sort((a, b) => a[0] - b[0]),
    [
      [p1.id, 1, value, 0],
      [p2.id, 0, 0, 150],
      [p3.id, 0, 0, 0],
    ],
  );
  assert.equal(d.players.find((p) => p.id === p2.id).username, 'second');
  assert.equal((await app.get('/api/admin/referrals/NOPE', { user: admin })).status, 404);
});

test('the main admin can stop counting Stars for codes; others neither see nor change it', async () => {
  const sAdmin = (await app.get('/api/admin/settings', { user: admin })).body.settings;
  assert.ok(!('ref_count_stars' in sAdmin));
  await app.put('/api/admin/settings', { user: admin, body: { ref_count_stars: false } });
  assert.equal(app.ctx.settings.get('ref_count_stars'), true, 'ignored from a regular admin');
  assert.equal((await app.get('/api/admin/settings', { user: owner })).body.settings.ref_count_stars, true);
  const off = await app.put('/api/admin/settings', { user: owner, body: { ref_count_stars: false } });
  assert.equal(off.status, 200);
  for (const u of [owner, admin]) {
    const l = await list(u);
    assert.equal(l.stars, false);
    const s = l.codes.find((c) => c.code === 'STREAMER');
    assert.ok(!('stars' in s) && !('starsPayments' in s) && !('starsCoins' in s));
    assert.equal(s.deposits, 1, 'brainrot deposits still count');
    const d = (await app.get('/api/admin/referrals/STREAMER', { user: u })).body;
    assert.equal(d.stars, false);
    assert.ok(d.players.every((p) => !('stars' in p)));
  }
  await app.put('/api/admin/settings', { user: owner, body: { ref_count_stars: true } });
  assert.equal((await codeIn(admin, 'STREAMER')).stars, 150);
  // a regular admin who doesn't see Stars payments doesn't see them here either
  await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: ['deposits_stars'] } });
  assert.equal((await list(admin)).stars, false);
  assert.equal((await list(owner)).stars, true);
  // ... and with the section switched off, not the codes at all
  await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: ['referrals'] } });
  assert.equal((await app.get('/api/admin/referrals', { user: admin })).status, 403);
  assert.equal((await app.post('/api/admin/referrals', { user: admin, body: { code: 'SNEAKY' } })).status, 403);
  assert.equal((await app.get('/api/admin/referrals', { user: owner })).status, 200);
  await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: [] } });
});

test('switched-off codes can\'t be typed in any more; a deleted code lets its players go', async () => {
  const off = await app.put('/api/admin/referrals/other', { user: admin, body: { active: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.codes.find((c) => c.code === 'OTHER').active, false);
  const r = await app.post('/api/topup/stars', { user: p4, body: { stars: 5, ref: 'OTHER' } });
  assert.equal(r.body.error, 'bad_ref');
  assert.equal(await refOf(p4), null);
  assert.equal((await app.put('/api/admin/referrals/other', { user: admin, body: { note: 'Партнёр' } })).body.codes.find((c) => c.code === 'OTHER').note, 'Партнёр');
  assert.equal((await app.put('/api/admin/referrals/other', { user: admin, body: { active: 'yes' } })).body.error, 'bad_field');
  assert.equal((await app.put('/api/admin/referrals/nope', { user: admin, body: { active: true } })).status, 404);
  const del = await app.del('/api/admin/referrals/STREAMER', { user: admin });
  assert.equal(del.status, 200);
  assert.deepEqual(del.body.codes.map((c) => c.code), ['OTHER']);
  assert.equal(await refOf(p1), null);
  assert.equal((await app.del('/api/admin/referrals/STREAMER', { user: admin })).status, 404);
});

test('a code can give +% coins on top-ups; only the main admin sets the percent', async () => {
  const b1 = { id: 9201, first_name: 'Бонусный', language_code: 'ru' };
  const b2 = { id: 9202, first_name: 'Второй', language_code: 'ru' };
  const b3 = { id: 9203, first_name: 'Третий', language_code: 'ru' };
  for (const u of [b1, b2, b3]) await app.post('/api/bootstrap', { user: u });
  const bal = async (u) => (await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [u.id])).balance;
  const logOf = (u) => app.ctx.db.many("SELECT delta, reason FROM bs_balance_log WHERE user_id = $1 ORDER BY id", [u.id]);

  // main admin makes a code worth +15%
  const c = await app.post('/api/admin/referrals', { user: owner, body: { code: 'BONUS15', note: 'Стример', bonusPct: 15 } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.canBonus, true);
  assert.equal(c.body.codes.find((x) => x.code === 'BONUS15').bonusPct, 15);
  // a regular admin neither sees nor sets the percent
  const seen = await list(admin);
  assert.equal(seen.canBonus, false);
  assert.ok(!('bonusPct' in seen.codes.find((x) => x.code === 'BONUS15')));
  assert.equal((await app.put('/api/admin/referrals/BONUS15', { user: admin, body: { bonusPct: 99 } })).status, 400); // nothing to change → bad_request after stripping
  assert.equal((await codeIn(owner, 'BONUS15')).bonusPct, 15, 'regular admin did not change it');
  // a regular admin creating a code can't set a percent: the code goes by the levels
  await app.post('/api/admin/referrals', { user: admin, body: { code: 'PLAIN', bonusPct: 50 } });
  assert.equal((await codeIn(owner, 'PLAIN')).bonusPct, null);
  assert.equal((await codeIn(owner, 'PLAIN')).pct, 10, 'level 1');

  // Stars: pays 100, gets 115 (100 + 15%)
  const inv = await app.post('/api/topup/stars', { user: b1, body: { stars: 100, ref: 'bonus15' } });
  assert.equal(inv.body.ref, 'BONUS15');
  const before = await bal(b1);
  await pay(b1, 100, 100, 'bonus-charge-1');
  assert.equal(await bal(b1), before + 115);
  const inInv = (await app.ctx.db.one("SELECT id FROM bs_requests WHERE user_id = $1 AND method = 'stars' ORDER BY id DESC LIMIT 1", [b1.id])).id;
  assert.deepEqual((await logOf(b1)).map((l) => [Number(l.delta), l.reason]), [[100, `stars:#${inInv}`], [15, `refbonus:#${inInv}`]]);
  // the deposit keeps the purchased coins (100), the bonus is tracked separately (15)
  assert.deepEqual(await app.ctx.db.one('SELECT coins, bonus FROM bs_requests WHERE id = $1', [inInv]), { coins: 100, bonus: 15 });

  // brainrot deposit: admin credits 200 → player gets 230
  const dep = await app.post('/api/requests/deposit', { user: b2, body: { nick: 'B2RBX', details: 'что-то', ref: 'BONUS15' } });
  assert.equal(dep.body.ref, 'BONUS15');
  const depId = dep.body.request.id;
  const b2before = await bal(b2);
  assert.equal((await app.post(`/api/admin/requests/${depId}/credit`, { user: owner, body: { amount: 200 } })).status, 200);
  assert.equal(await bal(b2), b2before + 230);
  assert.deepEqual(await app.ctx.db.one('SELECT coins, bonus FROM bs_requests WHERE id = $1', [depId]), { coins: 200, bonus: 30 });

  // a 0% code (set by the main admin) gives no bonus; and a code switched off after binding stops the bonus
  await app.post('/api/admin/referrals', { user: owner, body: { code: 'ZERO', bonusPct: 0 } });
  await app.post('/api/topup/stars', { user: b3, body: { stars: 50, ref: 'ZERO' } });
  const z0 = await bal(b3);
  await pay(b3, 50, 50, 'zero-charge-1');
  assert.equal(await bal(b3), z0 + 50, 'no bonus at 0%');
  // raise BONUS15 to 20%, then switch it off: a bound player gets nothing while it is off
  assert.equal((await app.put('/api/admin/referrals/BONUS15', { user: owner, body: { bonusPct: 20 } })).body.codes.find((x) => x.code === 'BONUS15').bonusPct, 20);
  await app.put('/api/admin/referrals/BONUS15', { user: owner, body: { active: false } });
  const b1b = await bal(b1);
  await pay(b1, 100, 100, 'bonus-charge-2');
  assert.equal(await bal(b1), b1b + 100, 'inactive code pays no bonus');
  await app.put('/api/admin/referrals/BONUS15', { user: owner, body: { active: true } });

  // validation
  for (const bad of [-1, 501, 'x']) {
    assert.equal((await app.put('/api/admin/referrals/BONUS15', { user: owner, body: { bonusPct: bad } })).body.error, 'bad_field', String(bad));
  }
});

const LEVELS = [
  { from: 0, pct: 10 },
  { from: 2, pct: 25.5 },
  { from: 3, pct: 35 },
];
const bal = async (u) => Number((await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [u.id])).balance);
/** The player gets the code on a Stars invoice, then pays; returns how many coins came in. */
async function payWith(u, code, stars, charge) {
  if (code) assert.equal((await app.post('/api/topup/stars', { user: u, body: { stars, ref: code } })).body.ref, code);
  const b = await bal(u);
  await pay(u, stars, stars, charge);
  return (await bal(u)) - b;
}

test('levels: the more of a code\'s players have topped up, the bigger their bonus; only the main admin sets the levels', async () => {
  // the default levels; only the main admin sees and changes them
  assert.deepEqual(app.ctx.settings.get('ref_levels'), [
    { from: 0, pct: 10 },
    { from: 50, pct: 25 },
    { from: 150, pct: 35 },
  ]);
  assert.ok(!('ref_levels' in (await app.get('/api/admin/settings', { user: admin })).body.settings));
  assert.equal((await app.get('/api/admin/settings', { user: owner })).body.settings.ref_levels.length, 3);
  await app.put('/api/admin/settings', { user: admin, body: { ref_levels: [{ from: 0, pct: 99 }] } });
  assert.equal(app.ctx.settings.get('ref_levels')[0].pct, 10, 'ignored from a regular admin');
  const bads = [[], 'x', [{ from: 1, pct: 10 }], [{ from: 0, pct: 10 }, { from: 0, pct: 20 }], [{ from: 0, pct: 10 }, { from: 5, pct: 20 }, { from: 4, pct: 30 }], [{ from: 0, pct: 501 }], [{ from: 0, pct: -1 }], [{ from: 0.5, pct: 1 }], [{ from: 0 }], [null], Array.from({ length: 11 }, (_, i) => ({ from: i, pct: i }))];
  for (const bad of bads) {
    const r = await app.put('/api/admin/settings', { user: owner, body: { ref_levels: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'bad_setting');
    assert.equal(r.body.key, 'ref_levels');
  }
  // numbers typed in a form come as strings, a comma works as the decimal point
  const set = await app.put('/api/admin/settings', { user: owner, body: { ref_levels: [{ from: '0', pct: '10' }, { from: 2, pct: '25,5' }, { from: 3, pct: 35 }] } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.settings.ref_levels, LEVELS);
  assert.deepEqual((await list(owner)).levels, LEVELS.map((l, i) => ({ n: i + 1, ...l })));
  assert.ok(!('levels' in (await list(admin))), 'regular admins don\'t get the levels');

  // a code without its own % goes by the levels
  assert.equal((await app.post('/api/admin/referrals', { user: owner, body: { code: 'LVL', note: 'Уровни' } })).status, 200);
  const view = async (u = owner) => {
    const c = await codeIn(u, 'LVL');
    return { players: c.players, paying: c.paying, level: c.level, ...(u === owner ? { pct: c.pct, bonusPct: c.bonusPct } : {}) };
  };
  assert.deepEqual(await view(), { players: 0, paying: 0, level: 1, pct: 10, bonusPct: null });

  const L = [1, 2, 3, 4, 5].map((i) => ({ id: 9300 + i, first_name: 'Лвл' + i, language_code: 'ru' }));
  for (const u of L) await app.post('/api/bootstrap', { user: u });
  // level 1 (nobody topped up yet): +10%
  assert.equal(await payWith(L[0], 'LVL', 100, 'lvl-1'), 110);
  assert.deepEqual(await view(), { players: 1, paying: 1, level: 1, pct: 10, bonusPct: null });
  // a brainrot deposit: the bonus by the level before it (1 player topped up → still level 1)
  const dep = await app.post('/api/requests/deposit', { user: L[1], body: { nick: 'L2RBX', details: 'что-то', ref: 'lvl' } });
  const b2 = await bal(L[1]);
  await complete(dep.body.request.id, 100);
  assert.equal((await bal(L[1])) - b2, 110);
  // done: 2 players topped up → level 2
  assert.deepEqual(await view(), { players: 2, paying: 2, level: 2, pct: 25.5, bonusPct: null });
  assert.equal(await payWith(L[2], 'LVL', 200, 'lvl-2'), 200 + 51, '+25.5% (rounded down)');
  // 3 players → level 3 for everyone of the code, also for those who came earlier
  assert.deepEqual(await view(), { players: 3, paying: 3, level: 3, pct: 35, bonusPct: null });
  assert.equal(await payWith(L[0], null, 100, 'lvl-3'), 135);
  // came with the code but didn't pay / a deposit closed without coins or brainrots: not counted
  assert.equal((await app.post('/api/topup/stars', { user: L[3], body: { stars: 10, ref: 'LVL' } })).body.ref, 'LVL');
  const empty = await app.post('/api/requests/deposit', { user: L[4], body: { nick: 'L5RBX', details: 'ничего', ref: 'LVL' } });
  await complete(empty.body.request.id, 0);
  assert.deepEqual(await view(), { players: 5, paying: 3, level: 3, pct: 35, bonusPct: null });
  assert.deepEqual(await view(admin), { players: 5, paying: 3, level: 3 }, 'regular admins see the level, not the %');

  // the main admin's own % for the code wins over the level; empty = by level again
  assert.equal((await app.put('/api/admin/referrals/LVL', { user: owner, body: { bonusPct: 5 } })).status, 200);
  assert.deepEqual(await view(), { players: 5, paying: 3, level: 3, pct: 5, bonusPct: 5 });
  assert.equal(await payWith(L[2], null, 100, 'lvl-4'), 105);
  assert.equal((await app.put('/api/admin/referrals/LVL', { user: owner, body: { bonusPct: '' } })).status, 200);
  assert.deepEqual(await view(), { players: 5, paying: 3, level: 3, pct: 35, bonusPct: null });
  assert.equal(await payWith(L[2], null, 100, 'lvl-5'), 135);

  // Stars payments not counted for codes: only brainrot deposits make the level
  await app.put('/api/admin/settings', { user: owner, body: { ref_count_stars: false } });
  assert.deepEqual(await view(), { players: 5, paying: 1, level: 1, pct: 10, bonusPct: null });
  assert.equal(await payWith(L[2], null, 100, 'lvl-6'), 110);
  await app.put('/api/admin/settings', { user: owner, body: { ref_count_stars: true } });
  assert.equal((await view()).paying, 3);

  // one code: who topped up
  const d = (await app.get('/api/admin/referrals/LVL', { user: owner })).body;
  assert.deepEqual(d.levels, (await list(owner)).levels);
  assert.deepEqual(
    d.players.map((p) => [p.id, p.paid]).sort((a, b) => a[0] - b[0]),
    L.map((u, i) => [u.id, i < 3]),
  );
  assert.equal(d.code.stats.paying, 3);
  assert.equal(d.code.level, 3);
  assert.ok(!('levels' in (await app.get('/api/admin/referrals/LVL', { user: admin })).body));
});

test('a partner sees their codes in the app: level, players and what they did; admins link the partner', async () => {
  const pp = { id: 9401, first_name: 'Партнёр', username: 'partner_pp', language_code: 'ru' };
  const s1 = { id: 9411, first_name: 'Стат1', username: 'stat_one', language_code: 'ru' };
  const s2 = { id: 9412, first_name: 'Стат2', language_code: 'ru' };
  for (const u of [s1, s2]) await app.post('/api/bootstrap', { user: u });
  assert.equal((await app.post('/api/bootstrap', { user: pp })).body.partner, false);
  assert.deepEqual((await app.get('/api/referrals/mine', { user: pp })).body, { codes: [] });

  // the partner must have opened the bot: by @username (any case) or Telegram ID
  for (const who of ['@nobody_here', '777777', 'not a name!']) {
    assert.equal((await app.put('/api/admin/referrals/LVL', { user: admin, body: { owner: who } })).body.error, 'partner_not_found', who);
  }
  const linked = await app.put('/api/admin/referrals/LVL', { user: admin, body: { owner: '@Partner_PP' } });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.deepEqual(linked.body.codes.find((c) => c.code === 'LVL').owner, { id: pp.id, name: 'Партнёр', username: 'partner_pp' });
  const made = await app.post('/api/admin/referrals', { user: owner, body: { code: 'STATS', owner: String(pp.id) } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.codes.find((c) => c.code === 'STATS').owner.id, pp.id);
  assert.equal((await app.post('/api/admin/referrals', { user: owner, body: { code: 'STATS2', owner: '@nobody_here' } })).body.error, 'partner_not_found');
  assert.equal(await codeIn(owner, 'STATS2'), undefined, 'not created');
  assert.equal((await app.post('/api/bootstrap', { user: pp })).body.partner, true);
  assert.equal((await app.get('/api/me', { user: pp })).body.partner, true);
  assert.equal((await app.get('/api/me', { user: s1 })).body.partner, false);

  // what the players of STATS do
  const paid = [...app.ctx.game.catalog.cases.values()].find((c) => c.enabled && c.price > 0 && !c.is_free && !c.is_nick && !c.is_share);
  assert.equal(await payWith(s1, 'STATS', 300, 'stats-1'), 330, 'level 1: +10%');
  await app.ctx.db.query('UPDATE bs_users SET balance = 1000000 WHERE id = $1', [s1.id]);
  assert.equal((await app.post(`/api/case/${paid.id}/open`, { user: s1, body: {} })).status, 200);
  assert.equal((await app.post('/api/crash/start', { user: s1, body: { bet: 100 } })).status, 200);
  const anyItem = [...app.ctx.game.catalog.items.values()][0];
  // an older opening without its price (counted at the case price) and one from before the code (not counted)
  await app.ctx.db.query("INSERT INTO bs_drops (user_id, item_id, value, case_id, kind) VALUES ($1, $2, 1, $3, 'case')", [s1.id, anyItem.id, paid.id]);
  await app.ctx.db.query("INSERT INTO bs_drops (user_id, item_id, value, case_id, kind, price, created_at) VALUES ($1, $2, 1, $3, 'case', 999999, now() - interval '1 day')", [s1.id, anyItem.id, paid.id]);
  // s2: a brainrot deposit (coins + a brainrot), an upgrade and withdrawals (done counts, rejected doesn't)
  const dep = await app.post('/api/requests/deposit', { user: s2, body: { nick: 'S2RBX', details: 'что-то', ref: 'STATS' } });
  const b2 = await bal(s2);
  await complete(dep.body.request.id, 50, 'Tim Cheese');
  assert.equal((await bal(s2)) - b2, 55, 'level 1 before this deposit: +10%');
  await app.ctx.db.query('INSERT INTO bs_upgrades (user_id, bet_value, target_item_id, chance, roll, won) VALUES ($1, 70, $2, 10, 50, false)', [s2.id, anyItem.id]);
  await app.ctx.db.query("INSERT INTO bs_requests (user_id, kind, status, total) VALUES ($1, 'withdraw', 'done', 40), ($1, 'withdraw', 'rejected', 1000)", [s2.id]);

  const stats = { players: 2, paying: 2, deposits: 300 + 50 + item('Tim Cheese').value, withdrawals: 40, bets: paid.price * 2 + 100 + 70, bonus: 30 + 5 };
  const mine = (await app.get('/api/referrals/mine', { user: pp })).body;
  assert.deepEqual(mine.codes.map((c) => c.code), ['LVL', 'STATS']);
  const m = mine.codes[1];
  assert.deepEqual(
    { active: m.active, pct: m.pct, own: m.own, level: m.level, next: m.next, stats: m.stats },
    { active: true, pct: 25.5, own: false, level: { n: 2, from: 2, pct: 25.5 }, next: { n: 3, from: 3, pct: 35 }, stats },
  );
  assert.deepEqual(m.levels, LEVELS.map((l, i) => ({ n: i + 1, ...l })));
  // the players: public names only, newest first
  assert.deepEqual(m.players.map((p) => [p.name, p.paid]), [['Стат2', true], ['Стат1', true]]);
  assert.ok(m.players.every((p) => Object.keys(p).sort().join() === 'at,name,paid'), 'no ids or usernames');
  assert.deepEqual({ level: mine.codes[0].level.n, next: mine.codes[0].next, players: mine.codes[0].stats.players }, { level: 3, next: null, players: 5 });
  // the code's own % shows as such
  await app.put('/api/admin/referrals/STATS', { user: owner, body: { bonusPct: 12.5 } });
  const own = (await app.get('/api/referrals/mine', { user: pp })).body.codes[1];
  assert.deepEqual({ pct: own.pct, own: own.own, level: own.level.n }, { pct: 12.5, own: true, level: 2 });
  await app.put('/api/admin/referrals/STATS', { user: owner, body: { bonusPct: null } });

  // the admin panel shows the same numbers
  assert.deepEqual((await app.get('/api/admin/referrals/STATS', { user: owner })).body.code.stats, stats);
  // a regular admin who doesn't see Stars payments: the deposits without them
  await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: ['deposits_stars'] } });
  assert.equal((await app.get('/api/admin/referrals/STATS', { user: admin })).body.code.stats.deposits, 50 + item('Tim Cheese').value);
  await app.put('/api/admin/settings', { user: owner, body: { admin_hidden: [] } });

  // other players get nothing; unlinking takes the screen away
  assert.deepEqual((await app.get('/api/referrals/mine', { user: s1 })).body, { codes: [] });
  for (const code of ['LVL', 'STATS']) assert.equal((await app.put(`/api/admin/referrals/${code}`, { user: admin, body: { owner: '' } })).status, 200);
  assert.equal((await codeIn(owner, 'STATS')).owner, null);
  assert.equal((await app.get('/api/me', { user: pp })).body.partner, false);
  assert.deepEqual((await app.get('/api/referrals/mine', { user: pp })).body, { codes: [] });
  assert.equal((await app.get('/api/referrals/mine')).status, 401);
});

test('levels come in once: codes that gave 0 % go by the levels, codes with a bonus keep theirs', async () => {
  assert.equal(app.ctx.settings.get('_ref_levels_1'), true, 'done at start');
  await app.ctx.db.query("INSERT INTO bs_ref_codes (code, bonus_pct) VALUES ('OLDZERO', 0), ('OLDSEVEN', 7)");
  await app.ctx.settings.setInternal('_ref_levels_1', false);
  const zeros = (await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_ref_codes WHERE bonus_pct = 0')).n;
  assert.ok(zeros >= 2, 'OLDZERO and ZERO');
  assert.equal(await levelsOnce(app.ctx.db, app.ctx.settings), zeros);
  assert.equal((await codeIn(owner, 'OLDZERO')).bonusPct, null);
  assert.equal((await codeIn(owner, 'OLDSEVEN')).bonusPct, 7);
  // only once: a 0 % the main admin sets later stays
  await app.put('/api/admin/referrals/OLDZERO', { user: owner, body: { bonusPct: 0 } });
  assert.equal(await levelsOnce(app.ctx.db, app.ctx.settings), 0);
  assert.equal((await codeIn(owner, 'OLDZERO')).bonusPct, 0);
  assert.equal((await codeIn(owner, 'OLDZERO')).pct, 0);
});
