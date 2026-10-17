// Deposits (Telegram Stars, brainrots by request), withdrawals and the admin conversation.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, users } from './helpers.js';
import { parseStarsPayload, starsPayload } from '../src/requests.js';

const nowSec = () => Math.floor(Date.now() / 1000);

let app;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freshWindow = () => wait(3100); // player actions are rate limited (12 per 3 s)
const admin = { id: 2001, first_name: 'Админ', username: 'boss', language_code: 'ru' };
const player = users.alice;
const other = users.bob;

before(async () => {
  app = await startApp({ dbName: 'bs_t_req' });
  await wait(300);
  for (const u of [admin, player, other, users.carol]) {
    await app.post('/api/bootstrap', { user: u });
    await app.message(u, '/start');
  }
  await app.makeAdmin(admin.id);
});
after(async () => {
  await app?.close();
});

const sent = (chatId) => app.tg.calls('sendMessage').filter((c) => Number(c.payload.chat_id) === chatId);
const lastSent = (chatId) => sent(chatId).at(-1)?.payload;
const balance = async (id) => (await app.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [id])).balance;
function itemByName(name) {
  for (const i of app.ctx.game.catalog.items.values()) if (i.name === name) return i;
  throw new Error('no item ' + name);
}
async function giveItems(userId, names) {
  const ids = [];
  for (const n of names) {
    const r = await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [
      userId,
      itemByName(n).id,
    ]);
    ids.push(r.id);
  }
  return ids;
}
const callback = (u, data, messageId = 1) =>
  app.sendUpdate({
    callback_query: {
      id: String(Math.random()),
      from: { is_bot: false, ...u },
      chat_instance: 'x',
      data,
      message: { message_id: messageId, date: 0, chat: { id: u.id, type: 'private' }, from: app.tg.me, text: 'x' },
    },
  });

// ------------------------------------------------------------------ stars
test('stars payload: roundtrip and garbage', () => {
  assert.deepEqual(parseStarsPayload(starsPayload(1001, 250, 500, 1700000000, 'a1b2c3d4e5f60718')), {
    userId: 1001,
    stars: 250,
    coins: 500,
    ts: 1700000000,
    invoice: 'a1b2c3d4e5f60718',
  });
  for (const bad of ['', 'bs:1:0:5:1:abcdef', 'bs:1:10001:5:1:abcdef', 'bs:1:5:0:1:abcdef', 'xx:1:5:5:1:abcdef', 'bs:1:5:5', 'bs:1:5:5:1:ABC', 'bs:1:5:5:1:abcdef:x', null]) {
    assert.equal(parseStarsPayload(bad), null, String(bad));
  }
});

test('stars: invoice link in XTR with coins by the admin rate', async () => {
  app.tg.reset();
  const r = await app.post('/api/topup/stars', { user: player, body: { stars: 150 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.link, /^https:\/\/t\.me\/\$inv_/);
  assert.equal(r.body.coins, 300, 'default rate: 2 coins per star');
  assert.match(r.body.invoice, /^[a-f0-9]{16}$/);
  const call = app.tg.calls('createInvoiceLink')[0].payload;
  assert.equal(call.currency, 'XTR');
  assert.equal(call.provider_token, '');
  assert.deepEqual(call.prices, [{ label: '300 монет', amount: 150 }]);
  const p = parseStarsPayload(call.payload);
  assert.deepEqual({ ...p, ts: undefined }, { userId: 1001, stars: 150, coins: 300, ts: undefined, invoice: r.body.invoice });
  assert.ok(Math.abs(p.ts - nowSec()) < 5);
  assert.equal(call.title, 'Пополнение баланса');

  await app.ctx.settings.update({ stars_rate: 2.5 });
  const r2 = await app.post('/api/topup/stars', { user: player, body: { stars: 3 } });
  assert.equal(r2.body.coins, 7, 'floor(3 * 2.5)');
  const boot = await app.post('/api/bootstrap', { user: player });
  const { buffs, ...topup } = boot.body.topup;
  assert.deepEqual(topup, { starsRate: 2.5, starsOpen: true, brainrotsOpen: true });
  assert.ok(Array.isArray(buffs) && buffs.length > 0, 'what buffs add to a deposited brainrot');
  await app.ctx.settings.update({ stars_rate: 2 });

  for (const stars of [0, -5, 1.5, 10001, 'abc', null]) {
    const bad = await app.post('/api/topup/stars', { user: player, body: { stars } });
    assert.equal(bad.status, 400, String(stars));
    assert.equal(bad.body.error, 'bad_stars');
  }
});

test('stars: pre-checkout accepts only our invoice for the same player and amount', async () => {
  const answers = () => app.tg.calls('answerPreCheckoutQuery').map((c) => c.payload);
  const q = (from, payload, total, currency = 'XTR') =>
    app.sendUpdate({ pre_checkout_query: { id: 'q' + Math.random(), from: { is_bot: false, ...from }, currency, total_amount: total, invoice_payload: payload } });
  app.tg.reset();
  const good = starsPayload(1001, 150, 150, nowSec(), 'abcdef123456');
  await q(player, good, 150);
  await q(other, good, 150);
  await q(player, good, 149);
  await q(player, good, 150, 'USD');
  await q(player, 'something-else', 150);
  await q(player, starsPayload(1001, 150, 150, nowSec() - 25 * 3600, 'abcdef123456'), 150); // stale invoice, old rate
  const a = answers();
  assert.equal(a.length, 6);
  assert.deepEqual(a.map((x) => x.ok), [true, false, false, false, false, false]);
  assert.match(a[1].error_message, /Платіж не пройшов перевірку/, "in the payer's language");
});

test('stars: successful payment credits once, logs it and shows up in deposits', async () => {
  const before = await balance(player.id);
  app.tg.reset();
  const pay = {
    currency: 'XTR',
    total_amount: 150,
    invoice_payload: starsPayload(1001, 150, 300, nowSec(), 'feedbeef0001'),
    telegram_payment_charge_id: 'stxCHARGE1',
    provider_payment_charge_id: '',
  };
  const status = (inv, u = player) => app.get(`/api/topup/stars/${inv}`, { user: u });
  assert.deepEqual((await status('feedbeef0001')).body, { paid: false });
  const msg = (extra) => app.sendUpdate({
    message: { message_id: 900, date: 0, chat: { id: player.id, type: 'private' }, from: { is_bot: false, ...player }, successful_payment: pay, ...extra },
  });
  await msg();
  await msg(); // Telegram retries the same update
  assert.equal(await balance(player.id), before + 300);
  assert.deepEqual((await status('feedbeef0001')).body, { paid: true, coins: 300, balance: before + 300 });
  assert.deepEqual((await status('feedbeef0001', other)).body, { paid: false }, "someone else's invoice");
  assert.equal((await status('BAD!')).status, 400);
  const replies = sent(player.id);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].payload.text, `✅ Оплата получена: +300 🪙\nБаланс: ${before + 300} 🪙`);
  const log = await app.ctx.db.many("SELECT delta, reason FROM bs_balance_log WHERE user_id = $1 AND reason LIKE 'stars:%'", [player.id]);
  assert.equal(log.length, 1);
  assert.equal(log[0].delta, 300);
  const list = await app.get('/api/admin/requests?kind=deposit&scope=all', { user: admin });
  const row = list.body.requests.find((x) => x.method === 'stars');
  assert.ok(row);
  assert.equal(row.status, 'done');
  assert.equal(row.stars, 150);
  assert.equal(row.coins, 300);
  assert.equal(row.waiting, false);
  assert.equal(row.user.id, player.id);
  const open = await app.get('/api/admin/requests?kind=deposit', { user: admin });
  assert.ok(!open.body.requests.some((x) => x.method === 'stars'), 'paid stars are not open requests');
});

