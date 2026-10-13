// Rocket (crash): the explosion point is drawn at the start, the server clock decides cash-outs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, scriptedRng } from './helpers.js';
import { crashPoint, crashMultAt, crashTimeOf, CRASH_SPEED } from '../src/crash.js';

const rng = scriptedRng();
const clock = { offset: 0 }; // server time = real time + offset
let app;
let pilot;
let nextId = 8001;
/** A new player for each test (actions are rate limited per player). */
async function fresh(bal = 1000) {
  pilot = { id: nextId++, first_name: 'Пилот', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: pilot });
  await app.setBalance(pilot.id, bal);
}
/** rng value that makes the rocket explode exactly at `x` (default edge 20%, the live setting) */
const at = (x, edge = 20) => (max) => Math.floor((1 - (100 - edge) / (100 * x + 0.5)) * max);
const balance = async () => (await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [pilot.id])).balance;
const row = (id) => app.ctx.db.one('SELECT status, crash_point, cash_mult, win FROM bs_crash WHERE id = $1', [id]);
const start = (bet, x) => {
  if (x !== undefined) rng.queue.push(typeof x === 'function' ? x : at(x));
  return app.post('/api/crash/start', { user: pilot, body: { bet } });
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  app = await startApp({ dbName: 'bs_t_crash', rng, now: () => Date.now() + clock.offset });
});
after(async () => {
  await app?.close();
});

test('math: P(reaching x) = (1 − edge) / x, the multiplier grows the same everywhere', () => {
  assert.equal(crashPoint(0, 5, 1000), 1, 'instant explosion');
  assert.equal(crashPoint(0.05, 5, 1000), 1);
  assert.equal(crashPoint(0.5, 5, 1000), 1.9);
  assert.equal(crashPoint(0.999999, 5, 1000), 1000, 'never above the max');
  const N = 200_000;
  let two = 0;
  let ten = 0;
  for (let i = 0; i < N; i++) {
    const p = crashPoint(i / N, 5, 1000);
    if (p >= 2) two++;
    if (p >= 10) ten++;
  }
  assert.ok(Math.abs(two / N - 0.475) < 0.001, `reaches 2x: ${two / N}`);
  assert.ok(Math.abs(ten / N - 0.095) < 0.001, `reaches 10x: ${ten / N}`);
  assert.equal(crashMultAt(0), 1);
  for (const x of [1.5, 2, 3.33, 10, 100, 1000]) {
    assert.equal(crashMultAt(crashTimeOf(x)), x, `${x}x is reached right at its time`);
    assert.ok(crashMultAt(crashTimeOf(x) - 5) < x);
  }
  assert.equal(CRASH_SPEED, 0.00008);
  assert.equal(crashMultAt(5000), 1.49);
});

test('the app gets the limits; bets are checked', async () => {
  await fresh();
  const b = (await app.post('/api/bootstrap', { user: pilot })).body;
  assert.deepEqual(b.crash, { minBet: 100, maxBet: 100000, maxMult: 1000, speed: 0.00008 });
  assert.deepEqual((await app.get('/api/catalog', { user: pilot })).body.crash, b.crash);
  for (const bet of [0, -5, 1.5, 'x', null, 100001]) {
    const r = await start(bet);
    assert.equal(r.status, 400, String(bet));
    assert.deepEqual(r.body, { error: 'bad_bet', min: 100, max: 100000 });
  }
  const poor = await start(1001);
  assert.equal(poor.body.error, 'not_enough');
  assert.equal(await balance(), 1000, 'nothing taken');
});

test('a cash-out pays bet × multiplier by the server clock; one rocket at a time', async () => {
  await fresh();
  const r = await start(100, 3);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.balance, 900);
  const { id } = r.body.round;
  assert.deepEqual({ ...r.body.round, elapsed: 0 }, { id, bet: 100, kind: 'coins', status: 'flying', elapsed: 0 });
  assert.ok(r.body.round.elapsed < 1000);
  assert.ok(!('crashPoint' in r.body.round), 'the explosion point stays secret while it flies');
  assert.equal((await row(id)).crash_point, 3);
  // a second rocket can't start, the app gets the one in the air
  const again = await start(10);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'crash_active');
  assert.equal(again.body.round.id, id);
  assert.equal(await balance(), 900);
  // after a reload the app finds it
  clock.offset += 1000;
  const act = (await app.get('/api/crash/active', { user: pilot })).body.round;
  assert.equal(act.id, id);
  assert.ok(act.elapsed >= 1000 && act.elapsed < 2000, String(act.elapsed));
  // 5.02 s of flight: e^(0.4016) = 1.494 -> 1.49x, 149 coins
  clock.offset += 4020;
  const c = await app.post(`/api/crash/${id}/cashout`, { user: pilot });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body, { round: { id, bet: 100, kind: 'coins', status: 'cashed', mult: 1.49, win: 149 }, balance: 1049 });
  assert.equal((await app.get('/api/crash/active', { user: pilot })).body.round, null);
  // a second click doesn't pay again
  const twice = await app.post(`/api/crash/${id}/cashout`, { user: pilot });
  assert.deepEqual(twice.body, c.body);
  assert.equal(await balance(), 1049);
  const log = await app.ctx.db.many("SELECT delta FROM bs_balance_log WHERE user_id = $1 AND reason = $2 ORDER BY id", [pilot.id, `crash:#${id}`]);
  assert.deepEqual(log.map((l) => Number(l.delta)), [-100, 149]);
  // someone else's rocket
  const other = { id: 8999, first_name: 'Чужой', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: other });
  assert.equal((await app.post(`/api/crash/${id}/cashout`, { user: other })).status, 404);
});

