// Maintenance: the main admin's switch in the admin panel. While it is on nobody but the main admin
// gets into the app or the bot; the others see "maintenance". A new DragonDrop starts with it on.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, users } from './helpers.js';
import { SETTINGS_SCHEMA } from '../src/settings.js';
import { starsPayload } from '../src/requests.js';

let app;
const boss = { id: 2001, first_name: 'Босс', username: 'boss', language_code: 'ru' }; // the main admin (OWNER_USERNAMES)
const helper = { id: 2002, first_name: 'Помощник', username: 'helper', language_code: 'ru' }; // a usual admin
const alice = users.alice; // ru
const carol = users.carol; // en
const RU = '🛠 Технические работы — скоро вернёмся.';

before(async () => {
  // as in production: nobody switched it yet, so the default (on) holds
  app = await startApp({ dbName: 'bs_t_maint', env: { OWNER_USERNAMES: 'boss' }, maintenance: true });
});
after(async () => {
  await app?.close();
});

const sent = () => app.tg.calls('sendMessage').map((c) => c.payload);

test('a new DragonDrop starts under maintenance: players and usual admins are kept out, the main admin is in', async () => {
  assert.equal(SETTINGS_SCHEMA.maintenance.def, true);
  assert.equal(app.ctx.settings.get('maintenance'), true);

  // a player: the app gets "maintenance" on every call
  const b = await app.post('/api/bootstrap', { user: alice });
  assert.equal(b.status, 403);
  assert.deepEqual(b.body, { error: 'maintenance' });
  assert.equal((await app.get('/api/me', { user: alice })).body.error, 'maintenance');
  assert.equal((await app.get('/api/inventory', { user: alice })).body.error, 'maintenance');
  assert.equal((await app.post('/api/free/open', { user: alice })).body.error, 'maintenance');

  // a usual admin: kept out too, the admin panel included
  await app.post('/api/bootstrap', { user: helper });
  await app.makeAdmin(helper.id);
  assert.equal((await app.post('/api/bootstrap', { user: helper })).body.error, 'maintenance');
  assert.equal((await app.get('/api/admin/overview', { user: helper })).body.error, 'maintenance');

  // the main admin: everything works, and the overview has the switch
  const me = await app.post('/api/bootstrap', { user: boss });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.me.isAdmin, true);
  const o = await app.get('/api/admin/overview', { user: boss });
  assert.equal(o.status, 200);
  assert.equal(o.body.maintenance, true);

  // public bits still answer: the maintenance screen asks /api/public whether it is over
  const pub = await app.get('/api/public');
  assert.equal(pub.status, 200);
  assert.equal(pub.body.maintenance, true);
  assert.equal((await app.get('/api/health')).status, 200);
  assert.equal((await app.get('/api/feed')).status, 200);
});

test('maintenance in the bot: one line for everyone but the main admin; /start still keeps the player', async () => {
  app.tg.reset();
  assert.equal(await app.message(alice, '/start'), 200);
  assert.equal(app.tg.calls('sendPhoto').length, 0, 'no welcome banner');
  assert.deepEqual(sent().map((m) => [Number(m.chat_id), m.text, m.reply_markup]), [[alice.id, RU, undefined]]);
  const row = await app.ctx.db.one('SELECT started_bot FROM bs_users WHERE id = $1', [alice.id]);
  assert.equal(row.started_bot, true, 'kept to tell them when it is over');

  // in the player's language; a stranger who never pressed /start too
  app.tg.reset();
  await app.message(carol, '/start');
  await app.message({ id: 3333, first_name: 'Kim', language_code: 'uk' }, 'привіт');
  assert.deepEqual(sent().map((m) => m.text), ['🛠 Maintenance — we will be back soon.', '🛠 Технічні роботи — скоро повернемося.']);

  // a button under an old message: a short answer on the button
  app.tg.reset();
  await app.sendUpdate({
    callback_query: { id: 'cbm', from: { is_bot: false, ...alice }, chat_instance: '1', data: 'promo', message: { message_id: 7, date: 1, chat: { id: alice.id, type: 'private' }, text: 'x' } },
  });
  assert.deepEqual(app.tg.calls('answerCallbackQuery').map((c) => c.payload.text), [RU]);
  assert.equal(sent().length, 0, 'no promo prompt');

  // a usual admin gets the same line; the main admin gets the usual welcome
  app.tg.reset();
  await app.message(helper, '/start');
  assert.deepEqual(sent().map((m) => m.text), [RU]);
  app.tg.reset();
  await app.message(boss, '/start');
  assert.equal(app.tg.calls('sendPhoto').length, 1, 'the main admin gets the welcome banner');
  assert.equal(sent().length, 0);
});