// ------------------------------------------------------------------ deposit by brainrots
let depId;

test('deposit request: validation', async () => {
  await freshWindow();
  const bad = async (body, code) => {
    const r = await app.post('/api/requests/deposit', { user: player, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, code);
  };
  await bad({ details: 'Tralalero' }, 'bad_nick');
  await bad({ nick: 'ab', details: 'Tralalero' }, 'bad_nick');
  await bad({ nick: 'x'.repeat(33), details: 'Tralalero' }, 'bad_nick');
  await bad({ nick: 'RobloxAlice' }, 'bad_details');
  await bad({ nick: 'RobloxAlice', details: ' ' }, 'bad_details');
  await bad({ nick: 'RobloxAlice', details: 'x'.repeat(501) }, 'bad_details');
  assert.equal((await app.post('/api/requests/deposit', { body: { nick: 'abc', details: 'abc' } })).status, 401);
});

test('deposit request: saved, player gets a confirmation to answer, admins get a heads-up', async () => {
  await freshWindow();
  app.tg.reset();
  const r = await app.post('/api/requests/deposit', { user: player, body: { nick: '@RobloxAlice', details: 'Tralalero Tralala x2' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  depId = r.body.request.id;
  assert.equal(r.body.request.kind, 'deposit');
  assert.equal(r.body.request.status, 'new');
  assert.equal(r.body.request.nick, 'RobloxAlice', 'leading @ removed');

  const conf = lastSent(player.id);
  assert.equal(
    conf.text,
    `📥 Заявка на пополнение #${depId} — ты в очереди: №1.\n\nНик в Roblox: RobloxAlice\nЧто пополняешь: Tralalero Tralala x2\n\nКогда подойдёт твоя очередь, бот напишет сюда — у тебя будет 5 минут, чтобы отправить трейд.`,
  );
  assert.deepEqual(r.body.queue, { id: depId, state: 'queue', nick: 'RobloxAlice', details: 'Tralalero Tralala x2', coins: 0, canCancel: true, position: 1, eta: 0 });
  assert.deepEqual(conf.reply_markup.inline_keyboard, [[{ text: '✍️ Написать', callback_data: `rq:${depId}` }]]);

  const note = lastSent(admin.id);
  assert.match(note.text, new RegExp(`^🆕 Пополнение #${depId}`));
  assert.match(note.text, /Alice \(@alice\) · id 1001/);
  assert.match(note.text, /🎮 Ник: RobloxAlice/);
  assert.deepEqual(note.reply_markup.inline_keyboard[0][0], {
    text: '📂 Открыть заявку',
    web_app: { url: `https://app.dragondrop.test/?go=admin/deposits/${depId}` },
  });
  assert.equal(sent(other.id).length, 0, 'regular players are not notified');

  const boot = await app.post('/api/bootstrap', { user: player });
  assert.equal(boot.body.me.nick, 'RobloxAlice', 'nickname pre-fills the next form');
  const counts = await app.get('/api/admin/requests/counts', { user: admin });
  assert.deepEqual(counts.body.counts, { deposit: 1, withdraw: 0 });
});

test('admin endpoints are for admins only', async () => {
  assert.equal((await app.get('/api/admin/requests?kind=deposit', { user: player })).status, 403);
  assert.equal((await app.get(`/api/admin/requests/${depId}`, { user: player })).status, 403);
  assert.equal((await app.post(`/api/admin/requests/${depId}/credit`, { user: player, body: { amount: 5 } })).status, 403);
  assert.equal((await app.get('/api/admin/requests?kind=nope', { user: admin })).status, 400);
  assert.equal((await app.get('/api/admin/requests/999999', { user: admin })).status, 404);
});

test('conversation: admin writes, the bot delivers it, the player answers in the bot', async () => {
  app.tg.reset();
  const r = await app.post(`/api/admin/requests/${depId}/messages`, { user: admin, body: { text: 'Привет! Добавь в друзья BossRoblox' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.delivered, true);
  assert.equal(r.body.request.status, 'new', 'a message keeps the deposit in the queue');
  assert.equal(r.body.request.queuePos, 1);
  assert.equal(r.body.request.waiting, false);
  const toPlayer = lastSent(player.id);
  assert.equal(toPlayer.text, `💬 Администратор по заявке #${depId}:\n\nПривет! Добавь в друзья BossRoblox`);
  assert.deepEqual(toPlayer.reply_markup.inline_keyboard, [[{ text: '✍️ Ответить', callback_data: `rq:${depId}` }]]);
  const adminMsg = r.body.messages.at(-1);
  assert.equal(adminMsg.author, 'admin');
  assert.equal(adminMsg.adminName, 'Админ');
  assert.equal(adminMsg.delivered, true);

  // "Reply" button -> next text goes to the request
  await callback(player, `rq:${depId}`);
  assert.equal(lastSent(player.id).text, `✍️ Напиши сообщение по заявке #${depId}:`);
  await app.message(player, 'Добавил, ник RobloxAlice');
  assert.equal(lastSent(player.id).text, '✅ Сообщение отправлено администратору.');
  assert.match(lastSent(admin.id).text, new RegExp(`^💬 Заявка #${depId} — Alice \\(@alice\\) · id 1001:\\n\\nДобавил, ник RobloxAlice$`));

  // a Telegram reply to the admin's message works too
  const tgMsgId = (await app.ctx.db.one("SELECT tg_msg_id FROM bs_request_msgs WHERE request_id = $1 AND author = 'admin'", [depId])).tg_msg_id;
  await app.message(player, 'Жду трейд', { reply_to_message: { message_id: tgMsgId, date: 0, chat: { id: player.id, type: 'private' }, from: app.tg.me, text: 'x' } });
  // a plain message without context is ignored
  await app.message(player, 'просто текст');

  const d = await app.get(`/api/admin/requests/${depId}`, { user: admin });
  const texts = d.body.messages.map((m) => [m.author, m.text]);
  assert.deepEqual(texts, [
    ['system', 'created'],
    ['admin', 'Привет! Добавь в друзья BossRoblox'],
    ['user', 'Добавил, ник RobloxAlice'],
    ['user', 'Жду трейд'],
  ]);
  assert.equal(d.body.request.waiting, true, 'player wrote last');
  assert.equal(d.body.request.lastText, 'Жду трейд');
  assert.equal(d.body.request.user.balance, await balance(player.id));

  // someone else can't hijack the request through the button
  await callback(other, `rq:${depId}`);
  await app.message(other, 'чужое');
  assert.equal((await app.get(`/api/admin/requests/${depId}`, { user: admin })).body.messages.length, 4);
});

test('deposit: admin credits coins and gives a brainrot, then completes it', async () => {
  const before = await balance(player.id);
  const c = await app.post(`/api/admin/requests/${depId}/credit`, { user: admin, body: { amount: 250 } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.request.coins, 250);
  assert.equal(await balance(player.id), before + 250);
  for (const amount of [0, -1, 1.5, 'x']) {
    assert.equal((await app.post(`/api/admin/requests/${depId}/credit`, { user: admin, body: { amount } })).status, 400);
  }
  const it = itemByName('Tralalero Tralala');
  const g = await app.post(`/api/admin/requests/${depId}/give`, { user: admin, body: { itemId: it.id } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.deepEqual(g.body.request.items.map((i) => i.name), ['Tralalero Tralala']);
  const inv = (await app.get('/api/inventory', { user: player })).body.inventory;
  assert.equal(inv[0].item.name, 'Tralalero Tralala');
  const log = await app.ctx.db.one("SELECT delta, admin_id FROM bs_balance_log WHERE reason = $1", [`deposit:#${depId}`]);
  assert.deepEqual(log, { delta: 250, admin_id: admin.id });

  app.tg.reset();
  const done = await app.post(`/api/admin/requests/${depId}/status`, { user: admin, body: { status: 'done' } });
  assert.equal(done.status, 200);
  assert.equal(done.body.request.status, 'done');
  assert.equal(done.body.request.waiting, false);
  assert.equal(lastSent(player.id).text, `✅ Заявка на пополнение #${depId} выполнена.\nЗачислено: +250 🪙\nВыдано: Tralalero Tralala`);
  assert.equal(lastSent(player.id).reply_markup, undefined, 'no reply button on a closed request');
  const sys = done.body.messages.filter((m) => m.author === 'system').map((m) => m.text);
  assert.deepEqual(sys, ['created', 'credit:250', `give:${it.id}`, 'status:done']);

  // closed: no more coins, no double completion
  assert.equal((await app.post(`/api/admin/requests/${depId}/credit`, { user: admin, body: { amount: 5 } })).body.error, 'request_closed');
  assert.equal((await app.post(`/api/admin/requests/${depId}/status`, { user: admin, body: { status: 'rejected' } })).body.error, 'request_closed');
  assert.equal((await app.post(`/api/admin/requests/${depId}/status`, { user: admin, body: { status: 'weird' } })).status, 400);
  const open = await app.get('/api/admin/requests?kind=deposit', { user: admin });
  assert.ok(!open.body.requests.some((x) => x.id === depId));

  // the conversation is over: the player is told so, nothing is stored
  const msgs = (await app.get(`/api/admin/requests/${depId}`, { user: admin })).body.messages.length;
  await callback(player, `rq:${depId}`);
  assert.equal(lastSent(player.id).text, `⚠️ Заявка #${depId} уже закрыта.`);
  const tgMsgId = (await app.ctx.db.one("SELECT tg_msg_id FROM bs_request_msgs WHERE request_id = $1 AND author = 'admin'", [depId])).tg_msg_id;
  await app.message(player, 'ещё вопрос', { reply_to_message: { message_id: tgMsgId, date: 0, chat: { id: player.id, type: 'private' }, from: app.tg.me, text: 'x' } });
  assert.equal(lastSent(player.id).text, `⚠️ Заявка #${depId} уже закрыта.`);
  assert.equal((await app.get(`/api/admin/requests/${depId}`, { user: admin })).body.messages.length, msgs);
  // a forged huge id in the button is ignored, not a server error
  assert.equal(await callback(player, 'rq:99999999999999999999'), 200);
  const all = await app.get('/api/admin/requests?kind=deposit&scope=all', { user: admin });
  assert.ok(all.body.requests.some((x) => x.id === depId));
});

// ------------------------------------------------------------------ withdrawals
test('withdraw: opens after top-ups of 100 ⭐ or brainrots worth one Garama and Madundung', async () => {
  const u = users.dave;
  await app.post('/api/bootstrap', { user: u });
  const [cer] = await giveItems(u.id, ['Cerberus']);
  const garama = itemByName('Garama and Madundung');
  const state = async () => (await app.get('/api/me', { user: u })).body.withdraw;
  assert.deepEqual(await state(), { open: false, stars: 0, brainrots: 0, need: { stars: 100, item: { id: garama.id, name: garama.name, value: garama.value } } });
  const locked = await app.post('/api/requests/withdraw', { user: u, body: { nick: 'DaveR', ids: [cer] } });
  assert.equal(locked.status, 403);
  assert.deepEqual(locked.body, { error: 'withdraw_locked', stars: 100, item: 'Garama and Madundung' });
  assert.equal((await app.get('/api/inventory', { user: u })).body.inventory.length, 1, 'nothing taken');

  // 99 ⭐ and brainrots worth less than one Garama: still locked
  await app.paidStars(u.id, 99);
  const dep = await app.ctx.db.one(
    "INSERT INTO bs_requests (user_id, kind, method, status, coins) VALUES ($1, 'deposit', 'brainrot', 'active', $2) RETURNING id",
    [u.id, garama.value - 1],
  );
  assert.equal((await state()).open, false);
  assert.equal((await state()).stars, 99);
  // coins credited + brainrots given on a brainrot deposit count (also while it is still open)
  await app.post(`/api/admin/requests/${dep.id}/give`, { user: admin, body: { itemId: itemByName('Tung Tung Tung Sahur').id } });
  assert.equal((await state()).open, true);
  await freshWindow();
  const ok = await app.post('/api/requests/withdraw', { user: u, body: { nick: 'DaveR', ids: [cer] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await app.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE user_id = $1", [u.id]);

  // 100 ⭐ alone open it too
  const e = { id: 1005, first_name: 'Erin', language_code: 'en' };
  await app.post('/api/bootstrap', { user: e });
  await app.paidStars(e.id, 60);
  await app.paidStars(e.id, 40);
  assert.equal((await app.get('/api/me', { user: e })).body.withdraw.open, true);
});

test('withdraw: brainrots leave the inventory and are held by the request', async () => {
  await app.paidStars(other.id);
  await app.paidStars(users.carol.id);
  const ids = await giveItems(other.id, ['Cerberus', 'Garama and Madundung', 'Capitano Moby']);
  const bad = await app.post('/api/requests/withdraw', { user: other, body: { nick: 'BobR', ids: [ids[0], 999999] } });
  assert.equal(bad.body.error, 'items_missing');
  assert.equal((await app.get('/api/inventory', { user: other })).body.inventory.length, 3, 'nothing taken on error');
  assert.equal((await app.post('/api/requests/withdraw', { user: other, body: { nick: 'BobR', ids: [] } })).status, 400);
  assert.equal((await app.post('/api/requests/withdraw', { user: other, body: { ids: [ids[0]] } })).body.error, 'bad_nick');
  await freshWindow();
  // someone else's items can't be withdrawn
  assert.equal((await app.post('/api/requests/withdraw', { user: player, body: { nick: 'Alice1', ids: [ids[0]] } })).body.error, 'items_missing');

  app.tg.reset();
  const r = await app.post('/api/requests/withdraw', { user: other, body: { nick: 'BobR', ids: [ids[0], ids[2]] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = r.body.request;
  assert.equal(w.kind, 'withdraw');
  assert.deepEqual(r.body.removed.sort(), [ids[0], ids[2]].sort());
  assert.deepEqual(w.items.map((i) => i.name), ['Cerberus', 'Capitano Moby']);
  assert.equal(w.total, 300 + 205);
  assert.equal(w.exchange, null);
  assert.equal(r.body.rest, 0);
  const left = (await app.get('/api/inventory', { user: other })).body.inventory;
  assert.deepEqual(left.map((i) => i.item.name), ['Garama and Madundung']);
  assert.match(lastSent(other.id).text, /^📤 Заявку на виведення #\d+ прийнято\.\n\nНік у Roblox: BobR\nБрейнроти: Cerberus, Capitano Moby\nНа суму: 505 🪙\n\nАдміністратор/);
  assert.match(lastSent(admin.id).text, /^🆕 Вывод #\d+/);
  assert.equal(lastSent(admin.id).reply_markup.inline_keyboard[0][0].web_app.url, `https://app.dragondrop.test/?go=admin/withdrawals/${w.id}`);
  const counts = await app.get('/api/admin/requests/counts', { user: admin });
  assert.deepEqual(counts.body.counts, { deposit: 0, withdraw: 1 });
  // coins can't be credited to a withdrawal
  assert.equal((await app.post(`/api/admin/requests/${w.id}/credit`, { user: admin, body: { amount: 5 } })).body.error, 'bad_request');

  // rejected -> items come back
  app.tg.reset();
  const rej = await app.post(`/api/admin/requests/${w.id}/status`, { user: admin, body: { status: 'rejected' } });
  assert.equal(rej.body.request.status, 'rejected');
  const back = (await app.get('/api/inventory', { user: other })).body.inventory.map((i) => i.item.name).sort();
  assert.deepEqual(back, ['Capitano Moby', 'Cerberus', 'Garama and Madundung']);
  assert.equal(lastSent(other.id).text, `❌ Заявку #${w.id} відхилено.\nБрейнроти повернулися в інвентар.`);
});

test('withdraw: completed withdrawal keeps the items out of the game', async () => {
  const inv = (await app.get('/api/inventory', { user: other })).body.inventory;
  const r = await app.post('/api/requests/withdraw', { user: other, body: { nick: 'BobR', ids: [inv[0].invId] } });
  app.tg.reset();
  const done = await app.post(`/api/admin/requests/${r.body.request.id}/status`, { user: admin, body: { status: 'done' } });
  assert.equal(done.body.request.status, 'done');
  assert.equal((await app.get('/api/inventory', { user: other })).body.inventory.length, inv.length - 1);
  assert.equal(lastSent(other.id).text, `✅ Виведення за заявкою #${r.body.request.id} виконано.`);
});

test('withdraw: only the listed brainrots; others are exchanged for one of them, the remainder goes to the balance', async () => {
  const allowed = ['Garama and Madundung', 'Cerberus', 'Capitano Moby', 'Burguro and Fryuro', 'Dragon Cannelloni'];
  const boot = (await app.post('/api/bootstrap', { user: other })).body;
  assert.deepEqual(boot.withdrawIds.map((id) => app.ctx.game.catalog.items.get(id).name).sort(), [...allowed].sort());

  await app.ctx.db.query('DELETE FROM bs_inventory WHERE user_id = $1', [other.id]);
  const [pot, chillis, garama] = await giveItems(other.id, ['Pot Hotspot', 'Los Chillis', 'Garama and Madundung']);
  const all = [pot, chillis, garama];
  const body = (extra) => ({ user: other, body: { nick: 'BobR', ids: all, ...extra } });
  await freshWindow();
  const need = await app.post('/api/requests/withdraw', body());
  assert.equal(need.status, 400);
  assert.equal(need.body.error, 'need_exchange');
  assert.equal(need.body.value, 40 + 285, 'value of the ones that must be exchanged');
  assert.equal((await app.post('/api/requests/withdraw', body({ exchangeTo: itemByName('Dragon Cannelloni').id }))).body.error, 'exchange_too_expensive');
  assert.equal((await app.post('/api/requests/withdraw', body({ exchangeTo: itemByName('Tung Tung Tung Sahur').id }))).body.error, 'not_withdrawable');
  assert.equal((await app.post('/api/requests/withdraw', { user: other, body: { nick: 'BobR', ids: [garama], exchangeTo: itemByName('Cerberus').id } })).body.error, 'bad_request');
  assert.equal((await app.get('/api/inventory', { user: other })).body.inventory.length, 3, 'nothing taken on errors');

  await freshWindow();
  const before = await balance(other.id);
  app.tg.reset();
  const r = await app.post('/api/requests/withdraw', body({ exchangeTo: itemByName('Cerberus').id }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rest, 325 - 300);
  assert.equal(r.body.balance, before + 25);
  assert.equal(await balance(other.id), before + 25);
  const w = r.body.request;
  assert.deepEqual(w.items.map((i) => i.name), ['Cerberus', 'Garama and Madundung'], 'kept one + the exchange');
  assert.equal(w.total, 300 + 175);
  assert.deepEqual(w.exchange.from.map((i) => i.name).sort(), ['Los Chillis', 'Pot Hotspot']);
  assert.equal(w.exchange.rest, 25);
  assert.equal((await app.get('/api/inventory', { user: other })).body.inventory.length, 0);
  const log = await app.ctx.db.one('SELECT delta FROM bs_balance_log WHERE reason = $1', [`exchange:#${w.id}`]);
  assert.equal(log.delta, 25);
  assert.match(lastSent(other.id).text, /Брейнроти: Cerberus, Garama and Madundung\nНа суму: 475 🪙\nЗалишок на баланс: \+25 🪙/);
  const d = (await app.get(`/api/admin/requests/${w.id}`, { user: admin })).body.request;
  assert.equal(d.exchange.value, 325);

  // declined: the withdrawable brainrots come back (the exchange stays done)
  await app.post(`/api/admin/requests/${w.id}/status`, { user: admin, body: { status: 'rejected' } });
  const back = (await app.get('/api/inventory', { user: other })).body.inventory.map((i) => i.item.name).sort();
  assert.deepEqual(back, ['Cerberus', 'Garama and Madundung']);

  // admins can allow more brainrots
  const tung = itemByName('Tung Tung Tung Sahur');
  const put = await app.put(`/api/admin/items/${tung.id}`, { user: admin, body: { name: tung.name, value: tung.value, emoji: tung.emoji, withdrawable: true } });
  assert.equal(put.status, 200);
  assert.ok((await app.get('/api/catalog', { user: other })).body.withdrawIds.includes(tung.id));
  const items = (await app.get('/api/admin/items', { user: admin })).body.items;
  assert.equal(items.find((i) => i.id === tung.id).withdrawable, true);
  // saving without the field keeps it
  await app.put(`/api/admin/items/${tung.id}`, { user: admin, body: { name: tung.name, value: tung.value, emoji: tung.emoji } });
  assert.equal((await app.get('/api/admin/items', { user: admin })).body.items.find((i) => i.id === tung.id).withdrawable, true);
  await app.put(`/api/admin/items/${tung.id}`, { user: admin, body: { name: tung.name, value: tung.value, emoji: tung.emoji, withdrawable: false } });
  assert.ok(!(await app.get('/api/catalog', { user: other })).body.withdrawIds.includes(tung.id));
  // a disabled brainrot that can be withdrawn stays in the list (players may still own it)
  const cer = itemByName('Cerberus');
  await app.put(`/api/admin/items/${cer.id}`, { user: admin, body: { name: cer.name, value: cer.value, emoji: cer.emoji, enabled: false } });
  assert.ok((await app.get('/api/catalog', { user: other })).body.withdrawIds.includes(cer.id));
  await app.put(`/api/admin/items/${cer.id}`, { user: admin, body: { name: cer.name, value: cer.value, emoji: cer.emoji, enabled: true } });
  await app.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE user_id = $1 AND status IN ('new', 'active')", [other.id]);
});

test('a player can have at most 5 open requests, one of them a brainrot deposit (one place in the queue)', async () => {
  const u = users.carol;
  const dep = await app.post('/api/requests/deposit', { user: u, body: { nick: 'CarolR', details: 'brainrot 0' } });
  assert.equal(dep.status, 200, JSON.stringify(dep.body));
  const again = await app.post('/api/requests/deposit', { user: u, body: { nick: 'CarolR', details: 'brainrot 1' } });
  assert.equal(again.status, 400);
  assert.deepEqual(again.body, { error: 'deposit_open', id: dep.body.request.id }, 'the request sent before goes first');
  const ids = await giveItems(u.id, ['Cerberus', 'Cerberus', 'Cerberus', 'Cerberus', 'Cerberus']);
  for (let i = 0; i < 4; i++) {
    await wait(260); // stay under the action rate limit
    const r = await app.post('/api/requests/withdraw', { user: u, body: { nick: 'CarolR', ids: [ids[i]] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await freshWindow();
  const r = await app.post('/api/requests/withdraw', { user: u, body: { nick: 'CarolR', ids: [ids[4]] } });
  assert.equal(r.body.error, 'too_many_requests');
  await app.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE user_id = $1 AND kind = 'withdraw'", [u.id]);
});

test('blocked bot: the admin sees the message was not delivered', async () => {
  const r0 = await app.post('/api/requests/deposit', { user: users.dave, body: { nick: 'DaveR', details: 'Odin Din Din Dun' } });
  await app.message(users.dave, '/start');
  app.tg.state.failSend.set(users.dave.id, { code: 403, times: 1 });
  const r = await app.post(`/api/admin/requests/${r0.body.request.id}/messages`, { user: admin, body: { text: 'Ау?' } });
  assert.equal(r.body.delivered, false);
  assert.equal(r.body.messages.at(-1).delivered, false);
  assert.equal(r.body.request.user.blockedBot, true);
  assert.equal((await app.post(`/api/admin/requests/${r0.body.request.id}/messages`, { user: admin, body: { text: '' } })).status, 400);
});

test('admin tabs: in progress / done / declined show only their own requests', async () => {
  await freshWindow();
  const rej = await app.post('/api/requests/deposit', { user: player, body: { nick: 'AliceR', details: 'Tralalero' } });
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal((await app.post(`/api/admin/requests/${rej.body.request.id}/status`, { user: admin, body: { status: 'rejected' } })).status, 200);
  const ids = (list) => list.map((r) => r.id).sort((a, b) => a - b);
  for (const kind of ['deposit', 'withdraw']) {
    const all = (await app.get(`/api/admin/requests?kind=${kind}&scope=all`, { user: admin })).body.requests;
    const by = {};
    for (const scope of ['active', 'done', 'rejected']) {
      const r = await app.get(`/api/admin/requests?kind=${kind}&scope=${scope}`, { user: admin });
      assert.equal(r.status, 200);
      by[scope] = r.body.requests;
    }
    assert.ok(by.active.every((r) => r.status === 'new' || r.status === 'active'), `${kind}: in progress`);
    assert.ok(by.done.every((r) => r.status === 'done'), `${kind}: done`);
    assert.ok(by.rejected.every((r) => r.status === 'rejected'), `${kind}: declined`);
    assert.deepEqual(ids([...by.active, ...by.done, ...by.rejected]), ids(all), `${kind}: the three tabs cover every request once`);
    // no scope = in progress (the default tab)
    assert.deepEqual(ids((await app.get(`/api/admin/requests?kind=${kind}`, { user: admin })).body.requests), ids(by.active));
    if (kind === 'deposit') {
      for (const s of ['active', 'done', 'rejected']) assert.ok(by[s].length > 0, `deposit test data has ${s} requests`);
      assert.ok(by.rejected.some((r) => r.id === rej.body.request.id));
      assert.ok(by.done.some((r) => r.method === 'stars'), 'paid Stars deposits are under "done"');
    }
  }
  assert.equal((await app.get('/api/admin/requests?kind=deposit&scope=bogus', { user: admin })).status, 400);
});

test('deposit by picked brainrots: validated, merged, shown to the player and the admins', async () => {
  const u = { id: 1050, first_name: 'Erin', username: 'erin', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: u });
  await app.message(u, '/start');
  await freshWindow();
  const id = (n) => itemByName(n).id;
  const dep = (offer) => app.post('/api/requests/deposit', { user: u, body: { nick: 'ErinRBX', offer } });
  for (const bad of [[], 'x', [{ itemId: 999999, count: 1 }], [{ itemId: id('Cerberus'), count: 0 }], [{ itemId: id('Cerberus'), count: 100 }], [{ itemId: id('Cerberus'), count: 1.5 }]]) {
    const r = await dep(bad);
    assert.equal(r.body.error, 'bad_offer', JSON.stringify(bad));
  }
  const many = [...app.ctx.game.catalog.items.values()].filter((i) => i.enabled).slice(0, 21).map((i) => ({ itemId: i.id, count: 1 }));
  assert.equal((await dep(many)).body.error, 'bad_offer', 'at most 20 different brainrots');
  // a switched-off brainrot can't be picked
  const off = itemByName('Tim Cheese');
  await app.ctx.db.query('UPDATE bs_items SET enabled = FALSE WHERE id = $1', [off.id]);
  await app.ctx.game.reloadCatalog();
  assert.equal((await dep([{ itemId: off.id, count: 1 }])).body.error, 'bad_offer');
  await app.ctx.db.query('UPDATE bs_items SET enabled = TRUE WHERE id = $1', [off.id]);
  await app.ctx.game.reloadCatalog();
  assert.equal(await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_requests WHERE user_id = $1', [u.id]).then((r) => r.n), 0, 'nothing saved');

  await freshWindow();
  app.tg.reset();
  // the same brainrot twice is merged; count defaults to 1
  const r = await dep([{ itemId: id('Cerberus'), count: 2 }, { itemId: id('Tralalero Tralala') }, { itemId: id('Cerberus'), count: 1 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const req = r.body.request;
  assert.deepEqual(req.offer.map((e) => [e.name, e.count]), [['Cerberus', 3], ['Tralalero Tralala', 1]]);
  assert.equal(req.offerTotal, itemByName('Cerberus').value * 3 + itemByName('Tralalero Tralala').value);
  assert.ok(req.offer.every((e) => e.rarity && e.emoji && e.value > 0));
  assert.equal(req.details, 'Cerberus ×3, Tralalero Tralala');
  // the player and the admins see the list in the bot
  assert.match(lastSent(u.id).text, /Что пополняешь: Cerberus ×3, Tralalero Tralala/);
  assert.match(lastSent(admin.id).text, /📝 Cerberus ×3, Tralalero Tralala/);
  // admin card and list
  const d = (await app.get(`/api/admin/requests/${req.id}`, { user: admin })).body.request;
  assert.deepEqual(d.offer, req.offer);
  const list = (await app.get('/api/admin/requests?kind=deposit', { user: admin })).body.requests;
  assert.equal(list.find((x) => x.id === req.id).offerTotal, req.offerTotal);
  // older requests (free text) still show as they were
  const all = (await app.get('/api/admin/requests?kind=deposit&scope=all', { user: admin })).body.requests;
  assert.equal(all.find((x) => x.id === depId).offer, null);
});

test('admins choose which brainrots can be deposited ("Can be deposited")', async () => {
  const u = { id: 1051, first_name: 'Fred', username: 'fred', language_code: 'ru' };
  await app.post('/api/bootstrap', { user: u });
  await app.message(u, '/start');
  await freshWindow();
  const cer = itemByName('Cerberus');
  const items = (await app.get('/api/admin/items', { user: admin })).body.items;
  assert.ok(items.every((i) => i.depositable === true), 'every brainrot can be deposited at first');
  const ids = async () => (await app.get('/api/catalog', { user: u })).body.depositIds;
  assert.ok((await ids()).includes(cer.id));
  // switched off in the item editor
  const body = { name: cer.name, value: cer.value, emoji: cer.emoji, enabled: true, depositable: false };
  assert.equal((await app.put(`/api/admin/items/${cer.id}`, { user: admin, body })).status, 200);
  assert.ok(!(await ids()).includes(cer.id), 'not offered in the app');
  assert.ok((await app.post('/api/bootstrap', { user: u })).body.depositIds.every((id) => id !== cer.id));
  const r = await app.post('/api/requests/deposit', { user: u, body: { nick: 'FredRBX', offer: [{ itemId: cer.id, count: 1 }] } });
  assert.equal(r.body.error, 'bad_offer', 'and refused by the server');
  // other flags are kept when the field isn't sent; on again
  assert.equal((await app.put(`/api/admin/items/${cer.id}`, { user: admin, body: { ...body, depositable: undefined } })).status, 200);
  assert.ok(!(await ids()).includes(cer.id));
  await app.put(`/api/admin/items/${cer.id}`, { user: admin, body: { ...body, depositable: true } });
  assert.ok((await ids()).includes(cer.id));
  await freshWindow();
  const ok = await app.post('/api/requests/deposit', { user: u, body: { nick: 'FredRBX', offer: [{ itemId: cer.id, count: 1 }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // a new brainrot can be deposited unless switched off
  const fresh = await app.post('/api/admin/items', { user: admin, body: { name: 'Depo Test', value: 5, emoji: '🧪' } });
  assert.ok((await ids()).includes(fresh.body.item.id));
  const off = await app.post('/api/admin/items', { user: admin, body: { name: 'Depo Off', value: 5, emoji: '🧪', depositable: false } });
  assert.ok(!(await ids()).includes(off.body.item.id));
});

test('brainrot deposits: admins close them for a while; no new requests, Stars still work, sent requests go on as usual', async () => {
  await freshWindow();
  const carol = { id: 2101, first_name: 'Кэрол', language_code: 'ru' };
  const other = { id: 2102, first_name: 'Боб', language_code: 'ru' };
  for (const u of [carol, other]) await app.post('/api/bootstrap', { user: u });
  const sentBefore = await app.post('/api/requests/deposit', { user: carol, body: { nick: 'CarolRBX', details: 'Tralalero' } });
  assert.equal(sentBefore.status, 200, JSON.stringify(sentBefore.body));
  const open = async (u) => (await app.post('/api/bootstrap', { user: u })).body.topup.brainrotsOpen;
  assert.equal(await open(carol), true);
  assert.equal((await app.get('/api/admin/requests?kind=deposit', { user: admin })).body.brainrotsOpen, true);
  assert.ok(!('brainrotsOpen' in (await app.get('/api/admin/requests?kind=withdraw', { user: admin })).body));

  // closed
  for (const bad of [undefined, 'no', 0]) {
    assert.equal((await app.put('/api/admin/deposit-gate', { user: admin, body: { open: bad } })).body.error, 'bad_field');
  }
  assert.equal((await app.put('/api/admin/deposit-gate', { user: carol, body: { open: false } })).status, 403);
  const off = await app.put('/api/admin/deposit-gate', { user: admin, body: { open: false } });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { brainrotsOpen: false });
  assert.equal(app.ctx.settings.get('deposits_brainrots_open'), false);
  assert.equal(await open(carol), false);
  assert.equal((await app.get('/api/me', { user: carol })).body.topup.brainrotsOpen, false);
  assert.equal((await app.get('/api/admin/requests?kind=deposit', { user: admin })).body.brainrotsOpen, false);
  const count = async () => (await app.ctx.db.one("SELECT count(*)::int AS n FROM bs_requests WHERE kind = 'deposit' AND method = 'brainrot'")).n;
  const n = await count();
  const refused = await app.post('/api/requests/deposit', { user: other, body: { nick: 'BobRBX', details: 'что-то' } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'deposits_closed');
  assert.equal(await count(), n, 'nothing saved');
  // Stars top-ups are not affected
  assert.equal((await app.post('/api/topup/stars', { user: other, body: { stars: 10 } })).status, 200);
  // the request sent before is handled as usual
  const id = sentBefore.body.request.id;
  assert.equal((await app.post(`/api/admin/requests/${id}/credit`, { user: admin, body: { amount: 10 } })).status, 200);
  assert.equal((await app.post(`/api/admin/requests/${id}/status`, { user: admin, body: { status: 'done' } })).status, 200);

  // open again
  await freshWindow();
  assert.deepEqual((await app.put('/api/admin/deposit-gate', { user: admin, body: { open: true } })).body, { brainrotsOpen: true });
  assert.equal(await open(other), true);
  const again = await app.post('/api/requests/deposit', { user: other, body: { nick: 'BobRBX', details: 'что-то' } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(await count(), n + 1);
});

// ------------------------------------------------------------------ the deposit queue
const P = [3001, 3002, 3003].map((id, i) => ({ id, first_name: ['Аня', 'Боря', 'Вика'][i], username: `q${i}`, language_code: 'ru' }));

test('deposit queue: places in order, the time until the turn, one request per player; the admin list follows the queue', async () => {
  await freshWindow();
  await app.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE status IN ('new', 'active')"); // an empty queue
  for (const u of P) {
    await app.post('/api/bootstrap', { user: u });
    await app.message(u, '/start');
  }
  app.tg.reset();
  const reqs = [];
  for (const [i, u] of P.entries()) {
    const r = await app.post('/api/requests/deposit', { user: u, body: { nick: `Q${i}Roblox`, offer: [{ itemId: itemByName('Cerberus').id, count: i + 1 }] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.queue.state, 'queue');
    assert.equal(r.body.queue.position, i + 1);
    assert.equal(r.body.queue.eta, i * 300, 'nobody is being served: 5 minutes for each one ahead');
    assert.equal(lastSent(u.id).text.split('\n')[0], `📥 Заявка на пополнение #${r.body.request.id} — ты в очереди: №${i + 1}.`);
    reqs.push(r.body.request.id);
  }
  // the app reads it on start and later
  assert.deepEqual((await app.post('/api/bootstrap', { user: P[1] })).body.queue, {
    id: reqs[1], state: 'queue', nick: 'Q1Roblox', details: 'Cerberus ×2', coins: 0, canCancel: true, position: 2, eta: 300,
  });
  assert.equal((await app.get('/api/me', { user: P[2] })).body.queue.position, 3);
  assert.equal((await app.get(`/api/requests/queue?id=${reqs[0]}`, { user: P[0] })).body.queue.position, 1);
  assert.equal((await app.get(`/api/requests/queue?id=${reqs[0]}`, { user: P[1] })).body.queue, null, "someone else's request: nothing");
  assert.equal((await app.get('/api/requests/queue?id=abc', { user: P[1] })).status, 400);
  assert.equal((await app.get('/api/requests/queue', { user: other })).body.queue, null, 'no deposit, no queue');
  // the admin: the queue in its order with the places
  const list = (await app.get('/api/admin/requests?kind=deposit', { user: admin })).body;
  assert.deepEqual(list.requests.map((x) => [x.id, x.queuePos]), reqs.map((id, i) => [id, i + 1]));
  assert.equal(list.tradeNick, null, 'no nick of the admin yet');
});

test('deposit queue: the admin accepts with their nick, the player gets 5 minutes and the nick, the others move up', async () => {
  const [q1, q2, q3] = (await app.ctx.db.many("SELECT id FROM bs_requests WHERE kind = 'deposit' AND status = 'new' ORDER BY id")).map((r) => Number(r.id));
  // the nick: needed first, checked, saved for the next time
  assert.equal((await app.post(`/api/admin/requests/${q1}/accept`, { user: admin })).body.error, 'trade_nick_missing');
  assert.equal((await app.put('/api/admin/trade-nick', { user: player, body: { nick: 'Hacker' } })).status, 403);
  assert.equal((await app.put('/api/admin/trade-nick', { user: admin, body: { nick: 'ab' } })).body.error, 'bad_nick');
  assert.deepEqual((await app.put('/api/admin/trade-nick', { user: admin, body: { nick: '@BossRoblox' } })).body, { tradeNick: 'BossRoblox' });
  assert.equal((await app.get('/api/admin/requests?kind=deposit', { user: admin })).body.tradeNick, 'BossRoblox');
  assert.equal((await app.get(`/api/admin/requests/${q1}`, { user: admin })).body.tradeNick, 'BossRoblox', 'the card has it too');

  app.tg.reset();
  const a = await app.post(`/api/admin/requests/${q1}/accept`, { user: admin });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.delivered, true);
  assert.equal(a.body.request.status, 'active');
  assert.equal(a.body.request.tradeNick, 'BossRoblox');
  assert.ok(a.body.request.tradeLeft >= 299 && a.body.request.tradeLeft <= 300, String(a.body.request.tradeLeft));
  assert.equal(a.body.request.queuePos, null);
  assert.equal(a.body.messages.at(-1).text, 'accept:BossRoblox');
  const msg = lastSent(P[0].id);
  assert.equal(msg.text, `🔔 Твоя очередь! Заявка #${q1}\n\nОтправь трейд в Steal a Brainrot на ник: BossRoblox\nЧто отправляешь: Cerberus\n\n⏱ На это 5 минут.`);
  assert.deepEqual(msg.reply_markup.inline_keyboard, [
    [{ text: '📲 Открыть', web_app: { url: 'https://app.dragondrop.test/?go=queue' } }],
    [{ text: '✍️ Ответить', callback_data: `rq:${q1}` }],
  ]);
  // a Telegram reply to it reaches the request
  const tgId = (await app.ctx.db.one("SELECT tg_msg_id FROM bs_request_msgs WHERE request_id = $1 AND text = 'accept:BossRoblox'", [q1])).tg_msg_id;
  assert.ok(tgId);
  assert.equal((await app.post(`/api/admin/requests/${q1}/accept`, { user: admin })).body.error, 'already_accepted');

  // the player: their turn; the others: one place up, the running trade window first
  const s1 = (await app.get('/api/requests/queue', { user: P[0] })).body.queue;
  assert.equal(s1.state, 'trade');
  assert.equal(s1.tradeNick, 'BossRoblox');
  assert.ok(s1.tradeLeft >= 298 && s1.tradeLeft <= 300);
  assert.ok(!('position' in s1));
  const s2 = (await app.get('/api/requests/queue', { user: P[1] })).body.queue;
  assert.equal(s2.position, 1);
  assert.ok(s2.eta >= 298 && s2.eta <= 300, String(s2.eta));
  const s3 = (await app.get('/api/requests/queue', { user: P[2] })).body.queue;
  assert.equal(s3.position, 2);
  assert.ok(s3.eta >= 598 && s3.eta <= 600, String(s3.eta));
  // the window is over: it no longer holds up the queue; the player still sees the nick
  await app.ctx.db.query("UPDATE bs_requests SET accepted_at = now() - interval '6 minutes' WHERE id = $1", [q1]);
  assert.equal((await app.get('/api/requests/queue', { user: P[1] })).body.queue.eta, 0);
  const late = (await app.get('/api/requests/queue', { user: P[0] })).body.queue;
  assert.deepEqual([late.state, late.tradeLeft, late.tradeNick], ['trade', 0, 'BossRoblox']);
  assert.equal((await app.get(`/api/admin/requests/${q1}`, { user: admin })).body.request.tradeLeft, 0);

  // a message to someone waiting keeps them in the queue; in the list the accepted one comes first
  await app.post(`/api/admin/requests/${q3}/messages`, { user: admin, body: { text: 'Скоро позовём' } });
  const list = (await app.get('/api/admin/requests?kind=deposit', { user: admin })).body.requests;
  assert.deepEqual(list.map((x) => [x.id, x.status, x.queuePos]), [[q1, 'active', null], [q2, 'new', 1], [q3, 'new', 2]]);
  // a nick typed in when accepting is used and saved
  const b = await app.post(`/api/admin/requests/${q2}/accept`, { user: admin, body: { nick: 'BossAlt' } });
  assert.equal(b.body.request.tradeNick, 'BossAlt');
  assert.equal((await app.ctx.db.one('SELECT trade_nick FROM bs_users WHERE id = $1', [admin.id])).trade_nick, 'BossAlt');
  assert.equal((await app.post(`/api/admin/requests/${q3}/accept`, { user: admin, body: { nick: 'x' } })).body.error, 'bad_nick');
  // only brainrot deposits
  const wd = await app.ctx.db.one("INSERT INTO bs_requests (user_id, kind, nick) VALUES ($1, 'withdraw', 'W') RETURNING id", [P[2].id]);
  assert.equal((await app.post(`/api/admin/requests/${wd.id}/accept`, { user: admin })).body.error, 'bad_request');
  await app.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE id = $1", [wd.id]);
});

test('deposit queue: the player cancels (waiting or called, until something is credited); the admin who called them is told', async () => {
  const [q1, q2] = (await app.ctx.db.many("SELECT id FROM bs_requests WHERE kind = 'deposit' AND status = 'active' AND accepted_at IS NOT NULL ORDER BY id")).map((r) => Number(r.id));
  const q3 = Number((await app.ctx.db.one("SELECT id FROM bs_requests WHERE kind = 'deposit' AND status = 'new' AND user_id = 3003")).id);
  await freshWindow();
  // someone else's or unknown: not found; garbage id: bad request
  assert.equal((await app.post(`/api/requests/${q3}/cancel`, { user: P[0] })).status, 404);
  assert.equal((await app.post('/api/requests/99999999/cancel', { user: P[0] })).status, 404);
  assert.equal((await app.post('/api/requests/x/cancel', { user: P[0] })).status, 400);

  // waiting: cancelled, nobody is bothered; the promo code sent with it can be used again
  const promo = await app.ctx.db.one("INSERT INTO bs_auto_promos (code, pct, starts_at, ends_at) VALUES ('QTEST', 10, now() - interval '1 hour', now() + interval '1 hour') RETURNING id");
  await app.ctx.db.query('INSERT INTO bs_auto_promo_uses (promo_id, user_id, request_id) VALUES ($1, $2, $3)', [promo.id, P[2].id, q3]);
  await app.ctx.db.query("UPDATE bs_requests SET promo_id = $2, promo_code = 'QTEST', promo_pct = 10 WHERE id = $1", [q3, promo.id]);
  app.tg.reset();
  const c3 = await app.post(`/api/requests/${q3}/cancel`, { user: P[2] });
  assert.equal(c3.status, 200, JSON.stringify(c3.body));
  assert.equal(c3.body.queue.state, 'cancelled');
  assert.equal(c3.body.queue.canCancel, false);
  assert.equal(app.tg.calls('sendMessage').length, 0, 'nobody to tell');
  assert.equal((await app.ctx.db.one('SELECT count(*)::int AS n FROM bs_auto_promo_uses WHERE promo_id = $1', [promo.id])).n, 0);
  assert.equal((await app.post(`/api/requests/${q3}/cancel`, { user: P[2] })).body.error, 'request_closed');
  assert.equal((await app.get('/api/requests/queue', { user: P[2] })).body.queue, null, 'nothing open any more');
  // the admin: under "declined", marked cancelled, with the line in the conversation
  const rej = (await app.get('/api/admin/requests?kind=deposit&scope=rejected', { user: admin })).body.requests.find((x) => x.id === q3);
  assert.deepEqual([rej.status, rej.cancelled], ['rejected', true]);
  assert.equal((await app.get(`/api/admin/requests/${q3}`, { user: admin })).body.messages.at(-1).text, 'status:cancelled');
  // a new request can be sent now
  const again = await app.post('/api/requests/deposit', { user: P[2], body: { nick: 'Q2Roblox', details: 'Cerberus' } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.queue.position, 1);

  // called: the admin who accepted it is told
  app.tg.reset();
  const c1 = await app.post(`/api/requests/${q1}/cancel`, { user: P[0] });
  assert.equal(c1.body.queue.state, 'cancelled');
  const note = lastSent(admin.id);
  assert.equal(note.text, `🚫 Игрок отменил заявку #${q1} — Аня (@q0) · id 3001`);
  assert.equal(note.reply_markup.inline_keyboard[0][0].web_app.url, `https://app.dragondrop.test/?go=admin/deposits/${q1}`);
  // something credited: too late to cancel
  await app.post(`/api/admin/requests/${q2}/credit`, { user: admin, body: { amount: 30 } });
  assert.equal((await app.get('/api/requests/queue', { user: P[1] })).body.queue.canCancel, false);
  const c2 = await app.post(`/api/requests/${q2}/cancel`, { user: P[1] });
  assert.equal(c2.status, 400);
  assert.equal(c2.body.error, 'request_in_work');
  // finished: the card shows how it ended
  await app.post(`/api/admin/requests/${q2}/status`, { user: admin, body: { status: 'done' } });
  const done = (await app.get(`/api/requests/queue?id=${q2}`, { user: P[1] })).body.queue;
  assert.deepEqual([done.state, done.coins], ['done', 30]);
  await app.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE status IN ('new', 'active')");
});
