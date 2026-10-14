// Colour dice: a colour, a stake (coins or brainrots), three fair dice; 1 / 3 dice of the colour pay
// ×2 / ×4, none loses the stake, and so do two dice of one colour (a pair), whatever the colour.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, scriptedRng } from './helpers.js';
import { DICE_COLORS, DICE_PAYS, isPair } from '../src/dice.js';

const rng = scriptedRng();
let app;
const admin = { id: 5101, first_name: 'Админ', username: 'dice_admin', language_code: 'ru' };
const p = { id: 5201, first_name: 'Игрок', language_code: 'ru' };
const q = { id: 5202, first_name: 'Второй', language_code: 'ru' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const C = Object.fromEntries(DICE_COLORS.map((c, i) => [c, i])); // colour -> what the random number must be

before(async () => {
  app = await startApp({ dbName: 'bs_t_dice', rng });
  for (const u of [admin, p, q]) await app.post('/api/bootstrap', { user: u });
  await app.makeAdmin(admin.id);
});
after(async () => {
  await app?.close();
});

const bal = async (u) => Number((await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [u.id])).balance);
const throwDice = (u, body, faces) => {
  if (faces) rng.queue.push(...faces.map((c) => C[c]));
  return app.post('/api/dice/roll', { user: u, body });
};
const item = (name) => [...app.ctx.game.catalog.items.values()].find((i) => i.name === name);
const give = async (u, names) => {
  const ids = [];
  for (const n of names) ids.push(Number((await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [u.id, item(n).id])).id));
  return ids;
};

test('six colours (orange, no pink), ×2 / ×4 for 1 / 3 dice, a pair loses: the game gives back 124 / 216 on average; the app gets the rules', async () => {
  assert.deepEqual(DICE_COLORS, ['red', 'yellow', 'green', 'blue', 'purple', 'orange']);
  // a pair is exactly two dice of one colour: three of a kind and three different are not
  assert.deepEqual([['red', 'red', 'blue'], ['blue', 'red', 'blue'], ['red', 'red', 'red'], ['red', 'blue', 'green']].map(isPair), [true, true, false, false]);
  // every one of the 6³ throws, betting on red: 60 win ×2 (one red, the other two different), 1 wins ×4
  let back = 0;
  let wins = 0;
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
    const m = isPair([a, b, c]) ? 0 : DICE_PAYS[[a, b, c].filter((x) => x === 0).length];
    back += m;
    if (m) wins++;
  }
  assert.deepEqual([back, wins], [124, 61]);
  const boot = (await app.post('/api/bootstrap', { user: p })).body;
  assert.deepEqual(boot.dice, { minBet: 5, maxBet: 100000, colors: DICE_COLORS, pays: [0, 2, 0, 4] });
  assert.deepEqual((await app.get('/api/catalog', { user: p })).body.dice, boot.dice);
});

test('coins: the stake leaves the balance, a win comes back multiplied; every throw is stored and logged', async () => {
  await app.setBalance(p.id, 1000);
  const cases = [
    { color: 'red', bet: 100, faces: ['red', 'blue', 'orange'], matches: 1, mult: 2 },
    { color: 'red', bet: 100, faces: ['red', 'purple', 'red'], matches: 2, mult: 0 }, // a pair of red: lost
    { color: 'red', bet: 100, faces: ['blue', 'red', 'blue'], matches: 1, mult: 0 }, // red came up, but a pair of blue
    { color: 'green', bet: 200, faces: ['green', 'green', 'green'], matches: 3, mult: 4 },
    { color: 'yellow', bet: '150', faces: ['red', 'green', 'blue'], matches: 0, mult: 0 },
  ];
  let expected = 1000;
  for (const k of cases) {
    const r = await throwDice(p, { color: k.color, bet: k.bet }, k.faces);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const bet = Number(k.bet);
    expected += bet * k.mult - bet;
    assert.deepEqual(
      { ...r.body.roll, id: undefined },
      { id: undefined, color: k.color, dice: k.faces, matches: k.matches, mult: k.mult, bet, win: bet * k.mult, kind: 'coins' },
    );
    assert.equal(Number(r.body.balance), expected);
    assert.equal(await bal(p), expected);
    const log = await app.ctx.db.many('SELECT delta FROM bs_balance_log WHERE user_id = $1 AND reason = $2 ORDER BY id', [p.id, `dice:#${r.body.roll.id}`]);
    assert.deepEqual(log.map((l) => Number(l.delta)), k.mult ? [-bet, bet * k.mult] : [-bet]);
  }
  const rows = await app.ctx.db.many('SELECT color, bet, dice, matches, mult, win FROM bs_dice WHERE user_id = $1 ORDER BY id', [p.id]);
  assert.deepEqual(rows.map((r) => [r.color, Number(r.bet), r.dice, r.matches, r.mult, Number(r.win)]), cases.map((k) => [k.color, Number(k.bet), k.faces, k.matches, k.mult, Number(k.bet) * k.mult]));
});