test('maintenance: a Stars invoice made before it still gets paid and credited', async () => {
  const ts = Math.floor(Date.now() / 1000);
  const payload = starsPayload(alice.id, 50, 50, ts, 'maint00001');
  app.tg.reset();
  await app.sendUpdate({ pre_checkout_query: { id: 'pq-m', from: { is_bot: false, ...alice }, currency: 'XTR', total_amount: 50, invoice_payload: payload } });
  assert.deepEqual(app.tg.calls('answerPreCheckoutQuery').map((c) => c.payload.ok), [true]);
  const before = (await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [alice.id])).balance;
  await app.sendUpdate({
    message: {
      message_id: 901,
      date: 0,
      chat: { id: alice.id, type: 'private' },
      from: { is_bot: false, ...alice },
      successful_payment: { currency: 'XTR', total_amount: 50, invoice_payload: payload, telegram_payment_charge_id: 'maint-charge-1', provider_payment_charge_id: '' },
    },
  });
  const afterPay = (await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [alice.id])).balance;
  assert.equal(Number(afterPay), Number(before) + 50);
  assert.match(sent().at(-1).text, /^✅ Оплата получена: \+50/);
});

test('only the main admin switches it: off lets everyone in, a usual admin cannot switch it back', async () => {
  // bad value
  const bad = await app.put('/api/admin/maintenance', { user: boss, body: { on: 'yes' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_field');

  const off = await app.put('/api/admin/maintenance', { user: boss, body: { on: false } });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { maintenance: false });
  assert.equal(app.ctx.settings.get('maintenance'), false);
  assert.equal((await app.get('/api/public')).body.maintenance, false);

  // everyone is back
  assert.equal((await app.post('/api/bootstrap', { user: alice })).status, 200);
  assert.equal((await app.post('/api/bootstrap', { user: helper })).status, 200);
  app.tg.reset();
  await app.message(alice, '/start');
  assert.equal(app.tg.calls('sendPhoto').length, 1, 'the usual welcome');

  // a usual admin: no switch in the overview, the switch and the settings field are refused
  const o = await app.get('/api/admin/overview', { user: helper });
  assert.equal(o.status, 200);
  assert.equal(o.body.maintenance, undefined);
  const no = await app.put('/api/admin/maintenance', { user: helper, body: { on: true } });
  assert.equal(no.status, 403);
  assert.equal(no.body.error, 'forbidden');
  const viaSettings = await app.put('/api/admin/settings', { user: helper, body: { maintenance: true } });
  assert.equal(viaSettings.status, 200);
  assert.equal(viaSettings.body.settings.maintenance, undefined, 'the field is hidden from usual admins');
  assert.equal(app.ctx.settings.get('maintenance'), false, 'and not changed');
  // a player can't reach it at all
  assert.equal((await app.put('/api/admin/maintenance', { user: alice, body: { on: true } })).status, 403);
  assert.equal(app.ctx.settings.get('maintenance'), false);

  // the main admin switches it on again: players are out at once
  const on = await app.put('/api/admin/maintenance', { user: boss, body: { on: true } });
  assert.deepEqual(on.body, { maintenance: true });
  assert.equal((await app.get('/api/me', { user: alice })).body.error, 'maintenance');
  assert.equal((await app.post('/api/bootstrap', { user: boss })).status, 200);
  await app.put('/api/admin/maintenance', { user: boss, body: { on: false } });
});
