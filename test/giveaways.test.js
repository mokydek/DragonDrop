// Giveaways, like on Case Battle: every day a Garama and Madundung, every week a Dragon Cannelloni (the
// main admin changes them). To join, a player tops up at least the minimum while the giveaway runs (Stars,
// coins credited, brainrots given; several top-ups add up) and presses «Участвовать». When the time is
// up, one of those who joined wins at random: the brainrot goes to their inventory, the bot tells them,
// the winner is shown under the giveaway, and the next one starts.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, scriptedRng } from './helpers.js';

let app;
const rng = scriptedRng();
const boss = { id: 7401, first_name: 'Босс', username: 'gw_boss', language_code: 'ru' };
const helper = { id: 7402, first_name: 'Помощник', username: 'gw_helper', language_code: 'ru' };
const ann = { id: 7411, first_name: 'Аня', language_code: 'ru' };
const ben = { id: 7412, first_name: 'Ben', language_code: 'en' };
const cid = { id: 7413, first_name: 'Сид', language_code: 'ru' };
const dan = { id: 7414, first_name: 'Даня', language_code: 'ru' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

before(async () => {
  app = await startApp({ dbName: 'bs_t_giveaways', env: { OWNER_USERNAMES: 'gw_boss' }, rng });
  for (const u of [boss, helper, ann, ben, cid, dan]) {
    await app.post('/api/bootstrap', { user: u });
    await app.message(u, '/start');
  }
  await app.makeAdmin(boss.id);
  await app.makeAdmin(helper.id);
  await app.ctx.settings.update({ stars_rate: 2 });
});
after(async () => {
  await app?.close();
});

const list = async (u) => {
  const r = await app.get('/api/giveaways', { user: u });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.giveaways;
};
const byKind = async (u, kind) => (await list(u)).find((g) => g.kind === kind);
const join = (u, id) => app.post(`/api/giveaways/${id}/join`, { user: u });
const open = (kind) => app.ctx.db.one("SELECT * FROM bs_giveaways WHERE kind = $1 AND status = 'open'", [kind]);
/** The time of the giveaway running now is up (`ago` ms ago). */
const due = (kind, ago = 1000) => app.ctx.db.query("UPDATE bs_giveaways SET ends_at = now() - make_interval(secs => $2) WHERE kind = $1 AND status = 'open'", [kind, ago / 1000]);
const itemNamed = (name) => [...app.ctx.game.catalog.items.values()].find((i) => i.name === name);
const inventory = async (u) => (await app.get('/api/inventory', { user: u })).body.inventory;

let charge = 0;
/** Telegram tells the bot an invoice of `stars` ⭐ was paid. */
async function payStars(u, stars) {
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
      successful_payment: { currency: 'XTR', total_amount: stars, invoice_payload: payload, telegram_payment_charge_id: 'gw-charge-' + ++charge, provider_payment_charge_id: '' },
    },
  });
}

test('a daily giveaway of a Garama and a weekly one of a Dragon Cannelloni run from the start: 24 hours and 7 days, from 100 and 500 coins', async () => {
  const gs = await list(ann);
  assert.deepEqual(
    gs.map((g) => [g.kind, g.item.name, g.min, new Date(g.endsAt) - new Date(g.startsAt), g.entries, g.joined, g.winners]),
    [
      ['day', 'Garama and Madundung', 100, DAY, 0, false, []],
      ['week', 'Dragon Cannelloni', 500, 7 * DAY, 0, false, []],
    ],
  );
  assert.ok(gs[0].item.image && gs[0].item.value > 0);
  // the cases screen gets them with the app
  const b = await app.post('/api/bootstrap', { user: ann });
  assert.deepEqual(
    b.body.giveaways.map((g) => [g.id, g.kind, g.item.name, g.endsAt]),
    gs.map((g) => [g.id, g.kind, g.item.name, g.endsAt]),
  );
});

