// Referral codes: admins make a code for a streamer or partner, a player types it in when topping
// up (once: the player stays with that code) and the admin panel shows what each code brought.
// Only deposits made after the player got the code count. The main admin can stop counting
// Telegram Stars payments for all codes (setting ref_count_stars).
//
// Levels: players of a code get +% coins on their top-ups. The % comes from the referral levels
// (setting ref_levels, main admin): the more of the code's players have topped up, the higher the
// level. The main admin can give a code its own % instead (bonus_pct; NULL = by level). A code can
// belong to a partner (owner_id), who then sees its players, stats and level in the app.
import { GameError, displayName } from './game.js';

export const REF_RE = /^[A-Z0-9_-]{3,32}$/;
export const normRef = (raw) =>
  String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

/**
 * Once per database, when the levels come in: codes that gave no bonus (0 %) go by the levels; codes
 * with a bonus keep it as their own %. After that a 0 % set by the main admin stays 0 %.
 */
export async function levelsOnce(db, settings) {
  if (settings.get('_ref_levels_1')) return 0;
  const r = await db.query('UPDATE bs_ref_codes SET bonus_pct = NULL WHERE bonus_pct = 0');
  await settings.setInternal('_ref_levels_1', true);
  return r.rowCount;
}

// deposits of players that came with a code, made after they got it
const DEPOSITS = `
    SELECT u.ref_code, r.user_id, r.method, r.stars, r.coins,
           r.coins + (SELECT coalesce(sum((e->>'value')::bigint), 0) FROM jsonb_array_elements(r.items) e) AS value
      FROM bs_requests r JOIN bs_users u ON u.id = r.user_id
     WHERE u.ref_code IS NOT NULL AND r.kind = 'deposit' AND r.status = 'done' AND r.created_at >= u.ref_at`;

/**
 * The player `u` of a code has topped up since they got it (a done deposit that brought coins or
 * brainrots): such players make the code's level. Parameter `$p` = whether Stars payments count.
 */
const PAID = (u, p) => `EXISTS (SELECT 1 FROM bs_requests r
      WHERE r.user_id = ${u}.id AND r.kind = 'deposit' AND r.status = 'done' AND r.created_at >= ${u}.ref_at
        AND (r.coins > 0 OR jsonb_array_length(r.items) > 0) AND (r.method = 'brainrot' OR $${p}::boolean))`;

/**
 * Everything a code's players did since they got it: $1 = code, $2 = whether Stars payments count
 * (for the level), $3 = whether they count in the deposit sum (not for admins who can't see them).
 */
const STATS = `
  SELECT
    (SELECT count(*)::int FROM bs_users u WHERE u.ref_code = $1) AS players,
    (SELECT count(*)::int FROM bs_users u WHERE u.ref_code = $1 AND ${PAID('u', 2)}) AS paying,
    (SELECT coalesce(sum(d.value), 0)::bigint FROM (${DEPOSITS}) d WHERE d.ref_code = $1 AND (d.method = 'brainrot' OR $3::boolean)) AS deposits,
    (SELECT coalesce(sum(r.total), 0)::bigint FROM bs_requests r JOIN bs_users u ON u.id = r.user_id
      WHERE u.ref_code = $1 AND r.kind = 'withdraw' AND r.status = 'done' AND r.created_at >= u.ref_at) AS withdrawals,
    (SELECT coalesce(sum(coalesce(d.price, c.price, 0)), 0)::bigint FROM bs_drops d JOIN bs_users u ON u.id = d.user_id
      LEFT JOIN bs_cases c ON c.id = d.case_id
      WHERE u.ref_code = $1 AND d.kind = 'case' AND d.created_at >= u.ref_at)
    + (SELECT coalesce(sum(g.bet_value), 0)::bigint FROM bs_upgrades g JOIN bs_users u ON u.id = g.user_id
      WHERE u.ref_code = $1 AND g.created_at >= u.ref_at)
    + (SELECT coalesce(sum(k.bet), 0)::bigint FROM bs_crash k JOIN bs_users u ON u.id = k.user_id
      WHERE u.ref_code = $1 AND k.created_at >= u.ref_at)
    + (SELECT coalesce(sum(x.bet), 0)::bigint FROM bs_dice x JOIN bs_users u ON u.id = x.user_id
      WHERE u.ref_code = $1 AND x.created_at >= u.ref_at) AS bets,
    (SELECT coalesce(sum(r.bonus), 0)::bigint FROM bs_requests r JOIN bs_users u ON u.id = r.user_id
      WHERE u.ref_code = $1 AND r.kind = 'deposit' AND r.created_at >= u.ref_at) AS bonus`;

