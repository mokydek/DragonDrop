import crypto from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { rarityOf } from './rarity.js';

export class GameError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const cryptoRng = { int: (max) => crypto.randomInt(0, max) };
export const OPEN_COUNTS = [1, 2, 3, 5]; // openings of one case at once
/** Built-in case art: case slug -> version of web/img/cases/<slug>.webp (bump it when the picture changes). */
export const CASE_ART = { noob: 1, pro: 1, dlc: 1, halloween: 1, summer: 1, dragon: 1, mushroom: 1, griffin: 1 };

/** A brainrot's file name: its name in lower-case latin letters and digits, joined by "-" ("Lirilì Larilà" -> "lirili-larila"). */
export function itemSlug(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Built-in brainrot pictures: every web/img/items/<slug>.webp, slug -> a short hash of the file (so a new
 * picture under the same name is not taken from the cache).
 */
export const ITEM_ART = (() => {
  const dir = new URL('../web/img/items/', import.meta.url);
  const art = new Map();
  let files = [];
  try {
    files = readdirSync(dir);
  } catch {
    return art;
  }
  for (const f of files) {
    const m = /^([a-z0-9-]+)\.webp$/.exec(f);
    if (m) art.set(m[1], crypto.createHash('md5').update(readFileSync(new URL(f, dir))).digest('hex').slice(0, 8));
  }
  return art;
})();

/** The built-in picture of a brainrot with this name (a file of the web app), if there is one. */
export function itemArtUrl(name) {
  const slug = itemSlug(name);
  return ITEM_ART.has(slug) ? `img/items/${slug}.webp?v=${ITEM_ART.get(slug)}` : null;
}

/** Letters and digits only, in lower case: "Dragon_Drop" and "dragon drop" both give "dragondrop". */
export function nickKey(s) {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Does the player's Telegram name (first + last name, as Telegram shows it) or @username contain `tag`?
 * Letter case, spaces, underscores and other symbols don't matter.
 */
export function hasNickTag(names, tag) {
  const t = nickKey(tag);
  if (!t || !names) return false;
  const full = nickKey(`${names.first_name || ''} ${names.last_name || ''}`);
  return full.includes(t) || nickKey(names.username).includes(t);
}

export function displayName(u) {
  const name = (u.first_name || '').trim() || (u.username ? `@${u.username}` : `#${u.id}`);
  return name.length > 18 ? name.slice(0, 17) + '…' : name;
}

/**
 * Upgrade chance in percent (2 decimals, rounded down). `luck` > 1 makes every chance that many
 * times lower. The app shows players this very number (same formula in web/js/app.js).
 */
export function upgradeChance(betValue, targetValue, edgePct, maxChance, luck = 1) {
  if (!(targetValue > 0) || !(betValue > 0)) return 0;
  const raw = (betValue / targetValue) * (100 - edgePct);
  return Math.floor((Math.min(maxChance, raw) / luck) * 100) / 100;
}

/** Weighted pick; chances may be any positive numbers (they are normalised). */
export function pickWeighted(entries, rng = cryptoRng) {
  const weights = entries.map((e) => Math.max(1, Math.round(e.chance * 10000)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.int(total);
  for (let i = 0; i < entries.length; i++) {
    if (r < weights[i]) return entries[i];
    r -= weights[i];
  }
  return entries[entries.length - 1];
}

export function createGame({ db, settings, live, tg, rng = cryptoRng }) {
  const catalog = { items: new Map(), cases: new Map(), order: [], categories: [] };

  function publicItem(it) {
    if (!it) return null;
    return {
      id: it.id,
      name: it.name,
      value: it.value,
      emoji: it.emoji,
      rarity: rarityOf(it.value, it.rarity),
      // a link or a picture from the admin panel, otherwise the brainrot's built-in picture (the emoji without one)
      image: it.image_url || (it.has_image ? `/api/img/item/${it.id}?v=${it.img_ver.slice(0, 8)}` : itemArtUrl(it.name)),
    };
  }

  /** A picture uploaded in the admin panel, otherwise the built-in art of the case (web/img/cases), if any. */
  function caseImage(c) {
    if (c.has_image) return `/api/img/case/${c.id}?v=${c.img_ver.slice(0, 8)}`;
    return CASE_ART[c.slug] ? `img/cases/${c.slug}.webp?v=${CASE_ART[c.slug]}` : null;
  }

  function publicCase(c) {
    const sum = c.items.reduce((s, e) => s + e.chance, 0) || 1;
    return {
      id: c.id,
      slug: c.slug,
      name: { ru: c.name_ru, uk: c.name_uk, en: c.name_en },
      price: c.price,
      isFree: c.is_free,
      isNick: c.is_nick,
      isShare: c.is_share,
      categoryId: c.category_id,
      emoji: c.emoji,
      color: c.color,
      image: caseImage(c),
      items: c.items
        .map((e) => ({ item: publicItem(catalog.items.get(e.item_id)), chance: Math.round((e.chance / sum) * 100000) / 1000 }))
        .sort((a, b) => b.item.value - a.item.value),
    };
  }

  async function reloadCatalog() {
    const items = await db.many(
      `SELECT id, name, value, emoji, rarity, image_url, enabled, coalesce(withdrawable, FALSE) AS withdrawable, depositable,
              (image_data IS NOT NULL) AS has_image, md5(coalesce(image_data, '')) AS img_ver
         FROM bs_items ORDER BY value, id`,
    );
    const cases = await db.many(
      `SELECT id, slug, name_ru, name_uk, name_en, price, is_free, is_nick, is_share, emoji, color, sort, enabled, category_id,
              (image_data IS NOT NULL) AS has_image, md5(coalesce(image_data, '')) AS img_ver
         FROM bs_cases ORDER BY sort, id`,
    );
    catalog.categories = await db.many('SELECT id, name, sort FROM bs_categories ORDER BY sort, id');
    const links = await db.many('SELECT case_id, item_id, chance FROM bs_case_items ORDER BY case_id, item_id');
    catalog.items = new Map(items.map((i) => [i.id, i]));
    const map = new Map(cases.map((c) => [c.id, { ...c, items: [] }]));
    for (const l of links) {
      const c = map.get(l.case_id);
      const it = catalog.items.get(l.item_id);
      if (c && it) c.items.push({ item_id: l.item_id, chance: l.chance });
    }
    catalog.cases = map;
    catalog.order = cases.map((c) => c.id);
  }

  function listCases({ includeDisabled = false } = {}) {
    return catalog.order
      .map((id) => catalog.cases.get(id))
      .filter((c) => includeDisabled || (c.enabled && c.items.length > 0))
      .map(publicCase);
  }

  /** Ids of brainrots that can be withdrawn (also disabled ones a player may still hold). */
  function withdrawIds() {
    return [...catalog.items.values()].filter((i) => i.withdrawable).map((i) => i.id);
  }

  /** Ids of brainrots players can pick in a deposit by brainrots. */
  function depositIds() {
    return [...catalog.items.values()].filter((i) => i.enabled && i.depositable).map((i) => i.id);
  }

  function listCategories() {
    return catalog.categories.map((c) => ({ id: c.id, name: c.name, sort: c.sort }));
  }

  function listItems({ includeDisabled = false } = {}) {
    return [...catalog.items.values()].filter((i) => includeDisabled || i.enabled).map(publicItem);
  }

  function freeCase() {
    for (const id of catalog.order) {
      const c = catalog.cases.get(id);
      if (c.is_free && c.enabled && c.items.length) return c;
    }
    return null;
  }

  /** The nick case (free, only with the bot's name in the player's Telegram name), if switched on. */
  function nickCase() {
    for (const id of catalog.order) {
      const c = catalog.cases.get(id);
      if (c.is_nick && c.enabled && c.items.length) return c;
    }
    return null;
  }

  /** The share case (free, after sharing the bot share_case_count times), if switched on. */
  function shareCase() {
    for (const id of catalog.order) {
      const c = catalog.cases.get(id);
      if (c.is_share && c.enabled && c.items.length) return c;
    }
    return null;
  }

  /**
   * Upgrader settings as this player gets them: `luck` is the global bad luck times the
   * account's own one (bs_users.upgrade_luck, set by the main admin), so the chance the
   * player is shown is the one that is rolled.
   */
  function upgradeSettings(user) {
    const own = Math.max(1, Number(user?.upgrade_luck) || 1);
    return {
      edge: settings.get('upgrade_edge'),
      minChance: settings.get('upgrade_min_chance'),
      maxChance: settings.get('upgrade_max_chance'),
      luck: Math.round(settings.get('upgrade_luck') * own * 1e6) / 1e6,
    };
  }

  // ---------------------------------------------------------------- drops
  /** `price`: what the opening cost (paid cases), so referral stats can sum players' bets. */
  async function recordDrop(client, user, item, caseRow, kind, price = null) {
    const r = await client.query(
      'INSERT INTO bs_drops (user_id, item_id, value, case_id, kind, price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at',
      [user.id, item.id, item.value, caseRow ? caseRow.id : null, kind, price],
    );
    const drop = {
      id: r.rows[0].id,
      at: r.rows[0].created_at,
      kind,
      value: item.value,
      item: publicItem(item),
      user: { name: displayName(user) },
      caseId: caseRow ? caseRow.id : null,
    };
    // an admin's drop is kept (stats) but never shown in the live feed or the top of the day
    if (user.is_admin) Object.defineProperty(drop, 'admin', { value: true });
    return drop;
  }

  /** Puts a brainrot into the inventory; `caseId` / `ref` record where it came from (see bs_inventory). */
  async function giveItem(client, userId, item, source, { caseId = null, ref = null } = {}) {
    const r = await client.query(
      'INSERT INTO bs_inventory (user_id, item_id, source, case_id, ref_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, item.id, source, caseId, ref],
    );
    return r.rows[0].id;
  }

  // ---------------------------------------------------------------- cases
  /** Opens a paid case `count` times (1, 2, 3 or 5) in one go; the price is charged for every opening. */
  async function openCase(user, caseId, count = 1) {
    const c = catalog.cases.get(Number(caseId));
    if (!c || !c.enabled || !c.items.length) throw new GameError('case_not_found', 404);
    if (c.is_free || c.is_nick || c.is_share) throw new GameError('use_free_endpoint');
    const n = count === undefined || count === null ? 1 : Number(count);
    if (!OPEN_COUNTS.includes(n)) throw new GameError('bad_request');
    const items = Array.from({ length: n }, () => catalog.items.get(pickWeighted(c.items, rng).item_id));
    const cost = c.price * n;
    const won = items.reduce((s, it) => s + it.value, 0);
    const best = items.reduce((a, b) => (b.value > a.value ? b : a));

    const res = await db.tx(async (cl) => {
      const u = (await cl.query('SELECT id, balance FROM bs_users WHERE id = $1 FOR UPDATE', [user.id])).rows[0];
      if (!u) throw new GameError('unauthorized', 401);
      if (u.balance < cost) throw new GameError('not_enough', 400, { balance: u.balance });
      const out = [];
      for (const item of items) {
        const invId = await giveItem(cl, user.id, item, 'case', { caseId: c.id });
        const drop = await recordDrop(cl, user, item, c, 'case', c.price);
        out.push({ invId, item, drop });
      }
      const upd = await cl.query(
        `UPDATE bs_users SET balance = balance - $2, cases_opened = cases_opened + $5,
                total_spent = total_spent + $2, total_won = total_won + $3,
                best_item_id = CASE WHEN $6 > best_value THEN $4 ELSE best_item_id END,
                best_value = GREATEST(best_value, $6)
          WHERE id = $1 RETURNING balance`,
        [user.id, cost, won, best.id, n, best.value],
      );
      return { out, balance: upd.rows[0].balance };
    });
    for (const o of res.out) live?.pushDrop(o.drop);
    const drops = res.out.map((o) => ({ invId: o.invId, item: publicItem(o.item) }));
    return { invId: drops[0].invId, item: drops[0].item, drops, balance: res.balance };
  }

  /** The player shared the bot after their last FREE case (the FREE case needs one share per opening). */
  const sharedSinceFree = (u) => !!u.shared_at && (!u.free_last_at || new Date(u.shared_at) > new Date(u.free_last_at));

  function freeState(u) {
    const cooldownMs = settings.get('free_cooldown_hours') * 3600_000;
    const last = u.free_last_at ? new Date(u.free_last_at).getTime() : 0;
    const nextAt = last && last + cooldownMs > Date.now() ? new Date(last + cooldownMs).toISOString() : null;
    const channel = settings.get('channel');
    const c = freeCase();
    return {
      available: !!c,
      caseId: c ? c.id : null,
      nextAt,
      requireSub: !!(settings.get('free_require_sub') && channel),
      requireShare: !!settings.get('free_require_share'),
      shared: sharedSinceFree(u),
      channelUrl: settings.get('channel_url') || (channel.startsWith('@') ? `https://t.me/${channel.slice(1)}` : ''),
    };
  }

  async function checkSubscription(userId) {
    const channel = settings.get('channel');
    if (!channel) return true;
    if (!tg) throw new GameError('sub_check_failed', 503);
    try {
      return await tg.isSubscribed(channel, userId);
    } catch (e) {
      console.warn('[free] subscription check failed:', e.message);
      throw new GameError('sub_check_failed', 503);
    }
  }

  /** The player shared the bot: it counts for the FREE case and as one more share for the share case. */
  async function markShared(userId) {
    await db.query('UPDATE bs_users SET shared_at = now(), share_n = LEAST(share_n + 1, 1000) WHERE id = $1', [userId]);
  }

  /**
   * Hands out one brainrot from a free case (FREE, nick, share). The player's row is locked and the
   * cooldown (`col` = when they last opened this case) and `ready(u)` are checked again inside the lock,
   * so parallel requests can't claim twice; `reset` lists what the opening uses up (SET clauses).
   */
  async function claimFree(user, c, { kind, col, cooldownMs, ready = null, reset = [] }) {
    const item = catalog.items.get(pickWeighted(c.items, rng).item_id);
    const res = await db.tx(async (cl) => {
      const u = (await cl.query('SELECT * FROM bs_users WHERE id = $1 FOR UPDATE', [user.id])).rows[0];
      if (!u) throw new GameError('unauthorized', 401);
      const last = u[col] ? new Date(u[col]).getTime() : 0;
      if (last && last + cooldownMs > Date.now()) throw new GameError('cooldown', 400, { nextAt: new Date(last + cooldownMs).toISOString() });
      if (ready) ready(u);
      const invId = await giveItem(cl, user.id, item, kind, { caseId: c.id });
      const set = [`${col} = now()`, ...reset, 'cases_opened = cases_opened + 1', 'total_won = total_won + $2'];
      const upd = await cl.query(
        `UPDATE bs_users SET ${set.join(', ')},
                best_item_id = CASE WHEN $2 > best_value THEN $3 ELSE best_item_id END,
                best_value = GREATEST(best_value, $2)
          WHERE id = $1 RETURNING balance, ${col} AS last_at`,
        [user.id, item.value, item.id],
      );
      const drop = await recordDrop(cl, user, item, c, kind);
      return { invId, balance: upd.rows[0].balance, lastAt: upd.rows[0].last_at, drop };
    });
    live?.pushDrop(res.drop);
    return {
      invId: res.invId,
      item: publicItem(item),
      balance: res.balance,
      nextAt: new Date(new Date(res.lastAt).getTime() + cooldownMs).toISOString(),
    };
  }

  async function openFree(user) {
    const c = freeCase();
    if (!c) throw new GameError('case_not_found', 404);
    const st = freeState(await db.one('SELECT * FROM bs_users WHERE id = $1', [user.id]));
    if (st.nextAt) throw new GameError('cooldown', 400, { nextAt: st.nextAt });
    if (st.requireShare && !st.shared) throw new GameError('need_share');
    if (st.requireSub && !(await checkSubscription(user.id))) throw new GameError('need_sub');
    return claimFree(user, c, {
      kind: 'free',
      col: 'free_last_at',
      cooldownMs: settings.get('free_cooldown_hours') * 3600_000,
      ready: (u) => {
        if (st.requireShare && !sharedSinceFree(u)) throw new GameError('need_share');
      },
    });
  }

  // ---------------------------------------------------------------- nick case
  /** The nick case for this player: whether there is one, when it opens again (null = now) and the text needed. */
  function nickState(u) {
    const cooldownMs = settings.get('nick_cooldown_hours') * 3600_000;
    const last = u && u.nick_last_at ? new Date(u.nick_last_at).getTime() : 0;
    const nextAt = last && last + cooldownMs > Date.now() ? new Date(last + cooldownMs).toISOString() : null;
    const c = nickCase();
    return { available: !!c, caseId: c ? c.id : null, nextAt, tag: settings.get('nick_tag') };
  }

  /**
   * The player's names right now. Telegram is asked first, so putting the bot's name in, opening the app
   * and taking it out again doesn't work. If Telegram can't answer (no chat with the bot yet, bot off),
   * the names Telegram signed for this Mini App session are used, else the saved profile.
   */
  async function currentNames(user, tgUser) {
    if (tg && tg.enabled) {
      try {
        return await tg.userNames(user.id);
      } catch {
        // falls back below
      }
    }
    return tgUser || user;
  }

  /** Opens the nick case: free, once per nick_cooldown_hours, only with nick_tag in the player's Telegram name. */
  async function openNick(user, tgUser) {
    const c = nickCase();
    if (!c) throw new GameError('case_not_found', 404);
    const st = nickState(await db.one('SELECT nick_last_at FROM bs_users WHERE id = $1', [user.id]));
    if (st.nextAt) throw new GameError('cooldown', 400, { nextAt: st.nextAt });
    if (!hasNickTag(await currentNames(user, tgUser), st.tag)) throw new GameError('need_nick', 400, { tag: st.tag });
    return claimFree(user, c, { kind: 'nick', col: 'nick_last_at', cooldownMs: settings.get('nick_cooldown_hours') * 3600_000 });
  }

  // ---------------------------------------------------------------- share case
  /** The share case for this player: whether there is one, when it opens again (null = now), shares done and needed. */
  function shareState(u) {
    const cooldownMs = settings.get('share_cooldown_hours') * 3600_000;
    const last = u && u.share_last_at ? new Date(u.share_last_at).getTime() : 0;
    const nextAt = last && last + cooldownMs > Date.now() ? new Date(last + cooldownMs).toISOString() : null;
    const need = settings.get('share_case_count');
    const c = shareCase();
    return {
      available: !!c,
      caseId: c ? c.id : null,
      nextAt,
      need,
      have: Math.min(Number(u && u.share_n) || 0, need),
      requireSub: !!(settings.get('share_require_sub') && settings.get('channel')),
    };
  }

  /**
   * Opens the share case: free, once per share_cooldown_hours, after share_case_count shares of the bot
   * since the last opening. A share counts when Telegram reports it sent (it doesn't say to which chat).
   */
  async function openShare(user) {
    const c = shareCase();
    if (!c) throw new GameError('case_not_found', 404);
    const st = shareState(await db.one('SELECT share_n, share_last_at FROM bs_users WHERE id = $1', [user.id]));
    if (st.nextAt) throw new GameError('cooldown', 400, { nextAt: st.nextAt });
    const short = (have) => new GameError('need_shares', 400, { have: Math.min(have, st.need), need: st.need });
    if (st.have < st.need) throw short(st.have);
    if (st.requireSub && !(await checkSubscription(user.id))) throw new GameError('need_sub');
    return claimFree(user, c, {
      kind: 'share',
      col: 'share_last_at',
      cooldownMs: settings.get('share_cooldown_hours') * 3600_000,
      ready: (u) => {
        if (u.share_n < st.need) throw short(u.share_n);
      },
      reset: ['share_n = 0'],
    });
  }

  // ---------------------------------------------------------------- inventory
  async function inventory(userId) {
    const rows = await db.many(
      'SELECT id, item_id, created_at FROM bs_inventory WHERE user_id = $1 ORDER BY id DESC LIMIT 1000',
      [userId],
    );
    return rows
      .map((r) => ({ invId: r.id, at: r.created_at, item: publicItem(catalog.items.get(r.item_id)) }))
      .filter((r) => r.item);
  }

  function parseIds(ids, max = 1000) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > max) throw new GameError('bad_request');
    const out = [...new Set(ids.map(Number))];
    if (out.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new GameError('bad_request');
    return out;
  }

  async function sell(userId, { ids, all } = {}) {
    const list = all ? null : parseIds(ids);
    return db.tx(async (cl) => {
      await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [userId]);
      const del = all
        ? await cl.query('DELETE FROM bs_inventory WHERE user_id = $1 RETURNING item_id', [userId])
        : await cl.query('DELETE FROM bs_inventory WHERE user_id = $1 AND id = ANY($2::bigint[]) RETURNING item_id', [
            userId,
            list,
          ]);
      if (!all && del.rowCount !== list.length) throw new GameError('items_missing');
      const total = del.rows.reduce((s, r) => s + (catalog.items.get(r.item_id)?.value || 0), 0);
      const upd = await cl.query(
        'UPDATE bs_users SET balance = balance + $2, sold_value = sold_value + $2 WHERE id = $1 RETURNING balance',
        [userId, total],
      );
      return { sold: del.rowCount, amount: total, balance: upd.rows[0].balance };
    });
  }

  // ---------------------------------------------------------------- upgrader
  async function upgrade(user, { ids, target, chance: shown }) {
    const list = parseIds(ids, 6);
    const targetItem = catalog.items.get(Number(target));
    if (!targetItem || !targetItem.enabled) throw new GameError('item_not_found', 404);

    const res = await db.tx(async (cl) => {
      const me = (await cl.query('SELECT upgrade_luck FROM bs_users WHERE id = $1 FOR UPDATE', [user.id])).rows[0];
      const s = upgradeSettings(me);
      const inv = await cl.query(
        'SELECT id, item_id FROM bs_inventory WHERE user_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE',
        [user.id, list],
      );
      if (inv.rowCount !== list.length) throw new GameError('items_missing');
      const bet = inv.rows.reduce((sum, r) => sum + (catalog.items.get(r.item_id)?.value || 0), 0);
      if (targetItem.value <= bet) throw new GameError('target_too_cheap');
      const chance = upgradeChance(bet, targetItem.value, s.edge, s.maxChance, s.luck);
      if (chance < s.minChance) throw new GameError('chance_too_low');
      // the player must have been shown this very chance (settings or prices may have changed since)
      if (Number(shown) !== chance) throw new GameError('chance_changed', 409, { chance });
      const roll = rng.int(100000) / 1000;
      const won = roll < chance;
      await cl.query('DELETE FROM bs_inventory WHERE id = ANY($1::bigint[])', [list]);
      const up = await cl.query(
        'INSERT INTO bs_upgrades (user_id, bet_value, target_item_id, chance, roll, won) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [user.id, bet, targetItem.id, chance, roll, won],
      );
      let invId = null;
      let drop = null;
      if (won) {
        invId = await giveItem(cl, user.id, targetItem, 'upgrade', { ref: up.rows[0].id });
        drop = await recordDrop(cl, user, targetItem, null, 'upgrade');
      }
      await cl.query(
        `UPDATE bs_users SET upgrades_total = upgrades_total + 1, upgrades_won = upgrades_won + $2,
                best_item_id = CASE WHEN $2 = 1 AND $3 > best_value THEN $4 ELSE best_item_id END,
                best_value = CASE WHEN $2 = 1 THEN GREATEST(best_value, $3) ELSE best_value END
          WHERE id = $1`,
        [user.id, won ? 1 : 0, targetItem.value, targetItem.id],
      );
      return { won, roll, chance, bet, invId, drop };
    });
    if (res.drop) live?.pushDrop(res.drop, live.upgradeDelayMs);
    return { won: res.won, roll: res.roll, chance: res.chance, bet: res.bet, invId: res.invId, item: publicItem(targetItem) };
  }

  // ---------------------------------------------------------------- promo
  function normalizeCode(code) {
    return String(code || '')
      .trim()
      .toUpperCase()
      .slice(0, 40);
  }

  async function redeemPromo(userId, rawCode) {
    const code = normalizeCode(rawCode);
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new GameError('promo_invalid');
    return db.tx(async (cl) => {
      const p = (await cl.query('SELECT * FROM bs_promo_codes WHERE code = $1 FOR UPDATE', [code])).rows[0];
      if (!p || !p.active) throw new GameError('promo_invalid');
      if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) throw new GameError('promo_expired');
      if (p.uses >= p.max_uses) throw new GameError('promo_limit');
      const ins = await cl.query(
        'INSERT INTO bs_promo_uses (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code',
        [code, userId],
      );
      if (!ins.rowCount) throw new GameError('promo_used');
      await cl.query('UPDATE bs_promo_codes SET uses = uses + 1 WHERE code = $1', [code]);
      const upd = await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1 RETURNING balance', [
        userId,
        p.amount,
      ]);
      if (!upd.rowCount) throw new GameError('unauthorized', 401);
      await cl.query("INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, 'promo:' || $3)", [
        userId,
        p.amount,
        code,
      ]);
      return { code, amount: p.amount, balance: upd.rows[0].balance };
    });
  }

  // ---------------------------------------------------------------- stats
  async function stats(userId) {
    const u = await db.one('SELECT * FROM bs_users WHERE id = $1', [userId]);
    if (!u) return null;
    const inv = await db.one(
      'SELECT count(*)::int AS n, coalesce(sum(it.value), 0)::bigint AS v FROM bs_inventory inv JOIN bs_items it ON it.id = inv.item_id WHERE inv.user_id = $1',
      [userId],
    );
    return {
      casesOpened: u.cases_opened,
      totalSpent: u.total_spent,
      totalWon: u.total_won,
      bestDrop: u.best_item_id ? publicItem(catalog.items.get(u.best_item_id)) : null,
      upgradesTotal: u.upgrades_total,
      upgradesWon: u.upgrades_won,
      soldValue: u.sold_value,
      inventoryCount: inv.n,
      inventoryValue: inv.v,
      since: u.created_at,
    };
  }

  return {
    catalog,
    reloadCatalog,
    listCases,
    listCategories,
    withdrawIds,
    depositIds,
    listItems,
    publicItem,
    caseImage,
    freeCase,
    freeState,
    nickCase,
    nickState,
    shareCase,
    shareState,
    upgradeSettings,
    openCase,
    openFree,
    openNick,
    openShare,
    checkSubscription,
    markShared,
    inventory,
    sell,
    upgrade,
    redeemPromo,
    normalizeCode,
    stats,
    giveItem,
    recordDrop,
  };
}