test('to join, a player tops up at least the minimum while the giveaway runs (several top-ups add up); an admin does not take part', async () => {
  const day = await byKind(ann, 'day');
  let r = await join(ann, day.id);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'giveaway_topup');
  assert.equal(r.body.left, 100);
  // a top-up made before the giveaway began doesn't count
  await payStars(ann, 20);
  await app.ctx.db.query('UPDATE bs_topups SET created_at = $2::timestamptz - interval \'1 minute\' WHERE user_id = $1', [ann.id, (await open('day')).starts_at]);
  assert.equal((await join(ann, day.id)).body.left, 100);
  // 25 ⭐ = 50 coins, then 25 ⭐ more: 100
  await payStars(ann, 25);
  assert.equal((await join(ann, day.id)).body.left, 50);
  await payStars(ann, 25);
  r = await join(ann, day.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // how many joined: everyone sees it; joining twice counts once
  assert.deepEqual(r.body.giveaways.map((g) => [g.kind, g.joined, g.entries]), [['day', true, 1], ['week', false, 0]]);
  assert.equal((await join(ann, day.id)).status, 200, 'again: fine');
  assert.deepEqual((await list(ben)).map((g) => [g.kind, g.joined, g.entries]), [['day', false, 1], ['week', false, 0]]);
  // the same top-ups count for the weekly one: 400 left of 500
  const week = await byKind(ann, 'week');
  assert.equal((await join(ann, week.id)).body.left, 400);
  // admins don't take part
  r = await join(helper, day.id);
  assert.equal(r.body.error, 'giveaway_admin');
  // a brainrot deposit: the coins credited and the brainrot given count too
  await wait(3100);
  const offer = [{ itemId: [...app.ctx.game.catalog.items.values()].find((i) => i.enabled && i.depositable).id, count: 1 }];
  const dep = await app.post('/api/requests/deposit', { user: ben, body: { nick: 'BenRBX', offer } });
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  const id = dep.body.request.id;
  assert.equal((await app.post(`/api/admin/requests/${id}/credit`, { user: boss, body: { amount: 60 } })).status, 200);
  assert.equal((await join(ben, day.id)).body.left, 40);
  const small = [...app.ctx.game.catalog.items.values()].find((i) => i.value >= 40);
  assert.equal((await app.post(`/api/admin/requests/${id}/give`, { user: boss, body: { itemId: small.id } })).status, 200);
  assert.equal((await join(ben, day.id)).status, 200);
  assert.equal((await byKind(ann, 'day')).entries, 2);
  // a giveaway that is not there; garbage
  assert.equal((await join(ann, 999999)).status, 404);
  assert.equal((await join(ann, 'abc')).status, 404);
});

test('when the time is up, one of those who joined wins at random: the brainrot goes to their inventory, the bot tells them, the next one starts where this one ended', async () => {
  const g = await open('day');
  const garama = itemNamed('Garama and Madundung');
  // Ann joined first, then Ben: the random number 1 picks Ben
  rng.queue.push(1);
  app.tg.reset();
  await due('day');
  await app.ctx.giveaways.tick();
  const done = await app.ctx.db.one('SELECT * FROM bs_giveaways WHERE id = $1', [g.id]);
  assert.deepEqual([done.status, Number(done.winner_id), done.entries], ['done', ben.id, 2]);
  const prize = (await inventory(ben)).filter((x) => x.item.id === garama.id);
  assert.equal(prize.length, 1, 'the Garama is in the winner\'s inventory');
  assert.equal(Number(done.inv_id), prize[0].invId);
  assert.equal((await inventory(ann)).filter((x) => x.item.id === garama.id).length, 0);
  // the bot's message to the winner, with a button to the inventory
  const msg = app.tg.calls('sendMessage').filter((c) => Number(c.payload.chat_id) === ben.id);
  assert.equal(msg.length, 1);
  assert.equal(msg[0].payload.text, `🎉 You won the daily giveaway #${g.id}!\n\nPrize: Garama and Madundung (${garama.value} 🪙) — it's already in your inventory.`);
  assert.equal(msg[0].payload.reply_markup.inline_keyboard[0][0].web_app.url, 'https://app.dragondrop.test/?go=profile');
  // the next one: from the moment this one ended, for a day; nobody joined it yet
  const next = await open('day');
  assert.notEqual(Number(next.id), Number(g.id));
  assert.equal(new Date(next.starts_at).getTime(), new Date(done.ends_at).getTime());
  assert.equal(new Date(next.ends_at) - new Date(next.starts_at), DAY);
  const day = await byKind(ann, 'day');
  assert.equal(day.id, Number(next.id));
  assert.equal(day.joined, false);
  assert.equal(day.entries, 0, 'a new giveaway: nobody yet');
  // the winner under the giveaway
  assert.deepEqual(
    day.winners.map((w) => [w.id, w.name, w.item.name]),
    [[Number(g.id), 'Ben', 'Garama and Madundung']],
  );
  // the admin player card: where the brainrot came from
  const card = await app.get(`/api/admin/users/${ben.id}`, { user: boss });
  const src = card.body.inventory.find((x) => x.invId === prize[0].invId);
  assert.deepEqual(src.from, { type: 'giveaway', giveaway: { id: Number(g.id), kind: 'day' } });
  // the top-ups of the old giveaway don't count for the new one
  assert.equal((await join(ann, day.id)).body.left, 100);
});