// a code with its partner and how many players came / topped up ($p = whether Stars payments count)
const codeCols = (p) => `c.code, c.note, c.bonus_pct, c.active, c.created_at, c.owner_id,
       o.first_name AS owner_first, o.username AS owner_username,
       (SELECT count(*)::int FROM bs_users u WHERE u.ref_code = c.code) AS players,
       (SELECT count(*)::int FROM bs_users u WHERE u.ref_code = c.code AND ${PAID('u', p)}) AS paying`;

// deposits done: brainrots (count, coins credited + brainrots given) and Stars payments
const SUMS = `count(*) FILTER (WHERE d.method = 'brainrot')::int AS dep_n,
                coalesce(sum(d.value) FILTER (WHERE d.method = 'brainrot'), 0)::bigint AS dep_value,
                count(*) FILTER (WHERE d.method = 'stars')::int AS stars_n,
                coalesce(sum(d.stars) FILTER (WHERE d.method = 'stars'), 0)::bigint AS stars_sum,
                coalesce(sum(d.coins) FILTER (WHERE d.method = 'stars'), 0)::bigint AS stars_coins`;

export function createReferrals({ db, settings }) {
  /** Do Telegram Stars payments count for codes (deposit sums and levels)? */
  const starsCount = () => settings.get('ref_count_stars') !== false;
  /** Are Stars payments shown to this viewer? */
  const starsShown = (canSeeStars) => starsCount() && !!canSeeStars;
  /** The levels: [{n, from, pct}], n from 1. */
  const ladder = () => settings.get('ref_levels').map((l, i) => ({ n: i + 1, from: l.from, pct: l.pct }));

  /** The level for this many players who topped up, and the next one (null at the top). */
  function levelFor(paying) {
    const L = ladder();
    let i = 0;
    for (let k = 0; k < L.length; k++) if (paying >= L[k].from) i = k;
    return { level: L[i], next: L[i + 1] || null };
  }

  /** What a code's players get on top-ups: the code's own % (main admin) or its level's. */
  function terms(ownPct, paying) {
    const { level, next } = levelFor(paying);
    const own = ownPct !== null && ownPct !== undefined;
    return { pct: own ? Number(ownPct) : level.pct, own, level, next };
  }

  async function codeStats(code, { showStars = true } = {}) {
    const r = await db.one(STATS, [code, starsCount(), starsCount() && showStars]);
    return {
      players: r.players,
      paying: r.paying,
      deposits: Number(r.deposits),
      withdrawals: Number(r.withdrawals),
      bets: Number(r.bets),
      bonus: Number(r.bonus),
    };
  }

  /**
   * Ties the player to the code the first time they type one in; later codes are ignored.
   * Returns the player's code (null if none). A wrong or switched-off code is refused.
   */
  async function bind(user, raw) {
    if (user.ref_code) return user.ref_code;
    const code = normRef(raw);
    if (!code) return null;
    if (!REF_RE.test(code)) throw new GameError('bad_ref');
    const ok = await db.one('SELECT code FROM bs_ref_codes WHERE code = $1 AND active', [code]);
    if (!ok) throw new GameError('bad_ref');
    await db.query('UPDATE bs_users SET ref_code = $2, ref_at = now() WHERE id = $1 AND ref_code IS NULL', [user.id, code]);
    const u = await db.one('SELECT ref_code FROM bs_users WHERE id = $1', [user.id]);
    user.ref_code = u.ref_code;
    return u.ref_code;
  }

  /** Brainrot deposits done (count, coins credited + brainrots given) and Stars payments if shown. */
  const depStats = (r, stars) => {
    const out = { deposits: Number(r.dep_n || 0), depositValue: Number(r.dep_value || 0) };
    if (stars) Object.assign(out, { starsPayments: Number(r.stars_n || 0), stars: Number(r.stars_sum || 0), starsCoins: Number(r.stars_coins || 0) });
    return out;
  };

  const ownerOf = (r) =>
    r.owner_id
      ? { id: Number(r.owner_id), name: displayName({ id: r.owner_id, first_name: r.owner_first, username: r.owner_username }), username: r.owner_username || null }
      : null;

  /** A code as admins see it; its own %, the % its players get and the levels only for the main admin. */
  function adminCode(r, stars, canSeeBonus) {
    const t = terms(r.bonus_pct, r.paying);
    return {
      code: r.code,
      note: r.note,
      active: r.active,
      createdAt: r.created_at,
      players: r.players,
      paying: r.paying,
      level: t.level.n,
      owner: ownerOf(r),
      ...(canSeeBonus ? { bonusPct: t.own ? Number(r.bonus_pct) : null, pct: t.pct } : {}),
      ...depStats(r, stars),
    };
  }

  async function list({ canSeeStars = true, canSeeBonus = true } = {}) {
    const stars = starsShown(canSeeStars);
    const rows = await db.many(
      `SELECT ${codeCols(1)}, s.*
         FROM bs_ref_codes c
         LEFT JOIN bs_users o ON o.id = c.owner_id
         LEFT JOIN LATERAL (SELECT ${SUMS} FROM (${DEPOSITS}) d WHERE d.ref_code = c.code) s ON TRUE
        ORDER BY c.created_at DESC, c.code LIMIT 500`,
      [starsCount()],
    );
    return {
      stars,
      canBonus: !!canSeeBonus,
      ...(canSeeBonus ? { levels: ladder() } : {}),
      codes: rows.map((r) => adminCode(r, stars, canSeeBonus)),
    };
  }

  async function detail(rawCode, { canSeeStars = true, canSeeBonus = true } = {}) {
    const code = normRef(rawCode);
    const stars = starsShown(canSeeStars);
    const c = await db.one(`SELECT ${codeCols(2)} FROM bs_ref_codes c LEFT JOIN bs_users o ON o.id = c.owner_id WHERE c.code = $1`, [code, starsCount()]);
    if (!c) throw new GameError('not_found', 404);
    const players = await db.many(
      `SELECT u.id, u.first_name, u.username, u.ref_at, ${PAID('u', 2)} AS paid, s.*
         FROM bs_users u
         LEFT JOIN LATERAL (SELECT ${SUMS} FROM (${DEPOSITS}) d WHERE d.user_id = u.id) s ON TRUE
        WHERE u.ref_code = $1 ORDER BY u.ref_at DESC LIMIT 500`,
      [code, starsCount()],
    );
    const total = { dep_n: 0, dep_value: 0, stars_n: 0, stars_sum: 0, stars_coins: 0 };
    for (const p of players) for (const k of Object.keys(total)) total[k] += Number(p[k] || 0);
    return {
      stars,
      canBonus: !!canSeeBonus,
      ...(canSeeBonus ? { levels: ladder() } : {}),
      code: { ...adminCode({ ...c, ...total }, stars, canSeeBonus), stats: await codeStats(code, { showStars: stars }) },
      players: players.map((p) => ({
        id: Number(p.id),
        name: p.first_name || (p.username ? '@' + p.username : `#${p.id}`),
        username: p.username,
        at: p.ref_at,
        paid: p.paid,
        ...depStats(p, stars),
      })),
    };
  }

  /**
   * The partner's own codes, as the app shows them: what the players get (own % or the level's, and
   * the next level), the whole ladder, the stats and the players (public names only).
   */
  async function mine(userId) {
    const codes = await db.many('SELECT code, bonus_pct, active FROM bs_ref_codes WHERE owner_id = $1 ORDER BY created_at, code LIMIT 20', [userId]);
    const out = [];
    for (const c of codes) {
      const stats = await codeStats(c.code);
      const players = await db.many(
        `SELECT u.id, u.first_name, u.username, u.ref_at, ${PAID('u', 2)} AS paid
           FROM bs_users u WHERE u.ref_code = $1 ORDER BY u.ref_at DESC, u.id DESC LIMIT 100`,
        [c.code, starsCount()],
      );
      out.push({
        code: c.code,
        active: c.active,
        ...terms(c.bonus_pct, stats.paying),
        levels: ladder(),
        stats,
        players: players.map((p) => ({ name: displayName(p), at: p.ref_at, paid: p.paid })),
      });
    }
    return { codes: out };
  }

  /** Does the player have a referral code of their own (a partner)? */
  async function isPartner(userId) {
    return !!(await db.one('SELECT 1 AS ok FROM bs_ref_codes WHERE owner_id = $1 LIMIT 1', [userId]));
  }

  /** The code's own bonus %: 0..500, two decimals; null or '' = by level. */
  function cleanBonus(v) {
    if (v === null || v === '') return null;
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 500) throw new GameError('bad_field', 400, { field: 'bonusPct' });
    return Math.round(n * 100) / 100;
  }

  /** The partner of a code: their Telegram ID or @username (they must have opened the bot); '' or null unlinks. */
  async function cleanOwner(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const s = String(v).trim();
    let u = null;
    if (/^\d{1,15}$/.test(s)) u = await db.one('SELECT id FROM bs_users WHERE id = $1', [s]);
    else if (/^@?[A-Za-z0-9_]{3,32}$/.test(s)) u = await db.one('SELECT id FROM bs_users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1', [s.replace(/^@/, '')]);
    if (!u) throw new GameError('partner_not_found');
    return Number(u.id);
  }

  async function create(admin, body = {}) {
    const code = normRef(body.code);
    if (!REF_RE.test(code)) throw new GameError('bad_field', 400, { field: 'code' });
    const note = String(body.note ?? '').trim().slice(0, 100);
    const bonus = body.bonusPct === undefined ? null : cleanBonus(body.bonusPct);
    const owner = await cleanOwner(body.owner);
    const r = await db.one(
      'INSERT INTO bs_ref_codes (code, note, bonus_pct, created_by, owner_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING RETURNING code',
      [code, note, bonus, admin.id, owner],
    );
    if (!r) throw new GameError('ref_exists');
    return code;
  }

  async function update(rawCode, body = {}) {
    const code = normRef(rawCode);
    const sets = [];
    const vals = [code];
    const set = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw new GameError('bad_field', 400, { field: 'active' });
      set('active', body.active);
    }
    if (body.note !== undefined) set('note', String(body.note ?? '').trim().slice(0, 100));
    if (body.bonusPct !== undefined) set('bonus_pct', cleanBonus(body.bonusPct));
    if (body.owner !== undefined) set('owner_id', await cleanOwner(body.owner));
    if (!sets.length) throw new GameError('bad_request');
    const r = await db.one(`UPDATE bs_ref_codes SET ${sets.join(', ')} WHERE code = $1 RETURNING code`, vals);
    if (!r) throw new GameError('not_found', 404);
    return code;
  }

  /**
   * Extra coins a player gets on a deposit: the % of their active code — its own, or its level's by
   * how many of its players had topped up before this deposit; 0 without a code. Call it before the
   * deposit itself is stored as done.
   */
  async function bonusCoins(cl, userId, baseCoins) {
    if (!(baseCoins > 0)) return 0;
    const r = (await cl.query('SELECT c.code, c.bonus_pct FROM bs_users u JOIN bs_ref_codes c ON c.code = u.ref_code AND c.active WHERE u.id = $1', [userId])).rows[0];
    if (!r) return 0;
    let pct = r.bonus_pct;
    if (pct === null) {
      const paying = (await cl.query(`SELECT count(*)::int AS n FROM bs_users u WHERE u.ref_code = $1 AND ${PAID('u', 2)}`, [r.code, starsCount()])).rows[0].n;
      pct = levelFor(paying).level.pct;
    }
    pct = Number(pct);
    return pct > 0 ? Math.floor((baseCoins * pct) / 100) : 0;
  }

  /** Is there such a referral code (switched on or off)? */
  async function exists(raw) {
    const code = normRef(raw);
    return REF_RE.test(code) && !!(await db.one('SELECT 1 AS x FROM bs_ref_codes WHERE code = $1', [code]));
  }

  /** Deleting a code also unties its players (they can type in another one). */
  async function remove(rawCode) {
    const code = normRef(rawCode);
    const del = await db.query('DELETE FROM bs_ref_codes WHERE code = $1', [code]);
    if (!del.rowCount) throw new GameError('not_found', 404);
  }

  return { bind, exists, bonusCoins, list, detail, mine, isPartner, create, update, remove, levelFor, codeStats };
}