test('too late: the rocket exploded before the cash-out arrived', async () => {
  await fresh();
  const r = await start(100, 1.5); // explodes after 5068 ms
  const { id } = r.body.round;
  clock.offset += 6000;
  const c = await app.post(`/api/crash/${id}/cashout`, { user: pilot });
  assert.deepEqual(c.body, { round: { id, bet: 100, kind: 'coins', status: 'crashed', crashPoint: 1.5 }, balance: 900 });
  assert.equal((await row(id)).status, 'crashed');
});

test('instant explosion at 1.00x; the long poll answers when the rocket explodes', async () => {
  await fresh();
  const r = await start(100, () => 0);
  const { id } = r.body.round;
  const w = await app.post(`/api/crash/${id}/wait`, { user: pilot });
  assert.deepEqual(w.body, { round: { id, bet: 100, kind: 'coins', status: 'crashed', crashPoint: 1 } });
  assert.equal(await balance(), 900);
  // 2x explodes after 8664 ms: jump to 400 ms before it, the answer comes ~400 ms later
  const r2 = await start(100, 2);
  clock.offset += crashTimeOf(2) - 400;
  const t0 = Date.now();
  const w2 = await app.post(`/api/crash/${r2.body.round.id}/wait`, { user: pilot });
  const took = Date.now() - t0;
  assert.equal(w2.body.round.status, 'crashed');
  assert.equal(w2.body.round.crashPoint, 2);
  assert.ok(took >= 300 && took < 2000, `answered after ${took} ms`);
});

test('a rocket nobody cashed out doesn\'t block the next one; the max multiplier caps it', async () => {
  await fresh();
  const r = await start(100, 1.2);
  clock.offset += 10_000; // exploded long ago, no request since
  const next = await start(100, () => 999_999_999);
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal((await row(r.body.round.id)).status, 'crashed');
  assert.equal((await row(next.body.round.id)).crash_point, 1000, 'capped by the max multiplier');
  clock.offset += crashTimeOf(1000) + 10;
  assert.equal((await app.post(`/api/crash/${next.body.round.id}/cashout`, { user: pilot })).body.round.status, 'crashed');
  await wait(1);
});

test('settings: edge, bets and the max change the game; the max bet can\'t be below the min', async () => {
  await fresh();
  await app.ctx.settings.update({ crash_edge: 50, crash_min_bet: 5, crash_max_bet: 20, crash_max_mult: 3 });
  assert.deepEqual((await app.get('/api/catalog', { user: pilot })).body.crash, { minBet: 5, maxBet: 20, maxMult: 3, speed: 0.00008 });
  assert.deepEqual((await start(4)).body, { error: 'bad_bet', min: 5, max: 20 });
  const r = await start(5, () => 600_000_000); // 50 / 0.4 = 125 -> 1.25x
  assert.equal((await row(r.body.round.id)).crash_point, 1.25);
  clock.offset += 60_000;
  await assert.rejects(app.ctx.settings.update({ crash_min_bet: 30 }), /crash_min_bet/);
  await app.ctx.settings.update({ crash_edge: 20, crash_min_bet: 100, crash_max_bet: 100000, crash_max_mult: 1000 });
});

test('a cash-out answers a waiting long poll right away', async () => {
  await fresh();
  const r = await start(100, 50);
  const { id } = r.body.round;
  const t0 = Date.now();
  const pending = app.post(`/api/crash/${id}/wait`, { user: pilot });
  await wait(150);
  const c = await app.post(`/api/crash/${id}/cashout`, { user: pilot });
  assert.equal(c.body.round.status, 'cashed');
  const w = await pending;
  assert.equal(w.body.round.status, 'cashed');
  assert.equal(w.body.round.win, c.body.round.win);
  assert.ok(Date.now() - t0 < 3000, 'not after the 20 s timeout');
});

