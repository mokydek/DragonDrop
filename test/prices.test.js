// The market prices reach a live database once: every seeded brainrot gets its value from seed-data.json,
// a paid case keeps its return to player (its price moves with the value of what is inside, rounded up to a
// multiple of 5), and a Telegram Star buys two coins.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from './helpers.js';
import { marketPricesOnce } from '../src/db.js';

let app;
before(async () => {
  app = await startApp({ dbName: 'bs_t_prices' });
});
after(async () => {
  await app?.close();
});

const seed = JSON.parse(readFileSync(new URL('../src/seed-data.json', import.meta.url), 'utf8'));
const values = async () => new Map((await app.ctx.db.many('SELECT name, value FROM bs_items')).map((r) => [r.name, r.value]));
const prices = async () => Object.fromEntries((await app.ctx.db.many('SELECT slug, price FROM bs_cases')).map((r) => [r.slug, r.price]));

test('a live database gets the market prices once: brainrot values, case prices with the same return, 1 Star = 2 coins', async () => {
  const { db, settings } = app.ctx;
  // a new database has them from the start
  assert.equal(settings.get('_market_prices_1'), true);
  const fresh = await prices();
  assert.equal(fresh.griffin, 1920);
  let v = await values();
  for (const it of seed.items) assert.equal(v.get(it.name), it.value, it.name);

  // the database as the previous version left it: other values (here 3 times higher) and case prices to
  // match, a case the admins priced their own way, another Stars rate, a brainrot an admin added
  await db.query('UPDATE bs_items SET value = value * 3');
  await db.query('UPDATE bs_cases SET price = price * 3 WHERE price > 0');
  await db.query("UPDATE bs_cases SET price = 99 WHERE slug = 'noob'");
  await db.query("INSERT INTO bs_items (name, value, emoji) VALUES ('Admin Brainrot', 777, '🧪')");
  await settings.update({ stars_rate: 2.5 });
  await settings.setInternal('_market_prices_1', false);

  assert.deepEqual(await marketPricesOnce(db, settings), { items: 136, cases: 9 });
  v = await values();
  for (const it of seed.items) assert.equal(v.get(it.name), it.value, it.name);
  assert.equal(v.get('Admin Brainrot'), 777, 'not a seeded brainrot: untouched');
  const now = await prices();
  assert.deepEqual({ ...now, noob: 0 }, { ...fresh, noob: 0 }, 'every case returns what it did before');
  assert.equal(now.noob, 35, "the admins' price keeps its own return: 99 / 3 = 33, rounded up to 35");
  assert.equal(now.free, 0, 'free cases stay free');
  assert.equal(settings.get('stars_rate'), 2, '1 Star = 2 coins');
  assert.equal(settings.get('_market_prices_1'), true);

  // only once: after that admins change prices as usual
  await db.query("UPDATE bs_items SET value = 5 WHERE name = 'Tim Cheese'");
  await settings.update({ stars_rate: 3 });
  assert.equal(await marketPricesOnce(db, settings), false);
  assert.equal((await values()).get('Tim Cheese'), 5);
  assert.equal(settings.get('stars_rate'), 3);
});
