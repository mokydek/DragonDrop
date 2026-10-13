// DragonDrop keeps its tables in a database schema of its own ("dragondrop", env DB_SCHEMA): a database
// shared with the old BrainrotSpin (its tables in the default schema) starts empty for DragonDrop, and
// the old tables stay exactly as they were.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startApp, users } from './helpers.js';
import { loadConfig } from '../src/config.js';

let app;
after(async () => {
  await app?.close();
});

test('a database shared with the old BrainrotSpin: DragonDrop starts empty in its own schema, the old tables stay untouched', async () => {
  app = await startApp({
    dbName: 'bs_t_schema',
    prepare: async (url) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query('CREATE TABLE bs_users (id BIGINT PRIMARY KEY, first_name TEXT, balance BIGINT NOT NULL DEFAULT 0)');
      await c.query("INSERT INTO bs_users (id, first_name, balance) VALUES ($1, 'Алиса', 777777)", [users.alice.id]);
      await c.end();
    },
  });
  const b = await app.post('/api/bootstrap', { user: users.alice });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.me.balance, 0, 'a new player in DragonDrop');
  assert.ok(b.body.cases.length > 0, 'the cases are seeded in the new schema');
  assert.equal((await app.ctx.db.one('SELECT current_schema() AS s')).s, 'dragondrop');
  const where = await app.ctx.db.many("SELECT table_schema AS s FROM information_schema.tables WHERE table_name = 'bs_users' ORDER BY 1");
  assert.deepEqual(where.map((r) => r.s), ['dragondrop', 'public']);
  const old = await app.ctx.db.many('SELECT id, first_name, balance FROM public.bs_users');
  assert.deepEqual(old, [{ id: users.alice.id, first_name: 'Алиса', balance: 777777 }], 'the old table is not touched');
  const cols = await app.ctx.db.many("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bs_users' ORDER BY 1");
  assert.deepEqual(cols.map((r) => r.c), ['balance', 'first_name', 'id'], 'no columns added to the old table');
});

test('DB_SCHEMA: dragondrop by default, empty or public = the default schema, anything odd is refused', () => {
  assert.equal(loadConfig({ DATABASE_URL: 'x' }).databaseSchema, 'dragondrop');
  assert.equal(loadConfig({ DATABASE_URL: 'x', DB_SCHEMA: '' }).databaseSchema, '');
  assert.equal(loadConfig({ DATABASE_URL: 'x', DB_SCHEMA: 'public' }).databaseSchema, '');
  assert.equal(loadConfig({ DATABASE_URL: 'x', DB_SCHEMA: ' Dragon_2 ' }).databaseSchema, 'dragon_2');
  for (const bad of ['a-b', '1abc', 'x; DROP TABLE y', 'ä']) assert.throws(() => loadConfig({ DATABASE_URL: 'x', DB_SCHEMA: bad }), /DB_SCHEMA/, bad);
});
