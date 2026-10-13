import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Brainrots that can be withdrawn by default (admins change it per item). */
export const WITHDRAWABLE = ['garama and madundung', 'cerberus', 'capitano moby', 'burguro and fryuro', 'dragon cannelloni'];

// BIGINT and NUMERIC come back as strings by default; our values fit in JS numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

/** Works out TLS settings from DATABASE_SSL or the sslmode query parameter. */
export function resolveSsl(url, mode) {
  let connectionString = url;
  let sslmode = (mode || '').toLowerCase();
  try {
    const u = new URL(url);
    const fromUrl = u.searchParams.get('sslmode');
    if (fromUrl) {
      if (!sslmode) sslmode = fromUrl.toLowerCase();
      u.searchParams.delete('sslmode');
      connectionString = u.toString();
    }
    if (!sslmode) {
      // Hosts without a dot are private network names (e.g. Render internal URLs).
      const host = u.hostname;
      const local = host === 'localhost' || host === '127.0.0.1' || !host.includes('.');
      sslmode = local ? 'disable' : 'no-verify';
    }
  } catch {
    sslmode = sslmode || 'disable';
  }
  let ssl = false;
  if (sslmode === 'verify-full' || sslmode === 'verify-ca' || sslmode === 'verify') ssl = true;
  else if (sslmode !== 'disable' && sslmode !== 'off' && sslmode !== 'false') ssl = { rejectUnauthorized: false };
  return { connectionString, ssl };
}

/** `schema`: the tables live there (made by migrate); empty: the default schema. */
export function createDb(url, sslMode, schema = '') {
  if (!url) throw new Error('DATABASE_URL is not set');
  const { connectionString, ssl } = resolveSsl(url, sslMode);
  const pool = new pg.Pool({ connectionString, ssl, max: 10, idleTimeoutMillis: 30_000, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));

  const db = {
    pool,
    schema,
    query: (text, params) => pool.query(text, params),
    one: async (text, params) => (await pool.query(text, params)).rows[0] ?? null,
    many: async (text, params) => (await pool.query(text, params)).rows,
    /** Runs fn(client) inside a transaction. */
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection already broken */
        }
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
  return db;
}

export async function migrate(db) {
  const sql = readFileSync(path.join(here, 'schema.sql'), 'utf8');
  const client = await db.pool.connect();
  try {
    if (db.schema) await client.query(`CREATE SCHEMA IF NOT EXISTS ${db.schema}`);
    await client.query('SELECT pg_advisory_lock(424242)');
    const hadSources = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bs_inventory' AND column_name = 'case_id'",
    );
    await client.query(sql);
    await seed(client);
    // first run with the withdrawable flag: these brainrots can be withdrawn, the rest can't
    await client.query('UPDATE bs_items SET withdrawable = (lower(name) = ANY($1::text[])) WHERE withdrawable IS NULL', [WITHDRAWABLE]);
    // first run with inventory sources: fill them in for brainrots players already have
    if (!hadSources.rowCount) await backfillInventorySources(client);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(424242)');
    } finally {
      client.release();
    }
  }
}

/**
 * Finds where older inventory rows came from. Rows written in the same transaction share now(),
 * so the drop / upgrade / request message created together with the brainrot has the same timestamp.
 */
