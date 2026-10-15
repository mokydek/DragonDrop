// Halloween: admins switch it on in the settings (`halloween`, off by default). The app gets the flag
// (and draws the Halloween look); the bot's /start and the shared post use the Halloween picture and text.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { startApp } from './helpers.js';
import { paths } from '../src/server.js';

let app;
let nextId = 9701;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  app = await startApp({ dbName: 'bs_t_halloween' });
  await wait(300); // the bot profile is set up in the background after start
});
after(async () => {
  await app?.close();
});

const player = (lang = 'ru') => ({ id: nextId++, first_name: 'Ира', language_code: lang });
async function admin() {
  const a = player();
  await app.post('/api/bootstrap', { user: a });
  await app.makeAdmin(a.id);
  return a;
}
const setHalloween = (a, on) => app.put('/api/admin/settings', { user: a, body: { halloween: on } });
/** The picture's URL for Telegram: the hash of the file in it, so Telegram fetches a changed picture again. */
const picUrl = (name, file) => `https://api.dragondrop.test/img/${name}.jpg?v=${crypto.createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10)}`;
/** The bytes a sendPhoto call uploaded (first /start) — null when it reused a Telegram file id. */
const uploaded = (p) => (/^attach:\/\//.test(p.photo) ? p[p.photo.slice('attach://'.length)] : null);

test('the switch: off by default, only admins change it, booleans only', async () => {
  const a = await admin();
  const s = (await app.get('/api/admin/settings', { user: a })).body.settings;
  assert.equal(s.halloween, false);
  const u = player();
  assert.equal((await app.post('/api/bootstrap', { user: u })).body.halloween, false);
  assert.equal((await app.put('/api/admin/settings', { user: u, body: { halloween: true } })).status, 403, 'players cannot');
  for (const bad of ['yes', 1, null]) assert.equal((await setHalloween(a, bad)).body.error, 'bad_setting', String(bad));
  assert.equal(app.ctx.settings.get('halloween'), false);
});

test('the app learns about it from /bootstrap and /catalog (an admin sees the change right after saving)', async () => {
  const a = await admin();
  const u = player();
  assert.equal((await setHalloween(a, true)).status, 200);
  try {
    assert.equal((await app.post('/api/bootstrap', { user: u })).body.halloween, true);
    assert.equal((await app.get('/api/catalog', { user: a })).body.halloween, true);
    // the Halloween case is a normal case: same price, same loot, opens as usual
    const c = (await app.post('/api/bootstrap', { user: u })).body.cases.find((x) => x.slug === 'halloween');
    assert.ok(c && c.price > 0 && !c.isFree);
  } finally {
    await setHalloween(a, false);
  }
  assert.equal((await app.get('/api/catalog', { user: a })).body.halloween, false);
});

test('/start while Halloween is on: the Halloween picture and text; the usual ones again when it is off', async () => {
  const a = await admin();
  const ru = player('ru');
  const uk = player('uk');
  const en = player('en');
  const hwSize = statSync(paths.bannerHalloween).size;
  const usualSize = statSync(paths.banner).size;
  assert.notEqual(hwSize, usualSize);

  await setHalloween(a, true);
  try {
    app.tg.reset();
    await app.message(ru, '/start');
    let p = app.tg.calls('sendPhoto')[0].payload;
    assert.equal(uploaded(p).size, hwSize, 'the Halloween picture is uploaded');
    assert.match(p.caption, /^🎃 Хэллоуин в DragonDrop! 👻/);
    assert.match(p.caption, /Кнопка «Играть на сайте» сразу входит в твой аккаунт — никому её не пересылай\./);
    assert.equal(p.reply_markup.inline_keyboard[0][0].text, '🎮 Играть в Telegram', 'the same buttons');
    // the next /start reuses the uploaded Halloween picture
    await app.message(ru, '/start');
    const fileId = app.tg.calls('sendPhoto')[1].payload.photo;
    assert.equal(fileId, app.ctx.settings.get('_banner_halloween_file_id'));
    assert.match(fileId, /^PHOTO_FILE_/);
    await app.message(uk, '/start');
    await app.message(en, '/start');
    const [, , pu, pe] = app.tg.calls('sendPhoto').map((c) => c.payload);
    assert.match(pu.caption, /^🎃 Хелловін у DragonDrop! 👻/);
    assert.match(pe.caption, /^🎃 Halloween at DragonDrop! 👻/);
    assert.equal(pu.photo, fileId);

    // admins' own /start text stays; the picture is still the Halloween one
    await app.ctx.settings.update({ welcome_ru: 'Свой текст админов.' });
    await app.message(ru, '/start');
    p = app.tg.calls('sendPhoto').at(-1).payload;
    assert.equal(p.caption, 'Свой текст админов.');
    assert.equal(p.photo, fileId);
    await app.ctx.settings.update({ welcome_ru: '' });
  } finally {
    await setHalloween(a, false);
  }
  // off: the usual picture (its own cached file, or uploaded now) and text
  app.tg.reset();
  await app.message(ru, '/start');
  const p = app.tg.calls('sendPhoto')[0].payload;
  assert.match(p.caption, /^😎 Добро пожаловать в DragonDrop!/);
  const up = uploaded(p);
  if (up) assert.equal(up.size, usualSize);
  else assert.equal(p.photo, app.ctx.settings.get('_banner_file_id'));
  assert.notEqual(p.photo, app.ctx.settings.get('_banner_halloween_file_id'));
});

test('sharing the bot while Halloween is on: the Halloween picture and caption', async () => {
  const a = await admin();
  const u = player('ru');
  await app.post('/api/bootstrap', { user: u });
  await setHalloween(a, true);
  try {
    const r = await app.post('/api/free/share', { user: u });
    assert.equal(r.status, 200);
    const prep = app.tg.calls('savePreparedInlineMessage').at(-1).payload;
    assert.equal(prep.result.photo_url, picUrl('banner-halloween', paths.bannerHalloween));
    assert.equal(prep.result.thumbnail_url, picUrl('banner-halloween', paths.bannerHalloween));
    assert.match(prep.result.caption, /^🎃 Хэллоуин в DragonDrop/);
    assert.match(decodeURIComponent(new URL(r.body.url).searchParams.get('text')), /^🎃 Хэллоуин в DragonDrop/);
  } finally {
    await setHalloween(a, false);
  }
  const r = await app.post('/api/free/share', { user: u });
  const prep = app.tg.calls('savePreparedInlineMessage').at(-1).payload;
  assert.equal(prep.result.photo_url, picUrl('banner', paths.banner));
  assert.match(prep.result.caption, /^🎁 Залетай в DragonDrop/);
  assert.match(new URL(r.body.url).searchParams.get('text'), /^🎁 Залетай/);
});

test('the Halloween picture is served like the usual one (Telegram downloads it by URL)', async () => {
  const res = await fetch(`${app.base}${new URL(picUrl('banner-halloween', paths.bannerHalloween)).pathname}?v=1`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, statSync(paths.bannerHalloween).size);
  assert.deepEqual([...buf.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
});
