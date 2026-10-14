import express from 'express';
import crypto from 'node:crypto';
import { GameError, displayName } from './game.js';
import { RARITIES, rarityOf } from './rarity.js';
import { wrap } from './api.js';
import { GATES, gatesState } from './access.js';
import { meView } from './api.js';

function int(v, min, max, field) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new GameError('bad_field', 400, { field });
  return n;
}
function num(v, min, max, field) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new GameError('bad_field', 400, { field });
  return n;
}
function str(v, min, max, field) {
  if (typeof v !== 'string') throw new GameError('bad_field', 400, { field });
  const s = v.trim();
  if (s.length < min || s.length > max) throw new GameError('bad_field', 400, { field });
  return s;
}
function optStr(v, max, field) {
  if (v === undefined || v === null || v === '') return null;
  return str(v, 0, max, field);
}
function bool(v, field) {
  if (typeof v !== 'boolean') throw new GameError('bad_field', 400, { field });
  return v;
}
function color(v) {
  const s = str(v, 4, 9, 'color');
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new GameError('bad_field', 400, { field: 'color' });
  return s.toLowerCase();
}
function imageUrl(v) {
  const s = optStr(v, 500, 'image_url');
  if (s && !/^https:\/\/\S+$/i.test(s)) throw new GameError('bad_field', 400, { field: 'image_url' });
  return s;
}
/** Uploaded picture: a base64 data URL of a raster image, at most ~700 KB. */
function imageData(v) {
  if (typeof v !== 'string' || v.length > 700_000 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) {
    throw new GameError('bad_field', 400, { field: 'image' });
  }
  return v;
}

