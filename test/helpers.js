import pg from 'pg';
import { createServer } from '../src/server.js';
import { buildInitData } from '../src/auth.js';
import { startMockTelegram } from './mock-telegram.js';

export const BOT_TOKEN = '123456789:TEST_TOKEN_abcdefghijklmnopqrstuvw';
const PG = process.env.TEST_PG || 'postgres://postgres:postgres@127.0.0.1:5432';

export async function freshDatabase(name) {
  const admin = new pg.Client({ connectionString: `${PG}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  return `${PG}/${name}`;
}

/** Sequenced RNG for deterministic tests: returns queued values, else crypto-like fallback. */
export function scriptedRng() {
  const queue = [];
  return {
    queue,
    int(max) {
      if (queue.length) {
        const v = queue.shift();
        return typeof v === 'function' ? v(max) : Math.min(max - 1, v);
      }
      return Math.floor(Math.random() * max);
    },
  };
}

export async function startApp({ dbName, env = {}, rng, now, autoPromoRng, prepare, maintenance = false } = {}) {
  const tg = await startMockTelegram();
  const databaseUrl = await freshDatabase(dbName);
  if (prepare) await prepare(databaseUrl); // e.g. tables left by another project
  const ctx = await createServer(
    {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      BOT_TOKEN,
      TELEGRAM_API_ROOT: tg.url,
      API_URL: 'https://api.dragondrop.test',
      WEB_URL: 'https://app.dragondrop.test',
      BOT_MODE: 'webhook',
      ADMIN_CODE: 'let-me-in-42',
      ...env,
    },
    { rng, now, autoPromoRng },
  );
  await ctx.start(0);
  // a new DragonDrop starts under maintenance (until the main admin opens it); tests start it open
  if (!maintenance) await ctx.settings.update({ maintenance: false });
  const base = `http://127.0.0.1:${ctx.port}`;

  const auth = (user) => `tma ${buildInitData(user, BOT_TOKEN)}`;

  async function call(method, path, { user, body, token, headers = {} } = {}) {
    const h = { ...headers };
    if (user) h.Authorization = auth(user);
    if (token) h.Authorization = `web ${token}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  let updateId = 1;
  async function sendUpdate(update) {
    const res = await fetch(`${base}/tg/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': ctx.config.webhookSecret },
      body: JSON.stringify({ update_id: updateId++, ...update }),
    });
    return res.status;
  }

  function message(user, text, extra = {}) {
    const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
    return sendUpdate({
      message: {
        message_id: Math.floor(Math.random() * 1e6),
        date: Math.floor(Date.now() / 1000),
        chat: { id: user.id, type: 'private', first_name: user.first_name },
        from: { is_bot: false, ...user },
        text,
        entities,
        ...extra,
      },
    });
  }

  async function makeAdmin(userId) {
    await ctx.db.query('UPDATE bs_users SET is_admin = TRUE WHERE id = $1', [userId]);
  }
  async function setBalance(userId, balance) {
    await ctx.db.query('UPDATE bs_users SET balance = $2 WHERE id = $1', [userId, balance]);
  }

  return {
    ctx,
    tg,
    base,
    call,
    get: (p, o) => call('GET', p, o),
    post: (p, o) => call('POST', p, o),
    put: (p, o) => call('PUT', p, o),
    del: (p, o) => call('DELETE', p, o),
    patch: (p, o) => call('PATCH', p, o),
    auth,
    sendUpdate,
    message,
    makeAdmin,
    setBalance,
    async close() {
      await ctx.stop();
      await tg.close();
    },
  };
}

export const users = {
  alice: { id: 1001, first_name: 'Alice', username: 'alice', language_code: 'ru', photo_url: 'https://t.me/i/userpic/320/a.jpg' },
  bob: { id: 1002, first_name: 'Bob', username: 'bob_uk', language_code: 'uk' },
  carol: { id: 1003, first_name: 'Carol', language_code: 'en' },
  dave: { id: 1004, first_name: 'Dave', username: 'dave', language_code: 'de' },
};