test('nobody joined: no winner, the next one starts; after a server off for longer than a day it starts now', async () => {
  const g = await open('day');
  await due('day', 2 * DAY);
  await app.ctx.giveaways.tick();
  const done = await app.ctx.db.one('SELECT status, winner_id, entries, inv_id FROM bs_giveaways WHERE id = $1', [g.id]);
  assert.deepEqual(done, { status: 'done', winner_id: null, entries: 0, inv_id: null });
  const next = await open('day');
  const now = (await app.ctx.db.one('SELECT now() AS t')).t;
  assert.ok(Math.abs(new Date(next.starts_at) - new Date(now)) < 5000, 'starts now');
  assert.equal(new Date(next.ends_at) - new Date(next.starts_at), DAY);
  // no winner — nobody new under the giveaway
  assert.deepEqual((await byKind(ann, 'day')).winners.map((w) => w.name), ['Ben']);
});

test('the time is up: «Участвовать» says it is over; the page draws it at once even before the timer of the server', async () => {
  const g = await open('day');
  await payStars(cid, 50);
  await due('day');
  const r = await join(cid, Number(g.id));
  assert.equal(r.body.error, 'giveaway_over');
  // opening the page draws it and shows the next one
  const day = await byKind(cid, 'day');
  assert.notEqual(day.id, Number(g.id));
  assert.equal((await app.ctx.db.one('SELECT status FROM bs_giveaways WHERE id = $1', [g.id])).status, 'done');
});