export function createAdmin({ db, settings, game, live, tg, users, requests, access, referrals, broadcaster }) {
  const r = express.Router();
  r.use((req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'forbidden' })));

  // sections the main admin switched off for the other admins (deposits and withdrawals are
  // checked per request below). The case editor also reads the item list.
  const can = (user, section) => access.can(user.id, section);
  // (routes match regardless of letter case, so do these)
  const ROUTE_SECTIONS = [
    [/^\/overview(\/|$)/i, 'overview'],
    [/^\/(cases|categories)(\/|$)/i, 'cases'],
    [/^\/items(\/|$)/i, 'items'],
    [/^\/users(\/|$)/i, 'users'],
    [/^\/referrals(\/|$)/i, 'referrals'],
    [/^\/promos(\/|$)/i, 'promos'],
    [/^\/(settings|check-channel)(\/|$)/i, 'settings'],
    [/^\/broadcast(\/|$)/i, 'broadcast'],
  ];
  r.use((req, res, next) => {
    const hit = ROUTE_SECTIONS.find(([re]) => re.test(req.path));
    if (!hit || can(req.user, hit[1])) return next();
    if (hit[1] === 'items' && req.method === 'GET' && /^\/items\/?$/i.test(req.path) && can(req.user, 'cases')) return next();
    return res.status(403).json({ error: 'forbidden' });
  });

  // ------------------------------------------------------------ overview
  r.get(
    '/overview',
    wrap(async (req) => {
      const s = await db.one(`
        SELECT (SELECT count(*)::int FROM bs_users) AS users,
               (SELECT count(*)::int FROM bs_users WHERE created_at > now() - interval '24 hours') AS new24,
               (SELECT count(*)::int FROM bs_drops WHERE kind IN ('case','free','nick','share') AND created_at > now() - interval '24 hours') AS opened24,
               (SELECT count(*)::int FROM bs_upgrades WHERE created_at > now() - interval '24 hours') AS upgrades24,
               (SELECT coalesce(sum(balance), 0)::bigint FROM bs_users) AS coins,
               (SELECT coalesce(sum(i.value), 0)::bigint FROM bs_inventory v JOIN bs_items i ON i.id = v.item_id) AS items_value`);
      // the main admin also gets the controls: the maintenance and what players can use
      const control = isMain(req.user) ? { control: { maintenance: !!settings.get('maintenance'), gates: gatesState(settings) } } : {};
      return { ...s, online: live.online(), ...control };
    }),
  );

  // ------------------------------------------------------------ controls (the main admin)
  // maintenance: nobody but the main admin gets into the bot and the app
  r.put(
    '/maintenance',
    wrap(async (req) => {
      if (!isMain(req.user)) throw new GameError('forbidden', 403);
      const on = (req.body || {}).on;
      if (typeof on !== 'boolean') throw new GameError('bad_field', 400, { field: 'on' });
      await settings.update({ maintenance: on });
      return { maintenance: on };
    }),
  );

  // close / open a part for every player: cases, upgrader, rocket, dice, withdrawals, top-ups
  r.put(
    '/gates',
    wrap(async (req) => {
      if (!isMain(req.user)) throw new GameError('forbidden', 403);
      const { gate, open } = req.body || {};
      if (typeof gate !== 'string' || !Object.hasOwn(GATES, gate)) throw new GameError('bad_field', 400, { field: 'gate' });
      if (typeof open !== 'boolean') throw new GameError('bad_field', 400, { field: 'open' });
      await settings.update({ [GATES[gate]]: open });
      return { gates: gatesState(settings) };
    }),
  );

  // every balance and every inventory back to zero. Rockets in flight burn (nothing comes back from
  // them); the history (drops, upgrades, the balance log) and the deposit / withdrawal requests stay.
  r.post(
    '/reset-economy',
    wrap(async (req) => {
      if (!isMain(req.user)) throw new GameError('forbidden', 403);
      if ((req.body || {}).confirm !== 'RESET') throw new GameError('bad_field', 400, { field: 'confirm' });
      return db.tx(async (cl) => {
        // every player row first: a case, an upgrade or a bet going on right now ends before the reset
        await cl.query('SELECT id FROM bs_users ORDER BY id FOR UPDATE');
        const sum = (await cl.query('SELECT count(*)::int AS n, coalesce(sum(balance), 0)::bigint AS coins FROM bs_users WHERE balance <> 0')).rows[0];
        await cl.query("INSERT INTO bs_balance_log (user_id, delta, reason, admin_id) SELECT id, -balance, 'admin:reset', $1 FROM bs_users WHERE balance <> 0", [req.user.id]);
        await cl.query('UPDATE bs_users SET balance = 0 WHERE balance <> 0');
        const rockets = (await cl.query("UPDATE bs_crash SET status = 'crashed' WHERE status = 'flying'")).rowCount;
        const items = (await cl.query('DELETE FROM bs_inventory')).rowCount;
        return { users: sum.n, coins: Number(sum.coins), items, rockets };
      });
    }),
  );

  // ------------------------------------------------------------ cases
  /** The free cases the app has built in (FREE, nick, share): no price, can't be deleted. */
  const systemCase = (c) => !!(c.is_free || c.is_nick || c.is_share);

  function adminCase(c) {
    const sum = c.items.reduce((a, e) => a + e.chance, 0);
    const ev = sum ? c.items.reduce((a, e) => a + (e.chance / sum) * (game.catalog.items.get(e.item_id)?.value || 0), 0) : 0;
    return {
      id: c.id,
      slug: c.slug,
      name_ru: c.name_ru,
      name_uk: c.name_uk,
      name_en: c.name_en,
      price: c.price,
      is_free: c.is_free,
      is_nick: c.is_nick,
      is_share: c.is_share,
      emoji: c.emoji,
      color: c.color,
      sort: c.sort,
      enabled: c.enabled,
      category_id: c.category_id,
      image: game.caseImage(c),
      hasUpload: !!c.has_image, // a picture uploaded here (the built-in art is not one)
      items: c.items
        .map((e) => ({ itemId: e.item_id, chance: e.chance }))
        .sort((a, b) => (game.catalog.items.get(b.itemId)?.value || 0) - (game.catalog.items.get(a.itemId)?.value || 0)),
      chanceSum: Math.round(sum * 10000) / 10000,
      ev: Math.round(ev * 100) / 100,
      rtp: c.price > 0 ? Math.round((ev / c.price) * 10000) / 100 : null,
    };
  }

  r.get(
    '/cases',
    wrap(async () => ({
      cases: game.catalog.order.map((id) => adminCase(game.catalog.cases.get(id))),
      categories: game.listCategories(),
    })),
  );

  function categoryId(v) {
    if (v === undefined || v === null || v === '') return null;
    const id = int(Number(v), 1, 2_147_483_647, 'category_id');
    if (!game.catalog.categories.some((c) => c.id === id)) throw new GameError('bad_field', 400, { field: 'category_id' });
    return id;
  }

  function parseCaseBody(b, existing) {
    const out = {
      name_ru: str(b.name_ru, 1, 60, 'name_ru'),
      name_uk: str(b.name_uk, 1, 60, 'name_uk'),
      name_en: str(b.name_en, 1, 60, 'name_en'),
      emoji: str(b.emoji, 1, 16, 'emoji'),
      color: color(b.color),
      sort: int(b.sort ?? 0, -1000, 1000, 'sort'),
      enabled: bool(b.enabled, 'enabled'),
      category_id: b.category_id === undefined && existing ? existing.category_id : categoryId(b.category_id),
    };
    // the free cases (FREE, nick, share) always cost nothing
    const isFree = existing ? systemCase(existing) : false;
    out.price = isFree ? 0 : int(b.price, 1, 10_000_000, 'price');
    if (!Array.isArray(b.items) || b.items.length > 200) throw new GameError('bad_field', 400, { field: 'items' });
    const seen = new Set();
    out.items = b.items.map((e) => {
      const itemId = int(e.itemId, 1, 2_147_483_647, 'items');
      if (!game.catalog.items.has(itemId) || seen.has(itemId)) throw new GameError('bad_field', 400, { field: 'items' });
      seen.add(itemId);
      return { itemId, chance: Math.round(num(e.chance, 0.0001, 100, 'chance') * 10000) / 10000 };
    });
    if (out.enabled && out.items.length === 0) throw new GameError('bad_field', 400, { field: 'items' });
    return out;
  }

  // rights of the main admin (the Stars rate); without OWNER_IDS / OWNER_USERNAMES every admin has them
  const isMain = (user) => access.isMain(user.id);

  async function saveItems(cl, caseId, items) {
    await cl.query('DELETE FROM bs_case_items WHERE case_id = $1', [caseId]);
    for (const e of items) {
      await cl.query('INSERT INTO bs_case_items (case_id, item_id, chance) VALUES ($1, $2, $3)', [caseId, e.itemId, e.chance]);
    }
  }

  r.put(
    '/cases/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      const existing = game.catalog.cases.get(id);
      if (!existing) throw new GameError('not_found', 404);
      const c = parseCaseBody(req.body || {}, existing);
      await db.tx(async (cl) => {
        await cl.query(
          `UPDATE bs_cases SET name_ru=$2, name_uk=$3, name_en=$4, emoji=$5, color=$6, sort=$7, enabled=$8, price=$9, category_id=$10 WHERE id=$1`,
          [id, c.name_ru, c.name_uk, c.name_en, c.emoji, c.color, c.sort, c.enabled, c.price, c.category_id],
        );
        await saveItems(cl, id, c.items);
      });
      await game.reloadCatalog();
      return { case: adminCase(game.catalog.cases.get(id)) };
    }),
  );

  r.post(
    '/cases',
    wrap(async (req) => {
      const c = parseCaseBody(req.body || {}, null);
      const base = c.name_en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'case';
      const slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
      const row = await db.tx(async (cl) => {
        const ins = await cl.query(
          `INSERT INTO bs_cases (slug, name_ru, name_uk, name_en, price, is_free, emoji, color, sort, enabled, category_id)
           VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$8,$9,$10) RETURNING id`,
          [slug, c.name_ru, c.name_uk, c.name_en, c.price, c.emoji, c.color, c.sort, c.enabled, c.category_id],
        );
        await saveItems(cl, ins.rows[0].id, c.items);
        return ins.rows[0];
      });
      await game.reloadCatalog();
      return { case: adminCase(game.catalog.cases.get(row.id)) };
    }),
  );

  r.delete(
    '/cases/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      const c = game.catalog.cases.get(id);
      if (!c) throw new GameError('not_found', 404);
      if (systemCase(c)) throw new GameError('cannot_delete_free');
      await db.query('DELETE FROM bs_cases WHERE id = $1', [id]);
      await game.reloadCatalog();
      return { ok: true };
    }),
  );

  r.post(
    '/cases/:id/image',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      if (!game.catalog.cases.has(id)) throw new GameError('not_found', 404);
      await db.query('UPDATE bs_cases SET image_data = $2 WHERE id = $1', [id, imageData((req.body || {}).dataUrl)]);
      await game.reloadCatalog();
      return { case: adminCase(game.catalog.cases.get(id)) };
    }),
  );

  r.delete(
    '/cases/:id/image',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      if (!game.catalog.cases.has(id)) throw new GameError('not_found', 404);
      await db.query('UPDATE bs_cases SET image_data = NULL WHERE id = $1', [id]);
      await game.reloadCatalog();
      return { case: adminCase(game.catalog.cases.get(id)) };
    }),
  );

  // ------------------------------------------------------------ case categories
  function parseCategory(b) {
    const out = { name: str(b.name, 1, 40, 'name'), sort: int(b.sort ?? 0, -1000, 1000, 'sort') };
    if (b.caseIds !== undefined) {
      if (!Array.isArray(b.caseIds) || b.caseIds.length > 500) throw new GameError('bad_field', 400, { field: 'caseIds' });
      out.caseIds = [...new Set(b.caseIds.map((x) => int(Number(x), 1, 2_147_483_647, 'caseIds')))];
      if (out.caseIds.some((id) => !game.catalog.cases.has(id))) throw new GameError('bad_field', 400, { field: 'caseIds' });
    }
    return out;
  }

  /** Puts exactly `caseIds` into the category (others leave it). */
  async function setCategoryCases(cl, id, caseIds) {
    if (!caseIds) return;
    await cl.query('UPDATE bs_cases SET category_id = NULL WHERE category_id = $1 AND NOT (id = ANY($2::int[]))', [id, caseIds]);
    await cl.query('UPDATE bs_cases SET category_id = $1 WHERE id = ANY($2::int[])', [id, caseIds]);
  }

  r.get('/categories', wrap(async () => ({ categories: game.listCategories() })));

  r.post(
    '/categories',
    wrap(async (req) => {
      const c = parseCategory(req.body || {});
      const row = await db.tx(async (cl) => {
        const ins = (await cl.query('INSERT INTO bs_categories (name, sort) VALUES ($1, $2) RETURNING id', [c.name, c.sort])).rows[0];
        await setCategoryCases(cl, ins.id, c.caseIds);
        return ins;
      });
      await game.reloadCatalog();
      return { category: game.listCategories().find((x) => x.id === row.id), categories: game.listCategories() };
    }),
  );

  r.put(
    '/categories/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      if (!game.catalog.categories.some((c) => c.id === id)) throw new GameError('not_found', 404);
      const c = parseCategory(req.body || {});
      await db.tx(async (cl) => {
        await cl.query('UPDATE bs_categories SET name = $2, sort = $3 WHERE id = $1', [id, c.name, c.sort]);
        await setCategoryCases(cl, id, c.caseIds);
      });
      await game.reloadCatalog();
      return { category: game.listCategories().find((x) => x.id === id), categories: game.listCategories() };
    }),
  );

  r.delete(
    '/categories/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      const del = await db.query('DELETE FROM bs_categories WHERE id = $1', [id]);
      if (!del.rowCount) throw new GameError('not_found', 404);
      await game.reloadCatalog();
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ items
  r.get(
    '/items',
    wrap(async () => {
      const usage = await db.many('SELECT item_id, count(*)::int AS n FROM bs_case_items GROUP BY item_id');
      const used = new Map(usage.map((u) => [u.item_id, u.n]));
      const items = [...game.catalog.items.values()].map((i) => ({
        ...game.publicItem(i),
        rarityOverride: i.rarity || null,
        image_url: i.image_url || null,
        hasUpload: i.has_image,
        enabled: i.enabled,
        withdrawable: i.withdrawable,
        depositable: i.depositable,
        inCases: used.get(i.id) || 0,
      }));
      return { items, rarities: RARITIES };
    }),
  );

  function parseItemBody(b) {
    const rarity = b.rarity ? str(b.rarity, 1, 20, 'rarity') : null;
    if (rarity && !RARITIES.includes(rarity)) throw new GameError('bad_field', 400, { field: 'rarity' });
    return {
      name: str(b.name, 1, 60, 'name'),
      value: int(b.value, 0, 100_000_000, 'value'),
      emoji: str(b.emoji || '🎁', 1, 16, 'emoji'),
      rarity,
      image_url: imageUrl(b.image_url),
      enabled: b.enabled === undefined ? true : bool(b.enabled, 'enabled'),
      withdrawable: b.withdrawable === undefined ? null : bool(b.withdrawable, 'withdrawable'),
      depositable: b.depositable === undefined ? null : bool(b.depositable, 'depositable'),
    };
  }

  r.post(
    '/items',
    wrap(async (req) => {
      const it = parseItemBody(req.body || {});
      const row = await db.one(
        'INSERT INTO bs_items (name, value, emoji, rarity, image_url, enabled, withdrawable, depositable) VALUES ($1,$2,$3,$4,$5,$6,coalesce($7,FALSE),coalesce($8,TRUE)) RETURNING id',
        [it.name, it.value, it.emoji, it.rarity, it.image_url, it.enabled, it.withdrawable, it.depositable],
      );
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(row.id)) };
    }),
  );

  r.put(
    '/items/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      if (!game.catalog.items.has(id)) throw new GameError('not_found', 404);
      const it = parseItemBody(req.body || {});
      await db.query(
        'UPDATE bs_items SET name=$2, value=$3, emoji=$4, rarity=$5, image_url=$6, enabled=$7, withdrawable=coalesce($8, withdrawable), depositable=coalesce($9, depositable) WHERE id=$1',
        [id, it.name, it.value, it.emoji, it.rarity, it.image_url, it.enabled, it.withdrawable, it.depositable],
      );
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(id)) };
    }),
  );

  r.post(
    '/items/:id/image',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      if (!game.catalog.items.has(id)) throw new GameError('not_found', 404);
      await db.query('UPDATE bs_items SET image_data = $2 WHERE id = $1', [id, imageData((req.body || {}).dataUrl)]);
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(id)) };
    }),
  );

  r.delete(
    '/items/:id/image',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      await db.query('UPDATE bs_items SET image_data = NULL WHERE id = $1', [id]);
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(id)) };
    }),
  );

  // ------------------------------------------------------------ users
  function userRow(u) {
    return {
      ...meView(u),
      firstName: u.first_name,
      lastName: u.last_name,
      isBanned: u.is_banned,
      lastSeen: u.last_seen_at,
      blockedBot: u.blocked_bot,
      startedBot: u.started_bot,
    };
  }

  r.get(
    '/users',
    wrap(async (req) => {
      const q = String(req.query.q || '').trim().replace(/^@/, '');
      let rows;
      if (!q) {
        rows = await db.many('SELECT * FROM bs_users ORDER BY last_seen_at DESC LIMIT 30');
      } else if (/^\d{3,15}$/.test(q)) {
        rows = await db.many('SELECT * FROM bs_users WHERE id = $1 OR username ILIKE $2 LIMIT 30', [Number(q), `%${q}%`]);
      } else {
        const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
        rows = await db.many(
          `SELECT * FROM bs_users WHERE username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
            ORDER BY last_seen_at DESC LIMIT 30`,
          [like],
        );
      }
      return { users: rows.map(userRow) };
    }),
  );

  /** The player's brainrots with where each one came from (case, upgrade, request, admin…). */
  async function inventoryWithSources(userId) {
    const rows = await db.many(
      `SELECT v.id, v.item_id, v.created_at, v.source, v.case_id, v.ref_id,
              c.name_ru, c.name_uk, c.name_en, up.chance, up.bet_value,
              a.id AS admin_id, a.first_name AS admin_first, a.username AS admin_username
         FROM bs_inventory v
         LEFT JOIN bs_cases c ON c.id = v.case_id
         LEFT JOIN bs_upgrades up ON v.source = 'upgrade' AND up.id = v.ref_id
         LEFT JOIN bs_users a ON v.source = 'admin' AND a.id = v.ref_id
        WHERE v.user_id = $1 ORDER BY v.id DESC LIMIT 1000`,
      [userId],
    );
    const out = [];
    for (const r of rows) {
      const item = game.catalog.items.get(r.item_id);
      if (!item) continue;
      const from = { type: r.source };
      if (r.case_id) from.case = { id: r.case_id, name: { ru: r.name_ru, uk: r.name_uk, en: r.name_en } };
      if (r.source === 'upgrade' && r.chance !== null) from.upgrade = { chance: Number(r.chance), bet: Number(r.bet_value) };
      if ((r.source === 'deposit' || r.source === 'refund') && r.ref_id) from.requestId = Number(r.ref_id);
      if (r.source === 'admin' && r.admin_id) from.admin = { id: Number(r.admin_id), name: displayName({ id: r.admin_id, first_name: r.admin_first, username: r.admin_username }) };
      out.push({ invId: Number(r.id), at: r.created_at, item: game.publicItem(item), from });
    }
    return out;
  }

  // balance log reasons of requests ("stars:#12") and their sections
  const LOG_SECTIONS = { stars: 'deposits_stars', deposit: 'deposits_brainrots', exchange: 'withdrawals' };

  async function loadUser(id) {
    const u = await db.one('SELECT * FROM bs_users WHERE id = $1', [id]);
    if (!u) throw new GameError('not_found', 404);
    return u;
  }

  r.get(
    '/users/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const u = await loadUser(id);
      // balance changes from deposits / withdrawals the admin doesn't see are left out
      const skip = Object.entries(LOG_SECTIONS)
        .filter(([, section]) => !can(req.user, section))
        .map(([prefix]) => prefix + ':%');
      const log = await db.many(
        'SELECT delta, reason, admin_id, created_at FROM bs_balance_log WHERE user_id = $1 AND NOT (reason LIKE ANY($2::text[])) ORDER BY id DESC LIMIT 20',
        [id, skip],
      );
      const out = { user: userRow(u), stats: await game.stats(id), inventory: await inventoryWithSources(id), log };
      // the account's own upgrader bad luck: only the main admin sees and changes it
      if (isMain(req.user)) out.luck = Number(u.upgrade_luck);
      return out;
    }),
  );

  r.post(
    '/users/:id/luck',
    wrap(async (req) => {
      if (!isMain(req.user)) throw new GameError('forbidden', 403);
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const luck = Math.round(num((req.body || {}).luck, 1, 10, 'luck') * 100) / 100;
      const u = await db.one('UPDATE bs_users SET upgrade_luck = $2 WHERE id = $1 RETURNING upgrade_luck', [id, luck]);
      if (!u) throw new GameError('not_found', 404);
      return { luck: Number(u.upgrade_luck) };
    }),
  );

  r.post(
    '/users/:id/balance',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const { mode, amount } = req.body || {};
      if (mode !== 'add' && mode !== 'set') throw new GameError('bad_field', 400, { field: 'mode' });
      const n = int(Number(amount), mode === 'add' ? -1_000_000_000 : 0, 1_000_000_000, 'amount');
      const res = await db.tx(async (cl) => {
        const u = (await cl.query('SELECT balance FROM bs_users WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!u) throw new GameError('not_found', 404);
        const next = mode === 'set' ? n : u.balance + n;
        if (next < 0) throw new GameError('negative_balance');
        await cl.query('UPDATE bs_users SET balance = $2 WHERE id = $1', [id, next]);
        await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason, admin_id) VALUES ($1, $2, $3, $4)', [
          id,
          next - u.balance,
          mode === 'set' ? 'admin:set' : 'admin:add',
          req.user.id,
        ]);
        return next;
      });
      return { balance: res };
    }),
  );

  r.post(
    '/users/:id/flags',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const b = req.body || {};
      await loadUser(id);
      // the main admin can't be demoted or banned (refused with a generic error)
      if (users.isOwnerId(id) && (b.is_admin === false || b.is_banned === true)) throw new GameError('forbidden', 403);
      if (b.is_admin !== undefined) {
        const v = bool(b.is_admin, 'is_admin');
        if (!v && id === req.user.id) throw new GameError('cannot_demote_self');
        await db.query('UPDATE bs_users SET is_admin = $2 WHERE id = $1', [id, v]);
      }
      if (b.is_banned !== undefined) {
        const v = bool(b.is_banned, 'is_banned');
        if (v && id === req.user.id) throw new GameError('cannot_ban_self');
        await db.query('UPDATE bs_users SET is_banned = $2 WHERE id = $1', [id, v]);
      }
      if (b.revoke_web) await db.query('UPDATE bs_users SET web_ver = web_ver + 1 WHERE id = $1', [id]);
      return { user: userRow(await loadUser(id)) };
    }),
  );

  r.post(
    '/users/:id/give',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const itemId = int(Number((req.body || {}).itemId), 1, 2_147_483_647, 'itemId');
      const item = game.catalog.items.get(itemId);
      if (!item) throw new GameError('not_found', 404);
      await loadUser(id);
      const invId = await db.tx((cl) => game.giveItem(cl, id, item, 'admin', { ref: req.user.id }));
      return { invId, item: game.publicItem(item) };
    }),
  );

  r.delete(
    '/users/:id/inventory/:invId',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const invId = int(Number(req.params.invId), 1, Number.MAX_SAFE_INTEGER, 'invId');
      const del = await db.query('DELETE FROM bs_inventory WHERE id = $1 AND user_id = $2', [invId, id]);
      if (!del.rowCount) throw new GameError('not_found', 404);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ referral codes
  const refView = (req) => ({ canSeeStars: can(req.user, 'deposits_stars'), canSeeBonus: isMain(req.user) });
  r.get('/referrals', wrap(async (req) => referrals.list(refView(req))));
  r.get('/referrals/:code', wrap(async (req) => referrals.detail(req.params.code, refView(req))));
  r.post(
    '/referrals',
    wrap(async (req) => {
      const body = { ...(req.body || {}) };
      if (!isMain(req.user)) delete body.bonusPct;
      await referrals.create(req.user, body);
      return referrals.list(refView(req));
    }),
  );
  r.put(
    '/referrals/:code',
    wrap(async (req) => {
      const body = { ...(req.body || {}) };
      if (!isMain(req.user)) delete body.bonusPct;
      await referrals.update(req.params.code, body);
      return referrals.list(refView(req));
    }),
  );
  r.delete(
    '/referrals/:code',
    wrap(async (req) => {
      await referrals.remove(req.params.code);
      return referrals.list(refView(req));
    }),
  );

  // ------------------------------------------------------------ promo codes
  r.get(
    '/promos',
    wrap(async () => ({
      promos: await db.many('SELECT code, amount, max_uses, uses, expires_at, active, created_at FROM bs_promo_codes ORDER BY created_at DESC LIMIT 200'),
    })),
  );

  r.post(
    '/promos',
    wrap(async (req) => {
      const b = req.body || {};
      let code = game.normalizeCode(b.code || '');
      if (!code) code = crypto.randomBytes(4).toString('hex').toUpperCase();
      if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new GameError('bad_field', 400, { field: 'code' });
      const amount = int(Number(b.amount), 1, 100_000_000, 'amount');
      const maxUses = int(Number(b.maxUses ?? 1), 1, 10_000_000, 'maxUses');
      const hours = b.expiresHours === undefined || b.expiresHours === null || b.expiresHours === '' ? null : num(Number(b.expiresHours), 0.1, 24 * 3650, 'expiresHours');
      const row = await db.one(
        `INSERT INTO bs_promo_codes (code, amount, max_uses, expires_at, created_by)
         VALUES ($1, $2, $3, CASE WHEN $4::float8 IS NULL THEN NULL ELSE now() + ($4::float8 * interval '1 hour') END, $5)
         ON CONFLICT (code) DO NOTHING
         RETURNING code, amount, max_uses, uses, expires_at, active, created_at`,
        [code, amount, maxUses, hours, req.user.id],
      );
      if (!row) throw new GameError('promo_exists');
      return { promo: row };
    }),
  );

  r.patch(
    '/promos/:code',
    wrap(async (req) => {
      const active = bool((req.body || {}).active, 'active');
      const row = await db.one('UPDATE bs_promo_codes SET active = $2 WHERE code = $1 RETURNING code, active', [
        game.normalizeCode(req.params.code),
        active,
      ]);
      if (!row) throw new GameError('not_found', 404);
      return { promo: row };
    }),
  );

  r.delete(
    '/promos/:code',
    wrap(async (req) => {
      const del = await db.query('DELETE FROM bs_promo_codes WHERE code = $1', [game.normalizeCode(req.params.code)]);
      if (!del.rowCount) throw new GameError('not_found', 404);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ settings
  // the Stars rate, the upgrader luck, what the other admins see, whether Stars count for referral
  // codes, the referral levels, the auto promo code, the buffs on deposited brainrots, the
  // maintenance and what players can use are seen and changed by the main admin only; other admins
  // don't get these fields
  const OWNER_SETTINGS = [
    'stars_rate', 'upgrade_luck', 'admin_hidden', 'ref_count_stars', 'ref_levels', 'auto_promo', 'auto_promo_min', 'auto_promo_max', 'auto_promo_hours', 'buffs',
    'maintenance', ...Object.values(GATES),
  ];
  // the rest of the upgrader settings and the rocket ones: other admins see them, but only the main
  // admin changes them (the form always sends every field; only an actual change is refused, with
  // the generic error)
  const ODDS_SETTINGS = ['upgrade_edge', 'upgrade_min_chance', 'upgrade_max_chance', 'crash_edge', 'crash_min_bet', 'crash_max_bet', 'crash_max_mult', 'dice_min_bet', 'dice_max_bet'];
  const visibleSettings = (user) => {
    const s = settings.all();
    if (!isMain(user)) for (const k of OWNER_SETTINGS) delete s[k];
    return s;
  };
  r.get('/settings', wrap(async (req) => ({ settings: visibleSettings(req.user) })));
  r.put(
    '/settings',
    wrap(async (req) => {
      const patch = { ...(req.body && typeof req.body === 'object' ? req.body : {}) };
      if (!isMain(req.user)) {
        for (const k of OWNER_SETTINGS) delete patch[k];
        for (const k of ODDS_SETTINGS) {
          if (Object.hasOwn(patch, k) && Number(String(patch[k]).replace(',', '.')) !== settings.get(k)) throw new GameError('forbidden', 403);
        }
      }
      await settings.update(patch);
      return { settings: visibleSettings(req.user) };
    }),
  );

  r.post(
    '/check-channel',
    wrap(async () => {
      const channel = settings.get('channel');
      if (!channel) throw new GameError('no_channel');
      try {
        return await tg.checkChannel(channel);
      } catch (e) {
        throw new GameError('channel_error', 400, { message: e.description || e.message });
      }
    }),
  );

  // ------------------------------------------------------------ broadcast
  r.get('/broadcast', wrap(async () => ({ status: broadcaster.status() })));
  r.post(
    '/broadcast',
    wrap(async (req) => {
      const text = str((req.body || {}).text, 1, 4000, 'text');
      const withButton = (req.body || {}).button !== false;
      const status = await broadcaster.start(text, { withButton, adminId: req.user.id });
      return { status };
    }),
  );

  // ------------------------------------------------------------ deposits & withdrawals
  const reqId = (req) => int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
  r.get(
    '/requests',
    wrap(async (req) => {
      const kind = String(req.query.kind || '');
      let methods = null;
      if (kind === 'deposit') {
        methods = [can(req.user, 'deposits_brainrots') && 'brainrot', can(req.user, 'deposits_stars') && 'stars'].filter(Boolean);
        if (!methods.length) throw new GameError('forbidden', 403);
      } else if (kind === 'withdraw' && !can(req.user, 'withdrawals')) {
        throw new GameError('forbidden', 403);
      }
      const list = await requests.list({ kind, scope: String(req.query.scope || 'active'), methods });
      // the deposits tab: whether brainrot deposits are open (for admins who handle them)
      if (kind === 'deposit' && can(req.user, 'deposits_brainrots')) return { requests: list, brainrotsOpen: settings.get('deposits_brainrots_open') !== false };
      return { requests: list };
    }),
  );
  // close / open brainrot deposits for a while (admins who handle them)
  r.put(
    '/deposit-gate',
    wrap(async (req) => {
      if (!can(req.user, 'deposits_brainrots')) throw new GameError('forbidden', 403);
      const open = (req.body || {}).open;
      if (typeof open !== 'boolean') throw new GameError('bad_field', 400, { field: 'open' });
      await settings.update({ deposits_brainrots_open: open });
      return { brainrotsOpen: open };
    }),
  );
  r.get(
    '/requests/counts',
    wrap(async (req) => {
      const counts = await requests.counts(); // brainrot requests only
      if (!can(req.user, 'deposits_brainrots')) counts.deposit = 0;
      if (!can(req.user, 'withdrawals')) counts.withdraw = 0;
      return { counts };
    }),
  );
  /** The request id, if this admin sees requests of its kind. */
  const visibleReq = async (req) => {
    const id = reqId(req);
    const section = await requests.sectionOf(id);
    if (section && !can(req.user, section)) throw new GameError('forbidden', 403);
    return id;
  };
  r.get('/requests/:id', wrap(async (req) => requests.detail(await visibleReq(req))));
  r.post('/requests/:id/messages', wrap(async (req) => requests.adminMessage(req.user, await visibleReq(req), (req.body || {}).text)));
  r.post('/requests/:id/credit', wrap(async (req) => requests.credit(req.user, await visibleReq(req), (req.body || {}).amount)));
  r.post('/requests/:id/give', wrap(async (req) => requests.give(req.user, await visibleReq(req), (req.body || {}).itemId)));
  r.post('/requests/:id/status', wrap(async (req) => requests.setStatus(req.user, await visibleReq(req), (req.body || {}).status)));

  return r;
}

export { rarityOf };
