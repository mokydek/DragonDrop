import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, users } from './helpers.js';
import { verifyWebToken } from '../src/auth.js';
import { createServer, paths } from '../src/server.js';
import { statSync } from 'node:fs';

let app;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  app = await startApp({ dbName: 'bs_t_bot' });
  await wait(300); // profile setup runs in the background after start
});
after(async () => {
  await app?.close();
});

test('startup: webhook with secret, name/description/commands in 3 languages, menu button, avatar', async () => {
  const hook = app.tg.calls('setWebhook')[0].payload;
  assert.equal(hook.url, 'https://api.dragondrop.test/tg/webhook');
  assert.equal(hook.secret_token, app.ctx.config.webhookSecret);
  assert.deepEqual(hook.allowed_updates, ['message', 'callback_query', 'my_chat_member', 'pre_checkout_query']);

  assert.equal(app.tg.calls('setMyName').length, 0, 'name already DragonDrop in getMe');
  const desc = app.tg.calls('setMyDescription').map((c) => [c.payload.language_code || '', c.payload.description]);
  assert.deepEqual(desc.map((d) => d[0]), ['', 'ru', 'uk', 'en']);
  assert.ok(desc.every((d) => d[1].startsWith('DragonDrop')));
  assert.equal(app.tg.calls('setMyShortDescription').length, 4);
  const cmds = app.tg.calls('setMyCommands');
  assert.equal(cmds.length, 4);
  assert.deepEqual(cmds[3].payload.commands, [{ command: 'start', description: 'Main menu' }]);
  const menu = app.tg.calls('setChatMenuButton')[0].payload;
  assert.equal(menu.chat_id, undefined);
  assert.deepEqual(menu.menu_button, { type: 'web_app', text: 'Играть', web_app: { url: 'https://app.dragondrop.test/' } });
  const photo = app.tg.calls('setMyProfilePhoto')[0].payload;
  assert.equal(photo.photo.type, 'static');
  assert.match(photo.photo.photo, /^attach:\/\//);
  const attached = Object.values(photo).find((v) => v && v.filename !== undefined);
  assert.ok(attached && attached.size === statSync(paths.avatar).size, 'the avatar jpeg uploaded');
});

test('startup profile setup is skipped when nothing changed', async () => {
  const before = app.tg.state.calls.length;
  const again = await createServer(
    {
      NODE_ENV: 'test',
      DATABASE_URL: app.ctx.config.databaseUrl,
      BOT_TOKEN: app.ctx.config.botToken,
      TELEGRAM_API_ROOT: app.tg.url,
      API_URL: 'https://api.dragondrop.test',
      WEB_URL: 'https://app.dragondrop.test',
      BOT_MODE: 'webhook',
    },
    {},
  );
  await again.start(0);
  await wait(300);
  await again.stop();
  const newCalls = app.tg.state.calls.slice(before).map((c) => c.method);
  assert.ok(!newCalls.includes('setMyDescription'), newCalls.join(','));
  assert.ok(!newCalls.includes('setMyProfilePhoto'));
  assert.ok(!newCalls.includes('setWebhook'), 'webhook already points to the right url');
});

test('startup: an old webhook without payment updates is re-registered', async () => {
  app.tg.state.allowedUpdates = ['message', 'callback_query', 'my_chat_member'];
  app.tg.reset();
  const again = await createServer(
    {
      NODE_ENV: 'test',
      DATABASE_URL: app.ctx.config.databaseUrl,
      BOT_TOKEN: app.ctx.config.botToken,
      TELEGRAM_API_ROOT: app.tg.url,
      API_URL: 'https://api.dragondrop.test',
      WEB_URL: 'https://app.dragondrop.test',
      BOT_MODE: 'webhook',
    },
    {},
  );
  await again.start(0);
  await wait(300);
  await again.stop();
  const hooks = app.tg.calls('setWebhook');
  assert.equal(hooks.length, 1);
  assert.deepEqual(hooks[0].payload.allowed_updates, ['message', 'callback_query', 'my_chat_member', 'pre_checkout_query']);
});

test('webhook rejects requests without the secret', async () => {
  const res = await fetch(`${app.base}/tg/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
    body: JSON.stringify({ update_id: 1 }),
  });
  assert.equal(res.status, 401);
});

test('/start sends the banner with the SABHelper-style text and buttons', async () => {
  app.tg.reset();
  assert.equal(await app.message(users.alice, '/start'), 200);
  const sent = app.tg.calls('sendPhoto');
  assert.equal(sent.length, 1);
  const p = sent[0].payload;
  assert.equal(Number(p.chat_id), users.alice.id);
  assert.match(p.photo, /^attach:\/\//, 'first start uploads the banner file');
  const file = p[p.photo.slice('attach://'.length)];
  assert.ok(file && file.size > 1000, 'banner bytes attached');
  assert.match(p.caption, /^😎 Добро пожаловать в DragonDrop!/);
  assert.match(p.caption, /Кнопка «Играть на сайте» сразу входит в твой аккаунт — никому её не пересылай\./);
  const kb = p.reply_markup.inline_keyboard;
  assert.equal(kb[0][0].text, '🎮 Играть в Telegram');
  assert.deepEqual(kb[0][0].web_app, { url: 'https://app.dragondrop.test/' });
  assert.equal(kb[0][1].text, '🌐 Играть на сайте');
  const login = new URL(kb[0][1].url).searchParams.get('login');
  assert.deepEqual(verifyWebToken(login, app.ctx.config.sessionSecret), { userId: users.alice.id, ver: 1 });
  assert.equal(kb[1][0].text, '🎁 Ввести промокод', 'no news/support buttons until links are set');
  assert.equal(kb[1][0].callback_data, 'promo');

  const menu = app.tg.calls('setChatMenuButton').at(-1).payload;
  assert.equal(Number(menu.chat_id), users.alice.id);
  assert.equal(menu.menu_button.text, 'Играть');

  const row = await app.ctx.db.one('SELECT * FROM bs_users WHERE id = $1', [users.alice.id]);
  assert.equal(row.started_bot, true);
  assert.equal(row.lang, 'ru');

  // Second /start reuses the uploaded file id
  await app.message(users.alice, '/start');
  assert.equal(app.tg.calls('sendPhoto')[1].payload.photo, 'PHOTO_FILE_1');
});

test('/start in Ukrainian and English, with news and support links', async () => {
  await app.ctx.settings.update({ news_url: 'https://t.me/dragondrop', support_url: 'https://t.me/dragondrop_help' });
  app.tg.reset();
  await app.message(users.bob, '/start');
  await app.message(users.carol, '/start');
  const [uk, en] = app.tg.calls('sendPhoto').map((c) => c.payload);
  assert.match(uk.caption, /^😎 Ласкаво просимо до DragonDrop!/);
  assert.equal(uk.reply_markup.inline_keyboard[0][0].text, '🎮 Грати в Telegram');
  assert.deepEqual(
    uk.reply_markup.inline_keyboard[1].map((b) => [b.text, b.url]),
    [
      ['📢 Новини', 'https://t.me/dragondrop'],
      ['💬 Підтримка', 'https://t.me/dragondrop_help'],
    ],
  );
  assert.match(en.caption, /^😎 Welcome to DragonDrop!/);
  assert.equal(en.reply_markup.inline_keyboard[2][0].text, '🎁 Enter promo code');
  const menus = app.tg.calls('setChatMenuButton').map((c) => c.payload.menu_button.text);
  assert.deepEqual(menus, ['Грати', 'Play']);
});

test('custom welcome text from the admin panel is used', async () => {
  await app.ctx.settings.update({ welcome_ru: 'Привет! Свой текст.' });
  app.tg.reset();
  await app.message(users.alice, '/start');
  assert.equal(app.tg.calls('sendPhoto')[0].payload.caption, 'Привет! Свой текст.');
  await app.ctx.settings.update({ welcome_ru: '' });
});

test('promo code through the bot', async () => {
  await app.ctx.db.query("INSERT INTO bs_promo_codes (code, amount, max_uses) VALUES ('BOT25', 25, 10)");
  app.tg.reset();
  const cb = await app.sendUpdate({
    callback_query: {
      id: 'cb1',
      from: { is_bot: false, ...users.alice },
      chat_instance: '1',
      data: 'promo',
      message: { message_id: 5, date: 1, chat: { id: users.alice.id, type: 'private' }, text: 'x' },
    },
  });
  assert.equal(cb, 200);
  assert.equal(app.tg.calls('answerCallbackQuery').length, 1);
  assert.equal(app.tg.calls('sendMessage')[0].payload.text, '🎁 Отправь промокод одним сообщением:');
  assert.equal(app.tg.calls('sendMessage')[0].payload.reply_markup.force_reply, true);

  await app.message(users.alice, 'bot25');
  const ok = app.tg.calls('sendMessage')[1].payload.text;
  assert.match(ok, /^✅ Промокод активирован: \+25 🪙\nБаланс: 25 🪙$/);

  // Text without the prompt is ignored; a used code reports an error
  await app.message(users.alice, 'bot25');
  assert.equal(app.tg.calls('sendMessage').length, 2);
  await app.sendUpdate({
    callback_query: { id: 'cb2', from: { is_bot: false, ...users.alice }, chat_instance: '1', data: 'promo', message: { message_id: 6, date: 1, chat: { id: users.alice.id, type: 'private' }, text: 'x' } },
  });
  await app.message(users.alice, 'BOT25');
  assert.equal(app.tg.calls('sendMessage').at(-1).payload.text, '⚠️ Ты уже активировал этот промокод.');
});

test('/admin with the right code grants admin, wrong code and brute force are refused', async () => {
  app.tg.reset();
  await app.message(users.bob, '/admin nope');
  assert.equal(app.tg.calls('sendMessage').at(-1).payload.text, '❌ Невірний код.');
  await app.message(users.bob, '/admin let-me-in-42');
  assert.match(app.tg.calls('sendMessage').at(-1).payload.text, /^✅ Готово, тепер ти адмін/);
  assert.equal((await app.ctx.db.one('SELECT is_admin FROM bs_users WHERE id = $1', [users.bob.id])).is_admin, true);

  for (let i = 0; i < 5; i++) await app.message(users.carol, '/admin guess' + i);
  await app.message(users.carol, '/admin let-me-in-42');
  assert.equal(app.tg.calls('sendMessage').at(-1).payload.text, '❌ Wrong code.');
  assert.equal((await app.ctx.db.one('SELECT is_admin FROM bs_users WHERE id = $1', [users.carol.id])).is_admin, false);
});

test('blocking the bot is tracked and broadcast skips/marks blocked users', async () => {
  await app.sendUpdate({
    my_chat_member: {
      chat: { id: users.carol.id, type: 'private' },
      from: { is_bot: false, ...users.carol },
      date: 1,
      old_chat_member: { status: 'member', user: app.tg.me },
      new_chat_member: { status: 'kicked', user: app.tg.me, until_date: 0 },
    },
  });
  assert.equal((await app.ctx.db.one('SELECT blocked_bot FROM bs_users WHERE id = $1', [users.carol.id])).blocked_bot, true);

  // Alice hits a rate limit once, a new user blocked the bot without us knowing
  await app.message(users.dave, '/start');
  app.tg.state.failSend.set(users.alice.id, { code: 429, retry_after: 1, times: 1 });
  app.tg.state.failSend.set(users.dave.id, { code: 403, times: 1 });
  app.tg.reset();
  const [r, dup] = await Promise.all([
    app.post('/api/admin/broadcast', { user: users.bob, body: { text: 'Новый кейс уже в игре!' } }),
    app.post('/api/admin/broadcast', { user: users.bob, body: { text: 'Новый кейс уже в игре!' } }),
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(dup.body.error, 'broadcast_running', 'a second broadcast cannot start while one is running');
  assert.equal(r.body.status.total, 3); // alice, bob, dave (carol blocked)
  for (let i = 0; i < 50 && (await app.get('/api/admin/broadcast', { user: users.bob })).body.status.running; i++) await wait(100);
  const st = (await app.get('/api/admin/broadcast', { user: users.bob })).body.status;
  assert.equal(st.sent, 2);
  assert.equal(st.failed, 1);
  const msgs = app.tg.calls('sendMessage');
  assert.ok(msgs.every((m) => m.payload.text === 'Новый кейс уже в игре!'));
  assert.deepEqual(msgs[0].payload.reply_markup.inline_keyboard[0][0].web_app, { url: 'https://app.dragondrop.test/' });
  assert.equal((await app.ctx.db.one('SELECT blocked_bot FROM bs_users WHERE id = $1', [users.dave.id])).blocked_bot, true);
});

test('banned users get a short notice on /start', async () => {
  await app.ctx.db.query('UPDATE bs_users SET is_banned = TRUE WHERE id = $1', [users.dave.id]);
  app.tg.reset();
  await app.message(users.dave, '/start');
  assert.equal(app.tg.calls('sendPhoto').length, 0);
  assert.equal(app.tg.calls('sendMessage')[0].payload.text, '⛔ Access to the bot is restricted.');
});
