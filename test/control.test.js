// The main admin's controls in the admin panel: close a part for every player (cases, upgrader,
// rocket, dice, withdrawals, top-ups) and reset every balance and inventory to zero.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, scriptedRng } from './helpers.js';
import { starsPayload } from '../src/requests.js';

const rng = scriptedRng();
let app;
const boss = { id: 2101, first_name: 'Босс', username: 'boss', language_code: 'ru' }; // the main admin
const helper = { id: 2102, first_name: 'Помощник', username: 'helper', language_code: 'ru' }; // a usual admin
let nextId = 9101;
/** A new player for each step (actions are rate limited per player). */
async function player(balance = 5000) {
  const u = { id: nextId++, first_name: 'Игрок', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: u });
  await app.setBalance(u.id, balance);
  return u;
}
const caseId = (slug) => [...app.ctx.game.catalog.cases.values()].find((c) => c.slug === slug).id;
const setGate = (gate, open, user = boss) => app.put('/api/admin/gates', { user, body: { gate, open } });
const balanceOf = async (id) => Number((await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [id])).balance);
const itemsOf = async (id) => (await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE user_id = $1', [id])).n;
// rng value that makes the rocket explode at `x` (edge 20%)
const at = (x, edge = 20) => (max) => Math.floor((1 - (100 - edge) / (100 * x + 0.5)) * max);

before(async () => {
  app = await startApp({ dbName: 'bs_t_control', env: { OWNER_USERNAMES: 'boss' }, rng });
  await app.post('/api/bootstrap', { user: boss });
  await app.post('/api/bootstrap', { user: helper });
  await app.makeAdmin(helper.id);
});
after(async () => {
  await app?.close();
});

test('only the main admin has the controls; every part is open at first', async () => {
  const o = await app.get('/api/admin/overview', { user: boss });
  assert.equal(o.status, 200);
  assert.deepEqual(o.body.control, {
    maintenance: false,
    gates: { cases: true, upgrade: true, crash: true, dice: true, withdrawals: true, deposits: true },
  });
  const h = await app.get('/api/admin/overview', { user: helper });
  assert.equal(h.status, 200);
  assert.equal(h.body.control, undefined, 'a usual admin has no controls');
  assert.equal((await setGate('cases', false, helper)).status, 403);
  assert.equal((await app.post('/api/admin/reset-economy', { user: helper, body: { confirm: 'RESET' } })).status, 403);
  const p = await player();
  assert.equal((await setGate('cases', false, p)).status, 403);
  // the settings form: hidden from usual admins and not changed through it
  const viaSettings = await app.put('/api/admin/settings', { user: helper, body: { cases_open: false, deposits_open: false } });
  assert.equal(viaSettings.status, 200);
  assert.equal(viaSettings.body.settings.cases_open, undefined);
  assert.equal(app.ctx.settings.get('cases_open'), true);
  assert.equal(app.ctx.settings.get('deposits_open'), true);
  // bad values
  assert.equal((await setGate('casino', false)).body.error, 'bad_field');
  assert.equal((await setGate('cases', 'no')).body.error, 'bad_field');
  // the player app knows what is open
  const b = await app.post('/api/bootstrap', { user: p });
  assert.deepEqual(b.body.modes, { cases: true, upgrade: true, crash: true, dice: true, withdrawals: true });
  assert.equal(b.body.topup.starsOpen, true);
  assert.equal(b.body.topup.brainrotsOpen, true);
});

test('cases closed: no case opens (the free ones neither); open again: they do', async () => {
  const p = await player();
  const r = await setGate('cases', false);
  assert.equal(r.status, 200);
  assert.equal(r.body.gates.cases, false);
  for (const path of [`/api/case/${caseId('noob')}/open`, '/api/free/open', '/api/nick/open', '/api/share/open']) {
    const res = await app.post(path, { user: p });
    assert.equal(res.status, 403, path);
    assert.equal(res.body.error, 'cases_closed', path);
  }
  assert.equal(await balanceOf(p.id), 5000, 'nothing taken');
  assert.equal((await app.get('/api/me', { user: p })).body.modes.cases, false);
  assert.equal((await app.get('/api/catalog', { user: p })).body.modes.cases, false);
  // admins too (the main admin included): a block is for everyone
  assert.equal((await app.post(`/api/case/${caseId('noob')}/open`, { user: boss })).body.error, 'cases_closed');
  await setGate('cases', true);
  const ok = await app.post(`/api/case/${caseId('noob')}/open`, { user: p });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('upgrader, rocket and dice closed: nothing starts; a rocket already flying can still be cashed out', async () => {
  const p = await player();
  await setGate('upgrade', false);
  assert.equal((await app.post('/api/upgrade', { user: p, body: { ids: [1], target: 1, chance: 50 } })).body.error, 'upgrade_closed');
  await setGate('upgrade', true);

  await setGate('dice', false);
  const d = await app.post('/api/dice/roll', { user: p, body: { color: 'red', bet: 10 } });
  assert.equal(d.status, 403);
  assert.equal(d.body.error, 'dice_closed');
  assert.equal(await balanceOf(p.id), 5000);
  await setGate('dice', true);
  assert.equal((await app.post('/api/dice/roll', { user: p, body: { color: 'red', bet: 10 } })).status, 200);

  // a rocket started before closing flies on and can be cashed out; a new one can't start
  const q = await player();
  rng.queue.push(at(1000));
  const s = await app.post('/api/crash/start', { user: q, body: { bet: 100 } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  await setGate('crash', false);
  const c = await app.post(`/api/crash/${s.body.round.id}/cashout`, { user: q });
  assert.equal(c.status, 200);
  assert.equal(c.body.round.status, 'cashed');
  const again = await app.post('/api/crash/start', { user: q, body: { bet: 100 } });
  assert.equal(again.status, 403);
  assert.equal(again.body.error, 'crash_closed');
  const modes = (await app.get('/api/me', { user: q })).body.modes;
  assert.deepEqual(modes, { cases: true, upgrade: true, crash: false, dice: true, withdrawals: true });
  await setGate('crash', true);
});

test('withdrawals and top-ups closed: no requests, no Stars invoices; a Stars invoice made before still pays', async () => {
  const p = await player();
  await app.post(`/api/case/${caseId('noob')}/open`, { user: p });
  const inv = (await app.get('/api/inventory', { user: p })).body.inventory;
  assert.ok(inv.length > 0);

  await setGate('withdrawals', false);
  const w = await app.post('/api/requests/withdraw', { user: p, body: { ids: [inv[0].invId], nick: 'RobloxNick' } });
  assert.equal(w.status, 403);
  assert.equal(w.body.error, 'withdrawals_closed');
  assert.equal(await itemsOf(p.id), inv.length, 'the brainrot stays');
  assert.equal((await app.get('/api/me', { user: p })).body.modes.withdrawals, false);
  await setGate('withdrawals', true);

  await setGate('deposits', false);
  const st = await app.post('/api/topup/stars', { user: p, body: { stars: 50 } });
  assert.equal(st.status, 403);
  assert.equal(st.body.error, 'topup_closed');
  const dep = await app.post('/api/requests/deposit', { user: p, body: { nick: 'RobloxNick', items: [] } });
  assert.equal(dep.body.error, 'topup_closed');
  const me = (await app.get('/api/me', { user: p })).body;
  assert.equal(me.topup.starsOpen, false);
  assert.equal(me.topup.brainrotsOpen, false);
  // an invoice made before closing: Telegram still lets them pay, the coins come
  const before = await balanceOf(p.id);
  const payload = starsPayload(p.id, 30, 30, Math.floor(Date.now() / 1000), 'gate000001');
  app.tg.reset();
  await app.sendUpdate({ pre_checkout_query: { id: 'pq-g', from: { is_bot: false, id: p.id, first_name: p.first_name }, currency: 'XTR', total_amount: 30, invoice_payload: payload } });
  assert.deepEqual(app.tg.calls('answerPreCheckoutQuery').map((c) => c.payload.ok), [true]);
  await app.sendUpdate({
    message: {
      message_id: 77,
      date: 0,
      chat: { id: p.id, type: 'private' },
      from: { is_bot: false, id: p.id, first_name: p.first_name },
      successful_payment: { currency: 'XTR', total_amount: 30, invoice_payload: payload, telegram_payment_charge_id: 'gate-charge-1', provider_payment_charge_id: '' },
    },
  });
  assert.equal(await balanceOf(p.id), before + 30);
  await setGate('deposits', true);
  // brainrot deposits closed on their own (the deposits tab switch) still close only brainrots
  await app.ctx.settings.update({ deposits_brainrots_open: false });
  const t = (await app.get('/api/me', { user: p })).body.topup;
  assert.equal(t.starsOpen, true);
  assert.equal(t.brainrotsOpen, false);
  await app.ctx.settings.update({ deposits_brainrots_open: true });
});

test('reset: every balance and inventory to zero, rockets in flight burn, the history stays', async () => {
  const a = await player(3000);
  const b = await player(700);
  await app.post(`/api/case/${caseId('noob')}/open`, { user: a });
  await app.post(`/api/case/${caseId('noob')}/open`, { user: b });
  rng.queue.push(at(1000));
  const flying = await app.post('/api/crash/start', { user: b, body: { bet: 100 } });
  assert.equal(flying.body.round.status, 'flying');
  const drops = (await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_drops')).n;
  const totals = await app.ctx.db.one('SELECT count(*)::int AS rich, coalesce(sum(balance), 0)::bigint AS coins FROM bs_users WHERE balance <> 0');
  const items = (await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory')).n;
  assert.ok(totals.rich >= 3 && items >= 2);

  // it needs the confirmation word
  const no = await app.post('/api/admin/reset-economy', { user: boss, body: {} });
  assert.equal(no.status, 400);
  assert.equal(no.body.error, 'bad_field');
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory')).n, items, 'nothing changed');

  const r = await app.post('/api/admin/reset-economy', { user: boss, body: { confirm: 'RESET' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { users: totals.rich, coins: Number(totals.coins), items, rockets: 1 });
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_users WHERE balance <> 0')).n, 0);
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory')).n, 0);
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_drops')).n, drops, 'the drop history stays');
  // the balance log says who reset what
  const log = await app.ctx.db.one("SELECT delta, admin_id FROM bs_balance_log WHERE user_id = $1 AND reason = 'admin:reset'", [a.id]);
  assert.ok(Number(log.delta) < 0);
  assert.equal(Number(log.admin_id), boss.id);
  // the rocket burnt: a cash-out gives nothing
  const c = await app.post(`/api/crash/${flying.body.round.id}/cashout`, { user: b });
  assert.equal(c.body.round.status, 'crashed');
  assert.equal(await balanceOf(b.id), 0);
  // the overview shows it
  const o = (await app.get('/api/admin/overview', { user: boss })).body;
  assert.equal(Number(o.coins), 0);
  assert.equal(Number(o.items_value), 0);
  // the game goes on: new coins work as usual
  await app.setBalance(a.id, 50);
  assert.equal((await app.post(`/api/case/${caseId('noob')}/open`, { user: a })).status, 200);
});