export async function backfillInventorySources(client) {
  await client.query(`UPDATE bs_inventory i SET case_id = d.case_id
      FROM bs_drops d
     WHERE i.source IN ('case', 'free') AND i.case_id IS NULL
       AND d.user_id = i.user_id AND d.item_id = i.item_id AND d.kind = i.source AND d.created_at = i.created_at`);
  await client.query(`UPDATE bs_inventory i SET ref_id = u.id
      FROM bs_upgrades u
     WHERE i.source = 'upgrade' AND i.ref_id IS NULL
       AND u.won AND u.user_id = i.user_id AND u.target_item_id = i.item_id AND u.created_at = i.created_at`);
  await client.query(`UPDATE bs_inventory i SET ref_id = r.id
      FROM bs_request_msgs m JOIN bs_requests r ON r.id = m.request_id
     WHERE i.source = 'deposit' AND i.ref_id IS NULL
       AND r.kind = 'deposit' AND r.user_id = i.user_id AND m.text = 'give:' || i.item_id AND m.created_at = i.created_at`);
  await client.query(`UPDATE bs_inventory i SET ref_id = r.id
      FROM bs_request_msgs m JOIN bs_requests r ON r.id = m.request_id
     WHERE i.source = 'refund' AND i.ref_id IS NULL
       AND r.kind = 'withdraw' AND r.user_id = i.user_id AND m.text = 'status:rejected' AND m.created_at = i.created_at`);
}

/**
 * Once per database (`marker`): adds a free system case (`flag` = is_nick / is_share) with the FREE case's
 * loot, unless there is one already. After that admins edit it or switch it off like the FREE case.
 */
async function addSystemCaseOnce(db, settings, marker, flag, c) {
  if (settings.get(marker)) return false;
  const added = await db.tx(async (cl) => {
    if ((await cl.query(`SELECT 1 FROM bs_cases WHERE ${flag}`)).rowCount) return false;
    const ins = await cl.query(
      `INSERT INTO bs_cases (slug, name_ru, name_uk, name_en, price, is_free, ${flag}, emoji, color, sort, enabled)
       VALUES ($1, $2, $3, $4, 0, FALSE, TRUE, $5, $6, 0, TRUE)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [c.slug, c.name_ru, c.name_uk, c.name_en, c.emoji, c.color],
    );
    if (!ins.rowCount) return false;
    await cl.query(
      `INSERT INTO bs_case_items (case_id, item_id, chance)
       SELECT $1, ci.item_id, ci.chance FROM bs_case_items ci
        WHERE ci.case_id = (SELECT id FROM bs_cases WHERE is_free ORDER BY sort, id LIMIT 1)`,
      [ins.rows[0].id],
    );
    return true;
  });
  await settings.setInternal(marker, true);
  return added;
}

/** The nick case: free, opens only for players with the bot's name in their Telegram name. */
export function addNickCaseOnce(db, settings) {
  return addSystemCaseOnce(db, settings, '_nick_case_1', 'is_nick', {
    slug: 'nick', name_ru: 'DragonDrop в нике', name_uk: 'DragonDrop у ніку', name_en: 'DragonDrop in nick', emoji: '🏷️', color: '#a855f7',
  });
}

/** The share case: free, opens after the player shared the bot share_case_count times. */
export function addShareCaseOnce(db, settings) {
  return addSystemCaseOnce(db, settings, '_share_case_1', 'is_share', {
    slug: 'share', name_ru: 'Кейс за репосты', name_uk: 'Кейс за репости', name_en: 'Share case', emoji: '📤', color: '#14b8a6',
  });
}

async function seed(client) {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM bs_cases');
  if (rows[0].n > 0) return;
  const data = JSON.parse(readFileSync(path.join(here, 'seed-data.json'), 'utf8'));
  await client.query('BEGIN');
  try {
    const ids = new Map();
    for (const it of data.items) {
      const r = await client.query(
        'INSERT INTO bs_items (name, value, emoji) VALUES ($1, $2, $3) RETURNING id',
        [it.name, it.value, it.emoji],
      );
      ids.set(it.name, r.rows[0].id);
    }
    for (const c of data.cases) {
      const r = await client.query(
        `INSERT INTO bs_cases (slug, name_ru, name_uk, name_en, price, is_free, emoji, color, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c.slug, c.name_ru, c.name_uk, c.name_en, c.price, c.is_free, c.emoji, c.color, c.sort],
      );
      for (const ci of c.items) {
        await client.query('INSERT INTO bs_case_items (case_id, item_id, chance) VALUES ($1, $2, $3)', [
          r.rows[0].id,
          ids.get(ci.item),
          ci.chance,
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}