test('rocket with brainrots: stake brainrots, a cash-out pays a brainrot + the rest in coins', async () => {
  await fresh(0);
  const items = [...app.ctx.game.catalog.items.values()];
  const itm = (n) => items.find((i) => i.name === n);
  const give = async (name) =>
    (await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [pilot.id, itm(name).id])).id;
  const startItems = (ids, x) => {
    if (x !== undefined) rng.queue.push(typeof x === 'function' ? x : at(x));
    return app.post('/api/crash/start', { user: pilot, body: { ids } });
  };
  const spooky = itm('Spooky and Pumpky'); // 200
  const inv = await give('Spooky and Pumpky');
  const r = await startItems([inv], 100); // explodes way above 2x
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.round.kind, 'brainrots');
  assert.equal(r.body.round.bet, spooky.value);
  assert.deepEqual(r.body.round.betItems.map((e) => e.itemId), [spooky.id]);
  assert.equal(r.body.balance, 0, 'no coins spent, the brainrot is the bet');
  assert.ok(!('crashPoint' in r.body.round));
  assert.equal((await app.get('/api/inventory', { user: pilot })).body.inventory.length, 0, 'staked brainrot is taken');

  clock.offset += crashTimeOf(2) + 5; // 2.00x
  const c = await app.post(`/api/crash/${r.body.round.id}/cashout`, { user: pilot });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.round.status, 'cashed');
  assert.equal(c.body.round.mult, 2);
  const win = Math.floor(spooky.value * 2); // 400
  assert.equal(c.body.round.win, win);
  const best = items.filter((i) => i.enabled && i.value <= win).sort((a, b) => b.value - a.value)[0];
  assert.equal(c.body.round.item.itemId, best.id, 'the most valuable brainrot that fits the win');
  assert.equal(c.body.round.coins, win - best.value);
  // the player got that brainrot and the remainder in coins
  const inv2 = (await app.get('/api/inventory', { user: pilot })).body.inventory;
  assert.deepEqual(inv2.map((i) => i.item.id), [best.id]);
  assert.equal(await balance(), win - best.value);
  assert.deepEqual(await app.ctx.db.one('SELECT win_item->>\'itemId\' AS i FROM bs_crash WHERE id = $1', [r.body.round.id]), { i: String(best.id) });
  // the won brainrot shows on the player card as «Ракета»
  const admin = { id: 8701, first_name: 'Админ', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: admin });
  await app.makeAdmin(admin.id);
  const card = (await app.get(`/api/admin/users/${pilot.id}`, { user: admin })).body.inventory;
  assert.equal(card.find((i) => i.item.id === best.id).from.type, 'crash');
});

test('rocket with brainrots: an explosion loses the staked brainrots; checks and one rocket at a time', async () => {
  await fresh(1000);
  const items = [...app.ctx.game.catalog.items.values()];
  const itm = (n) => items.find((i) => i.name === n);
  const give = async (name) =>
    (await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [pilot.id, itm(name).id])).id;
  const startItems = (ids, x) => {
    if (x !== undefined) rng.queue.push(typeof x === 'function' ? x : at(x));
    return app.post('/api/crash/start', { user: pilot, body: { ids } });
  };
  // not owned
  assert.equal((await startItems([999999])).body.error, 'items_missing');
  // value out of range (brainrot worth more than the max bet)
  const inv = await give('Spooky and Pumpky'); // 200
  await app.ctx.settings.update({ crash_min_bet: 1, crash_max_bet: 10 });
  assert.deepEqual((await startItems([inv])).body, { error: 'bad_bet', min: 1, max: 10 });
  assert.equal((await app.get('/api/inventory', { user: pilot })).body.inventory.length, 1, 'nothing taken when refused');
  await app.ctx.settings.update({ crash_min_bet: 100, crash_max_bet: 100000 });
  // explosion at 1.3x: the brainrot is lost
  const r = await startItems([inv], 1.3);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // another rocket can't start while one flies
  const inv2 = await give('Tim Cheese');
  assert.equal((await startItems([inv2])).body.error, 'crash_active');
  assert.equal((await app.post('/api/crash/start', { user: pilot, body: { bet: 10 } })).body.error, 'crash_active');
  clock.offset += crashTimeOf(1.3) + 2000;
  const c = await app.post(`/api/crash/${r.body.round.id}/cashout`, { user: pilot });
  assert.equal(c.body.round.status, 'crashed');
  assert.equal(c.body.round.crashPoint, 1.3);
  assert.deepEqual(
    (await app.get('/api/inventory', { user: pilot })).body.inventory.map((i) => i.invId).sort(),
    [inv2].sort(),
    'the staked brainrot is gone, the unspent one stays',
  );
  assert.equal(await balance(), 1000, 'no coins moved');
});

test('the rocket edge can go up to 90% (the main admin makes wins rarer)', async () => {
  const owner = { id: 8801, first_name: 'Главный', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: owner });
  await app.makeAdmin(owner.id);
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { crash_edge: 90 } })).status, 200);
  assert.equal(app.ctx.settings.get('crash_edge'), 90);
  assert.equal(crashPoint(0.5, 90, 1000), 1); // (100-90)/0.5 = 20 → 0.2x, clamped up to the 1.00x floor
  // at 90% edge reaching 2x happens ~5% of the time
  let two = 0;
  const N = 100000;
  for (let i = 0; i < N; i++) if (crashPoint(i / N, 90, 1000) >= 2) two++;
  assert.ok(Math.abs(two / N - 0.05) < 0.002, `reach 2x at 90% edge: ${two / N}`);
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { crash_edge: 91 } })).body.error, 'bad_setting');
  await app.ctx.settings.update({ crash_edge: 20 });
});