test('two servers draw at once: one winner, one brainrot, one next giveaway', async () => {
  const g = await open('day');
  await payStars(dan, 50);
  assert.equal((await join(dan, Number(g.id))).status, 200);
  const before = (await inventory(dan)).length;
  app.tg.reset();
  await due('day');
  const [a, b] = await Promise.all([app.ctx.giveaways.draw(Number(g.id)), app.ctx.giveaways.draw(Number(g.id))]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal((await inventory(dan)).length, before + 1);
  assert.equal((await app.ctx.db.one("SELECT count(*)::int AS n FROM bs_giveaways WHERE kind = 'day' AND status = 'open'")).n, 1);
  assert.equal(app.tg.calls('sendMessage').filter((c) => Number(c.payload.chat_id) === dan.id).length, 1);
});

test('a banned player who joined does not win', async () => {
  const g = await open('day');
  await payStars(cid, 50);
  assert.equal((await join(cid, Number(g.id))).status, 200);
  await app.ctx.db.query('UPDATE bs_users SET is_banned = TRUE WHERE id = $1', [cid.id]);
  await due('day');
  await app.ctx.giveaways.tick();
  const done = await app.ctx.db.one('SELECT winner_id, entries FROM bs_giveaways WHERE id = $1', [g.id]);
  assert.deepEqual(done, { winner_id: null, entries: 0 });
  await app.ctx.db.query('UPDATE bs_users SET is_banned = FALSE WHERE id = $1', [cid.id]);
});

test('the main admin changes a kind: a giveaway nobody joined takes it at once, one with players keeps its prize to the end; off — no new one; other admins only look', async () => {
  const put = (u, kind, body) => app.put(`/api/admin/giveaways/${kind}`, { user: u, body });
  const v = await app.get('/api/admin/giveaways', { user: helper });
  assert.equal(v.status, 200, 'other admins see it');
  assert.deepEqual(Object.keys(v.body.giveaways), ['day', 'week']);
  assert.deepEqual([v.body.giveaways.day.active, v.body.giveaways.day.item.name, v.body.giveaways.day.min], [true, 'Garama and Madundung', 100]);
  assert.deepEqual(v.body.giveaways.day.past.map((p) => p.winner && p.winner.name), [null, 'Даня', null, null, 'Ben'], 'the last ones drawn, newest first');
  const garama = itemNamed('Garama and Madundung');
  const other = [...app.ctx.game.catalog.items.values()].find((i) => i.value > 1000 && i.value < 3000 && i.name !== 'Dragon Cannelloni');
  assert.equal((await put(helper, 'day', { active: true, itemId: other.id, min: 200 })).status, 403, 'only the main admin changes');
  // the daily one has a player: it keeps the Garama and 100; the next one has the new prize and minimum
  const g = await open('day');
  await payStars(ann, 50);
  assert.equal((await join(ann, Number(g.id))).status, 200);
  let r = await put(boss, 'day', { active: true, itemId: other.id, min: 200 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.giveaways.day.item.name, r.body.giveaways.day.min], [other.name, 200]);
  assert.deepEqual([r.body.giveaways.day.current.item.name, r.body.giveaways.day.current.min, r.body.giveaways.day.current.entries], ['Garama and Madundung', 100, 1]);
  rng.queue.push(0);
  await due('day');
  await app.ctx.giveaways.tick();
  assert.equal((await inventory(ann)).filter((x) => x.item.id === garama.id).length, 1, 'Ann won the Garama');
  const next = await byKind(ann, 'day');
  assert.deepEqual([next.item.name, next.min], [other.name, 200]);
  // the weekly one has nobody: it changes at once
  const w = await open('week');
  r = await put(boss, 'week', { active: true, itemId: garama.id, min: 300 });
  assert.equal(r.status, 200);
  const w2 = await open('week');
  assert.deepEqual([Number(w2.id), w2.item_id, Number(w2.min_topup), w2.ends_at.getTime()], [Number(w.id), garama.id, 300, w.ends_at.getTime()]);
  // off: a giveaway nobody joined stops now and no new one starts
  r = await put(boss, 'week', { active: false, itemId: garama.id, min: 300 });
  assert.equal(r.body.giveaways.week.current, null);
  assert.deepEqual((await list(ann)).map((x) => x.kind), ['day']);
  await app.ctx.giveaways.tick();
  assert.deepEqual((await list(ann)).map((x) => x.kind), ['day']);
  // on again: a new one from now
  r = await put(boss, 'week', { active: true, itemId: itemNamed('Dragon Cannelloni').id, min: 500 });
  const w3 = await open('week');
  assert.notEqual(Number(w3.id), Number(w.id));
  assert.equal(new Date(w3.ends_at) - new Date(w3.starts_at), 7 * DAY);
  // off with players in it: it goes on to the end and is drawn, then none starts
  await payStars(ben, 250);
  assert.equal((await join(ben, Number(w3.id))).status, 200);
  r = await put(boss, 'week', { active: false, itemId: itemNamed('Dragon Cannelloni').id, min: 500 });
  assert.equal(r.body.giveaways.week.current.id, Number(w3.id));
  rng.queue.push(0);
  await due('week');
  await app.ctx.giveaways.tick();
  assert.equal(Number((await app.ctx.db.one('SELECT winner_id FROM bs_giveaways WHERE id = $1', [w3.id])).winner_id), ben.id);
  assert.deepEqual((await list(ben)).map((x) => x.kind), ['day']);
  // wrong values
  const bad = async (kind, body, field) => {
    const x = await put(boss, kind, body);
    assert.equal(x.status, 400, JSON.stringify(body));
    assert.equal(x.body.field, field);
  };
  await bad('day', { active: true, itemId: 999999, min: 100 }, 'itemId');
  await bad('day', { active: true, itemId: garama.id, min: -1 }, 'min');
  await bad('day', { active: true, itemId: garama.id, min: 1.5 }, 'min');
  await bad('day', { active: 'yes', itemId: garama.id, min: 1 }, 'active');
  assert.equal((await put(boss, 'month', { active: true, itemId: garama.id, min: 1 })).status, 404);
  // who joined
  const cur = await open('day');
  await payStars(ben, 100);
  assert.equal((await join(ben, Number(cur.id))).status, 200);
  const e = await app.get(`/api/admin/giveaways/${cur.id}/entries`, { user: helper });
  assert.deepEqual(e.body.entries.map((x) => x.name), ['Ben']);
  // the main admin hides the section from the other admins
  await app.put('/api/admin/settings', { user: boss, body: { admin_hidden: ['giveaways'] } });
  assert.equal((await app.get('/api/admin/giveaways', { user: helper })).status, 403);
  assert.equal((await app.get('/api/admin/giveaways', { user: boss })).status, 200);
  await app.put('/api/admin/settings', { user: boss, body: { admin_hidden: [] } });
  // players can't get in
  assert.equal((await app.get('/api/admin/giveaways', { user: ann })).status, 403);
});

test('the server draws by itself when the time is up (its timer), without anyone opening the page', async () => {
  const other = await startApp({ dbName: 'bs_t_giveaways_timer', env: { GIVEAWAY_TICK_MS: '200' } });
  try {
    const p = { id: 7499, first_name: 'Таймер', language_code: 'ru' };
    await other.post('/api/bootstrap', { user: p });
    const g = await other.ctx.db.one("SELECT id FROM bs_giveaways WHERE kind = 'day' AND status = 'open'");
    await other.ctx.db.query('INSERT INTO bs_topups (user_id, value) VALUES ($1, 100)', [p.id]);
    assert.equal((await other.post(`/api/giveaways/${g.id}/join`, { user: p })).status, 200);
    await other.ctx.db.query("UPDATE bs_giveaways SET ends_at = now() WHERE id = $1", [g.id]);
    let row = null;
    for (let i = 0; i < 30 && !(row && row.status === 'done'); i++) {
      await wait(100);
      row = await other.ctx.db.one('SELECT status, winner_id FROM bs_giveaways WHERE id = $1', [g.id]);
    }
    assert.deepEqual(row, { status: 'done', winner_id: p.id });
    assert.equal((await other.ctx.db.one("SELECT count(*)::int AS n FROM bs_giveaways WHERE kind = 'day' AND status = 'open'")).n, 1);
  } finally {
    await other.close();
  }
});