test('refused before anything is taken: wrong colour, stake out of the limits, not enough coins, wrong brainrots', async () => {
  await wait(3100); // player actions are rate limited
  await app.setBalance(q.id, 250);
  const rows = async () => (await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_dice WHERE user_id = $1', [q.id])).n;
  for (const color of [undefined, '', 'black', 'RED', 3]) {
    const r = await throwDice(q, { color, bet: 100 });
    assert.equal(r.status, 400, String(color));
    assert.equal(r.body.error, 'bad_request');
  }
  for (const bet of [4, 0, 100001, 5.5, 'abc', null, -100]) {
    const r = await throwDice(q, { color: 'red', bet });
    assert.equal(r.body.error, 'bad_bet', String(bet));
    assert.deepEqual([r.body.min, r.body.max], [5, 100000]);
  }
  await wait(3100);
  const poor = await throwDice(q, { color: 'red', bet: 300 });
  assert.equal(poor.body.error, 'not_enough');
  assert.equal(await bal(q), 250);
  for (const ids of [[], [1, 1], ['x'], Array.from({ length: 13 }, (_, i) => i + 1)]) assert.equal((await throwDice(q, { color: 'red', ids })).body.error, 'bad_request', JSON.stringify(ids));
  const mine = await give(q, ['Tim Cheese']);
  const others = await give(p, ['Tim Cheese']);
  assert.equal((await throwDice(q, { color: 'red', ids: [mine[0], others[0]] })).body.error, 'items_missing');
  assert.equal(await rows(), 0, 'nothing thrown');
  assert.equal(await bal(q), 250);
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE id = $1', [mine[0]])).n, 1, 'the brainrot stays');
});

test('brainrots: they leave the inventory; a win hands out the best brainrot it covers and the rest as coins', async () => {
  await wait(3100);
  await app.setBalance(q.id, 0);
  const stake = ['Cerberus', 'Tralalero Tralala'];
  const ids = await give(q, stake);
  const value = stake.reduce((s, n) => s + item(n).value, 0);
  assert.ok(value >= 100, `stake ${value}`);
  const r = await throwDice(q, { color: 'blue', ids }, ['blue', 'yellow', 'green']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const win = value * 2;
  const best = [...app.ctx.game.catalog.items.values()].filter((i) => i.enabled && i.value <= win).sort((a, b) => b.value - a.value)[0];
  const roll = r.body.roll;
  assert.deepEqual({ kind: roll.kind, bet: roll.bet, matches: roll.matches, mult: roll.mult, win: roll.win }, { kind: 'brainrots', bet: value, matches: 1, mult: 2, win });
  assert.deepEqual(roll.betItems.map((e) => e.name).sort(), [...stake].sort());
  assert.equal(roll.item.itemId, best.id);
  assert.equal(roll.coins, win - best.value);
  assert.equal(await bal(q), win - best.value, 'the rest as coins');
  // the staked ones are gone, the won one came from the dice
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE id = ANY($1::bigint[])', [ids])).n, 0);
  const got = await app.ctx.db.one("SELECT item_id, ref_id FROM bs_inventory WHERE user_id = $1 AND source = 'dice'", [q.id]);
  assert.deepEqual([got.item_id, Number(got.ref_id)], [best.id, roll.id]);
  // the admin player card says where it came from
  const card = (await app.get(`/api/admin/users/${q.id}`, { user: admin })).body;
  assert.equal(card.inventory.find((i) => i.item.id === best.id).from.type, 'dice');
  // a miss: the brainrots are lost, nothing comes back
  const ids2 = await give(q, ['Cerberus']);
  assert.ok(item('Cerberus').value >= 100);
  const b0 = await bal(q);
  const lost = await throwDice(q, { color: 'orange', ids: ids2 }, ['red', 'red', 'green']);
  assert.deepEqual([lost.body.roll.matches, lost.body.roll.win, lost.body.roll.item, lost.body.roll.coins], [0, 0, null, 0]);
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE id = $1', [ids2[0]])).n, 0);
  assert.equal(await bal(q), b0);
  // too cheap a stake: refused, the brainrot stays
  const cheap = [...app.ctx.game.catalog.items.values()].find((i) => i.enabled && i.value < 5);
  const [cid] = await give(q, [cheap.name]);
  assert.equal((await throwDice(q, { color: 'red', ids: [cid] })).body.error, 'bad_bet');
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE id = $1', [cid])).n, 1);
});

test('the limits are settings (min not above max); referral codes count dice stakes as bets', async () => {
  await wait(3100);
  assert.equal((await app.put('/api/admin/settings', { user: admin, body: { dice_min_bet: 500, dice_max_bet: 400 } })).body.error, 'bad_setting');
  assert.equal((await app.put('/api/admin/settings', { user: admin, body: { dice_min_bet: 10, dice_max_bet: 5000 } })).status, 200);
  assert.deepEqual((await app.get('/api/catalog', { user: q })).body.dice.minBet, 10);
  await app.setBalance(q.id, 1000);
  assert.equal((await throwDice(q, { color: 'red', bet: 10 }, ['blue', 'blue', 'blue'])).status, 200);
  assert.equal((await throwDice(q, { color: 'red', bet: 5001 })).body.error, 'bad_bet');
  await app.put('/api/admin/settings', { user: admin, body: { dice_min_bet: 5, dice_max_bet: 100000 } });
  // a player of a code: their dice stakes are the code's bets
  assert.equal((await app.post('/api/admin/referrals', { user: admin, body: { code: 'DICEREF' } })).status, 200);
  const r = { id: 5301, first_name: 'Реф', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: r });
  assert.equal((await app.post('/api/topup/stars', { user: r, body: { stars: 10, ref: 'diceref' } })).body.ref, 'DICEREF');
  await app.setBalance(r.id, 1000);
  await throwDice(r, { color: 'red', bet: 300 }, ['red', 'blue', 'blue']);
  await throwDice(r, { color: 'red', bet: 200 }, ['blue', 'blue', 'blue']);
  assert.equal((await app.get('/api/admin/referrals/DICEREF', { user: admin })).body.code.stats.bets, 500);
});

test('dice start from 5 coins: the default, and once on a database from the first release (100); later changes stay', async () => {
  const { createSettings, diceFromFiveOnce } = await import('../src/settings.js');
  assert.equal(app.ctx.settings.get('dice_min_bet'), 5);
  assert.equal(app.ctx.settings.get('_dice_min_5'), true, 'done at the first start');
  const restart = async () => {
    const s = createSettings(app.ctx.db);
    await s.load();
    return s;
  };
  // the first release saved 100
  await app.ctx.db.query("DELETE FROM bs_settings WHERE key = '_dice_min_5'");
  await app.ctx.settings.update({ dice_min_bet: 100 });
  let s = await restart();
  assert.equal(await diceFromFiveOnce(s), true);
  assert.equal(s.get('dice_min_bet'), 5);
  assert.equal((await restart()).get('dice_min_bet'), 5, 'saved');
  // the main admin sets it again later: the next starts leave it
  await s.update({ dice_min_bet: 50 });
  s = await restart();
  assert.equal(await diceFromFiveOnce(s), false);
  assert.equal(s.get('dice_min_bet'), 50);
  // a 5-coin throw
  await app.ctx.settings.update({ dice_min_bet: 5 });
  await wait(3100);
  await app.setBalance(q.id, 5);
  const r = await throwDice(q, { color: 'red', bet: 5 }, ['red', 'green', 'blue']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.roll.bet, r.body.roll.win, Number(r.body.balance)], [5, 10, 10]);
});
